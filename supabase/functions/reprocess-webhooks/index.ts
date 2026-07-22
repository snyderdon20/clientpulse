/**
 * reprocess-webhooks — Supabase Edge Function
 *
 * Replays EVERY event stored in webhook_log, oldest first → newest last,
 * exactly as the live vagaro-webhook handler would have processed them:
 *
 *   customer.*    → create missing clients / update profile fields
 *   appointment.* → upsert appointments (by vagaro_appt_id)
 *   transaction.* → insert missing transactions, link client_id
 *
 * Then recalculates per-client metrics from the appointments table:
 *   clients.last_visit, clients.completed_appointments_count, clients.no_shows
 *
 * Safe to run multiple times — all writes are idempotent.
 *
 * Optimized for Edge Function compute limits: events are deduped to the
 * latest state per entity, writes are batched in chunks, and metrics come
 * from a single pass over the appointments table.
 *
 * Requires the appointments.vagaro_appt_id column + unique index
 * (migration 20260706_appointments_vagaro_appt_id.sql).
 * Deployed via .github/workflows/deploy-functions.yml on merge to main.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const str    = (v: unknown): string => (v != null ? String(v) : "");
const orNull = (v: unknown) => str(v) || null;
const num    = (v: unknown) => (v != null && v !== "" ? Number(v) : null);

const PAGE = 1000;
const CHUNK = 500;
const CONCURRENCY = 20;

// Vagaro appointment timestamps have a "Z" suffix but are really the studio's
// Mountain Standard wall clock + a fixed 7 hours (no DST). Subtracting 7h
// recovers the local date and HH:MM.
const VAGARO_OFFSET_MS = 7 * 60 * 60 * 1000;
function vagaroLocal(raw: string): { date: string; time: string } | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() - VAGARO_OFFSET_MS).toISOString();
  return { date: shifted.split("T")[0], time: shifted.split("T")[1].slice(0, 5) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Prefetch lookups ────────────────────────────────────────────────────────
  const clientMap = new Map<string, string>(); // vagaro_id → client id
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("clients").select("id, vagaro_id")
      .not("vagaro_id", "is", null)
      .order("id", { ascending: true }) // stable order — unordered range pagination skips/repeats rows
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);
    for (const c of data ?? []) clientMap.set(str(c.vagaro_id), str(c.id));
    if (!data || data.length < PAGE) break;
  }

  const staffMap = new Map<string, string>(); // vagaro_provider_id → full_name
  {
    const { data: staffRows } = await sb
      .from("staff").select("full_name, vagaro_provider_id")
      .not("vagaro_provider_id", "is", null);
    for (const s of staffRows ?? []) staffMap.set(str(s.vagaro_provider_id), str(s.full_name));
  }

  // Vagaro bookingStatus vocabulary observed in live webhook data:
  // accepted, confirmed, need acceptance, awaiting confirmation,
  // service completed, show, service in progress, cancel, deleted,
  // denied, no show
  const statusMap: Record<string, string> = {
    accepted: "scheduled", requested: "scheduled", booked: "scheduled",
    confirmed: "scheduled", pending: "scheduled", rescheduled: "scheduled",
    "need acceptance": "scheduled", "awaiting confirmation": "scheduled",
    "checked in": "checked-in", checkedin: "checked-in", "checked-in": "checked-in",
    "service in progress": "checked-in", "ready to start": "checked-in",
    completed: "completed", serviced: "completed", show: "completed",
    "service completed": "completed",
    cancelled: "cancelled", canceled: "cancelled", cancel: "cancelled",
    deleted: "cancelled", denied: "cancelled",
    "no show": "no-show", noshow: "no-show", "no-show": "no-show",
  };
  const statusBreakdown: Record<string, number> = {};

  // ── Counters ────────────────────────────────────────────────────────────────
  let scanned = 0;
  let placeholdersCreated = 0;
  let customersCreated = 0, customersUpdated = 0;
  let apptEvents = 0, skippedNoClient = 0, skippedNoApptId = 0;
  let txEvents = 0;

  // Latest-state accumulators (log is scanned oldest → newest, so later
  // entries overwrite earlier ones — newest state wins)
  const latestApptById  = new Map<string, Record<string, unknown>>();
  const latestClientUpd = new Map<string, Record<string, unknown>>(); // client id → field updates
  const latestTxByKey   = new Map<string, Record<string, unknown>>(); // txId|item → row
  const affectedClientIds = new Set<string>();

  // ── Single chronological pass over ALL webhook_log entries ────────────────
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await sb
      .from("webhook_log")
      .select("event_type, payload")
      .order("received_at", { ascending: true })
      .order("id", { ascending: true }) // tie-breaker so pagination is fully stable
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);

    for (const row of rows ?? []) {
      scanned++;
      const event = str(row.event_type);
      const body  = row.payload as Record<string, unknown>;
      const data  = (body.payload ?? body.Payload ?? body.Data ?? body.data ?? {}) as Record<string, unknown>;

      // ── customer.* ─────────────────────────────────────────────────────────
      if (event.startsWith("customer.")) {
        const vagaro_id = orNull(data.customerId ?? data.CustomerId);
        if (!vagaro_id) continue;
        const firstName = str(data.customerFirstName ?? data.FirstName ?? data.firstName);
        const lastName  = str(data.customerLastName  ?? data.LastName  ?? data.lastName);

        if (!clientMap.has(vagaro_id)) {
          if (!firstName && !lastName) continue;
          const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
          const { data: inserted, error: insErr } = await sb.from("clients").insert({
            vagaro_id, vagaro_synced: true,
            first_name: firstName, last_name: lastName,
            email: orNull(data.email ?? data.Email),
            phone: orNull(data.mobilePhone ?? data.MobilePhone ?? data.dayPhone ?? data.Phone),
            birthday: orNull(data.birthday ?? data.Birthday),
            address: orNull(data.streetAddress ?? data.Address1 ?? data.address),
            city: orNull(data.city ?? data.City),
            state: orNull(data.regionCode ?? data.State ?? data.state),
            zip: orNull(data.postalCode ?? data.Zip ?? data.zip),
            customer_since: orNull(str(data.createdDate ?? "").split("T")[0]) ?? today,
            avg_visit_interval_days: 30, waitlisted: false, tags: [], golden_nuggets: [],
          }).select("id").single();
          if (!insErr && inserted) {
            clientMap.set(vagaro_id, str(inserted.id));
            customersCreated++;
          }
        } else {
          // Existing client — collect latest non-empty field values (newest wins)
          const clientId = clientMap.get(vagaro_id)!;
          const updates = latestClientUpd.get(clientId) ?? {};
          const maybe = (col: string, ...vals: unknown[]) => {
            const v = vals.find((x) => x != null && str(x) !== "");
            if (v !== undefined) updates[col] = str(v);
          };
          maybe("first_name", data.customerFirstName, data.FirstName);
          maybe("last_name",  data.customerLastName,  data.LastName);
          maybe("email",      data.email,  data.Email);
          maybe("phone",      data.mobilePhone, data.MobilePhone, data.dayPhone);
          maybe("address",    data.streetAddress, data.Address1);
          maybe("city",       data.city,  data.City);
          maybe("state",      data.regionCode, data.State);
          maybe("zip",        data.postalCode, data.Zip);
          maybe("birthday",   data.birthday, data.Birthday);
          if (Object.keys(updates).length > 0) latestClientUpd.set(clientId, updates);
        }
        continue;
      }

      // ── appointment.* ──────────────────────────────────────────────────────
      if (event.startsWith("appointment.")) {
        apptEvents++;
        const vagaro_customer_id = orNull(data.customerId ?? data.CustomerId);
        const vagaro_appt_id     = orNull(data.appointmentId ?? data.AppointmentId ?? data.Id);
        if (!vagaro_customer_id) { skippedNoClient++; continue; }
        let clientId = clientMap.get(vagaro_customer_id);
        if (!clientId) {
          // Unknown customer — create a placeholder so the appointment isn't
          // dropped. "Sync all clients from Vagaro" fills in real details.
          const suffix = vagaro_customer_id.replace(/[^a-zA-Z0-9]/g, "").slice(-6);
          const today  = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
          const { data: createdRow, error: createErr } = await sb.from("clients").insert({
            vagaro_id: vagaro_customer_id, vagaro_synced: true,
            first_name: "Vagaro", last_name: `Client ${suffix}`,
            customer_since: today, avg_visit_interval_days: 30,
            waitlisted: false, tags: [], golden_nuggets: [],
          }).select("id").single();
          if (createErr || !createdRow) { skippedNoClient++; continue; }
          clientId = str(createdRow.id);
          clientMap.set(vagaro_customer_id, clientId);
          placeholdersCreated++;
        }

        const startRaw = str(data.startDateTime ?? data.StartDateTime ?? data.startTime ?? data.StartTime ?? data.startDate ?? data.StartDate ?? "");
        const endRaw   = str(data.endDateTime   ?? data.EndDateTime   ?? data.endTime   ?? data.EndTime   ?? "");
        const startLoc = vagaroLocal(startRaw);
        const apptDate = startLoc?.date ?? null;
        const apptTime = startLoc?.time ?? null;

        const rawStatus = str(data.bookingStatus ?? data.BookingStatus ?? data.status ?? data.Status ?? "").toLowerCase().trim();
        statusBreakdown[rawStatus || "(empty)"] = (statusBreakdown[rawStatus || "(empty)"] ?? 0) + 1;
        const status = statusMap[rawStatus] ??
          (event === "appointment.cancelled" ? "cancelled" :
           event === "appointment.completed" ? "completed" :
           event === "appointment.checkedin" ? "checked-in" :
           event === "appointment.noshow"    ? "no-show"   : "scheduled");

        const service = orNull(data.serviceTitle ?? data.ServiceTitle ?? data.serviceName ?? data.ServiceName ?? data.service);
        const providerId = orNull(data.serviceProviderId ?? data.ServiceProviderId);
        const therapist  = orNull(data.providerName ?? data.ProviderName ?? data.serviceProviderName)
          ?? (providerId ? staffMap.get(providerId) ?? null : null);

        let duration = num(data.duration ?? data.Duration);
        if (duration == null && startRaw && endRaw) {
          const ms = new Date(endRaw).getTime() - new Date(startRaw).getTime();
          if (!isNaN(ms) && ms > 0) duration = Math.round(ms / 60000);
        }

        if (!apptDate || !vagaro_appt_id) { skippedNoApptId++; continue; }

        latestApptById.set(vagaro_appt_id, {
          vagaro_appt_id, client_id: clientId,
          date: apptDate, time: apptTime ?? null,
          service: service ?? "Appointment",
          duration: duration ?? null, therapist: therapist ?? null, status,
        });
        affectedClientIds.add(clientId);
        continue;
      }

      // ── transaction.* ──────────────────────────────────────────────────────
      if (event.startsWith("transaction.")) {
        const vagaro_transaction_id = orNull(data.transactionId ?? data.TransactionId ?? data.Id ?? data.id);
        if (!vagaro_transaction_id) continue;
        txEvents++;

        const vagaro_customer_id = orNull(data.customerId ?? data.CustomerId);
        const client_id = vagaro_customer_id ? clientMap.get(vagaro_customer_id) ?? null : null;

        const dateRaw = str(data.checkoutDate ?? data.CheckoutDate ?? data.transactionDate ?? data.TransactionDate ?? data.createdDate ?? data.CreatedDate ?? "");
        const transaction_date = dateRaw ? (dateRaw.includes("T") ? dateRaw : dateRaw + "T12:00:00Z") : null;
        const item_sold = orNull(data.itemSold ?? data.ItemSold ?? data.serviceName ?? data.ServiceName ?? data.name ?? data.Name);

        latestTxByKey.set(`${vagaro_transaction_id}|${item_sold ?? ""}`, {
          vagaro_transaction_id, vagaro_customer_id,
          vagaro_service_provider_id: orNull(
            data.serviceProviderName ?? data.ServiceProviderName ??
            data.providerName ?? data.ProviderName ??
            data.serviceProviderId ?? data.ServiceProviderId ??
            data.staffName ?? data.StaffName),
          client_id, transaction_date, item_sold,
          purchase_type: orNull(data.purchaseType ?? data.PurchaseType ?? data.transactionType ?? data.TransactionType ?? data.type ?? data.Type),
          quantity: num(data.quantity ?? data.Quantity) ?? 1,
          tax: num(data.tax ?? data.Tax),
          tip: num(data.tip ?? data.Tip),
          discount: num(data.discount ?? data.Discount),
          cash_amount: num(data.cashAmount ?? data.CashAmount),
          check_amount: num(data.checkAmount ?? data.CheckAmount),
          gc_redemption: num(data.gcRedemption ?? data.GcRedemption ?? data.gcAmount ?? data.GcAmount ?? data.giftCardAmount ?? data.GiftCardAmount),
          package_redemption: num(data.packageRedemption ?? data.PackageRedemption ?? data.packageAmount ?? data.PackageAmount),
          membership_amount: num(data.membershipAmount ?? data.MembershipAmount ?? data.membershipRedemption),
          cc_amount: num(data.ccAmount ?? data.CcAmount ?? data.creditCardAmount ?? data.CreditCardAmount),
          bank_account_amount: num(data.bankAccountAmount ?? data.BankAccountAmount),
          vagaro_pay_later_amount: num(data.vagaroPayLaterAmount ?? data.VagaroPayLaterAmount),
          other_amount: num(data.otherAmount ?? data.OtherAmount),
          created_by: orNull(data.checkedOutBy ?? data.CheckedOutBy ?? data.staffName ?? data.StaffName),
        });
        continue;
      }
    }

    if (!rows || rows.length < PAGE) break;
  }

  // ── Apply collected client profile updates ─────────────────────────────────
  const updEntries = [...latestClientUpd.entries()];
  for (let i = 0; i < updEntries.length; i += CONCURRENCY) {
    const batch = updEntries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async ([clientId, updates]) => {
      const { error } = await sb.from("clients").update(updates).eq("id", clientId);
      return !error;
    }));
    customersUpdated += results.filter(Boolean).length;
  }

  // ── Bulk upsert appointments ────────────────────────────────────────────────
  const apptRows = [...latestApptById.values()];
  let apptUpserts = 0, upsertErrors = 0;
  let firstUpsertError: string | null = null;
  for (let i = 0; i < apptRows.length; i += CHUNK) {
    const chunk = apptRows.slice(i, i + CHUNK);
    const { error: uErr } = await sb.from("appointments").upsert(chunk, { onConflict: "vagaro_appt_id" });
    if (uErr) { upsertErrors += chunk.length; if (!firstUpsertError) firstUpsertError = uErr.message; }
    else apptUpserts += chunk.length;
  }

  // ── Insert missing transactions ─────────────────────────────────────────────
  // Existing (vagaro_transaction_id, item_sold) pairs are skipped.
  const existingTxKeys = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data: txs, error } = await sb
      .from("transactions")
      .select("vagaro_transaction_id, item_sold")
      .not("vagaro_transaction_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);
    for (const t of txs ?? []) existingTxKeys.add(`${str(t.vagaro_transaction_id)}|${str(t.item_sold)}`);
    if (!txs || txs.length < PAGE) break;
  }
  const newTxRows = [...latestTxByKey.entries()]
    .filter(([key]) => !existingTxKeys.has(key))
    .map(([, row]) => row);
  let txInserted = 0, txErrors = 0;
  for (let i = 0; i < newTxRows.length; i += CHUNK) {
    const chunk = newTxRows.slice(i, i + CHUNK);
    const { error } = await sb.from("transactions").insert(chunk);
    if (error) txErrors += chunk.length;
    else txInserted += chunk.length;
  }

  // ── Link client_id on transactions that are missing it ─────────────────────
  let txLinked = 0;
  {
    const unlinked: { id: string; vagaro_customer_id: string }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: txs, error } = await sb
        .from("transactions")
        .select("id, vagaro_customer_id")
        .is("client_id", null)
        .not("vagaro_customer_id", "is", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) break;
      for (const t of txs ?? []) unlinked.push({ id: str(t.id), vagaro_customer_id: str(t.vagaro_customer_id) });
      if (!txs || txs.length < PAGE) break;
    }
    const linkable = unlinked.filter((t) => clientMap.has(t.vagaro_customer_id));
    for (let i = 0; i < linkable.length; i += CONCURRENCY) {
      const batch = linkable.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (t) => {
        const { error } = await sb.from("transactions")
          .update({ client_id: clientMap.get(t.vagaro_customer_id) })
          .eq("id", t.id);
        return !error;
      }));
      txLinked += results.filter(Boolean).length;
    }
  }

  // ── Recalculate client metrics from ONE pass over appointments ─────────────
  type Metrics = { completed: number; noShows: number; lastVisit: string | null };
  const metrics = new Map<string, Metrics>();
  for (let from = 0; ; from += PAGE) {
    const { data: appts, error } = await sb
      .from("appointments")
      .select("client_id, date, status")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);
    for (const a of appts ?? []) {
      const cid = str(a.client_id);
      if (!affectedClientIds.has(cid)) continue;
      const m = metrics.get(cid) ?? { completed: 0, noShows: 0, lastVisit: null };
      if (a.status === "completed" || a.status === "checked-in") {
        m.completed++;
        if (!m.lastVisit || a.date > m.lastVisit) m.lastVisit = a.date;
      } else if (a.status === "no-show") m.noShows++;
      metrics.set(cid, m);
    }
    if (!appts || appts.length < PAGE) break;
  }

  const affected = [...affectedClientIds];
  const currentClients = new Map<string, { last_visit: string | null; completed_appointments_count: number | null; no_shows: number | null }>();
  for (let i = 0; i < affected.length; i += 200) {
    const { data: rows } = await sb
      .from("clients")
      .select("id, last_visit, completed_appointments_count, no_shows")
      .in("id", affected.slice(i, i + 200));
    for (const r of rows ?? []) currentClients.set(str(r.id), r);
  }

  let clientsUpdated = 0;
  for (let i = 0; i < affected.length; i += CONCURRENCY) {
    const batch = affected.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (cid) => {
      const m   = metrics.get(cid) ?? { completed: 0, noShows: 0, lastVisit: null };
      const cur = currentClients.get(cid);
      const updates: Record<string, unknown> = {
        // Never decrease counts already set from CSV imports
        completed_appointments_count: Math.max(m.completed, cur?.completed_appointments_count ?? 0),
        no_shows: Math.max(m.noShows, cur?.no_shows ?? 0),
      };
      if (m.lastVisit && (!cur?.last_visit || m.lastVisit > cur.last_visit)) {
        updates.last_visit = m.lastVisit;
      }
      const { error } = await sb.from("clients").update(updates).eq("id", cid);
      return !error;
    }));
    clientsUpdated += results.filter(Boolean).length;
  }

  return json({
    ok: true,
    logEntriesScanned: scanned,
    processed: apptEvents,
    uniqueAppointments: apptRows.length,
    skipped: skippedNoClient,
    skippedNoApptId,
    apptUpserts,
    upsertErrors,
    firstUpsertError,
    statusBreakdown,
    customersCreated,
    placeholdersCreated,
    customersUpdated,
    txEvents,
    txInserted,
    txErrors,
    txLinked,
    clientsUpdated,
    message: `Replayed ${scanned} webhooks oldest→newest: ${customersCreated + placeholdersCreated} clients created${placeholdersCreated > 0 ? ` (${placeholdersCreated} placeholders pending sync)` : ""}, ${customersUpdated} profiles updated, ${apptUpserts} appointments written, ${txInserted} transactions added, ${clientsUpdated} client metrics refreshed.`,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

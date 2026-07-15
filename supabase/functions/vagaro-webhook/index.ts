import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Confirmed Vagaro webhook envelope (from live traffic):
// {
//   Id, Type: "customer"|"appointment"|"transaction",
//   Action: "created"|"updated"|"cancelled"|...,
//   payload: { ... },
//   CreatedDate
// }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const str = (v: unknown): string => (v != null ? String(v) : "");
const orNull = (v: unknown) => str(v) || null;
const num = (v: unknown) => (v != null && v !== "" ? Number(v) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const type   = str(body.Type   ?? body.type   ?? "");
  const action = str(body.Action ?? body.action ?? "");
  const event  = type && action ? `${type}.${action}` : str(body.Event ?? body.event ?? "unknown");
  const data   = (body.payload ?? body.Payload ?? body.Data ?? body.data ?? {}) as Record<string, unknown>;

  // Log every received webhook immediately — this feeds the Settings log
  // and gives vagaro-sync the customerId values it needs for matching.
  await supabase.from("webhook_log").insert({
    source: "vagaro",
    event_type: event,
    payload: body,
  }).then(({ error }) => {
    if (error) console.error("webhook_log insert:", error.message);
  });

  try {
    if (type === "customer") {
      await handleCustomer(supabase, event, data);
    } else if (type === "appointment") {
      await handleAppointment(supabase, event, data);
    } else if (type === "transaction") {
      await handleTransaction(supabase, data);
    }
  } catch (err) {
    console.error(`Error processing ${event}:`, err);
    // Update the log row with the error so it shows in Settings
    await supabase.from("webhook_log")
      .update({ error: String(err) })
      .eq("source", "vagaro")
      .eq("event_type", event)
      .order("received_at", { ascending: false })
      .limit(1);
  }

  return json({ received: true, event });
});

// ─── Customer handler ─────────────────────────────────────────────────────────

async function handleCustomer(
  sb: ReturnType<typeof createClient>,
  _event: string,
  data: Record<string, unknown>,
) {
  const vagaro_id = orNull(data.customerId ?? data.CustomerId);
  if (!vagaro_id) return;

  const firstName = str(data.customerFirstName ?? data.FirstName ?? data.firstName);
  const lastName  = str(data.customerLastName  ?? data.LastName  ?? data.lastName);

  // Check whether this client already exists
  const { data: existing } = await sb
    .from("clients").select("id").eq("vagaro_id", vagaro_id).maybeSingle();

  if (!existing) {
    // ── Create ────────────────────────────────────────────────────────────────
    if (!firstName && !lastName) return;

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });

    const { data: inserted, error } = await sb.from("clients").insert({
      vagaro_id,
      vagaro_synced: true,
      first_name:   firstName,
      last_name:    lastName,
      email:        orNull(data.email        ?? data.Email),
      phone:        orNull(data.mobilePhone  ?? data.MobilePhone ?? data.dayPhone ?? data.Phone),
      birthday:     orNull(data.birthday     ?? data.Birthday),
      address:      orNull(data.streetAddress ?? data.Address1  ?? data.address),
      city:         orNull(data.city         ?? data.City),
      state:        orNull(data.regionCode   ?? data.State      ?? data.state),
      zip:          orNull(data.postalCode   ?? data.Zip        ?? data.zip),
      customer_since: orNull(data.createdDate?.toString().split("T")[0]) ?? today,
      avg_visit_interval_days: 30,
      waitlisted: false,
      tags: [],
      golden_nuggets: [],
    }).select("id").single();

    if (error) throw error;

    await sb.from("history").insert({
      client_id: inserted.id,
      type: "client.created",
      detail: "New customer created in Vagaro — synced automatically",
      by: "Vagaro",
      ts: Date.now(),
      source: "vagaro",
      direction: "internal",
    });

  } else {
    // ── Update ────────────────────────────────────────────────────────────────
    // Only overwrite fields that are present and non-empty in the payload so we
    // don't blank out data that Vagaro sent as an empty string.
    const updates: Record<string, unknown> = {};
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

    if (Object.keys(updates).length > 0) {
      const { error } = await sb.from("clients").update(updates).eq("vagaro_id", vagaro_id);
      if (error) throw error;
    }
  }
}

// ─── Appointment handler ──────────────────────────────────────────────────────

async function handleAppointment(
  sb: ReturnType<typeof createClient>,
  event: string,
  data: Record<string, unknown>,
) {
  const vagaro_customer_id = orNull(data.customerId ?? data.CustomerId);
  const vagaro_appt_id     = orNull(data.appointmentId ?? data.AppointmentId ?? data.Id);
  if (!vagaro_customer_id) return;

  // Resolve client by vagaro_id — if unknown, create one so the appointment
  // is never dropped. Real details come from the Vagaro API when reachable;
  // otherwise a placeholder that the next customer webhook / sync fills in.
  let client = (await sb
    .from("clients").select("id").eq("vagaro_id", vagaro_customer_id).maybeSingle()).data;
  if (!client) {
    const businessId = orNull(data.businessId ?? data.BusinessId);
    client = await createClientForCustomer(sb, vagaro_customer_id, businessId);
    if (!client) return; // creation failed — logged inside
  }

  // Parse date/time — Vagaro sends startTime/endTime as full datetimes.
  // The values carry a "Z" suffix but are actually business-local Mountain
  // time shifted by a FIXED +7 hours year-round (no DST) — verified against
  // live calendar data. Subtract 7h to recover the wall-clock date/time.
  const startRaw = str(data.startDateTime ?? data.StartDateTime ?? data.startTime ?? data.StartTime ?? data.startDate ?? data.StartDate ?? "");
  const endRaw   = str(data.endDateTime   ?? data.EndDateTime   ?? data.endTime   ?? data.EndTime   ?? "");
  const startLoc = vagaroLocal(startRaw);
  const apptDate = startLoc?.date ?? null;
  const apptTime = startLoc?.time ?? null;

  // Vagaro bookingStatus vocabulary observed in live webhook data:
  // accepted, confirmed, need acceptance, awaiting confirmation,
  // service completed, show, service in progress, cancel, deleted,
  // denied, no show
  const statusMap: Record<string, string> = {
    accepted: "scheduled", requested: "scheduled", booked: "scheduled",
    confirmed: "scheduled", pending: "scheduled", rescheduled: "scheduled",
    "need acceptance": "scheduled", "awaiting confirmation": "scheduled",
    "checked in": "checked-in", checkedin: "checked-in", "checked-in": "checked-in",
    "service in progress": "checked-in",
    completed: "completed", serviced: "completed", show: "completed",
    "service completed": "completed",
    cancelled: "cancelled", canceled: "cancelled", cancel: "cancelled",
    deleted: "cancelled", denied: "cancelled",
    "no show": "no-show", noshow: "no-show", "no-show": "no-show",
  };
  const rawStatus = str(data.bookingStatus ?? data.BookingStatus ?? data.status ?? data.Status ?? "").toLowerCase().trim();
  const status = statusMap[rawStatus] ??
    (event === "appointment.cancelled" ? "cancelled" :
     event === "appointment.completed" ? "completed" :
     event === "appointment.checkedin" ? "checked-in" :
     event === "appointment.noshow"    ? "no-show"   : "scheduled");

  const service = orNull(data.serviceTitle ?? data.ServiceTitle ?? data.serviceName ?? data.ServiceName ?? data.service);

  // Vagaro only sends serviceProviderId — resolve to a display name via the staff table
  let therapist = orNull(data.providerName ?? data.ProviderName ?? data.serviceProviderName ?? data.therapist);
  const providerId = orNull(data.serviceProviderId ?? data.ServiceProviderId);
  if (!therapist && providerId) {
    const { data: staffRow } = await sb
      .from("staff").select("full_name").eq("vagaro_provider_id", providerId).maybeSingle();
    therapist = staffRow?.full_name ?? null;
  }

  // No duration field — compute minutes from startTime → endTime
  let duration = num(data.duration ?? data.Duration);
  if (duration == null && startRaw && endRaw) {
    const ms = new Date(endRaw).getTime() - new Date(startRaw).getTime();
    if (!isNaN(ms) && ms > 0) duration = Math.round(ms / 60000);
  }

  // Upsert appointment so re-deliveries are idempotent
  if (apptDate && vagaro_appt_id) {
    const { error } = await sb.from("appointments").upsert({
      vagaro_appt_id,
      client_id: client.id,
      date:      apptDate,
      time:      apptTime ?? null,
      service:   service  ?? "Appointment",
      duration:  duration ?? null,
      therapist: therapist ?? null,
      status,
    }, { onConflict: "vagaro_appt_id" });
    if (error) console.error("appointment upsert:", error.message);
  }

  // Update client metrics after the appointment record is written
  if (apptDate) {
    if (status === "completed" || status === "checked-in") {
      // Count all completed/checked-in appointments for this client (idempotent)
      const { count: completedCount } = await sb
        .from("appointments")
        .select("*", { count: "exact", head: true })
        .eq("client_id", client.id)
        .in("status", ["completed", "checked-in"]);

      const { data: clientRow } = await sb
        .from("clients")
        .select("last_visit, completed_appointments_count")
        .eq("id", client.id)
        .single();

      // Never let the count go below what was already stored (handles historical imports)
      const newCount = Math.max(completedCount ?? 0, clientRow?.completed_appointments_count ?? 0);
      const updates: Record<string, unknown> = { completed_appointments_count: newCount };

      // Only move last_visit forward, never back
      if (!clientRow?.last_visit || apptDate > clientRow.last_visit) {
        updates.last_visit = apptDate;
      }

      const { error: clientErr } = await sb.from("clients").update(updates).eq("id", client.id);
      if (clientErr) console.error("client metrics update:", clientErr.message);

    } else if (status === "no-show") {
      const { data: clientRow } = await sb
        .from("clients").select("no_shows").eq("id", client.id).single();
      const { error: nsErr } = await sb.from("clients")
        .update({ no_shows: (clientRow?.no_shows ?? 0) + 1 })
        .eq("id", client.id);
      if (nsErr) console.error("no_shows update:", nsErr.message);
    }
  }

  // Log to client history
  const histType: Record<string, string> = {
    "appointment.created":   "appt.scheduled",
    "appointment.updated":   "appt.rescheduled",
    "appointment.cancelled": "appt.cancelled",
    "appointment.completed": "appt.completed",
    "appointment.checkedin": "appt.checkin",
    "appointment.noshow":    "appt.noshow",
  };
  const detail = [
    event.replace("appointment.", "").replace(/^\w/, (c) => c.toUpperCase()),
    service,
    apptDate ? new Date(apptDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null,
    apptTime ? formatTime(apptTime) : null,
  ].filter(Boolean).join(" · ");

  await sb.from("history").insert({
    client_id: client.id,
    type: histType[event] ?? "appt.scheduled",
    detail,
    by: "Vagaro",
    ts: Date.now(),
    source: "vagaro",
    direction: "internal",
  });
}

// ─── Transaction handler ──────────────────────────────────────────────────────
// Vagaro sends one webhook event per transaction line item (mirrors CSV rows).
// We upsert by vagaro_transaction_id + item_sold so re-deliveries are idempotent
// and multi-item checkouts each get their own row (same transaction ID, different item).

async function handleTransaction(
  sb: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
) {
  // Transaction ID is required — without it we can't deduplicate
  const vagaro_transaction_id = orNull(
    data.transactionId ?? data.TransactionId ?? data.Id ?? data.id
  );
  if (!vagaro_transaction_id) return;

  // Resolve client by Vagaro customer ID
  const vagaro_customer_id = orNull(data.customerId ?? data.CustomerId);
  let client_id: string | null = null;
  if (vagaro_customer_id) {
    const { data: client } = await sb
      .from("clients").select("id").eq("vagaro_id", vagaro_customer_id).maybeSingle();
    if (client) client_id = client.id;
  }

  // Checkout date — Vagaro sends "YYYY-MM-DD" or a full ISO string
  const dateRaw = str(
    data.checkoutDate ?? data.CheckoutDate ??
    data.transactionDate ?? data.TransactionDate ??
    data.createdDate ?? data.CreatedDate ?? ""
  );
  const transaction_date = dateRaw
    ? (dateRaw.includes("T") ? dateRaw : dateRaw + "T12:00:00Z")
    : null;

  // Item / service name (Vagaro CSV column: "Service/Product/GC/Package/Membership/Class")
  const item_sold = orNull(
    data.itemSold ?? data.ItemSold ??
    data.serviceName ?? data.ServiceName ??
    data.name ?? data.Name
  );

  // Purchase type (Vagaro CSV column: "Transaction Type" — "Services", "Packages", etc.)
  const purchase_type = orNull(
    data.purchaseType ?? data.PurchaseType ??
    data.transactionType ?? data.TransactionType ??
    data.type ?? data.Type
  );

  // Provider name or ID (used for per-staff session counts)
  const vagaro_service_provider_id = orNull(
    data.serviceProviderName ?? data.ServiceProviderName ??
    data.providerName ?? data.ProviderName ??
    data.serviceProviderId ?? data.ServiceProviderId ??
    data.staffName ?? data.StaffName
  );

  const row = {
    vagaro_transaction_id,
    vagaro_customer_id,
    vagaro_service_provider_id,
    client_id,
    transaction_date,
    item_sold,
    purchase_type,
    quantity:               num(data.quantity ?? data.Quantity) ?? 1,
    tax:                    num(data.tax ?? data.Tax),
    tip:                    num(data.tip ?? data.Tip),
    discount:               num(data.discount ?? data.Discount),
    cash_amount:            num(data.cashAmount ?? data.CashAmount),
    check_amount:           num(data.checkAmount ?? data.CheckAmount),
    gc_redemption:          num(data.gcRedemption ?? data.GcRedemption ?? data.gcAmount ?? data.GcAmount ?? data.giftCardAmount ?? data.GiftCardAmount),
    package_redemption:     num(data.packageRedemption ?? data.PackageRedemption ?? data.packageAmount ?? data.PackageAmount),
    membership_amount:      num(data.membershipAmount ?? data.MembershipAmount ?? data.membershipRedemption),
    cc_amount:              num(data.ccAmount ?? data.CcAmount ?? data.creditCardAmount ?? data.CreditCardAmount),
    bank_account_amount:    num(data.bankAccountAmount ?? data.BankAccountAmount),
    vagaro_pay_later_amount: num(data.vagaroPayLaterAmount ?? data.VagaroPayLaterAmount),
    other_amount:           num(data.otherAmount ?? data.OtherAmount),
    created_by:             orNull(data.checkedOutBy ?? data.CheckedOutBy ?? data.staffName ?? data.StaffName),
  };

  // Upsert: check for existing row by transaction_id + item_sold
  // (same checkout can have multiple line items with the same transaction_id)
  if (item_sold) {
    const { data: existing } = await sb.from("transactions")
      .select("id")
      .eq("vagaro_transaction_id", vagaro_transaction_id)
      .eq("item_sold", item_sold)
      .maybeSingle();

    if (existing) {
      // Update — fill in any missing fields (e.g. client_id if it was null before)
      const { error } = await sb.from("transactions").update(row).eq("id", existing.id);
      if (error) throw error;
      return;
    }
  }

  // Insert new row
  const { error } = await sb.from("transactions").insert(row);
  if (error) throw error;
}

// ─── Client auto-creation for unknown customers ──────────────────────────────

// Fetch real customer details from the Vagaro V2 API (best effort).
async function fetchVagaroCustomerDetails(
  customerId: string,
  businessId: string | null,
): Promise<Record<string, unknown> | null> {
  try {
    const region          = Deno.env.get("VAGARO_REGION");
    const clientId        = Deno.env.get("VAGARO_CLIENT_ID");
    const clientSecretKey = Deno.env.get("VAGARO_CLIENT_SECRET_KEY");
    if (!region || !clientId || !clientSecretKey || !businessId) return null;

    const tokenRes = await fetch(
      `https://api.vagaro.com/${region}/api/v2/merchants/generate-access-token`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecretKey, scope: "read access" }) },
    );
    if (!tokenRes.ok) return null;
    const accessToken = (await tokenRes.json())?.data?.access_token;
    if (!accessToken) return null;

    const res = await fetch(
      `https://api.vagaro.com/${region}/api/v2/customers`,
      { method: "POST", headers: { "Content-Type": "application/json", accessToken },
        body: JSON.stringify({ businessId, customerId }) },
    );
    if (!res.ok) return null;
    return ((await res.json())?.data as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

// Create a client for a Vagaro customer we've never seen. Uses real details
// from the API when possible, otherwise a recognizable placeholder that gets
// corrected by the next customer webhook or "Sync all clients from Vagaro".
async function createClientForCustomer(
  sb: ReturnType<typeof createClient>,
  vagaroCustomerId: string,
  businessId: string | null,
): Promise<{ id: string } | null> {
  const vc = await fetchVagaroCustomerDetails(vagaroCustomerId, businessId);
  const firstName = str(vc?.customerFirstName ?? "").trim();
  const lastName  = str(vc?.customerLastName ?? "").trim();
  const suffix    = vagaroCustomerId.replace(/[^a-zA-Z0-9]/g, "").slice(-6);
  const today     = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });

  const { data: inserted, error } = await sb.from("clients").insert({
    vagaro_id:     vagaroCustomerId,
    vagaro_synced: true,
    first_name:    firstName || "Vagaro",
    last_name:     lastName  || `Client ${suffix}`,
    email:         orNull(vc?.email),
    phone:         orNull(vc?.mobilePhone) ?? orNull(vc?.dayPhone),
    birthday:      orNull(vc?.birthday),
    address:       orNull(vc?.streetAddress),
    city:          orNull(vc?.city),
    state:         orNull(vc?.regionCode),
    zip:           orNull(vc?.postalCode),
    customer_since: orNull(str(vc?.createdDate ?? "").split("T")[0]) ?? today,
    avg_visit_interval_days: 30,
    waitlisted: false, tags: [], golden_nuggets: [],
  }).select("id").single();

  if (error) {
    // Possible race with a concurrent customer webhook — re-check
    const { data: existing } = await sb
      .from("clients").select("id").eq("vagaro_id", vagaroCustomerId).maybeSingle();
    if (existing) return existing as { id: string };
    console.error(`auto-create client ${vagaroCustomerId}:`, error.message);
    return null;
  }

  await sb.from("history").insert({
    client_id: inserted.id,
    type: "client.created",
    detail: firstName || lastName
      ? "Created automatically from a Vagaro appointment webhook"
      : "Created as a placeholder from a Vagaro appointment webhook — details pending sync",
    by: "Vagaro",
    ts: Date.now(),
    source: "vagaro",
    direction: "internal",
  });

  return inserted as { id: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

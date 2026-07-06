/**
 * reprocess-webhooks — Supabase Edge Function
 *
 * Replays all appointment events stored in webhook_log to backfill:
 *   - appointments table (upsert by vagaro_appt_id)
 *   - clients.last_visit
 *   - clients.completed_appointments_count
 *   - clients.no_shows
 *
 * Safe to run multiple times — all writes are idempotent.
 *
 * Optimized for Edge Function compute limits: events are deduped to the
 * latest state per appointment, writes are batched in chunks, and client
 * metrics are computed from a single pass over the appointments table
 * instead of per-client queries.
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
const UPSERT_CHUNK = 500;
const UPDATE_CONCURRENCY = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Prefetch all linked clients once (vagaro_id → id)
  const clientMap = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("clients")
      .select("id, vagaro_id")
      .not("vagaro_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);
    for (const c of data ?? []) clientMap.set(str(c.vagaro_id), str(c.id));
    if (!data || data.length < PAGE) break;
  }

  // Prefetch staff so serviceProviderId can be resolved to a display name
  const staffMap = new Map<string, string>();
  {
    const { data: staffRows } = await sb
      .from("staff").select("full_name, vagaro_provider_id")
      .not("vagaro_provider_id", "is", null);
    for (const s of staffRows ?? []) staffMap.set(str(s.vagaro_provider_id), str(s.full_name));
  }

  const statusMap: Record<string, string> = {
    accepted: "scheduled", requested: "scheduled", booked: "scheduled",
    confirmed: "scheduled", pending: "scheduled", rescheduled: "scheduled",
    "checked in": "checked-in", checkedin: "checked-in", "checked-in": "checked-in",
    completed: "completed", serviced: "completed", show: "completed",
    cancelled: "cancelled", canceled: "cancelled",
    "no show": "no-show", noshow: "no-show", "no-show": "no-show",
  };
  const statusBreakdown: Record<string, number> = {};

  let scanned          = 0;
  let processed        = 0;
  let skippedNoClient  = 0;
  let skippedNoApptId  = 0;

  // Dedupe: latest event per vagaro_appt_id wins (log is scanned oldest → newest)
  const latestByApptId = new Map<string, Record<string, unknown>>();
  const affectedClientIds = new Set<string>();

  // Page through webhook_log, parsing each page immediately so raw payloads
  // don't accumulate in memory.
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await sb
      .from("webhook_log")
      .select("event_type, payload")
      .like("event_type", "appointment.%")
      .order("received_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);

    for (const row of rows ?? []) {
      scanned++;
      const event = str(row.event_type);
      const body  = row.payload as Record<string, unknown>;
      const data  = (body.payload ?? body.Payload ?? body.Data ?? body.data ?? {}) as Record<string, unknown>;

      const vagaro_customer_id = orNull(data.customerId ?? data.CustomerId);
      const vagaro_appt_id     = orNull(data.appointmentId ?? data.AppointmentId ?? data.Id);

      if (!vagaro_customer_id) { skippedNoClient++; continue; }
      const clientId = clientMap.get(vagaro_customer_id);
      if (!clientId) { skippedNoClient++; continue; }

      // Parse date/time — Vagaro sends startTime/endTime as full datetimes
      const startRaw = str(data.startDateTime ?? data.StartDateTime ?? data.startTime ?? data.StartTime ?? data.startDate ?? data.StartDate ?? "");
      const endRaw   = str(data.endDateTime   ?? data.EndDateTime   ?? data.endTime   ?? data.EndTime   ?? "");
      const apptDate = startRaw ? startRaw.split("T")[0] : null;
      const apptTime = startRaw.includes("T") ? startRaw.split("T")[1]?.slice(0, 5) : null;

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

      latestByApptId.set(vagaro_appt_id, {
        vagaro_appt_id,
        client_id: clientId,
        date:      apptDate,
        time:      apptTime ?? null,
        service:   service  ?? "Appointment",
        duration:  duration ?? null,
        therapist: therapist ?? null,
        status,
      });
      affectedClientIds.add(clientId);
      processed++;
    }

    if (!rows || rows.length < PAGE) break;
  }

  // Bulk upsert unique appointments in chunks
  const uniqueRows = [...latestByApptId.values()];
  let apptUpserts  = 0;
  let upsertErrors = 0;
  let firstUpsertError: string | null = null;

  for (let i = 0; i < uniqueRows.length; i += UPSERT_CHUNK) {
    const chunk = uniqueRows.slice(i, i + UPSERT_CHUNK);
    const { error: uErr } = await sb.from("appointments")
      .upsert(chunk, { onConflict: "vagaro_appt_id" });
    if (uErr) {
      upsertErrors += chunk.length;
      if (!firstUpsertError) firstUpsertError = uErr.message;
    } else {
      apptUpserts += chunk.length;
    }
  }

  // Compute per-client metrics from ONE pass over the appointments table
  type Metrics = { completed: number; noShows: number; lastVisit: string | null };
  const metrics = new Map<string, Metrics>();
  for (let from = 0; ; from += PAGE) {
    const { data: appts, error } = await sb
      .from("appointments")
      .select("client_id, date, status")
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);

    for (const a of appts ?? []) {
      const cid = str(a.client_id);
      if (!affectedClientIds.has(cid)) continue;
      const m = metrics.get(cid) ?? { completed: 0, noShows: 0, lastVisit: null };
      if (a.status === "completed" || a.status === "checked-in") {
        m.completed++;
        if (!m.lastVisit || a.date > m.lastVisit) m.lastVisit = a.date;
      } else if (a.status === "no-show") {
        m.noShows++;
      }
      metrics.set(cid, m);
    }
    if (!appts || appts.length < PAGE) break;
  }

  // Fetch current client values for affected clients (chunked .in() queries)
  const affected = [...affectedClientIds];
  const currentClients = new Map<string, { last_visit: string | null; completed_appointments_count: number | null; no_shows: number | null }>();
  for (let i = 0; i < affected.length; i += 200) {
    const ids = affected.slice(i, i + 200);
    const { data: rows } = await sb
      .from("clients")
      .select("id, last_visit, completed_appointments_count, no_shows")
      .in("id", ids);
    for (const r of rows ?? []) currentClients.set(str(r.id), r);
  }

  // Apply updates with limited concurrency
  let clientsUpdated = 0;
  for (let i = 0; i < affected.length; i += UPDATE_CONCURRENCY) {
    const batch = affected.slice(i, i + UPDATE_CONCURRENCY);
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
    processed,
    uniqueAppointments: uniqueRows.length,
    skipped: skippedNoClient,
    skippedNoApptId,
    apptUpserts,
    upsertErrors,
    firstUpsertError,
    statusBreakdown,
    clientsUpdated,
    message: `Processed ${processed} appointment events (${uniqueRows.length} unique appointments), wrote ${apptUpserts} appointment records, updated ${clientsUpdated} client profiles.`,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

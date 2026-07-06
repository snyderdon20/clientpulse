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
 * Requires the appointments.vagaro_appt_id column + unique index
 * (migration 20260706_appointments_vagaro_appt_id.sql).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const str    = (v: unknown): string => (v != null ? String(v) : "");
const orNull = (v: unknown) => str(v) || null;
const num    = (v: unknown) => (v != null && v !== "" ? Number(v) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Load ALL appointment webhook_log entries — paginated, because PostgREST
  // caps a single query at 1000 rows.
  const PAGE = 1000;
  const logRows: { event_type: string; payload: Record<string, unknown> }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("webhook_log")
      .select("event_type, payload")
      .like("event_type", "appointment.%")
      .order("received_at", { ascending: true }) // oldest first so upserts land in order
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);
    logRows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  if (!logRows.length) return json({ ok: true, processed: 0, message: "No appointment webhook entries found in webhook_log." });

  // Prefetch all linked clients once (vagaro_id → id) instead of one query per event
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
  // Count raw bookingStatus values so unmapped ones are visible in the response
  const statusBreakdown: Record<string, number> = {};

  let processed        = 0;
  let skippedNoClient  = 0;
  let skippedNoApptId  = 0;
  let apptUpserts      = 0;
  let upsertErrors     = 0;
  let firstUpsertError: string | null = null;

  // Track which client IDs need their metrics recalculated
  const affectedClientIds = new Set<string>();

  for (const row of logRows) {
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

    // Vagaro only sends serviceProviderId — resolve to a display name via staff
    const providerId = orNull(data.serviceProviderId ?? data.ServiceProviderId);
    const therapist  = orNull(data.providerName ?? data.ProviderName ?? data.serviceProviderName)
      ?? (providerId ? staffMap.get(providerId) ?? null : null);

    // No duration field — compute minutes from startTime → endTime
    let duration = num(data.duration ?? data.Duration);
    if (duration == null && startRaw && endRaw) {
      const ms = new Date(endRaw).getTime() - new Date(startRaw).getTime();
      if (!isNaN(ms) && ms > 0) duration = Math.round(ms / 60000);
    }

    // Upsert appointment record
    if (apptDate && vagaro_appt_id) {
      const { error: uErr } = await sb.from("appointments").upsert({
        vagaro_appt_id,
        client_id: clientId,
        date:      apptDate,
        time:      apptTime ?? null,
        service:   service  ?? "Appointment",
        duration:  duration ?? null,
        therapist: therapist ?? null,
        status,
      }, { onConflict: "vagaro_appt_id" });

      if (uErr) {
        upsertErrors++;
        if (!firstUpsertError) firstUpsertError = uErr.message;
      } else {
        apptUpserts++;
      }
    } else {
      skippedNoApptId++;
    }

    affectedClientIds.add(clientId);
    processed++;
  }

  // Recalculate metrics for every affected client
  let clientsUpdated = 0;
  for (const clientId of affectedClientIds) {
    // Count completed/checked-in appointments
    const { count: completedCount } = await sb
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .in("status", ["completed", "checked-in"]);

    // Count no-shows
    const { count: noShowCount } = await sb
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "no-show");

    // Most recent completed/checked-in date
    const { data: latestAppt } = await sb
      .from("appointments")
      .select("date")
      .eq("client_id", clientId)
      .in("status", ["completed", "checked-in"])
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: currentClient } = await sb
      .from("clients")
      .select("last_visit, completed_appointments_count, no_shows")
      .eq("id", clientId)
      .single();

    const updates: Record<string, unknown> = {
      // Never decrease counts already set from CSV imports
      completed_appointments_count: Math.max(
        completedCount ?? 0,
        currentClient?.completed_appointments_count ?? 0
      ),
      no_shows: Math.max(
        noShowCount ?? 0,
        currentClient?.no_shows ?? 0
      ),
    };

    // Advance last_visit to the most recent completed date
    if (latestAppt?.date) {
      if (!currentClient?.last_visit || latestAppt.date > currentClient.last_visit) {
        updates.last_visit = latestAppt.date;
      }
    }

    const { error: updErr } = await sb.from("clients").update(updates).eq("id", clientId);
    if (!updErr) clientsUpdated++;
  }

  return json({
    ok: true,
    logEntriesScanned: logRows.length,
    processed,
    skipped: skippedNoClient,
    skippedNoApptId,
    apptUpserts,
    upsertErrors,
    firstUpsertError,
    statusBreakdown,
    clientsUpdated,
    message: `Processed ${processed} appointment events, wrote ${apptUpserts} appointment records, updated ${clientsUpdated} client profiles.`,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

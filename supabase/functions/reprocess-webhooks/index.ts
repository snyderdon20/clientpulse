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

  // Load ALL appointment webhook_log entries
  const { data: logRows, error: logErr } = await sb
    .from("webhook_log")
    .select("event_type, payload")
    .like("event_type", "appointment.%")
    .order("received_at", { ascending: true }); // oldest first so upserts land in order

  if (logErr) return json({ error: logErr.message }, 500);
  if (!logRows?.length) return json({ ok: true, processed: 0, message: "No appointment webhook entries found in webhook_log." });

  const statusMap: Record<string, string> = {
    confirmed: "scheduled", pending: "scheduled",
    "checked in": "checked-in", checkedin: "checked-in",
    completed: "completed", cancelled: "cancelled", canceled: "cancelled",
    "no show": "no-show", noshow: "no-show",
  };

  let processed   = 0;
  let skipped     = 0;
  let apptUpserts = 0;

  // Track which client IDs need their metrics recalculated
  const affectedClientIds = new Set<string>();

  for (const row of logRows) {
    const event = str(row.event_type);
    const body  = row.payload as Record<string, unknown>;
    const data  = (body.payload ?? body.Payload ?? body.Data ?? body.data ?? {}) as Record<string, unknown>;

    const vagaro_customer_id = orNull(data.customerId ?? data.CustomerId);
    const vagaro_appt_id     = orNull(data.appointmentId ?? data.AppointmentId ?? data.Id);

    if (!vagaro_customer_id) { skipped++; continue; }

    // Resolve client
    const { data: client } = await sb
      .from("clients").select("id").eq("vagaro_id", vagaro_customer_id).maybeSingle();
    if (!client) { skipped++; continue; }

    // Parse date/time
    const startRaw = str(data.startDateTime ?? data.StartDateTime ?? data.startDate ?? data.StartDate ?? "");
    const apptDate = startRaw ? startRaw.split("T")[0] : null;
    const apptTime = startRaw?.includes("T")
      ? startRaw.split("T")[1]?.slice(0, 5)
      : orNull(data.startTime ?? data.StartTime);

    const rawStatus = str(data.status ?? data.Status ?? "").toLowerCase();
    const status = statusMap[rawStatus] ??
      (event === "appointment.cancelled" ? "cancelled" :
       event === "appointment.completed" ? "completed" :
       event === "appointment.checkedin" ? "checked-in" :
       event === "appointment.noshow"    ? "no-show"   : "scheduled");

    const service   = orNull(data.serviceName    ?? data.ServiceName   ?? data.service);
    const therapist = orNull(data.providerName   ?? data.ProviderName  ?? data.serviceProviderName ?? data.therapist);
    const duration  = num(data.duration ?? data.Duration);

    // Upsert appointment record
    if (apptDate && vagaro_appt_id) {
      const { error: uErr } = await sb.from("appointments").upsert({
        vagaro_appt_id,
        client_id: client.id,
        date:      apptDate,
        time:      apptTime ?? null,
        service:   service  ?? "Appointment",
        duration:  duration ?? null,
        therapist: therapist ?? null,
        status,
      }, { onConflict: "vagaro_appt_id" });

      if (uErr) {
        console.error(`appt upsert ${vagaro_appt_id}:`, uErr.message);
      } else {
        apptUpserts++;
      }
    }

    affectedClientIds.add(client.id);
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
    skipped,
    apptUpserts,
    clientsUpdated,
    message: `Processed ${processed} appointment events, updated ${clientsUpdated} client profiles.`,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

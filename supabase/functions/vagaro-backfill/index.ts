/**
 * vagaro-backfill — Supabase Edge Function
 *
 * Pulls FULL appointment history + customer details for linked clients
 * directly from the Vagaro V2 API (Retrieve Appointments / Retrieve
 * Customer), which — unlike webhook_log — includes history from before the
 * webhook was set up.
 *
 * Processes a bounded batch of clients per invocation to stay within Edge
 * compute limits. The caller loops, passing the returned nextOffset until it
 * comes back null.
 *
 * Body: { offset?: number, limit?: number, businessId?: string }
 *
 * Requires secrets: VAGARO_CLIENT_ID, VAGARO_CLIENT_SECRET_KEY, VAGARO_REGION.
 * Deployed via .github/workflows/deploy-functions.yml on merge to main.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const str    = (v: unknown): string => (v == null ? "" : String(v));
const orNull = (v: unknown) => str(v).trim() || null;
const num    = (v: unknown) => (v != null && v !== "" ? Number(v) : null);

const PAGE = 1000;
const CLIENT_LIMIT = 60;   // clients processed per invocation
const API_CONCURRENCY = 5; // parallel Vagaro API calls

// Vagaro appointment timestamps carry a "Z" suffix but are the studio's
// Mountain wall clock + a fixed 7h. Subtract 7h for local date/HH:MM.
const VAGARO_OFFSET_MS = 7 * 60 * 60 * 1000;
function vagaroLocal(raw: string): { date: string; time: string } | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() - VAGARO_OFFSET_MS).toISOString();
  return { date: shifted.split("T")[0], time: shifted.split("T")[1].slice(0, 5) };
}

const STATUS_MAP: Record<string, string> = {
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

async function getAccessToken(region: string, clientId: string, clientSecretKey: string): Promise<string> {
  const res = await fetch(
    `https://api.vagaro.com/${region}/api/v2/merchants/generate-access-token`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecretKey, scope: "read access" }) },
  );
  if (!res.ok) throw new Error(`Vagaro auth failed: ${res.status} ${await res.text()}`);
  const token = (await res.json())?.data?.access_token;
  if (!token) throw new Error("No access_token in Vagaro response");
  return token;
}

// deno-lint-ignore no-explicit-any
async function fetchAppointments(region: string, accessToken: string, businessId: string, customerId: string): Promise<any[]> {
  const all: unknown[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.vagaro.com/${region}/api/v2/appointments?pageNumber=${page}&pageSize=100&orderBy=asc`,
      { method: "POST", headers: { "Content-Type": "application/json", accessToken },
        body: JSON.stringify({ businessId, customerId }) },
    );
    if (!res.ok) break;
    const rows = (await res.json())?.data;
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all as unknown[];
}

// deno-lint-ignore no-explicit-any
async function fetchCustomer(region: string, accessToken: string, businessId: string, customerId: string): Promise<any | null> {
  try {
    const res = await fetch(
      `https://api.vagaro.com/${region}/api/v2/customers`,
      { method: "POST", headers: { "Content-Type": "application/json", accessToken },
        body: JSON.stringify({ businessId, customerId }) },
    );
    if (!res.ok) return null;
    return (await res.json())?.data ?? null;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const reqBody = await req.json().catch(() => ({})) as Record<string, unknown>;
  const offset = Math.max(0, Number(reqBody.offset) || 0);
  const limit  = Math.min(200, Number(reqBody.limit) || CLIENT_LIMIT);

  const clientId        = Deno.env.get("VAGARO_CLIENT_ID");
  const clientSecretKey = Deno.env.get("VAGARO_CLIENT_SECRET_KEY");
  const region          = Deno.env.get("VAGARO_REGION");
  if (!clientId || !clientSecretKey || !region) {
    return json({ error: "VAGARO_CLIENT_ID, VAGARO_CLIENT_SECRET_KEY, and VAGARO_REGION secrets must be set in Supabase." }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // businessId from body or latest webhook_log
  let businessId = str(reqBody.businessId);
  if (!businessId) {
    const { data: logRow } = await sb
      .from("webhook_log").select("payload")
      .eq("source", "vagaro")
      .not("payload->payload->businessId", "is", null)
      .order("received_at", { ascending: false }).limit(1).maybeSingle();
    businessId = str((logRow?.payload as Record<string, unknown>)?.payload?.businessId ?? "");
  }
  if (!businessId) return json({ error: "Could not determine businessId — trigger a Vagaro webhook first or pass businessId." }, 400);

  let accessToken: string;
  try { accessToken = await getAccessToken(region, clientId, clientSecretKey); }
  catch (e) { return json({ error: String(e) }, 502); }

  // Total linked-client count (for progress reporting)
  const { count: totalClients } = await sb
    .from("clients").select("*", { count: "exact", head: true }).not("vagaro_id", "is", null);

  // This batch of linked clients
  const { data: batch, error: batchErr } = await sb
    .from("clients")
    .select("id, vagaro_id, first_name, last_name")
    .not("vagaro_id", "is", null)
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (batchErr) return json({ error: `Supabase error: ${batchErr.message}` }, 500);

  const clients = batch ?? [];
  let apptsUpserted = 0, apptErrors = 0, placeholdersEnriched = 0;
  const touchedClientIds: string[] = [];
  let firstError: string | null = null;

  // Process clients in parallel batches (network latency dominates)
  for (let i = 0; i < clients.length; i += API_CONCURRENCY) {
    const slice = clients.slice(i, i + API_CONCURRENCY);
    await Promise.all(slice.map(async (c) => {
      const vid = str(c.vagaro_id);
      const clientDbId = str(c.id);
      touchedClientIds.push(clientDbId);

      // Enrich placeholder clients ("Vagaro Client xxxxxx" or blank name)
      const isPlaceholder = str(c.first_name) === "Vagaro" && str(c.last_name).startsWith("Client ");
      if (isPlaceholder || !str(c.first_name)) {
        const vc = await fetchCustomer(region, accessToken, businessId, vid);
        const fn = str(vc?.customerFirstName).trim();
        const ln = str(vc?.customerLastName).trim();
        if (fn || ln) {
          const { error } = await sb.from("clients").update({
            first_name: fn || "Vagaro", last_name: ln || str(c.last_name),
            email: orNull(vc?.email), phone: orNull(vc?.mobilePhone) ?? orNull(vc?.dayPhone),
            birthday: orNull(vc?.birthday), updated_at: new Date().toISOString(),
          }).eq("id", clientDbId);
          if (!error) placeholdersEnriched++;
        }
      }

      // Full appointment history
      const appts = await fetchAppointments(region, accessToken, businessId, vid);
      const rows: Record<string, unknown>[] = [];
      for (const a of appts) {
        const vagaro_appt_id = orNull(a.appointmentId);
        const loc = vagaroLocal(str(a.startTime));
        if (!vagaro_appt_id || !loc) continue;
        const endLoc = str(a.endTime);
        let duration = num(a.duration);
        if (duration == null && a.startTime && endLoc) {
          const ms = new Date(endLoc).getTime() - new Date(str(a.startTime)).getTime();
          if (!isNaN(ms) && ms > 0) duration = Math.round(ms / 60000);
        }
        const raw = str(a.bookingStatus).toLowerCase().trim();
        rows.push({
          vagaro_appt_id, client_id: clientDbId,
          date: loc.date, time: loc.time,
          service: orNull(a.serviceTitle) ?? "Appointment",
          duration: duration ?? null,
          therapist: orNull(a.serviceProvider) ?? null,
          status: STATUS_MAP[raw] ?? "scheduled",
        });
      }
      if (rows.length) {
        const { error } = await sb.from("appointments").upsert(rows, { onConflict: "vagaro_appt_id" });
        if (error) { apptErrors += rows.length; if (!firstError) firstError = error.message; }
        else apptsUpserted += rows.length;
      }
    }));
  }

  // Recalculate metrics for the touched clients from a single pass
  let clientsUpdated = 0;
  if (touchedClientIds.length) {
    const metrics = new Map<string, { completed: number; noShows: number; lastVisit: string | null }>();
    const idSet = new Set(touchedClientIds);
    // Pull appointments only for touched clients (chunk the .in() list)
    for (let i = 0; i < touchedClientIds.length; i += 200) {
      const ids = touchedClientIds.slice(i, i + 200);
      for (let from = 0; ; from += PAGE) {
        const { data: appts, error } = await sb
          .from("appointments").select("client_id, date, status")
          .in("client_id", ids)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) break;
        for (const a of appts ?? []) {
          const cid = str(a.client_id);
          if (!idSet.has(cid)) continue;
          const m = metrics.get(cid) ?? { completed: 0, noShows: 0, lastVisit: null };
          if (a.status === "completed" || a.status === "checked-in") {
            m.completed++;
            if (!m.lastVisit || a.date > m.lastVisit) m.lastVisit = a.date;
          } else if (a.status === "no-show") m.noShows++;
          metrics.set(cid, m);
        }
        if (!appts || appts.length < PAGE) break;
      }
    }

    const current = new Map<string, { last_visit: string | null; completed_appointments_count: number | null; no_shows: number | null }>();
    for (let i = 0; i < touchedClientIds.length; i += 200) {
      const { data: rows } = await sb
        .from("clients").select("id, last_visit, completed_appointments_count, no_shows")
        .in("id", touchedClientIds.slice(i, i + 200));
      for (const r of rows ?? []) current.set(str(r.id), r);
    }

    for (let i = 0; i < touchedClientIds.length; i += API_CONCURRENCY) {
      const slice = touchedClientIds.slice(i, i + API_CONCURRENCY);
      const res = await Promise.all(slice.map(async (cid) => {
        const m = metrics.get(cid) ?? { completed: 0, noShows: 0, lastVisit: null };
        const cur = current.get(cid);
        const updates: Record<string, unknown> = {
          completed_appointments_count: Math.max(m.completed, cur?.completed_appointments_count ?? 0),
          no_shows: Math.max(m.noShows, cur?.no_shows ?? 0),
        };
        if (m.lastVisit && (!cur?.last_visit || m.lastVisit > cur.last_visit)) updates.last_visit = m.lastVisit;
        const { error } = await sb.from("clients").update(updates).eq("id", cid);
        return !error;
      }));
      clientsUpdated += res.filter(Boolean).length;
    }
  }

  const processedThrough = offset + clients.length;
  const nextOffset = processedThrough < (totalClients ?? 0) && clients.length > 0 ? processedThrough : null;

  return json({
    ok: true,
    totalClients: totalClients ?? 0,
    clientsProcessed: clients.length,
    processedThrough,
    apptsUpserted,
    apptErrors,
    firstError,
    placeholdersEnriched,
    clientsUpdated,
    nextOffset,
    message: `Backfilled ${clients.length} clients (${apptsUpserted} appointments), ${placeholdersEnriched} placeholders enriched.`,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

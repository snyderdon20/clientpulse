/**
 * merge-clients — Supabase Edge Function
 *
 * Merges a duplicate client into a primary client:
 *   1. Fetches both client records
 *   2. Merges fields (primary wins, fills missing from duplicate)
 *   3. Reassigns appointments, history, and tasks to primary
 *   4. Deletes the duplicate
 *
 * Body: { primaryId: string, duplicateId: string }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({})) as Record<string, string>;
  const { primaryId, duplicateId } = body;

  if (!primaryId || !duplicateId) {
    return json({ error: "primaryId and duplicateId are required" }, 400);
  }
  if (primaryId === duplicateId) {
    return json({ error: "primaryId and duplicateId must be different" }, 400);
  }

  const [{ data: primary, error: e1 }, { data: duplicate, error: e2 }] = await Promise.all([
    sb.from("clients").select("*").eq("id", primaryId).single(),
    sb.from("clients").select("*").eq("id", duplicateId).single(),
  ]);
  if (e1 || !primary)   return json({ error: `Primary not found: ${e1?.message}` }, 404);
  if (e2 || !duplicate) return json({ error: `Duplicate not found: ${e2?.message}` }, 404);

  const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  const mergeArr = (a: unknown[], b: unknown[]) => [...new Set([...(a ?? []), ...(b ?? [])])];

  const merged = {
    vagaro_id:              primary.vagaro_id              || duplicate.vagaro_id,
    vagaro_synced:          primary.vagaro_synced          || duplicate.vagaro_synced,
    email:                  primary.email                  || duplicate.email,
    phone:                  primary.phone                  || duplicate.phone,
    birthday:               primary.birthday               || duplicate.birthday,
    customer_since:         primary.customer_since         || duplicate.customer_since,
    last_visit:             later(primary.last_visit, duplicate.last_visit),
    avg_visit_interval_days: primary.avg_visit_interval_days || duplicate.avg_visit_interval_days || 30,
    referred_by:            primary.referred_by            || duplicate.referred_by,
    care_category:          primary.care_category          || duplicate.care_category,
    red_light_status:       primary.red_light_status       || duplicate.red_light_status,
    waitlisted:             primary.waitlisted             || duplicate.waitlisted,
    address:                primary.address                || duplicate.address,
    city:                   primary.city                   || duplicate.city,
    state:                  primary.state                  || duplicate.state,
    zip:                    primary.zip                    || duplicate.zip,
    tags:                   mergeArr(primary.tags, duplicate.tags),
    golden_nuggets:         mergeArr(primary.golden_nuggets, duplicate.golden_nuggets),
    no_shows:               (primary.no_shows ?? 0) + (duplicate.no_shows ?? 0),
    total_spent:            ((parseFloat(primary.total_spent) || 0) + (parseFloat(duplicate.total_spent) || 0)).toFixed(2),
    status_override:        primary.status_override        || duplicate.status_override,
    updated_at:             new Date().toISOString(),
  };

  const { error: ue } = await sb.from("clients").update(merged).eq("id", primaryId);
  if (ue) return json({ error: `Failed to update primary: ${ue.message}` }, 500);

  await Promise.all([
    sb.from("appointments").update({ client_id: primaryId }).eq("client_id", duplicateId),
    sb.from("history").update({ client_id: primaryId }).eq("client_id", duplicateId),
    sb.from("tasks").update({ client_id: primaryId }).eq("client_id", duplicateId),
  ]);

  await sb.from("history").insert({
    client_id: primaryId,
    type: "client.merged",
    detail: `Merged duplicate record (${duplicate.first_name} ${duplicate.last_name})`,
    by: "ClientPulse",
    ts: Date.now(),
    source: "manual",
    direction: "internal",
  });

  const { error: de } = await sb.from("clients").delete().eq("id", duplicateId);
  if (de) return json({ error: `Failed to delete duplicate: ${de.message}` }, 500);

  return json({ success: true, primaryId, duplicateId, merged });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

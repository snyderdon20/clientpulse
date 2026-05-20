// vagaro-sync: fetches all Vagaro customers, matches by name, writes vagaro_id back to clients
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const clientId     = Deno.env.get("VAGARO_CLIENT_ID");
  const clientSecret = Deno.env.get("VAGARO_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return json({ error: "VAGARO_CLIENT_ID and VAGARO_CLIENT_SECRET secrets are not set in Supabase." }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Get Vagaro OAuth token ─────────────────────────────────────────────────
  const tokenRes = await fetch("https://api.vagaro.com/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!tokenRes.ok) {
    const msg = await tokenRes.text();
    return json({ error: `Vagaro auth failed: ${tokenRes.status} ${msg}` }, 502);
  }
  const { access_token } = await tokenRes.json();
  if (!access_token) return json({ error: "No access_token in Vagaro response" }, 502);

  // ── Get businessId from webhook_log if not provided ────────────────────────
  let { businessId } = await req.json().catch(() => ({ businessId: "" }));
  if (!businessId) {
    const { data: logRow } = await supabase
      .from("webhook_log")
      .select("payload")
      .eq("source", "vagaro")
      .not("payload->payload->businessId", "is", null)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    businessId = (logRow?.payload as Record<string, unknown>)?.payload?.businessId as string ?? "";
  }
  if (!businessId) return json({ error: "Could not determine businessId — create at least one appointment in Vagaro first, or pass businessId in the request body." }, 400);

  // ── Fetch all Vagaro customers (paginated) ─────────────────────────────────
  const vagaroCustomers: VagaroCustomer[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const url = `https://api.vagaro.com/v2/businesses/${encodeURIComponent(businessId)}/customers?pageNumber=${page}&pageSize=${pageSize}`;
    const res = await fetch(url, { headers: { "Authorization": `Bearer ${access_token}` } });

    if (!res.ok) {
      const msg = await res.text();
      return json({ error: `Vagaro customers API failed: ${res.status} ${msg}`, fetched: vagaroCustomers.length }, 502);
    }

    const body = await res.json();
    // Vagaro may return array directly or wrapped in { data: [...] } or { customers: [...] }
    const batch: VagaroCustomer[] = Array.isArray(body) ? body : (body.data ?? body.customers ?? body.items ?? []);
    if (batch.length === 0) break;

    vagaroCustomers.push(...batch);
    if (batch.length < pageSize) break; // last page
    page++;
  }

  if (vagaroCustomers.length === 0) {
    return json({ error: "Vagaro returned 0 customers. The API endpoint may need adjustment — check Supabase Edge Function logs.", businessId }, 502);
  }

  // ── Load all ClientPulse clients that still have no vagaro_id ─────────────
  const { data: cpClients, error: cpErr } = await supabase
    .from("clients")
    .select("id, first_name, last_name, vagaro_id")
    .is("vagaro_id", null);
  if (cpErr) return json({ error: `Supabase error: ${cpErr.message}` }, 500);

  // Build a lookup: "firstname lastname" (lowercase) → client row
  const nameMap = new Map<string, { id: string }>();
  for (const c of cpClients ?? []) {
    const key = `${(c.first_name ?? "").trim().toLowerCase()} ${(c.last_name ?? "").trim().toLowerCase()}`;
    nameMap.set(key, c);
  }

  // ── Match + update ─────────────────────────────────────────────────────────
  let matched = 0;
  let unmatched = 0;
  const unmatchedNames: string[] = [];

  for (const vc of vagaroCustomers) {
    const firstName = str(vc.firstName ?? vc.first_name ?? "");
    const lastName  = str(vc.lastName  ?? vc.last_name  ?? "");
    const vagaroId  = str(vc.customerId ?? vc.id ?? "");
    if (!vagaroId || !firstName) continue;

    const key = `${firstName.trim().toLowerCase()} ${lastName.trim().toLowerCase()}`;
    const cp  = nameMap.get(key);

    if (cp) {
      await supabase.from("clients").update({
        vagaro_id:     vagaroId,
        vagaro_synced: true,
        updated_at:    new Date().toISOString(),
      }).eq("id", cp.id);

      // Also retroactively link any unlinked appointments in the DB
      await supabase.from("appointments")
        .update({ client_id: cp.id })
        .eq("vagaro_appt_id", vagaroId)   // won't match much — belt+suspenders
        .is("client_id", null);

      nameMap.delete(key); // prevent double-matching
      matched++;
    } else {
      unmatched++;
      if (unmatchedNames.length < 20) unmatchedNames.push(`${firstName} ${lastName}`);
    }
  }

  return json({
    success: true,
    total:       vagaroCustomers.length,
    matched,
    unmatched,
    unmatchedSample: unmatchedNames,
    note: unmatched > 0 ? "Unmatched customers have no corresponding client in ClientPulse (different name or not yet imported)." : undefined,
  });
});

interface VagaroCustomer {
  customerId?: string;
  id?: string;
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
}

function str(v: unknown): string { return v == null ? "" : String(v); }
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

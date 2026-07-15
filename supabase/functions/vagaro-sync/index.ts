/**
 * vagaro-sync — Supabase Edge Function (v2)
 *
 * Syncs Vagaro customer IDs into the ClientPulse `clients` table by:
 *   1. Collecting all unique customerIds from webhook_log
 *   2. Looking up each via the Vagaro V2 Customer API
 *   3. Matching by name to local clients with no vagaro_id
 *   4. Writing vagaro_id + vagaro_synced back to Supabase
 *
 * Auth uses the real Vagaro V2 token endpoint:
 *   POST https://api.vagaro.com/{region}/api/v2/merchants/generate-access-token
 *   Body: { clientId, clientSecretKey, scope }
 *
 * Supabase secrets required:
 *   VAGARO_CLIENT_ID        — your Vagaro clientId
 *   VAGARO_CLIENT_SECRET_KEY — your Vagaro clientSecretKey
 *   VAGARO_REGION           — your account region, e.g. "us04"
 *
 * Also supports { test: true, region, clientId, clientSecretKey } for
 * credential validation from the Settings page (bypasses CORS).
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Vagaro V2 helpers ────────────────────────────────────────────────────────

async function getAccessToken(
  region: string,
  clientId: string,
  clientSecretKey: string,
  scope = "read access",
): Promise<string> {
  const res = await fetch(
    `https://api.vagaro.com/${region}/api/v2/merchants/generate-access-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecretKey, scope }),
    },
  );
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Vagaro auth failed: ${res.status} ${msg}`);
  }
  const body = await res.json();
  const token = body?.data?.access_token;
  if (!token) throw new Error("No access_token in Vagaro response");
  return token;
}

interface VagaroCustomer {
  customerId: string;
  customerFirstName: string;
  customerLastName: string;
  email?: string;
  mobilePhone?: string;
  dayPhone?: string;
  streetAddress?: string;
  city?: string;
  regionCode?: string;
  postalCode?: string;
  birthday?: string;
  createdDate?: string;
}

async function fetchCustomer(
  region: string,
  accessToken: string,
  businessId: string,
  customerId: string,
): Promise<{ customer: VagaroCustomer | null; httpStatus: number }> {
  try {
    const res = await fetch(
      `https://api.vagaro.com/${region}/api/v2/customers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", accessToken },
        body: JSON.stringify({ businessId, customerId }),
      },
    );
    if (!res.ok) return { customer: null, httpStatus: res.status };
    const body = await res.json();
    return { customer: (body?.data as VagaroCustomer) ?? null, httpStatus: res.status };
  } catch {
    return { customer: null, httpStatus: 0 }; // network error
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const reqBody = await req.json().catch(() => ({})) as Record<string, unknown>;

  // ── Test mode: validate credentials stored as Supabase secrets ───────────
  if (reqBody.test === true) {
    const region          = Deno.env.get("VAGARO_REGION");
    const clientId        = Deno.env.get("VAGARO_CLIENT_ID");
    const clientSecretKey = Deno.env.get("VAGARO_CLIENT_SECRET_KEY");

    if (!region || !clientId || !clientSecretKey) {
      return json({
        ok: false,
        msg: "Secrets not set yet. Run: supabase secrets set VAGARO_CLIENT_ID=… VAGARO_CLIENT_SECRET_KEY=… VAGARO_REGION=… --project-ref dewsznqxagzahtkpriuk",
      });
    }
    try {
      await getAccessToken(region, clientId, clientSecretKey);
      return json({ ok: true, msg: "Credentials verified — Vagaro V2 API connection successful." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("401") || msg.includes("Unauthorized")) {
        return json({ ok: false, msg: "Invalid credentials — check your Client ID and Client Secret Key in Supabase secrets." });
      }
      return json({ ok: false, msg: `Connection failed: ${msg}` });
    }
  }

  // ── Full sync mode ────────────────────────────────────────────────────────
  const clientId        = Deno.env.get("VAGARO_CLIENT_ID");
  const clientSecretKey = Deno.env.get("VAGARO_CLIENT_SECRET_KEY");
  const region          = Deno.env.get("VAGARO_REGION");

  if (!clientId || !clientSecretKey || !region) {
    return json({
      error: "VAGARO_CLIENT_ID, VAGARO_CLIENT_SECRET_KEY, and VAGARO_REGION secrets must be set in Supabase.",
    }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Get businessId from request body or fall back to webhook_log
  let businessId = str(reqBody.businessId);
  if (!businessId) {
    const { data: logRow } = await supabase
      .from("webhook_log")
      .select("payload")
      .eq("source", "vagaro")
      .not("payload->payload->businessId", "is", null)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    businessId = str((logRow?.payload as Record<string, unknown>)?.payload?.businessId ?? "");
  }
  if (!businessId) {
    return json({
      error: "Could not determine businessId — trigger at least one Vagaro webhook first, or pass businessId in the request body.",
    }, 400);
  }

  // Get access token
  let accessToken: string;
  try {
    accessToken = await getAccessToken(region, clientId, clientSecretKey);
  } catch (e) {
    return json({ error: String(e) }, 502);
  }

  // Collect all unique customerIds from webhook_log
  const { data: logRows } = await supabase
    .from("webhook_log")
    .select("payload")
    .eq("source", "vagaro")
    .not("payload->payload->customerId", "is", null);

  const customerIds = new Set<string>();
  for (const row of logRows ?? []) {
    const cid = str((row.payload as Record<string, unknown>)?.payload?.customerId ?? "");
    if (cid) customerIds.add(cid);
  }

  if (customerIds.size === 0) {
    return json({
      error: "No customerIds found in webhook_log — receive at least one appointment webhook from Vagaro first.",
    }, 400);
  }

  // Load ClientPulse clients that still have no vagaro_id
  const { data: cpClients, error: cpErr } = await supabase
    .from("clients")
    .select("id, first_name, last_name")
    .is("vagaro_id", null);
  if (cpErr) return json({ error: `Supabase error: ${cpErr.message}` }, 500);

  // Build name → client lookup (trim each part to handle CSV import whitespace)
  const nameMap = new Map<string, { id: string }>();
  for (const c of cpClients ?? []) {
    const key = `${str(c.first_name).trim().toLowerCase()} ${str(c.last_name).trim().toLowerCase()}`.trim();
    nameMap.set(key, c);
  }

  // For each Vagaro customerId, fetch customer details and try to match
  let matched        = 0;
  let alreadyLinked  = 0;
  let created        = 0;

  // Failure diagnostics — why a customerId could not be resolved
  const failures = { notFound: 0, unauthorized: 0, serverError: 0, networkError: 0, otherError: 0, emptyName: 0 };
  const failSamples: { customerId: string; reason: string }[] = [];
  const noteFailure = (customerId: string, reason: keyof typeof failures) => {
    failures[reason]++;
    if (failSamples.length < 10) failSamples.push({ customerId, reason });
  };

  for (const customerId of customerIds) {
    // Skip if already linked — client was synced via webhook
    const { data: alreadyDone } = await supabase
      .from("clients").select("id").eq("vagaro_id", customerId).maybeSingle();
    if (alreadyDone) { alreadyLinked++; continue; }

    const { customer: vc, httpStatus } = await fetchCustomer(region, accessToken, businessId, customerId);
    if (!vc) {
      if (httpStatus === 404)                            noteFailure(customerId, "notFound");
      else if (httpStatus === 401 || httpStatus === 403) noteFailure(customerId, "unauthorized");
      else if (httpStatus >= 500)                        noteFailure(customerId, "serverError");
      else if (httpStatus === 0)                         noteFailure(customerId, "networkError");
      else                                               noteFailure(customerId, "otherError");
      continue;
    }

    const firstName = str(vc.customerFirstName).trim();
    const lastName  = str(vc.customerLastName).trim();
    const key = `${firstName.toLowerCase()} ${lastName.toLowerCase()}`.trim();

    // 1. In-memory name map (fast path — only unlinked clients)
    let cp = nameMap.get(key) ?? null;

    // 2. Database name match
    if (!cp && (firstName || lastName)) {
      const { data: dbMatch } = await supabase
        .from("clients").select("id")
        .ilike("first_name", firstName).ilike("last_name", lastName)
        .is("vagaro_id", null).maybeSingle();
      if (dbMatch) cp = dbMatch as { id: string };
    }

    // 3. Email match
    if (!cp && vc.email?.trim()) {
      const { data: emailMatch } = await supabase
        .from("clients").select("id")
        .ilike("email", vc.email.trim())
        .is("vagaro_id", null).maybeSingle();
      if (emailMatch) cp = emailMatch as { id: string };
    }

    // 4. Phone match
    if (!cp && vc.mobilePhone?.trim()) {
      const { data: phoneMatch } = await supabase
        .from("clients").select("id")
        .ilike("phone", vc.mobilePhone.trim())
        .is("vagaro_id", null).maybeSingle();
      if (phoneMatch) cp = phoneMatch as { id: string };
    }

    if (cp) {
      await supabase.from("clients").update({
        vagaro_id:     customerId,
        vagaro_synced: true,
        updated_at:    new Date().toISOString(),
      }).eq("id", cp.id);

      await linkPendingAppointments(supabase, customerId, cp.id);
      nameMap.delete(key);
      matched++;
    } else {
      // No existing client found — create one from the Vagaro data
      if (!firstName && !lastName) { noteFailure(customerId, "emptyName"); continue; }

      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
      const orNull = (v: string | undefined) => v?.trim() || null;

      const { data: inserted, error: insErr } = await supabase
        .from("clients").insert({
          vagaro_id:      customerId,
          vagaro_synced:  true,
          first_name:     firstName,
          last_name:      lastName,
          email:          orNull(vc.email),
          phone:          orNull(vc.mobilePhone) ?? orNull(vc.dayPhone),
          address:        orNull(vc.streetAddress),
          city:           orNull(vc.city),
          state:          orNull(vc.regionCode),
          zip:            orNull(vc.postalCode),
          birthday:       orNull(vc.birthday),
          customer_since: orNull(vc.createdDate?.split("T")[0]) ?? today,
          avg_visit_interval_days: 30,
          waitlisted: false,
          tags: [],
          golden_nuggets: [],
        }).select("id").single();

      if (insErr) {
        console.error(`Failed to create client ${firstName} ${lastName}:`, insErr.message);
        continue;
      }

      await linkPendingAppointments(supabase, customerId, inserted.id);
      created++;
    }
  }

  const totalFailed = Object.values(failures).reduce((a, b) => a + b, 0);
  return json({
    success: true,
    scanned:       customerIds.size,
    alreadyLinked,
    matched,
    created,
    failed: totalFailed,
    failures,
    failSamples,
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function linkPendingAppointments(
  // deno-lint-ignore no-explicit-any
  sb: any,
  vagaroCustomerId: string,
  clientId: string,
) {
  try {
    const { data: logRows } = await sb
      .from("webhook_log")
      .select("payload")
      .eq("source", "vagaro")
      .like("event_type", "appointment.%")
      .filter("payload->payload->customerId", "eq", vagaroCustomerId);

    const apptIds = (logRows ?? [])
      .map((r: Record<string, unknown>) => {
        const p = (r.payload as Record<string, unknown>)?.payload as Record<string, unknown> | undefined;
        return str(p?.appointmentId ?? "");
      })
      .filter(Boolean);

    if (apptIds.length > 0) {
      await sb.from("appointments")
        .update({ client_id: clientId })
        .in("vagaro_appt_id", apptIds)
        .is("client_id", null);
    }
  } catch (e) {
    console.error("linkPendingAppointments:", e);
  }
}

function str(v: unknown): string { return v == null ? "" : String(v); }
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/**
 * vagaro-webhook — Supabase Edge Function
 *
 * Receives Vagaro webhook events and syncs them into ClientPulse.
 *
 * Vagaro webhook payload format:
 *   { type: "appointment"|"customer"|"sale", action: "created"|..., payload: {...} }
 *
 * Client resolution chain (for linking appointments to clients):
 *   1. Direct vagaro_id lookup
 *   2. Name from prior customer events in webhook_log
 *   3. Vagaro V2 Customer API (requires VAGARO_* secrets)
 *   4. Case-insensitive name match against clients table
 *
 * Supabase secrets required:
 *   VAGARO_CLIENT_ID         — your Vagaro clientId
 *   VAGARO_CLIENT_SECRET_KEY — your Vagaro clientSecretKey
 *   VAGARO_REGION            — your account region, e.g. "us04"
 *   VAGARO_WEBHOOK_SECRET    — optional, validates x-webhook-secret header
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Status maps ──────────────────────────────────────────────────────────────

const BOOKING_STATUS: Record<string, string> = {
  "confirmed":   "scheduled",
  "pending":     "scheduled",
  "checked in":  "checked-in",
  "checkedin":   "checked-in",
  "inprogress":  "checked-in",
  "in progress": "checked-in",
  "completed":   "completed",
  "cancelled":   "cancelled",
  "canceled":    "cancelled",
  "no show":     "no-show",
  "no-show":     "no-show",
  "noshow":      "no-show",
};

const HISTORY_TYPE: Record<string, string> = {
  "appointment.created":   "appt.scheduled",
  "appointment.updated":   "appt.rescheduled",
  "appointment.cancelled": "appt.cancelled",
  "appointment.deleted":   "appt.cancelled",
  "appointment.completed": "appt.completed",
  "appointment.checkedin": "appt.checkin",
  "appointment.noshow":    "appt.noshow",
  "customer.created":      "client.updated",
  "customer.updated":      "client.updated",
};

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-vagaro-signature, x-webhook-secret",
};

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const secret = Deno.env.get("VAGARO_WEBHOOK_SECRET");
  if (secret) {
    const provided = req.headers.get("x-webhook-secret") || req.headers.get("x-vagaro-signature");
    if (provided !== secret) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const type      = str(body.type);
  const action    = str(body.action);
  const eventType = type && action ? `${type}.${action}` : "unknown";
  const data      = (body.payload ?? {}) as Record<string, unknown>;

  await supabase.from("webhook_log").insert({ source: "vagaro", event_type: eventType, payload: body });

  let processingError: string | null = null;
  try {
    if (type === "appointment") await handleAppointment(supabase, eventType, data);
    else if (type === "customer") await handleCustomer(supabase, eventType, data);
    else if (type === "sale")     await handleSale(supabase, data);
  } catch (err) {
    processingError = String(err);
    console.error("Processing error:", processingError);
  }

  return new Response(
    JSON.stringify({ received: true, event: eventType, error: processingError }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});

// ─── Client resolution ────────────────────────────────────────────────────────

type ClientRow = { id: string; no_shows: number; total_spent: number };
type SB = ReturnType<typeof createClient>;

async function resolveClient(
  sb: SB,
  vagaroCustomerId: string,
  businessId = "",
): Promise<ClientRow | null> {
  // 1. Direct vagaro_id lookup
  let client = await findByVagaroId(sb, vagaroCustomerId);
  if (client) return client;

  // 2. Name from prior customer events in webhook_log → name match
  const { firstName: logFirst, lastName: logLast } = await nameFromLog(sb, vagaroCustomerId);
  if (logFirst || logLast) {
    client = await findByName(sb, logFirst, logLast);
    if (client) return await linkClient(sb, client, vagaroCustomerId, logFirst, logLast);
  }

  // 3. Vagaro API — full profile for name + email + phone matching
  if (!businessId) return null;
  const profile = await profileFromVagaroAPI(businessId, vagaroCustomerId);
  if (!profile) return null;

  const { firstName, lastName, email, phone } = profile;

  if (firstName || lastName) {
    client = await findByName(sb, firstName, lastName);
    if (client) return await linkClient(sb, client, vagaroCustomerId, firstName, lastName);
  }

  if (email) {
    client = await findByEmail(sb, email);
    if (client) return await linkClient(sb, client, vagaroCustomerId, firstName, lastName);
  }

  if (phone) {
    client = await findByPhone(sb, phone);
    if (client) return await linkClient(sb, client, vagaroCustomerId, firstName, lastName);
  }

  return null;
}

async function linkClient(
  sb: SB,
  client: ClientRow,
  vagaroCustomerId: string,
  firstName: string,
  lastName: string,
): Promise<ClientRow> {
  await sb.from("clients").update({
    vagaro_id:     vagaroCustomerId,
    vagaro_synced: true,
    updated_at:    new Date().toISOString(),
  }).eq("id", client.id);
  await linkPendingAppointments(sb, vagaroCustomerId, client.id);
  console.log(`Linked ${firstName} ${lastName} → Vagaro ID ${vagaroCustomerId}`);
  return client;
}

async function findByVagaroId(sb: SB, vagaroId: string): Promise<ClientRow | null> {
  const { data } = await sb.from("clients")
    .select("id, no_shows, total_spent")
    .eq("vagaro_id", vagaroId)
    .maybeSingle();
  return (data as ClientRow) ?? null;
}

async function findByName(sb: SB, firstName: string, lastName: string): Promise<ClientRow | null> {
  if (!firstName.trim() && !lastName.trim()) return null;
  const { data } = await sb.from("clients")
    .select("id, no_shows, total_spent")
    .ilike("first_name", firstName.trim())
    .ilike("last_name",  lastName.trim())
    .maybeSingle();
  return (data as ClientRow) ?? null;
}

async function findByEmail(sb: SB, email: string): Promise<ClientRow | null> {
  if (!email.trim()) return null;
  const { data } = await sb.from("clients")
    .select("id, no_shows, total_spent")
    .ilike("email", email.trim())
    .maybeSingle();
  return (data as ClientRow) ?? null;
}

async function findByPhone(sb: SB, phone: string): Promise<ClientRow | null> {
  if (!phone.trim()) return null;
  const { data } = await sb.from("clients")
    .select("id, no_shows, total_spent")
    .ilike("phone", phone.trim())
    .maybeSingle();
  return (data as ClientRow) ?? null;
}

async function nameFromLog(
  sb: SB,
  vagaroCustomerId: string,
): Promise<{ firstName: string; lastName: string }> {
  try {
    const { data } = await sb.from("webhook_log")
      .select("payload")
      .eq("source", "vagaro")
      .in("event_type", ["customer.created", "customer.updated"])
      .order("received_at", { ascending: false })
      .limit(200);
    for (const row of data ?? []) {
      const p = (row.payload as Record<string, unknown>)?.payload as Record<string, unknown> | undefined;
      if (!p) continue;
      if (str(p.customerId ?? p.id) === vagaroCustomerId) {
        return {
          firstName: str(p.firstName ?? p.FirstName ?? "").trim(),
          lastName:  str(p.lastName  ?? p.LastName  ?? "").trim(),
        };
      }
    }
  } catch (e) { console.error("nameFromLog:", e); }
  return { firstName: "", lastName: "" };
}

/**
 * Calls the Vagaro V2 Customer API and returns the full profile
 * (name + email + phone) for use in multi-field client matching.
 */
async function profileFromVagaroAPI(
  businessId: string,
  customerId: string,
): Promise<{ firstName: string; lastName: string; email: string; phone: string } | null> {
  const clientId        = Deno.env.get("VAGARO_CLIENT_ID");
  const clientSecretKey = Deno.env.get("VAGARO_CLIENT_SECRET_KEY");
  const region          = Deno.env.get("VAGARO_REGION");
  if (!clientId || !clientSecretKey || !region) return null;

  try {
    const tokenRes = await fetch(
      `https://api.vagaro.com/${region}/api/v2/merchants/generate-access-token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecretKey, scope: "read access" }),
      },
    );
    if (!tokenRes.ok) { console.error("Vagaro V2 token error:", tokenRes.status); return null; }
    const accessToken = (await tokenRes.json())?.data?.access_token;
    if (!accessToken) return null;

    const custRes = await fetch(
      `https://api.vagaro.com/${region}/api/v2/customers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", accessToken },
        body: JSON.stringify({ businessId, customerId }),
      },
    );
    if (!custRes.ok) {
      console.error("Vagaro V2 customer error:", custRes.status, await custRes.text());
      return null;
    }

    const c = (await custRes.json())?.data;
    const firstName = str(c?.customerFirstName ?? "").trim();
    const lastName  = str(c?.customerLastName  ?? "").trim();
    const email     = str(c?.email             ?? "").trim();
    const phone     = str(c?.mobilePhone ?? c?.dayPhone ?? "").trim();
    if (firstName || lastName || email || phone) {
      console.log(`Vagaro V2 resolved: ${firstName} ${lastName} (${email}) for customerId ${customerId}`);
      return { firstName, lastName, email, phone };
    }
  } catch (e) { console.error("profileFromVagaroAPI:", e); }
  return null;
}

async function linkPendingAppointments(sb: SB, vagaroCustomerId: string, clientId: string) {
  try {
    const { data: logRows } = await sb.from("webhook_log")
      .select("payload")
      .eq("source", "vagaro")
      .like("event_type", "appointment.%")
      .filter("payload->payload->customerId", "eq", vagaroCustomerId);

    const apptIds = (logRows ?? []).map((r: { payload: unknown }) => {
      const p = (r.payload as Record<string, unknown>)?.payload as Record<string, unknown> | undefined;
      return str(p?.appointmentId ?? "");
    }).filter(Boolean);

    if (apptIds.length > 0) {
      await sb.from("appointments")
        .update({ client_id: clientId })
        .in("vagaro_appt_id", apptIds)
        .is("client_id", null);
      console.log(`Retroactively linked ${apptIds.length} appointment(s) to client ${clientId}`);
    }
  } catch (e) { console.error("linkPendingAppointments:", e); }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleAppointment(sb: SB, eventType: string, data: Record<string, unknown>) {
  const vagaroApptId   = str(data.appointmentId);
  const vagaroClientId = str(data.customerId);
  const businessId     = str(data.businessId);
  if (!vagaroApptId) return;

  const startIso   = str(data.startTime);
  const apptDate   = startIso ? startIso.split("T")[0] : new Date().toISOString().split("T")[0];
  const apptTime   = startIso.includes("T") ? startIso.split("T")[1].slice(0, 5) : null;
  const rawStatus  = str(data.bookingStatus).toLowerCase().trim();
  const apptStatus = BOOKING_STATUS[rawStatus] ?? (
    eventType.endsWith(".cancelled") || eventType.endsWith(".deleted") ? "cancelled" :
    eventType.endsWith(".completed") ? "completed" : "scheduled"
  );
  const service  = str(data.serviceTitle ?? data.serviceName ?? "");
  const duration = calcDuration(data.startTime, data.endTime);

  await sb.from("appointments").upsert(
    { vagaro_appt_id: vagaroApptId, date: apptDate, time: apptTime, service, duration, status: apptStatus },
    { onConflict: "vagaro_appt_id" },
  );

  if (!vagaroClientId) return;
  const client = await resolveClient(sb, vagaroClientId, businessId);
  if (!client) {
    console.log(`No client found for Vagaro ID ${vagaroClientId} — appointment stored unlinked`);
    return;
  }

  await sb.from("appointments").update({ client_id: client.id }).eq("vagaro_appt_id", vagaroApptId);

  if (apptStatus === "completed") {
    const updates: Record<string, unknown> = { last_visit: apptDate, updated_at: new Date().toISOString() };
    const amount = num(data.amount);
    if (amount > 0) updates.total_spent = (client.total_spent ?? 0) + amount;
    await sb.from("clients").update(updates).eq("id", client.id);
  }

  if (apptStatus === "no-show") {
    await sb.from("clients")
      .update({ no_shows: (client.no_shows ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq("id", client.id);
  }

  await logHistory(sb, client.id, HISTORY_TYPE[eventType] ?? "appt.scheduled", `${service || "Appointment"} — Vagaro sync`);
}

async function handleCustomer(sb: SB, eventType: string, data: Record<string, unknown>) {
  const vagaroId  = str(data.customerId ?? data.id);
  const firstName = str(data.firstName  ?? data.FirstName  ?? data.customerFirstName  ?? "");
  const lastName  = str(data.lastName   ?? data.LastName   ?? data.customerLastName   ?? "");
  const email     = str(data.email      ?? data.Email      ?? "") || null;
  const phone     = str(data.mobilePhone ?? data.phone     ?? "") || null;
  const birthday  = str(data.birthDate  ?? data.birthday   ?? "").split("T")[0] || null;
  if (!vagaroId) return;

  if (eventType === "customer.created") {
    const existing = await resolveClient(sb, vagaroId, "");
    if (!existing && firstName) {
      await sb.from("clients").insert({
        id: crypto.randomUUID(),
        vagaro_id: vagaroId, vagaro_synced: true,
        first_name: firstName, last_name: lastName,
        email, phone, birthday,
        tags: [], golden_nuggets: [],
      });
    }
    return;
  }

  const client = await resolveClient(sb, vagaroId, "");
  if (!client) return;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), vagaro_synced: true };
  if (firstName) updates.first_name = firstName;
  if (lastName)  updates.last_name  = lastName;
  if (email)     updates.email      = email;
  if (phone)     updates.phone      = phone;
  if (birthday)  updates.birthday   = birthday;
  await sb.from("clients").update(updates).eq("id", client.id);
  await logHistory(sb, client.id, "client.updated", "Profile synced from Vagaro");
}

async function handleSale(sb: SB, data: Record<string, unknown>) {
  const vagaroClientId = str(data.customerId ?? data.CustomerId ?? "");
  const amount = num(data.totalAmount ?? data.amount ?? 0);
  if (!vagaroClientId || !amount) return;

  const client = await resolveClient(sb, vagaroClientId, str(data.businessId ?? ""));
  if (!client) return;
  await sb.from("clients").update({
    total_spent: (client.total_spent ?? 0) + amount,
    updated_at:  new Date().toISOString(),
  }).eq("id", client.id);
  await logHistory(sb, client.id, "payment.charged", `Payment of $${amount.toFixed(2)} synced from Vagaro`);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function str(v: unknown): string { return v == null ? "" : String(v); }
function num(v: unknown): number { return Number(v) || 0; }

function calcDuration(start: unknown, end: unknown): number | null {
  if (!start || !end) return null;
  const ms = new Date(str(end)).getTime() - new Date(str(start)).getTime();
  return ms > 0 ? Math.round(ms / 60000) : null;
}

async function logHistory(sb: SB, clientId: string, type: string, detail: string) {
  await sb.from("history").insert({
    client_id: clientId, type, detail, by: "Vagaro",
    ts: Date.now(), source: "vagaro", direction: "internal",
  });
}

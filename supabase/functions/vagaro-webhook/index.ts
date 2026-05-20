// v3 — name-matching fallback
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Vagaro sends { type, action, payload: { ... }, createdDate }
// We combine type + action → "appointment.created" etc.

const BOOKING_STATUS: Record<string, string> = {
  "confirmed":  "scheduled",
  "pending":    "scheduled",
  "checkedin":  "checked-in",
  "checked in": "checked-in",
  "inprogress": "checked-in",
  "completed":  "completed",
  "cancelled":  "cancelled",
  "canceled":   "cancelled",
  "noshow":     "no-show",
  "no show":    "no-show",
  "no-show":    "no-show",
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
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
    const provided =
      req.headers.get("x-webhook-secret") ||
      req.headers.get("x-vagaro-signature");
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

  // Log every event
  await supabase.from("webhook_log").insert({
    source:     "vagaro",
    event_type: eventType,
    payload:    body,
  });

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

// ─── CLIENT LOOKUP ───────────────────────────────────────────────────────────
// Try vagaro_id first. If no match, fall back to first+last name.
// When found by name, write vagaro_id back so future events skip the fallback.

type ClientRow = { id: string; no_shows: number; total_spent: number };
type SB = ReturnType<typeof createClient>;

async function findOrMatchClient(
  sb: SB,
  vagaroId: string,
  firstName = "",
  lastName  = "",
): Promise<ClientRow | null> {

  // 1. Exact vagaro_id match
  if (vagaroId) {
    const { data } = await sb
      .from("clients")
      .select("id, no_shows, total_spent")
      .eq("vagaro_id", vagaroId)
      .maybeSingle();
    if (data) return data as ClientRow;
  }

  // 2. Name match
  const first = firstName.trim();
  const last  = lastName.trim();
  if (first && last) {
    const { data } = await sb
      .from("clients")
      .select("id, no_shows, total_spent")
      .ilike("first_name", first)
      .ilike("last_name",  last)
      .maybeSingle();

    if (data) {
      const row = data as ClientRow;
      // Backfill vagaro_id — future events will now match directly
      if (vagaroId) {
        await sb.from("clients")
          .update({ vagaro_id: vagaroId, vagaro_synced: true, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        console.log(`Linked client ${row.id} to Vagaro ID ${vagaroId} via name match (${first} ${last})`);
      }
      return row;
    }
  }

  return null;
}

// For appointment events we only get customerId (encoded), not the name.
// Look through previous webhook_log customer events for that same customerId
// to recover the name so we can do a name-match fallback.
async function lookupNameFromLog(
  sb: SB,
  vagaroCustomerId: string,
): Promise<{ firstName: string; lastName: string }> {
  try {
    const { data: rows } = await sb
      .from("webhook_log")
      .select("payload")
      .eq("source", "vagaro")
      .in("event_type", ["customer.created", "customer.updated"])
      .order("received_at", { ascending: false })
      .limit(200);

    if (!rows) return { firstName: "", lastName: "" };

    for (const row of rows) {
      const p = (row.payload as Record<string, unknown>)?.payload as Record<string, unknown> | undefined;
      if (!p) continue;
      const cid = str(p.customerId ?? p.id ?? "");
      if (cid === vagaroCustomerId) {
        return {
          firstName: str(p.firstName ?? p.FirstName ?? ""),
          lastName:  str(p.lastName  ?? p.LastName  ?? ""),
        };
      }
    }
  } catch (e) {
    console.error("lookupNameFromLog error:", e);
  }
  return { firstName: "", lastName: "" };
}

// ─── APPOINTMENT ─────────────────────────────────────────────────────────────

async function handleAppointment(sb: SB, eventType: string, data: Record<string, unknown>) {
  const vagaroApptId   = str(data.appointmentId);
  const vagaroClientId = str(data.customerId);
  if (!vagaroApptId) return;

  const startIso  = str(data.startTime);
  const apptDate  = startIso ? startIso.split("T")[0] : new Date().toISOString().split("T")[0];
  const apptTime  = startIso.includes("T") ? startIso.split("T")[1].slice(0, 5) : null;

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

  // Try direct match first; if that fails, recover name from webhook_log and name-match
  let client = await findOrMatchClient(sb, vagaroClientId);
  if (!client) {
    const { firstName, lastName } = await lookupNameFromLog(sb, vagaroClientId);
    if (firstName || lastName) {
      client = await findOrMatchClient(sb, vagaroClientId, firstName, lastName);
    }
  }

  if (!client) {
    console.log(`No client found for Vagaro ID ${vagaroClientId} — appointment stored unlinked`);
    return;
  }

  // Link appointment to client
  await sb.from("appointments")
    .update({ client_id: client.id })
    .eq("vagaro_appt_id", vagaroApptId);

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

  await logHistory(
    sb, client.id,
    HISTORY_TYPE[eventType] ?? "appt.scheduled",
    `${service || "Appointment"} — Vagaro sync`,
  );
}

// ─── CUSTOMER ────────────────────────────────────────────────────────────────

async function handleCustomer(sb: SB, eventType: string, data: Record<string, unknown>) {
  const vagaroId  = str(data.customerId ?? data.id);
  const firstName = str(data.firstName  ?? data.FirstName  ?? "");
  const lastName  = str(data.lastName   ?? data.LastName   ?? "");
  const email     = str(data.email      ?? data.Email      ?? "") || null;
  const phone     = str(data.mobilePhone ?? data.phone     ?? "") || null;
  const rawBday   = str(data.birthDate  ?? data.birthday   ?? "");
  const birthday  = rawBday ? rawBday.split("T")[0] : null;

  if (!vagaroId) return;

  if (eventType === "customer.created") {
    // Try to find by vagaro_id or name before inserting to avoid duplicates
    const existing = await findOrMatchClient(sb, vagaroId, firstName, lastName);
    if (!existing && firstName) {
      await sb.from("clients").insert({
        id:            crypto.randomUUID(),
        vagaro_id:     vagaroId,
        vagaro_synced: true,
        first_name:    firstName,
        last_name:     lastName,
        email,
        phone,
        birthday,
        tags:           [],
        golden_nuggets: [],
      });
    }
    return;
  }

  // customer.updated — find (with name fallback) then patch
  const client = await findOrMatchClient(sb, vagaroId, firstName, lastName);
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

// ─── SALE ────────────────────────────────────────────────────────────────────

async function handleSale(sb: SB, data: Record<string, unknown>) {
  const vagaroClientId = str(data.customerId ?? data.CustomerId ?? "");
  const amount = num(data.totalAmount ?? data.amount ?? 0);
  if (!vagaroClientId || !amount) return;

  let client = await findOrMatchClient(sb, vagaroClientId);
  if (!client) {
    const { firstName, lastName } = await lookupNameFromLog(sb, vagaroClientId);
    client = await findOrMatchClient(sb, vagaroClientId, firstName, lastName);
  }
  if (!client) return;

  await sb.from("clients")
    .update({ total_spent: (client.total_spent ?? 0) + amount, updated_at: new Date().toISOString() })
    .eq("id", client.id);
  await logHistory(sb, client.id, "payment.charged", `Payment of $${amount.toFixed(2)} synced from Vagaro`);
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function str(v: unknown): string { return v == null ? "" : String(v); }
function num(v: unknown): number { return Number(v) || 0; }

function calcDuration(start: unknown, end: unknown): number | null {
  if (!start || !end) return null;
  const ms = new Date(str(end)).getTime() - new Date(str(start)).getTime();
  return ms > 0 ? Math.round(ms / 60000) : null;
}

async function logHistory(sb: SB, clientId: string, type: string, detail: string) {
  await sb.from("history").insert({
    client_id: clientId, type, detail,
    by: "Vagaro", ts: Date.now(), source: "vagaro", direction: "internal",
  });
}

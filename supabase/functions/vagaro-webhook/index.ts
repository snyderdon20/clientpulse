import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Vagaro sends PascalCase event names — map them to our dot-notation
const EVENT_MAP: Record<string, string> = {
  AppointmentAdded:       "appointment.booked",
  AppointmentUpdated:     "appointment.updated",
  AppointmentCompleted:   "appointment.completed",
  AppointmentCancelled:   "appointment.cancelled",
  AppointmentDeleted:     "appointment.cancelled",
  AppointmentNoShow:      "appointment.noshow",
  AppointmentCheckIn:     "appointment.checkin",
  CustomerAdded:          "customer.created",
  CustomerUpdated:        "customer.updated",
  SaleAdded:              "sale.completed",
  SaleUpdated:            "sale.updated",
  FormResponseAdded:      "form.submitted",
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

  // Verify shared secret when configured
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

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Normalise the event type
  const rawType = String(
    payload.EventType ?? payload.eventType ?? payload.event ?? "unknown"
  );
  const eventType =
    EVENT_MAP[rawType] ??
    rawType.replace(/([A-Z])/g, (m) => `.${m.toLowerCase()}`).replace(/^\./, "");

  // Persist to webhook_log
  const { error: logErr } = await supabase.from("webhook_log").insert({
    source:     "vagaro",
    event_type: eventType,
    payload,
  });
  if (logErr) console.error("webhook_log insert failed:", logErr.message);

  // Process the event
  let processingError: string | null = null;
  try {
    const data = (payload.Data ?? payload.data ?? payload) as Record<string, unknown>;
    if (eventType.startsWith("appointment.")) await handleAppointment(supabase, eventType, data);
    else if (eventType.startsWith("customer."))    await handleCustomer(supabase, eventType, data);
    else if (eventType.startsWith("sale."))        await handleSale(supabase, eventType, data);
  } catch (err) {
    processingError = String(err);
    console.error("Processing error:", processingError);
    // Mark the log row as errored
    await supabase
      .from("webhook_log")
      .update({ processed: false, error: processingError })
      .eq("event_type", eventType)
      .order("received_at", { ascending: false })
      .limit(1);
  }

  return new Response(
    JSON.stringify({ received: true, event: eventType, error: processingError }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

type SB = ReturnType<typeof createClient>;

async function findClient(sb: SB, vagaroId: string) {
  const { data } = await sb
    .from("clients")
    .select("id, no_shows, total_spent")
    .eq("vagaro_id", vagaroId)
    .maybeSingle();
  return data as { id: string; no_shows: number; total_spent: number } | null;
}

async function logHistory(
  sb: SB,
  clientId: string,
  type: string,
  detail: string,
) {
  await sb.from("history").insert({
    client_id: clientId,
    type,
    detail,
    by:        "Vagaro",
    ts:        Date.now(),
    source:    "vagaro",
    direction: "internal",
  });
}

// ─── APPOINTMENT ─────────────────────────────────────────────────────────────

async function handleAppointment(sb: SB, eventType: string, data: Record<string, unknown>) {
  const vagaroApptId   = str(data.AppointmentId ?? data.appointmentId ?? data.id);
  const vagaroClientId = str(data.CustomerId    ?? data.customerId    ?? data.clientId);
  if (!vagaroApptId) return;

  const STATUS_MAP: Record<string, string> = {
    "appointment.booked":    "scheduled",
    "appointment.updated":   "scheduled",
    "appointment.checkin":   "checked-in",
    "appointment.completed": "completed",
    "appointment.cancelled": "cancelled",
    "appointment.noshow":    "no-show",
  };

  const rawStart = str(data.StartDateTime ?? data.startDateTime ?? data.date ?? "");
  const apptDate = rawStart.split("T")[0] || new Date().toISOString().split("T")[0];
  const apptTime = rawStart.includes("T") ? rawStart.split("T")[1].slice(0, 5) : null;
  const service  = str(data.ServiceName ?? data.serviceName ?? data.service ?? "");
  const therapist = str(data.EmployeeName ?? data.employeeName ?? data.therapist ?? "");

  await sb.from("appointments").upsert(
    {
      vagaro_appt_id: vagaroApptId,
      date:       apptDate,
      time:       apptTime,
      service,
      duration:   num(data.Duration ?? data.duration) || null,
      therapist,
      status:     STATUS_MAP[eventType] ?? "scheduled",
    },
    { onConflict: "vagaro_appt_id" },
  );

  if (!vagaroClientId) return;
  const client = await findClient(sb, vagaroClientId);
  if (!client) return;

  // Link appointment → client
  await sb
    .from("appointments")
    .update({ client_id: client.id })
    .eq("vagaro_appt_id", vagaroApptId);

  if (eventType === "appointment.completed") {
    await sb
      .from("clients")
      .update({ last_visit: apptDate, updated_at: new Date().toISOString() })
      .eq("id", client.id);
  }

  if (eventType === "appointment.noshow") {
    await sb
      .from("clients")
      .update({
        no_shows:    (client.no_shows ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", client.id);
  }

  const HISTORY_MAP: Record<string, string> = {
    "appointment.booked":    "appt.scheduled",
    "appointment.updated":   "appt.rescheduled",
    "appointment.checkin":   "appt.checkin",
    "appointment.completed": "appt.completed",
    "appointment.cancelled": "appt.cancelled",
    "appointment.noshow":    "appt.noshow",
  };
  await logHistory(
    sb, client.id,
    HISTORY_MAP[eventType] ?? "appt.scheduled",
    `${service || "Appointment"} — Vagaro sync`,
  );
}

// ─── CUSTOMER ────────────────────────────────────────────────────────────────

async function handleCustomer(sb: SB, eventType: string, data: Record<string, unknown>) {
  const vagaroId = str(data.CustomerId ?? data.customerId ?? data.id);
  if (!vagaroId) return;

  const firstName = str(data.FirstName  ?? data.firstName  ?? "");
  const lastName  = str(data.LastName   ?? data.lastName   ?? "");
  const email     = str(data.Email      ?? data.email      ?? "") || null;
  const phone     = str(data.MobilePhone ?? data.mobilePhone ?? data.phone ?? "") || null;
  const rawBday   = str(data.BirthDate  ?? data.birthDate  ?? data.birthday ?? "");
  const birthday  = rawBday ? rawBday.split("T")[0] : null;

  if (eventType === "customer.created") {
    const existing = await findClient(sb, vagaroId);
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

  // customer.updated
  const client = await findClient(sb, vagaroId);
  if (!client) return;

  const updates: Record<string, unknown> = {
    updated_at:    new Date().toISOString(),
    vagaro_synced: true,
  };
  if (firstName) updates.first_name = firstName;
  if (lastName)  updates.last_name  = lastName;
  if (email)     updates.email      = email;
  if (phone)     updates.phone      = phone;
  if (birthday)  updates.birthday   = birthday;

  await sb.from("clients").update(updates).eq("id", client.id);
  await logHistory(sb, client.id, "client.updated", "Profile synced from Vagaro");
}

// ─── SALE ────────────────────────────────────────────────────────────────────

async function handleSale(sb: SB, _eventType: string, data: Record<string, unknown>) {
  const vagaroClientId = str(data.CustomerId ?? data.customerId ?? "");
  const amount = num(data.TotalAmount ?? data.totalAmount ?? data.amount ?? 0);
  if (!vagaroClientId || !amount) return;

  const client = await findClient(sb, vagaroClientId);
  if (!client) return;

  await sb
    .from("clients")
    .update({
      total_spent: (client.total_spent ?? 0) + amount,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", client.id);

  await logHistory(
    sb, client.id,
    "payment.charged",
    `Payment of $${amount.toFixed(2)} synced from Vagaro`,
  );
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function str(v: unknown): string { return v == null ? "" : String(v); }
function num(v: unknown): number { return Number(v) || 0; }

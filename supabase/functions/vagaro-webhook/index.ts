import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Confirmed Vagaro webhook envelope (from live traffic):
// {
//   Id, Type: "customer"|"appointment"|"transaction",
//   Action: "created"|"updated"|"cancelled"|...,
//   payload: { ... },
//   CreatedDate
// }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const str = (v: unknown): string => (v != null ? String(v) : "");
const orNull = (v: unknown) => str(v) || null;
const num = (v: unknown) => (v != null && v !== "" ? Number(v) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const type   = str(body.Type   ?? body.type   ?? "");
  const action = str(body.Action ?? body.action ?? "");
  const event  = type && action ? `${type}.${action}` : str(body.Event ?? body.event ?? "unknown");
  const data   = (body.payload ?? body.Payload ?? body.Data ?? body.data ?? {}) as Record<string, unknown>;

  // Log every received webhook immediately — this feeds the Settings log
  // and gives vagaro-sync the customerId values it needs for matching.
  await supabase.from("webhook_log").insert({
    source: "vagaro",
    event_type: event,
    payload: body,
  }).then(({ error }) => {
    if (error) console.error("webhook_log insert:", error.message);
  });

  try {
    if (type === "customer") {
      await handleCustomer(supabase, event, data);
    } else {
      // For all non-customer events, ensure the customer exists in ClientPulse
      // before handling — fetches from Vagaro API and creates the client if needed.
      const cid = orNull(data.customerId ?? data.CustomerId);
      if (cid) await ensureClient(supabase, cid);

      if (type === "appointment") {
        await handleAppointment(supabase, event, data);
      }
    }
    // transaction and other types: logged above, no further action needed yet
  } catch (err) {
    console.error(`Error processing ${event}:`, err);
    // Update the log row with the error so it shows in Settings
    await supabase.from("webhook_log")
      .update({ error: String(err) })
      .eq("source", "vagaro")
      .eq("event_type", event)
      .order("received_at", { ascending: false })
      .limit(1);
  }

  return json({ received: true, event });
});

// ─── Customer handler ─────────────────────────────────────────────────────────

async function handleCustomer(
  sb: ReturnType<typeof createClient>,
  _event: string,
  data: Record<string, unknown>,
) {
  const vagaro_id = orNull(data.customerId ?? data.CustomerId);
  if (!vagaro_id) return;

  const firstName = str(data.customerFirstName ?? data.FirstName ?? data.firstName);
  const lastName  = str(data.customerLastName  ?? data.LastName  ?? data.lastName);

  // Check whether this client already exists
  const { data: existing } = await sb
    .from("clients").select("id").eq("vagaro_id", vagaro_id).maybeSingle();

  if (!existing) {
    // ── Create ────────────────────────────────────────────────────────────────
    if (!firstName && !lastName) return;

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });

    const { data: inserted, error } = await sb.from("clients").insert({
      vagaro_id,
      vagaro_synced: true,
      first_name:   firstName,
      last_name:    lastName,
      email:        orNull(data.email        ?? data.Email),
      phone:        orNull(data.mobilePhone  ?? data.MobilePhone ?? data.dayPhone ?? data.Phone),
      birthday:     orNull(data.birthday     ?? data.Birthday),
      address:      orNull(data.streetAddress ?? data.Address1  ?? data.address),
      city:         orNull(data.city         ?? data.City),
      state:        orNull(data.regionCode   ?? data.State      ?? data.state),
      zip:          orNull(data.postalCode   ?? data.Zip        ?? data.zip),
      customer_since: orNull(data.createdDate?.toString().split("T")[0]) ?? today,
      avg_visit_interval_days: 30,
      waitlisted: false,
      tags: [],
      golden_nuggets: [],
    }).select("id").single();

    if (error) throw error;

    await sb.from("history").insert({
      client_id: inserted.id,
      type: "client.created",
      detail: "New customer created in Vagaro — synced automatically",
      by: "Vagaro",
      ts: Date.now(),
      source: "vagaro",
      direction: "internal",
    });

  } else {
    // ── Update ────────────────────────────────────────────────────────────────
    // Only overwrite fields that are present and non-empty in the payload so we
    // don't blank out data that Vagaro sent as an empty string.
    const updates: Record<string, unknown> = {};
    const maybe = (col: string, ...vals: unknown[]) => {
      const v = vals.find((x) => x != null && str(x) !== "");
      if (v !== undefined) updates[col] = str(v);
    };
    maybe("first_name", data.customerFirstName, data.FirstName);
    maybe("last_name",  data.customerLastName,  data.LastName);
    maybe("email",      data.email,  data.Email);
    maybe("phone",      data.mobilePhone, data.MobilePhone, data.dayPhone);
    maybe("address",    data.streetAddress, data.Address1);
    maybe("city",       data.city,  data.City);
    maybe("state",      data.regionCode, data.State);
    maybe("zip",        data.postalCode, data.Zip);

    if (Object.keys(updates).length > 0) {
      const { error } = await sb.from("clients").update(updates).eq("vagaro_id", vagaro_id);
      if (error) throw error;
    }
  }
}

// ─── Appointment handler ──────────────────────────────────────────────────────

async function handleAppointment(
  sb: ReturnType<typeof createClient>,
  event: string,
  data: Record<string, unknown>,
) {
  const vagaro_customer_id = orNull(data.customerId ?? data.CustomerId);
  const vagaro_appt_id     = orNull(data.appointmentId ?? data.AppointmentId ?? data.Id);
  if (!vagaro_customer_id) return;

  // Resolve client by vagaro_id (ensureClient already ran in the main handler)
  const { data: client } = await sb
    .from("clients").select("id").eq("vagaro_id", vagaro_customer_id).maybeSingle();
  if (!client) return;

  // Parse date/time from startDateTime or separate fields
  const startRaw = str(data.startDateTime ?? data.StartDateTime ?? data.startDate ?? data.StartDate ?? "");
  const apptDate = startRaw ? startRaw.split("T")[0] : null;
  const apptTime = startRaw?.includes("T") ? startRaw.split("T")[1]?.slice(0, 5) : orNull(data.startTime ?? data.StartTime);

  const statusMap: Record<string, string> = {
    confirmed: "scheduled", pending: "scheduled",
    "checked in": "checked-in", checkedin: "checked-in",
    completed: "completed", cancelled: "cancelled", canceled: "cancelled",
    "no show": "no-show", noshow: "no-show",
  };
  const rawStatus = str(data.status ?? data.Status ?? "").toLowerCase();
  const status = statusMap[rawStatus] ??
    (event === "appointment.cancelled" ? "cancelled" :
     event === "appointment.completed" ? "completed" :
     event === "appointment.checkedin" ? "checked-in" : "scheduled");

  const service   = orNull(data.serviceName    ?? data.ServiceName   ?? data.service);
  const therapist = orNull(data.providerName   ?? data.ProviderName  ?? data.serviceProviderName ?? data.therapist);
  const duration  = num(data.duration ?? data.Duration);

  // Upsert appointment so re-deliveries are idempotent
  if (apptDate && vagaro_appt_id) {
    const { error } = await sb.from("appointments").upsert({
      vagaro_appt_id,
      client_id: client.id,
      date:      apptDate,
      time:      apptTime ?? null,
      service:   service  ?? "Appointment",
      duration:  duration ?? null,
      therapist: therapist ?? null,
      status,
    }, { onConflict: "vagaro_appt_id" });
    if (error) console.error("appointment upsert:", error.message);
  }

  // Log to client history
  const histType: Record<string, string> = {
    "appointment.created":   "appt.scheduled",
    "appointment.updated":   "appt.rescheduled",
    "appointment.cancelled": "appt.cancelled",
    "appointment.completed": "appt.completed",
    "appointment.checkedin": "appt.checkin",
    "appointment.noshow":    "appt.noshow",
  };
  const detail = [
    event.replace("appointment.", "").replace(/^\w/, (c) => c.toUpperCase()),
    service,
    apptDate ? new Date(apptDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null,
    apptTime ? formatTime(apptTime) : null,
  ].filter(Boolean).join(" · ");

  await sb.from("history").insert({
    client_id: client.id,
    type: histType[event] ?? "appt.scheduled",
    detail,
    by: "Vagaro",
    ts: Date.now(),
    source: "vagaro",
    direction: "internal",
  });
}

// ─── Auto-create client from Vagaro API ───────────────────────────────────────
// Called for every non-customer webhook that carries a customerId.
// If the client is already in ClientPulse this is a fast no-op (one DB read).
// If not, it fetches customer details from the Vagaro API and either links them
// to an existing unlinked profile (name/email match) or creates a new one.

async function ensureClient(
  sb: ReturnType<typeof createClient>,
  vagaroId: string,
): Promise<void> {
  // Fast path — already linked
  const { data: existing } = await sb
    .from("clients").select("id").eq("vagaro_id", vagaroId).maybeSingle();
  if (existing) return;

  // Need Vagaro API credentials
  const region          = Deno.env.get("VAGARO_REGION");
  const clientId        = Deno.env.get("VAGARO_CLIENT_ID");
  const clientSecretKey = Deno.env.get("VAGARO_CLIENT_SECRET_KEY");
  if (!region || !clientId || !clientSecretKey) return;

  // businessId — pull from the most recent webhook that carried one
  const { data: logRow } = await sb
    .from("webhook_log")
    .select("payload")
    .eq("source", "vagaro")
    .not("payload->payload->businessId", "is", null)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const businessId = str((logRow?.payload as Record<string, unknown>)?.payload?.businessId ?? "");
  if (!businessId) return;

  // Get Vagaro access token
  let accessToken: string;
  try {
    const res = await fetch(
      `https://api.vagaro.com/${region}/api/v2/merchants/generate-access-token`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecretKey, scope: "read access" }) },
    );
    if (!res.ok) return;
    const t = await res.json();
    accessToken = t?.data?.access_token;
    if (!accessToken) return;
  } catch { return; }

  // Fetch customer record
  let vc: Record<string, unknown> | null = null;
  try {
    const res = await fetch(
      `https://api.vagaro.com/${region}/api/v2/customers`,
      { method: "POST",
        headers: { "Content-Type": "application/json", accessToken },
        body: JSON.stringify({ businessId, customerId: vagaroId }) },
    );
    if (res.ok) vc = ((await res.json())?.data as Record<string, unknown>) ?? null;
  } catch { return; }
  if (!vc) return;

  const firstName = str(vc.customerFirstName).trim();
  const lastName  = str(vc.customerLastName).trim();
  if (!firstName && !lastName) return;

  const vcOrNull = (v: unknown) => str(v).trim() || null;

  // Try to match an existing unlinked profile before creating a new one
  let existingId: string | null = null;

  const { data: nameMatch } = await sb.from("clients").select("id")
    .ilike("first_name", firstName).ilike("last_name", lastName)
    .is("vagaro_id", null).maybeSingle();
  if (nameMatch) existingId = (nameMatch as { id: string }).id;

  if (!existingId && vcOrNull(vc.email)) {
    const { data: emailMatch } = await sb.from("clients").select("id")
      .ilike("email", vcOrNull(vc.email)!)
      .is("vagaro_id", null).maybeSingle();
    if (emailMatch) existingId = (emailMatch as { id: string }).id;
  }

  if (existingId) {
    await sb.from("clients").update({ vagaro_id: vagaroId, vagaro_synced: true }).eq("id", existingId);
    return;
  }

  // No match — create a new client
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const { error } = await sb.from("clients").insert({
    vagaro_id:      vagaroId,
    vagaro_synced:  true,
    first_name:     firstName,
    last_name:      lastName,
    email:          vcOrNull(vc.email),
    phone:          vcOrNull(vc.mobilePhone) ?? vcOrNull(vc.dayPhone),
    address:        vcOrNull(vc.streetAddress),
    city:           vcOrNull(vc.city),
    state:          vcOrNull(vc.regionCode),
    zip:            vcOrNull(vc.postalCode),
    birthday:       vcOrNull(vc.birthday),
    customer_since: vcOrNull(str(vc.createdDate).split("T")[0]) ?? today,
    avg_visit_interval_days: 30,
    waitlisted: false,
    tags: [],
    golden_nuggets: [],
  });
  if (error) console.error("ensureClient insert:", error.message);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

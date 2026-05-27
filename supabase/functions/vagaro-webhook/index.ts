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
    } else if (type === "appointment") {
      await handleAppointment(supabase, event, data);
    } else if (type === "transaction") {
      await handleTransaction(supabase, data);
    }
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

  // Resolve client by vagaro_id
  const { data: client } = await sb
    .from("clients").select("id").eq("vagaro_id", vagaro_customer_id).maybeSingle();
  if (!client) return; // Customer not yet in ClientPulse — sync will catch them later

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

// ─── Transaction handler ──────────────────────────────────────────────────────
// Vagaro sends one webhook event per transaction line item (mirrors CSV rows).
// We upsert by vagaro_transaction_id + item_sold so re-deliveries are idempotent
// and multi-item checkouts each get their own row (same transaction ID, different item).

async function handleTransaction(
  sb: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
) {
  // Transaction ID is required — without it we can't deduplicate
  const vagaro_transaction_id = orNull(
    data.transactionId ?? data.TransactionId ?? data.Id ?? data.id
  );
  if (!vagaro_transaction_id) return;

  // Resolve client by Vagaro customer ID
  const vagaro_customer_id = orNull(data.customerId ?? data.CustomerId);
  let client_id: string | null = null;
  if (vagaro_customer_id) {
    const { data: client } = await sb
      .from("clients").select("id").eq("vagaro_id", vagaro_customer_id).maybeSingle();
    if (client) client_id = client.id;
  }

  // Checkout date — Vagaro sends "YYYY-MM-DD" or a full ISO string
  const dateRaw = str(
    data.checkoutDate ?? data.CheckoutDate ??
    data.transactionDate ?? data.TransactionDate ??
    data.createdDate ?? data.CreatedDate ?? ""
  );
  const transaction_date = dateRaw
    ? (dateRaw.includes("T") ? dateRaw : dateRaw + "T12:00:00Z")
    : null;

  // Item / service name (Vagaro CSV column: "Service/Product/GC/Package/Membership/Class")
  const item_sold = orNull(
    data.itemSold ?? data.ItemSold ??
    data.serviceName ?? data.ServiceName ??
    data.name ?? data.Name
  );

  // Purchase type (Vagaro CSV column: "Transaction Type" — "Services", "Packages", etc.)
  const purchase_type = orNull(
    data.purchaseType ?? data.PurchaseType ??
    data.transactionType ?? data.TransactionType ??
    data.type ?? data.Type
  );

  // Provider name or ID (used for per-staff session counts)
  const vagaro_service_provider_id = orNull(
    data.serviceProviderName ?? data.ServiceProviderName ??
    data.providerName ?? data.ProviderName ??
    data.serviceProviderId ?? data.ServiceProviderId ??
    data.staffName ?? data.StaffName
  );

  const row = {
    vagaro_transaction_id,
    vagaro_customer_id,
    vagaro_service_provider_id,
    client_id,
    transaction_date,
    item_sold,
    purchase_type,
    quantity:               num(data.quantity ?? data.Quantity) ?? 1,
    tax:                    num(data.tax ?? data.Tax),
    tip:                    num(data.tip ?? data.Tip),
    discount:               num(data.discount ?? data.Discount),
    cash_amount:            num(data.cashAmount ?? data.CashAmount),
    check_amount:           num(data.checkAmount ?? data.CheckAmount),
    gc_redemption:          num(data.gcRedemption ?? data.GcRedemption ?? data.gcAmount ?? data.GcAmount ?? data.giftCardAmount ?? data.GiftCardAmount),
    package_redemption:     num(data.packageRedemption ?? data.PackageRedemption ?? data.packageAmount ?? data.PackageAmount),
    membership_amount:      num(data.membershipAmount ?? data.MembershipAmount ?? data.membershipRedemption),
    cc_amount:              num(data.ccAmount ?? data.CcAmount ?? data.creditCardAmount ?? data.CreditCardAmount),
    bank_account_amount:    num(data.bankAccountAmount ?? data.BankAccountAmount),
    vagaro_pay_later_amount: num(data.vagaroPayLaterAmount ?? data.VagaroPayLaterAmount),
    other_amount:           num(data.otherAmount ?? data.OtherAmount),
    created_by:             orNull(data.checkedOutBy ?? data.CheckedOutBy ?? data.staffName ?? data.StaffName),
  };

  // Upsert: check for existing row by transaction_id + item_sold
  // (same checkout can have multiple line items with the same transaction_id)
  if (item_sold) {
    const { data: existing } = await sb.from("transactions")
      .select("id")
      .eq("vagaro_transaction_id", vagaro_transaction_id)
      .eq("item_sold", item_sold)
      .maybeSingle();

    if (existing) {
      // Update — fill in any missing fields (e.g. client_id if it was null before)
      const { error } = await sb.from("transactions").update(row).eq("id", existing.id);
      if (error) throw error;
      return;
    }
  }

  // Insert new row
  const { error } = await sb.from("transactions").insert(row);
  if (error) throw error;
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

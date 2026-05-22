import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Actual Vagaro webhook envelope (confirmed from live traffic):
// {
//   Id, Type: "customer", Action: "created"|"updated",
//   payload: { customerId, customerFirstName, customerLastName, email,
//              mobilePhone, dayPhone, nightPhone, streetAddress, city,
//              regionCode, postalCode, createdDate, ... },
//   CreatedDate
// }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const str = (v: unknown): string => (v != null ? String(v) : "");
const orNull = (v: unknown) => str(v) || null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();

    // Derive event key from Type+Action (real format) with fallback to legacy Event field
    const type   = str(body.Type   ?? body.type   ?? "");
    const action = str(body.Action ?? body.action ?? "");
    const event  = type && action ? `${type}.${action}` : str(body.Event ?? body.event ?? "");

    // Payload is lowercase "payload" in real Vagaro; legacy used "Data"
    const data: Record<string, unknown> = (body.payload ?? body.Payload ?? body.Data ?? body.data ?? {}) as Record<string, unknown>;

    if (event === "customer.created") {
      const vagaro_id = orNull(data.customerId ?? data.CustomerId);
      if (!vagaro_id) {
        return json({ error: "Missing customerId" }, 400);
      }

      // Idempotency — ignore if we already have this customer
      const { data: existing } = await supabase
        .from("clients").select("id").eq("vagaro_id", vagaro_id).maybeSingle();
      if (existing) return json({ status: "already_exists", id: existing.id });

      const firstName = str(data.customerFirstName ?? data.FirstName ?? data.firstName);
      const lastName  = str(data.customerLastName  ?? data.LastName  ?? data.lastName);
      if (!firstName && !lastName) return json({ error: "Missing customer name" }, 400);

      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });

      const { data: inserted, error } = await supabase.from("clients").insert({
        vagaro_id,
        vagaro_synced: true,
        first_name:   firstName,
        last_name:    lastName,
        email:        orNull(data.email        ?? data.Email),
        phone:        orNull(data.mobilePhone  ?? data.MobilePhone ?? data.dayPhone ?? data.Phone),
        birthday:     orNull(data.birthday     ?? data.Birthday),
        address:      orNull(data.streetAddress ?? data.Address1   ?? data.address),
        city:         orNull(data.city         ?? data.City),
        state:        orNull(data.regionCode   ?? data.State       ?? data.state),
        zip:          orNull(data.postalCode   ?? data.Zip         ?? data.zip),
        customer_since: orNull(data.createdDate?.toString().split("T")[0]) ?? today,
        avg_visit_interval_days: 30,
        waitlisted: false,
        tags: [],
        golden_nuggets: [],
      }).select("id").single();

      if (error) throw error;

      await supabase.from("history").insert({
        client_id: inserted.id,
        type: "client.created",
        detail: "New customer created in Vagaro — synced automatically",
        by: "Vagaro",
        ts: Date.now(),
        source: "vagaro",
        direction: "internal",
      });

      return json({ status: "created", id: inserted.id });
    }

    if (event === "customer.updated") {
      const vagaro_id = orNull(data.customerId ?? data.CustomerId);
      if (!vagaro_id) return json({ error: "Missing customerId" }, 400);

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
        const { error } = await supabase.from("clients").update(updates).eq("vagaro_id", vagaro_id);
        if (error) throw error;
      }

      return json({ status: "updated" });
    }

    return json({ status: "ignored", event });

  } catch (err) {
    console.error("vagaro-webhook error:", err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

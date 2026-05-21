import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Vagaro sends customer.created / customer.updated webhooks.
// Field names come from their API — verify against https://docs.vagaro.com/webhooks
// if their payload structure changes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();

    // Vagaro wraps payload in { Event, Data } — handle both casings defensively
    const event: string = body.Event ?? body.event ?? "";
    const data = body.Data ?? body.data ?? {};

    if (event === "customer.created") {
      const vagaro_id: string = String(data.CustomerId ?? data.customerId ?? "");
      if (!vagaro_id) {
        return new Response(JSON.stringify({ error: "Missing CustomerId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if we already have this Vagaro customer (idempotency)
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("vagaro_id", vagaro_id)
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ status: "already_exists", id: existing.id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const firstName: string = data.FirstName ?? data.firstName ?? "";
      const lastName: string = data.LastName ?? data.lastName ?? "";

      if (!firstName && !lastName) {
        return new Response(JSON.stringify({ error: "Missing customer name" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const phone: string = data.MobilePhone ?? data.mobilePhone ?? data.Phone ?? data.phone ?? "";
      const email: string = data.Email ?? data.email ?? "";
      const birthday: string | null = data.Birthday ?? data.birthday ?? null;
      const address: string = data.Address1 ?? data.address ?? "";
      const city: string = data.City ?? data.city ?? "";
      const state: string = data.State ?? data.state ?? "";
      const zip: string = data.Zip ?? data.zip ?? "";

      const today = new Date().toISOString().split("T")[0];

      const { data: inserted, error } = await supabase
        .from("clients")
        .insert({
          vagaro_id,
          vagaro_synced: true,
          first_name: firstName,
          last_name: lastName,
          email: email || null,
          phone: phone || null,
          birthday: birthday || null,
          customer_since: today,
          avg_visit_interval_days: 30,
          waitlisted: false,
          address: address || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
          tags: [],
          golden_nuggets: [],
        })
        .select("id")
        .single();

      if (error) throw error;

      // Log the creation event in history
      await supabase.from("history").insert({
        client_id: inserted.id,
        type: "client.created",
        detail: "New customer created in Vagaro — synced automatically",
        by: "Vagaro",
        ts: Date.now(),
        source: "vagaro",
        direction: "internal",
      });

      return new Response(JSON.stringify({ status: "created", id: inserted.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event === "customer.updated") {
      const vagaro_id: string = String(data.CustomerId ?? data.customerId ?? "");
      if (!vagaro_id) {
        return new Response(JSON.stringify({ error: "Missing CustomerId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const updates: Record<string, unknown> = {};
      if (data.FirstName ?? data.firstName) updates.first_name = data.FirstName ?? data.firstName;
      if (data.LastName ?? data.lastName) updates.last_name = data.LastName ?? data.lastName;
      if (data.Email ?? data.email) updates.email = data.Email ?? data.email;
      if (data.MobilePhone ?? data.mobilePhone ?? data.Phone) {
        updates.phone = data.MobilePhone ?? data.mobilePhone ?? data.Phone;
      }
      if (data.Address1 ?? data.address) updates.address = data.Address1 ?? data.address;
      if (data.City ?? data.city) updates.city = data.City ?? data.city;
      if (data.State ?? data.state) updates.state = data.State ?? data.state;
      if (data.Zip ?? data.zip) updates.zip = data.Zip ?? data.zip;

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from("clients")
          .update(updates)
          .eq("vagaro_id", vagaro_id);
        if (error) throw error;
      }

      return new Response(JSON.stringify({ status: "updated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Acknowledge unknown events without error so Vagaro doesn't retry
    return new Response(JSON.stringify({ status: "ignored", event }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("vagaro-webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

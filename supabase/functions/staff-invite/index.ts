/**
 * staff-invite — Supabase Edge Function
 *
 * Sends an invitation email to a new staff member using the Supabase Admin API
 * (requires SUPABASE_SERVICE_ROLE_KEY, which is only available server-side).
 *
 * Request body: { email: string, full_name: string, role?: "staff" | "manager" | "admin" }
 * Response:     { ok: true } | { error: string }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const email     = str(body.email).trim();
  const full_name = str(body.full_name).trim();
  const role      = str(body.role || "staff");

  if (!email || !full_name) {
    return json({ error: "email and full_name are required" }, 400);
  }

  const supabaseUrl            = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Send invite email — use SITE_URL secret (production app URL) when set,
  // otherwise fall back to request origin (skipping localhost).
  const siteUrl = Deno.env.get("SITE_URL");
  const origin  = req.headers.get("origin") ?? "";
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1");
  const redirectTo = siteUrl ?? (isLocal ? undefined : (origin || undefined));
  const { data: inviteData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role },
    redirectTo,
  });

  if (inviteErr) {
    // "User already registered" means they have an account — still ensure staff row exists
    if (!inviteErr.message.toLowerCase().includes("already")) {
      return json({ error: inviteErr.message }, 400);
    }
  }

  // Upsert staff row (by email so re-invites are idempotent)
  const userId = inviteData?.user?.id;
  const staffRow: Record<string, unknown> = { full_name, email, role, active: true };
  if (userId) staffRow.id = userId;

  if (userId) {
    const { error: staffErr } = await supabase.from("staff").upsert(staffRow, { onConflict: "id" });
    if (staffErr) console.error("staff upsert error:", staffErr.message);
  } else {
    // User already existed — look up their id and update role
    const { error: staffErr } = await supabase.from("staff").upsert(staffRow, { onConflict: "email" });
    if (staffErr) console.error("staff upsert error:", staffErr.message);
  }

  return json({ ok: true });
});

function str(v: unknown): string { return v == null ? "" : String(v); }
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

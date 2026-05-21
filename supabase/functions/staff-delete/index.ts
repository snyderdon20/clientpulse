/**
 * staff-delete — Supabase Edge Function
 *
 * Deletes a staff member's row from the staff table AND removes their
 * Supabase auth user, revoking all login access.
 *
 * Request body: { userId: string }
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
  const userId = String(body.userId ?? "").trim();

  if (!userId) return json({ error: "userId is required" }, 400);

  const supabaseUrl            = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Delete staff row first
  const { error: staffErr } = await supabase.from("staff").delete().eq("id", userId);
  if (staffErr) return json({ error: staffErr.message }, 500);

  // Delete auth user — revokes all sessions and login access
  const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
  if (authErr) return json({ error: authErr.message }, 500);

  return json({ ok: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

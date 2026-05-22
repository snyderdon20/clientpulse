/**
 * staff-auth — Supabase Edge Function
 *
 * Handles internal authentication — no Supabase Auth, no email invites.
 * Admin creates staff directly with a bcrypt-hashed password.
 *
 * Actions:
 *   { action: "login", email, password }
 *   { action: "create", full_name, email, role, password }
 *   { action: "set-password", staff_id, password }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = str(body.action);

  const supabaseUrl            = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  if (action === "login") {
    const email    = str(body.email).trim().toLowerCase();
    const password = str(body.password);

    if (!email || !password) {
      return json({ error: "Invalid email or password" }, 401);
    }

    // Look up staff by email (case-insensitive via ilike)
    const { data: rows, error: dbErr } = await supabase
      .from("staff")
      .select("*")
      .ilike("email", email)
      .limit(1);

    if (dbErr || !rows || rows.length === 0) {
      return json({ error: "Invalid email or password" }, 401);
    }

    const staff = rows[0];

    if (!staff.password_hash) {
      return json({ error: "No password set — ask your admin to set one for you" }, 401);
    }

    const valid = await bcrypt.compare(password, staff.password_hash);
    if (!valid) {
      return json({ error: "Invalid email or password" }, 401);
    }

    // Strip password_hash before returning
    const { password_hash: _omit, ...safeStaff } = staff;
    return json({ ok: true, staff: safeStaff });
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────
  if (action === "create") {
    const full_name = str(body.full_name).trim();
    const email     = str(body.email).trim().toLowerCase();
    const role      = str(body.role || "staff");
    const password  = str(body.password);

    if (!full_name || !email || !password) {
      return json({ error: "full_name, email, and password are required" }, 400);
    }

    // Check for duplicate email
    const { data: existing } = await supabase
      .from("staff")
      .select("id")
      .ilike("email", email)
      .limit(1);

    if (existing && existing.length > 0) {
      return json({ error: "A staff member with that email already exists" }, 400);
    }

    const password_hash = await bcrypt.hash(password);

    const { data: inserted, error: insertErr } = await supabase
      .from("staff")
      .insert({ full_name, email, role, password_hash, active: true })
      .select("*")
      .single();

    if (insertErr) {
      return json({ error: insertErr.message }, 400);
    }

    const { password_hash: _omit, ...safeStaff } = inserted;
    return json({ ok: true, staff: safeStaff });
  }

  // ── SET-PASSWORD ───────────────────────────────────────────────────────────
  if (action === "set-password") {
    const staff_id = str(body.staff_id);
    const password = str(body.password);

    if (!staff_id || !password) {
      return json({ error: "staff_id and password are required" }, 400);
    }

    const password_hash = await bcrypt.hash(password);

    const { error: updateErr } = await supabase
      .from("staff")
      .update({ password_hash })
      .eq("id", staff_id);

    if (updateErr) {
      return json({ error: updateErr.message }, 400);
    }

    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});

function str(v: unknown): string { return v == null ? "" : String(v); }
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

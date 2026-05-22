import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = str(body.action);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  if (action === "login") {
    const email    = str(body.email).trim().toLowerCase();
    const password = str(body.password);
    if (!email || !password) return json({ error: "Invalid email or password" }, 401);

    const { data: rows } = await supabase
      .from("staff").select("*").ilike("email", email).eq("active", true).limit(1);

    const staff = rows?.[0];
    if (!staff) return json({ error: "Invalid email or password" }, 401);
    if (!staff.password_hash) return json({ error: "No password set — ask your admin to set one for you" }, 401);

    const valid = await bcrypt.compare(password, staff.password_hash);
    if (!valid) return json({ error: "Invalid email or password" }, 401);

    const { password_hash: _omit, ...safeStaff } = staff;
    return json({ ok: true, staff: safeStaff });
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────
  if (action === "create") {
    const full_name = str(body.full_name).trim();
    const email     = str(body.email).trim().toLowerCase();
    const roles: string[] = Array.isArray(body.roles) ? body.roles as string[] : ["therapist"];
    const password  = str(body.password);
    if (!full_name || !email || !password) return json({ error: "full_name, email, and password are required" }, 400);

    const { data: existing } = await supabase.from("staff").select("id").ilike("email", email).limit(1);
    if (existing && existing.length > 0) return json({ error: "A staff member with that email already exists" }, 400);

    const password_hash = await bcrypt.hash(password, 10);
    const role = roles.find((r: string) => r !== "admin") || roles[0] || "therapist";
    const { data: inserted, error: insertErr } = await supabase
      .from("staff").insert({ id: crypto.randomUUID(), full_name, email, role, roles, password_hash, active: true }).select("*").single();
    if (insertErr) return json({ error: insertErr.message }, 400);

    const { password_hash: _omit, ...safeStaff } = inserted;
    return json({ ok: true, staff: safeStaff });
  }

  // ── SET-PASSWORD ───────────────────────────────────────────────────────────
  if (action === "set-password") {
    const staff_id = str(body.staff_id);
    const password = str(body.password);
    if (!staff_id || !password) return json({ error: "staff_id and password are required" }, 400);

    const password_hash = await bcrypt.hash(password, 10);
    const { error: updateErr } = await supabase.from("staff").update({ password_hash }).eq("id", staff_id);
    if (updateErr) return json({ error: updateErr.message }, 400);
    return json({ ok: true });
  }

  // ── BOOTSTRAP ─────────────────────────────────────────────────────────────
  // Sets initial password only when none is set yet — prevents unauthorized resets.
  if (action === "bootstrap") {
    const email    = str(body.email).trim().toLowerCase();
    const password = str(body.password);
    if (!email || !password) return json({ error: "email and password are required" }, 400);

    const { data: rows } = await supabase
      .from("staff").select("id, password_hash, active").ilike("email", email).limit(1);

    const staff = rows?.[0];
    if (!staff || !staff.active) return json({ error: "No active staff account found for that email" }, 404);
    if (staff.password_hash)    return json({ error: "Password already set — use login instead" }, 403);

    const password_hash = await bcrypt.hash(password, 10);
    await supabase.from("staff").update({ password_hash }).eq("id", staff.id);
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

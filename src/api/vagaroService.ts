/**
 * vagaroService.ts
 *
 * Typed service functions for Vagaro operations that are proxied through
 * Supabase Edge Functions (the browser can't call Vagaro directly due to CORS).
 *
 * Internally uses axios so all requests benefit from timeout handling,
 * structured error parsing, and consistent response types.
 */

import axios, { AxiosInstance } from "axios";

// ─── Response types ───────────────────────────────────────────────────────────

export interface TestConnectionResult {
  ok: boolean;
  msg: string;
}

export interface SyncResult {
  success?: boolean;
  total?: number;
  matched?: number;
  unmatched?: number;
  unmatchedSample?: string[];
  note?: string;
  error?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Creates a short-lived axios instance scoped to a specific Supabase project's
 * edge functions base URL.  A new instance is created per call so callers
 * don't need to manage lifecycle.
 */
function makeEdgeClient(supabaseUrl: string): AxiosInstance {
  return axios.create({
    baseURL: `${supabaseUrl.replace(/\/$/, "")}/functions/v1`,
    timeout: 30_000,
    headers: { "Content-Type": "application/json" },
  });
}

/** Extracts the most useful error message from a failed edge function call. */
function extractErrorMsg(err: unknown, fallback = "Unknown error"): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as Record<string, unknown> | undefined;
    const candidate = d?.msg ?? d?.error ?? d?.message;
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (err.response?.status) return `HTTP ${err.response.status}`;
    if (err.code === "ECONNABORTED") return "Request timed out — edge function did not respond in 30 s.";
    return err.message || fallback;
  }
  return String(err) || fallback;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validates a pair of Vagaro OAuth credentials by asking the edge function
 * to attempt a token exchange server-side (bypassing CORS).
 *
 * @returns {TestConnectionResult} `ok: true` when credentials are valid.
 *
 * @example
 * const result = await testVagaroConnection(supabaseUrl, clientId, clientSecret);
 * if (!result.ok) console.error(result.msg);
 */
export async function testVagaroConnection(
  supabaseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<TestConnectionResult> {
  if (!supabaseUrl)   return { ok: false, msg: "Supabase URL is not configured." };
  if (!clientId)      return { ok: false, msg: "Client ID is required." };
  if (!clientSecret)  return { ok: false, msg: "Client Secret is required." };

  try {
    const { data } = await makeEdgeClient(supabaseUrl).post<TestConnectionResult>(
      "/vagaro-sync",
      { test: true, clientId, clientSecret },
    );
    return { ok: Boolean(data.ok), msg: data.msg ?? (data.ok ? "Connected." : "Failed.") };
  } catch (err) {
    return { ok: false, msg: extractErrorMsg(err, "Could not reach the edge function.") };
  }
}

/**
 * Triggers a full Vagaro → ClientPulse client ID sync via the edge function.
 * Fetches all Vagaro customers, matches them to local clients by name, and
 * writes `vagaro_id` back to the `clients` table.
 *
 * @param supabaseUrl  Your project's Supabase URL.
 * @param businessId   Optional — auto-detected from `webhook_log` if omitted.
 *
 * @example
 * const result = await syncVagaroClients(supabaseUrl);
 * console.log(`Matched ${result.matched} of ${result.total} Vagaro customers.`);
 */
export async function syncVagaroClients(
  supabaseUrl: string,
  businessId?: string,
): Promise<SyncResult> {
  if (!supabaseUrl) return { error: "Supabase URL is not configured." };

  try {
    const { data } = await makeEdgeClient(supabaseUrl).post<SyncResult>(
      "/vagaro-sync",
      { businessId: businessId ?? "" },
    );
    return data;
  } catch (err) {
    return { error: extractErrorMsg(err, "Sync failed.") };
  }
}

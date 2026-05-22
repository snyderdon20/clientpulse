/**
 * vagaroService.ts
 *
 * Browser-side proxy calls that route through Supabase Edge Functions.
 * The browser cannot call api.vagaro.com directly (IP allowlist), so all
 * Vagaro API calls from the React app go through edge functions.
 *
 * Vagaro V2 auth uses:
 *   POST /{region}/api/v2/merchants/generate-access-token
 *   Body: { clientId, clientSecretKey, scope }        ← NOT OAuth2 client_credentials
 */

import axios, { AxiosInstance } from "axios";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestConnectionResult {
  ok: boolean;
  msg: string;
}

export interface SyncResult {
  success?: boolean;
  matched?: number;
  unmatched?: number;
  unmatchedSample?: string[];
  note?: string;
  error?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeEdgeClient(supabaseUrl: string, supabaseAnonKey?: string): AxiosInstance {
  return axios.create({
    baseURL: `${supabaseUrl.replace(/\/$/, "")}/functions/v1`,
    timeout: 30_000,
    headers: {
      "Content-Type": "application/json",
      ...(supabaseAnonKey ? { "Authorization": `Bearer ${supabaseAnonKey}` } : {}),
    },
  });
}

function extractErrorMsg(err: unknown, fallback = "Unknown error"): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as Record<string, unknown> | undefined;
    const candidate = d?.msg ?? d?.error ?? d?.message;
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (err.response?.status) return `HTTP ${err.response.status}`;
    if (err.code === "ECONNABORTED") return "Request timed out.";
    return err.message || fallback;
  }
  return String(err) || fallback;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Tests the Vagaro V2 connection using credentials stored as Supabase secrets.
 * No credentials are sent from the browser — the edge function reads them
 * from VAGARO_CLIENT_ID, VAGARO_CLIENT_SECRET_KEY, VAGARO_REGION env vars.
 */
export async function testVagaroConnection(
  supabaseUrl: string,
  supabaseAnonKey?: string,
): Promise<TestConnectionResult> {
  if (!supabaseUrl) return { ok: false, msg: "Supabase URL is not configured." };

  try {
    const { data } = await makeEdgeClient(supabaseUrl, supabaseAnonKey).post<TestConnectionResult>(
      "/vagaro-sync",
      { test: true },
    );
    return { ok: Boolean(data.ok), msg: data.msg ?? (data.ok ? "Connected." : "Failed.") };
  } catch (err) {
    return { ok: false, msg: extractErrorMsg(err, "Could not reach the edge function.") };
  }
}

export async function syncVagaroClients(
  supabaseUrl: string,
  supabaseAnonKey?: string,
  businessId?: string,
): Promise<SyncResult> {
  if (!supabaseUrl) return { error: "Supabase URL is not configured." };

  try {
    const { data } = await makeEdgeClient(supabaseUrl, supabaseAnonKey).post<SyncResult>(
      "/vagaro-sync",
      { businessId: businessId ?? "" },
    );
    return data;
  } catch (err) {
    return { error: extractErrorMsg(err, "Sync failed.") };
  }
}

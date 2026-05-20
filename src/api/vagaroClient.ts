/**
 * vagaroClient.ts — Vagaro Public Enterprise Business API V2
 *
 * What changed from the old implementation:
 *  - Base URL:  https://api.vagaro.com/{region}/api/v2  (was /v1)
 *  - Auth:      custom `accessToken` request header     (was Authorization: Bearer)
 *  - Token:     POST /merchants/generate-access-token   (was /oauth2/token)
 *  - Creds:     clientId + clientSecretKey              (was client_id + client_secret)
 *  - Region:    required path segment                   (was absent)
 *
 * Every response is wrapped in { status, responseId, responseCode, message, data }.
 * Service functions call `unwrap(response)` to get the inner `data` value.
 */

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

// ─── Response envelope ────────────────────────────────────────────────────────

/** Shape of every Vagaro V2 API response body. */
export interface VagaroEnvelope<T = unknown> {
  status: number;
  responseId: string;
  responseCode: number;
  message: string;
  data: T;
}

/** Extracts the inner `data` from a Vagaro response. */
export function unwrap<T>(response: AxiosResponse<VagaroEnvelope<T>>): T {
  return response.data.data;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export interface VagaroErrorDetail {
  [field: string]: string | undefined;
}

export interface VagaroApiErrorPayload {
  status: number;
  responseId: string;
  responseCode: number;
  message: string;
  errors?: VagaroErrorDetail;
}

/** Structured error thrown by the response interceptor for 400/401/403 responses. */
export class VagaroClientError extends Error {
  readonly status: number;
  readonly payload: VagaroApiErrorPayload;
  readonly isVagaroError = true as const;

  constructor(message: string, status: number, payload: VagaroApiErrorPayload) {
    super(message);
    this.name = "VagaroClientError";
    this.status = status;
    this.payload = payload;
    Object.setPrototypeOf(this, VagaroClientError.prototype);
  }
}

export function isVagaroClientError(err: unknown): err is VagaroClientError {
  return err instanceof VagaroClientError;
}

// ─── Token management ─────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  /** Unix timestamp (ms) after which the token is stale. */
  expiresAt: number;
}

interface TokenApiResponse {
  access_token: string;
  /** Seconds until expiry (3600 = 1 hour). */
  expires_in: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface VagaroCredentials {
  clientId: string;
  clientSecretKey: string;
}

export interface VagaroClientConfig {
  /**
   * Returns the account region (e.g. "us04").
   * Find yours by looking at the subdomain of your Vagaro business URL.
   * Defaults to reading `cp_vagaro_region` from localStorage.
   */
  getRegion?: () => string | null;

  /**
   * Returns API credentials for token generation.
   * Defaults to reading from localStorage:
   *   cp_vagaro_client_id, cp_vagaro_client_secret_key
   */
  getCredentials?: () => VagaroCredentials | null;

  /**
   * Comma-separated scopes to request on the access token.
   * Vagaro scopes: "read access" | "write access" | "write employee"
   * Defaults to requesting all three.
   */
  scope?: string;

  /** Called on 401 — use to redirect to login or clear stored credentials. */
  onUnauthorized?: () => void;

  /** Called on 403 — use to show a "missing permissions" message. */
  onForbidden?: () => void;
}

// ─── Retry config for 429 ────────────────────────────────────────────────────

const RATE_LIMIT_RETRY = {
  maxRetries: 2,
  defaultDelayMs: 1_000,
} as const;

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a configured Vagaro V2 API client.
 *
 * @example — default singleton, reads from localStorage:
 *   import { vagaroClient } from './api/vagaroClient';
 *   const res = await vagaroClient.post('/appointments', { businessId });
 *   return unwrap(res); // → Appointment[]
 *
 * @example — custom instance wired to your auth store:
 *   const client = createVagaroClient({
 *     getRegion:      () => settingsStore.region,
 *     getCredentials: () => settingsStore.credentials,
 *     onUnauthorized: () => settingsStore.clearCredentials(),
 *   });
 */
export function createVagaroClient(config: VagaroClientConfig = {}): AxiosInstance {
  const {
    getRegion = () => localStorage.getItem("cp_vagaro_region"),
    getCredentials = () => {
      const clientId = localStorage.getItem("cp_vagaro_client_id");
      const clientSecretKey = localStorage.getItem("cp_vagaro_client_secret_key");
      return clientId && clientSecretKey ? { clientId, clientSecretKey } : null;
    },
    scope = "read access,write access,write employee",
    onUnauthorized,
    onForbidden,
  } = config;

  let tokenCache: TokenCache | null = null;

  async function getAccessToken(): Promise<string | null> {
    // Return cached token if still valid with a 60-second buffer.
    if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
      return tokenCache.accessToken;
    }

    const region = getRegion();
    const creds  = getCredentials();
    if (!region || !creds) return null;

    try {
      const res = await axios.post<VagaroEnvelope<TokenApiResponse>>(
        `https://api.vagaro.com/${region}/api/v2/merchants/generate-access-token`,
        { clientId: creds.clientId, clientSecretKey: creds.clientSecretKey, scope },
        { headers: { "Content-Type": "application/json" } },
      );
      const { access_token, expires_in } = res.data.data;
      tokenCache = { accessToken: access_token, expiresAt: Date.now() + expires_in * 1_000 };
      return access_token;
    } catch (e) {
      console.error("[Vagaro] Token generation failed:", e);
      tokenCache = null;
      return null;
    }
  }

  const client = axios.create({
    timeout: 15_000,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  // ── Request interceptor — inject baseURL from region + accessToken header ──
  client.interceptors.request.use(
    async (reqConfig: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
      const region = getRegion() ?? "us04";
      reqConfig.baseURL = `https://api.vagaro.com/${region}/api/v2`;

      const token = await getAccessToken();
      if (token) reqConfig.headers.accessToken = token;

      return reqConfig;
    },
    (err: unknown) => Promise.reject(err),
  );

  // ── Response interceptor — structured error handling ───────────────────────
  client.interceptors.response.use(
    (res: AxiosResponse): AxiosResponse => res,

    async (err: AxiosError<VagaroApiErrorPayload>): Promise<never> => {
      const status  = err.response?.status;
      const payload = err.response?.data;
      const headers = err.response?.headers ?? {};

      const blankPayload = (msg: string): VagaroApiErrorPayload => ({
        status: status ?? 0, responseId: "", responseCode: 0, message: msg,
      });

      switch (status) {
        case 400:
          throw new VagaroClientError(
            payload?.message ?? "Bad Request",
            400,
            payload ?? blankPayload("Bad Request"),
          );

        case 401:
          tokenCache = null;
          console.warn("[Vagaro] 401 Unauthorized — token cache cleared.");
          onUnauthorized?.();
          throw new VagaroClientError("Unauthorized", 401, payload ?? blankPayload("Unauthorized"));

        case 403:
          console.warn("[Vagaro] 403 Forbidden — check API scopes.");
          onForbidden?.();
          throw new VagaroClientError("Forbidden", 403, payload ?? blankPayload("Forbidden"));

        case 429: {
          const retryAfter = headers["retry-after"] as string | undefined;
          const orig = err.config as RetryableConfig | undefined;
          console.warn(`[Vagaro] 429 Too Many Requests${retryAfter ? ` — Retry-After: ${retryAfter}s` : ""}`);

          if (!orig) break;
          orig._retryCount = (orig._retryCount ?? 0) + 1;

          if (orig._retryCount > RATE_LIMIT_RETRY.maxRetries) {
            console.error(`[Vagaro] Exhausted ${RATE_LIMIT_RETRY.maxRetries} retries after 429.`);
            break;
          }

          const delayMs = retryAfter
            ? parseInt(retryAfter, 10) * 1_000
            : RATE_LIMIT_RETRY.defaultDelayMs * orig._retryCount;

          console.info(`[Vagaro] Retrying in ${delayMs}ms (${orig._retryCount}/${RATE_LIMIT_RETRY.maxRetries})`);
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          return client(orig) as Promise<never>;
        }
      }

      return Promise.reject(err);
    },
  );

  return client;
}

// ─── Default singleton ────────────────────────────────────────────────────────
export const vagaroClient = createVagaroClient();

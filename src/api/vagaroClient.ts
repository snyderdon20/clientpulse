/**
 * vagaroClient.ts
 *
 * Production-ready Axios client for the Vagaro Public REST API.
 *
 * Environment variable (Vite):  VITE_VAGARO_API_BASE_URL
 * Note: Vite uses import.meta.env.VITE_* instead of process.env.REACT_APP_*.
 *       Add  VITE_VAGARO_API_BASE_URL=https://api.vagaro.com/v1  to your .env file.
 */

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of the JSON body Vagaro returns for 4xx errors. */
export interface VagaroApiErrorPayload {
  error: string;
  error_description?: string;
  message?: string;
  code?: string | number;
}

/** Rich error thrown by the response interceptor for handled status codes. */
export class VagaroClientError extends Error {
  readonly status: number;
  readonly payload: VagaroApiErrorPayload;
  readonly isVagaroError = true as const;

  constructor(message: string, status: number, payload: VagaroApiErrorPayload) {
    super(message);
    this.name = "VagaroClientError";
    this.status = status;
    this.payload = payload;
    // Restore prototype chain so `instanceof VagaroClientError` works after transpilation.
    Object.setPrototypeOf(this, VagaroClientError.prototype);
  }
}

/** Type guard — narrows an unknown error to VagaroClientError. */
export function isVagaroClientError(err: unknown): err is VagaroClientError {
  return err instanceof VagaroClientError;
}

// ─── Client config ────────────────────────────────────────────────────────────

export interface VagaroClientConfig {
  /**
   * Returns the current OAuth Bearer token.
   * Defaults to reading `vagaro_access_token` from localStorage.
   * Replace with your auth-state selector (Redux, Zustand, Context, etc.).
   */
  getToken?: () => string | null;

  /**
   * Returns the static Vagaro API key (X-API-Key header).
   * Defaults to reading `vagaro_api_key` from localStorage.
   */
  getApiKey?: () => string | null;

  /**
   * Called on every 401 response.
   * Use this to trigger a logout, redirect to login, or start a token-refresh flow.
   */
  onUnauthorized?: () => void;

  /**
   * Called on every 403 response.
   * `requiredScopes` is populated from the `X-Required-Scopes` header when present.
   */
  onForbidden?: (requiredScopes?: string) => void;
}

// ─── Retry config for 429 Too Many Requests ──────────────────────────────────

const RATE_LIMIT_RETRY = {
  /** Maximum number of automatic retries before giving up. */
  maxRetries: 2,
  /** Fallback delay (ms) when the API omits a `Retry-After` header. */
  defaultDelayMs: 1_000,
} as const;

// Axios doesn't expose a `_retryCount` field — extend the config type locally.
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a fully configured Vagaro API client.
 *
 * @example
 * // Default singleton (reads from localStorage, no auth callbacks):
 * import { vagaroClient } from './api/vagaroClient';
 * const data = await vagaroClient.get('/businesses/me');
 *
 * @example
 * // Custom instance wired to your auth layer:
 * const client = createVagaroClient({
 *   getToken:       () => authStore.getState().accessToken,
 *   onUnauthorized: () => authStore.getState().logout(),
 *   onForbidden:    (scopes) => toast.error(`Missing scopes: ${scopes}`),
 * });
 */
export function createVagaroClient(config: VagaroClientConfig = {}): AxiosInstance {
  const {
    getToken  = () => localStorage.getItem("vagaro_access_token"),
    getApiKey = () => localStorage.getItem("vagaro_api_key"),
    onUnauthorized,
    onForbidden,
  } = config;

  // ── Base instance ──────────────────────────────────────────────────────────
  const client = axios.create({
    baseURL: import.meta.env.VITE_VAGARO_API_BASE_URL ?? "https://api.vagaro.com/v1",
    timeout: 15_000,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  // ── Request interceptor — attach auth headers ──────────────────────────────
  client.interceptors.request.use(
    (reqConfig: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      const token  = getToken();
      const apiKey = getApiKey();

      if (token)  reqConfig.headers.Authorization = `Bearer ${token}`;
      if (apiKey) reqConfig.headers["X-API-Key"]  = apiKey;

      return reqConfig;
    },
    (error: unknown) => Promise.reject(error),
  );

  // ── Response interceptor — structured error handling ───────────────────────
  client.interceptors.response.use(
    (response: AxiosResponse): AxiosResponse => response,

    async (error: AxiosError<VagaroApiErrorPayload>): Promise<never> => {
      const status  = error.response?.status;
      const headers = error.response?.headers ?? {};
      const payload = error.response?.data;

      switch (status) {
        // ── 400 Bad Request ─────────────────────────────────────────────────
        // Parse the Vagaro JSON error body and surface a readable message.
        case 400: {
          const message =
            payload?.error_description ??
            payload?.message ??
            payload?.error ??
            "Bad Request";

          throw new VagaroClientError(message, 400, payload ?? { error: "Bad Request" });
        }

        // ── 401 Unauthorized ────────────────────────────────────────────────
        // Token is missing, expired, or revoked.  Delegate to the caller's
        // auth layer (logout, token refresh, redirect to login, etc.).
        case 401: {
          console.warn("[Vagaro] 401 Unauthorized — triggering onUnauthorized callback.");
          onUnauthorized?.();
          throw new VagaroClientError("Unauthorized", 401, payload ?? { error: "Unauthorized" });
        }

        // ── 403 Forbidden ───────────────────────────────────────────────────
        // The token is valid but lacks the required OAuth scopes.
        case 403: {
          const requiredScopes = headers["x-required-scopes"] as string | undefined;
          console.warn(
            `[Vagaro] 403 Forbidden — insufficient scopes.` +
            (requiredScopes ? ` Required: ${requiredScopes}` : " No scope detail provided."),
          );
          onForbidden?.(requiredScopes);
          throw new VagaroClientError("Forbidden", 403, payload ?? { error: "Forbidden" });
        }

        // ── 429 Too Many Requests ───────────────────────────────────────────
        // Respect the `Retry-After` header and retry automatically up to
        // RATE_LIMIT_RETRY.maxRetries times before propagating the error.
        case 429: {
          const remaining   = headers["x-ratelimit-remaining"] ?? headers["x-rate-limit-remaining"];
          const retryAfter  = headers["retry-after"] as string | undefined;
          const originalReq = error.config as RetryableRequestConfig | undefined;

          console.warn(
            `[Vagaro] 429 Too Many Requests` +
            ` — X-RateLimit-Remaining: ${remaining ?? "unknown"}` +
            (retryAfter ? ` — Retry-After: ${retryAfter}s` : ""),
          );

          if (!originalReq) break;

          originalReq._retryCount = (originalReq._retryCount ?? 0) + 1;

          if (originalReq._retryCount > RATE_LIMIT_RETRY.maxRetries) {
            console.error(
              `[Vagaro] Exhausted ${RATE_LIMIT_RETRY.maxRetries} retries after 429. Giving up.`,
            );
            break;
          }

          const delayMs = retryAfter
            ? parseInt(retryAfter, 10) * 1_000
            : RATE_LIMIT_RETRY.defaultDelayMs * originalReq._retryCount;

          console.info(
            `[Vagaro] Retrying in ${delayMs}ms` +
            ` (attempt ${originalReq._retryCount}/${RATE_LIMIT_RETRY.maxRetries})`,
          );

          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          return client(originalReq) as Promise<never>;
        }
      }

      // Re-throw everything else (500, network errors, etc.) as-is.
      return Promise.reject(error);
    },
  );

  return client;
}

// ─── Singleton ────────────────────────────────────────────────────────────────
// Import this directly for simple use cases.
// For apps with a proper auth store, call createVagaroClient({ getToken, onUnauthorized })
// once at startup and export the result instead.
export const vagaroClient = createVagaroClient();

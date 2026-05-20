/**
 * appointmentService.ts
 *
 * Pure async functions for every Vagaro appointment endpoint.
 * No React — safe to call from hooks, server actions, or tests.
 *
 * All functions use the shared `vagaroClient` Axios instance, which
 * automatically attaches auth headers and handles 400/401/403/429 errors.
 */

import { vagaroClient } from "./vagaroClient";

// ─── Enums & literals ─────────────────────────────────────────────────────────

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "checked-in"
  | "in-progress"
  | "completed"
  | "cancelled"
  | "no-show";

// ─── Domain types ─────────────────────────────────────────────────────────────

/** Lightweight reference embedded inside an Appointment (avoid circular deps). */
export interface AppointmentRef {
  id: string;
  name: string;
}

export interface AppointmentService {
  id: string;
  name: string;
  /** Duration in minutes. */
  duration: number;
  /** Price in USD. */
  price: number;
  category?: string;
}

export interface Appointment {
  id: string;
  status: AppointmentStatus;

  /** ISO-8601 datetime string — e.g. "2024-07-15T09:00:00". */
  startDateTime: string;
  /** ISO-8601 datetime string. */
  endDateTime: string;

  customer: AppointmentRef;
  location: AppointmentRef;
  employee: AppointmentRef;
  service: AppointmentService;

  notes?: string;

  /** Price charged for this specific booking (may differ from service list price). */
  price?: number;

  createdAt: string;
  updatedAt: string;
}

// ─── Request / response shapes ────────────────────────────────────────────────

/**
 * Query parameters accepted by `GET /appointments`.
 * All fields are optional — omit any you don't need.
 */
export interface FetchAppointmentsParams {
  /** ISO-8601 date string "YYYY-MM-DD". */
  startDate?: string;
  /** ISO-8601 date string "YYYY-MM-DD". */
  endDate?: string;
  locationId?: string;
  employeeId?: string;
  /** Pagination: 1-based page number (default 1). */
  page?: number;
  /** Results per page — max 100 (default 20). */
  pageSize?: number;
}

/** Paginated envelope returned by `GET /appointments`. */
export interface AppointmentsPage {
  data: Appointment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Payload for `POST /appointments`. */
export interface CreateAppointmentPayload {
  customerId: string;
  locationId: string;
  employeeId: string;
  serviceId: string;
  /** ISO-8601 datetime string — e.g. "2024-07-15T09:00:00". */
  startDateTime: string;
  notes?: string;
}

/**
 * Payload for `PUT /appointments/{id}`.
 * All fields optional — send only what changed.
 */
export interface UpdateAppointmentPayload {
  startDateTime?: string;
  employeeId?: string;
  notes?: string;
}

// ─── Query key factory ────────────────────────────────────────────────────────
//
// Centralising keys prevents string typos and lets you invalidate
// precisely — e.g. invalidate every list without touching detail caches.
//
// Usage:
//   queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
//   queryClient.invalidateQueries({ queryKey: appointmentKeys.detail(id) });

export const appointmentKeys = {
  /** Root key — invalidates everything appointment-related. */
  all: ["appointments"] as const,

  /** Invalidates every list query regardless of filter params. */
  lists: () => [...appointmentKeys.all, "list"] as const,

  /** Cache key for a specific set of filter params. */
  list: (params: FetchAppointmentsParams) =>
    [...appointmentKeys.lists(), params] as const,

  /** Invalidates every detail query. */
  details: () => [...appointmentKeys.all, "detail"] as const,

  /** Cache key for a single appointment. */
  detail: (id: string) => [...appointmentKeys.details(), id] as const,
} as const;

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * `GET /appointments`
 *
 * Fetch a paginated, filtered list of appointments.
 * Params with undefined values are automatically stripped by Axios.
 */
export async function fetchAppointments(
  params: FetchAppointmentsParams = {},
): Promise<AppointmentsPage> {
  const { data } = await vagaroClient.get<AppointmentsPage>("/appointments", {
    params,
  });
  return data;
}

/**
 * `POST /appointments`
 *
 * Book a new appointment. Throws `VagaroClientError` on validation failure (400)
 * or auth issues (401/403) — no try/catch needed in the hook.
 */
export async function createAppointment(
  payload: CreateAppointmentPayload,
): Promise<Appointment> {
  const { data } = await vagaroClient.post<Appointment>("/appointments", payload);
  return data;
}

/**
 * `GET /appointments/{id}`
 *
 * Fetch full details for a single appointment.
 * Returns `null` if the appointment is not found (404) rather than throwing,
 * so components can distinguish "not found" from real errors.
 */
export async function getAppointmentById(id: string): Promise<Appointment | null> {
  try {
    const { data } = await vagaroClient.get<Appointment>(`/appointments/${id}`);
    return data;
  } catch (err: unknown) {
    // Surface 404 as null; re-throw everything else so the interceptor handles it.
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      (err as { status: number }).status === 404
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * `PUT /appointments/{id}`
 *
 * Reschedule or update notes/employee on an existing appointment.
 * Send only the fields you want to change.
 */
export async function updateAppointment(
  id: string,
  payload: UpdateAppointmentPayload,
): Promise<Appointment> {
  const { data } = await vagaroClient.put<Appointment>(
    `/appointments/${id}`,
    payload,
  );
  return data;
}

/**
 * `DELETE /appointments/{id}`
 *
 * Cancel an appointment. Returns void on success (Vagaro responds 204).
 */
export async function cancelAppointment(id: string): Promise<void> {
  await vagaroClient.delete(`/appointments/${id}`);
}

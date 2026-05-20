/**
 * appointmentService.ts — Vagaro V2 Appointments
 *
 * The Vagaro V2 API is READ-ONLY for appointments.
 * There are no create / update / cancel endpoints — those happen
 * inside Vagaro's own UI or online booking widget.
 *
 * Endpoints:
 *   POST /{region}/api/v2/appointments              — Retrieve Appointments
 *   POST /{region}/api/v2/appointments/availability — Search Availability
 */

import { vagaroClient, unwrap, type VagaroEnvelope } from "./vagaroClient";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * bookingStatus values observed in production data.
 * Vagaro returns these capitalised ("Confirmed", not "confirmed").
 */
export type BookingStatus =
  | "Confirmed"
  | "Pending"
  | "Checked In"
  | "In Progress"
  | "Completed"
  | "Cancelled"
  | "No Show";

export interface Appointment {
  appointmentId: string;
  /** ISO-8601 datetime, e.g. "2024-10-10T21:15:00.000Z" */
  startTime: string;
  /** ISO-8601 datetime */
  endTime: string;
  bookingStatus: BookingStatus;
  serviceTitle: string;
  serviceId: string;
  calendarEventId: string | null;
  /** Price charged, in business currency. */
  amount: number;
  eventType: string;
  /** "Booked Online" | "Walk In" | etc. */
  onlineVsInhouse: string;
  appointmentTypeCode: string | null;
  appointmentTypeName: string | null;
  customerId: string;
  bookingSource: string;
  serviceProviderId: string;
  serviceCategory: string;
  createdDate: string;
  createdBy: string;
  modifiedDate: string | null;
  modifiedBy: string | null;
  /** IDs of form responses linked to this appointment. */
  formResponseIds: string[];
}

// ─── Retrieve Appointments ────────────────────────────────────────────────────

export interface RetrieveAppointmentsBody {
  /** Required — the business location to query. */
  businessId: string;
  /**
   * Retrieve a specific appointment.
   * At least one of appointmentId or customerId is expected by the API.
   */
  appointmentId?: string;
  /** Retrieve all appointments for a specific customer. */
  customerId?: string;
}

export interface RetrieveAppointmentsQuery {
  pageNumber?: number;
  pageSize?: number;
  /** Sort by start time: "asc" | "desc" */
  orderBy?: "asc" | "desc";
}

/**
 * `POST /{region}/api/v2/appointments`
 *
 * Returns appointments for a business, filtered by appointmentId or customerId.
 * Paginated — use `pageNumber` and `pageSize` query params to page through results.
 *
 * @example
 * // All appointments for a customer:
 * const appts = await retrieveAppointments({ businessId, customerId });
 *
 * // A specific appointment:
 * const appts = await retrieveAppointments({ businessId, appointmentId });
 */
export async function retrieveAppointments(
  body: RetrieveAppointmentsBody,
  query?: RetrieveAppointmentsQuery,
): Promise<Appointment[]> {
  const res = await vagaroClient.post<VagaroEnvelope<Appointment[]>>(
    "/appointments",
    body,
    { params: query },
  );
  return unwrap(res) ?? [];
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const appointmentKeys = {
  all: ["appointments"] as const,
  lists: () => [...appointmentKeys.all, "list"] as const,
  list: (body: RetrieveAppointmentsBody, query?: RetrieveAppointmentsQuery) =>
    [...appointmentKeys.lists(), body, query] as const,
  availability: (body: SearchAvailabilityBody) =>
    [...appointmentKeys.all, "availability", body] as const,
} as const;

// ─── Search Appointment Availability ─────────────────────────────────────────

/** A single service + provider combination to check availability for. */
export interface BookingItem {
  serviceId: string;
  /** Optionally restrict to a specific service provider. */
  serviceProviderId?: string;
}

export interface SearchAvailabilityBody {
  /** Required — the business location to search. */
  businessId: string;
  /**
   * Date to search in "YYYY-MM-DD" format.
   * If omitted, Vagaro returns the first available date's slots.
   */
  appointmentDate?: string;
  /** One or more service + provider combinations to find slots for. */
  bookingItems: BookingItem[];
}

export interface AvailabilityItem {
  serviceProviderId: string;
  serviceProvider: string;
  serviceId: string;
  serviceTitle: string;
  /** Duration in minutes. */
  duration: number;
}

export interface AvailabilitySlot {
  items: AvailabilityItem[];
  /** "YYYY-MM-DD" */
  appointmentDate: string;
  /** Available start times in "HH:MM" format, e.g. ["09:00", "09:30"]. */
  timeSlot: string[];
}

/**
 * `POST /{region}/api/v2/appointments/availability`
 *
 * Returns available time slots for one or more services at a location.
 * Use this to power a booking widget or calendar view.
 *
 * @example
 * const slots = await searchAppointmentAvailability({
 *   businessId,
 *   appointmentDate: "2025-09-15",
 *   bookingItems: [{ serviceId: "abc123", serviceProviderId: "xyz456" }],
 * });
 */
export async function searchAppointmentAvailability(
  body: SearchAvailabilityBody,
): Promise<AvailabilitySlot[]> {
  const res = await vagaroClient.post<VagaroEnvelope<AvailabilitySlot[]>>(
    "/appointments/availability",
    body,
  );
  return unwrap(res) ?? [];
}

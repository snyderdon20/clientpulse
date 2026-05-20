/**
 * useAppointments.ts — TanStack Query v5 hooks for Vagaro V2 Appointments
 *
 * The Vagaro V2 API is READ-ONLY for appointments — there are no create,
 * update, or cancel endpoints. Those actions happen inside Vagaro's UI.
 * These hooks cover the two available endpoints:
 *
 *   useAppointments         → POST /appointments        (retrieve list)
 *   useAppointmentAvailability → POST /appointments/availability (search slots)
 *
 * SETUP — wrap your app root once in main.tsx:
 *   import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
 *   const queryClient = new QueryClient();
 *   <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
 *
 * ─── Loading/error pattern ────────────────────────────────────────────────────
 *  isPending   → first-ever fetch, no data yet    → show skeleton / spinner
 *  isFetching  → any in-flight request             → show subtle progress bar
 *  isError     → latest fetch threw               → show error UI
 *  error       → the thrown VagaroClientError or AxiosError
 *  refetch     → manually re-trigger the query
 */

import { useQuery, keepPreviousData, type UseQueryResult } from "@tanstack/react-query";

import {
  retrieveAppointments,
  searchAppointmentAvailability,
  appointmentKeys,
  type Appointment,
  type RetrieveAppointmentsBody,
  type RetrieveAppointmentsQuery,
  type AvailabilitySlot,
  type SearchAvailabilityBody,
} from "../api/appointmentService";

import { isVagaroClientError } from "../api/vagaroClient";

// ─── Stale time ───────────────────────────────────────────────────────────────
// Appointments change frequently — treat cache as stale after 2 minutes.
const APPOINTMENTS_STALE_MS = 2 * 60 * 1_000;
// Availability slots are ephemeral — stale after 30 seconds.
const AVAILABILITY_STALE_MS = 30 * 1_000;

// ─── useAppointments ──────────────────────────────────────────────────────────

export type UseAppointmentsResult = UseQueryResult<Appointment[], Error> & {
  /** Convenience alias for `data ?? []`. Never undefined. */
  appointments: Appointment[];
};

/**
 * Fetch appointments for a customer or a specific appointment ID.
 *
 * @param body     Required `businessId` + optional `customerId` or `appointmentId`.
 * @param query    Optional pagination / sort params.
 * @param options  Pass `{ enabled: false }` to defer fetching.
 *
 * @example
 * const { appointments, isPending, isFetching, isError, error } = useAppointments(
 *   { businessId, customerId },
 *   { orderBy: "desc" }
 * );
 *
 * if (isPending) return <Spinner />;
 * if (isError)   return <p>{getErrorMessage(error)}</p>;
 * return <AppointmentList items={appointments} />;
 */
export function useAppointments(
  body: RetrieveAppointmentsBody,
  query?: RetrieveAppointmentsQuery,
  options: { enabled?: boolean } = {},
): UseAppointmentsResult {
  const result = useQuery({
    queryKey: appointmentKeys.list(body, query),
    queryFn:  () => retrieveAppointments(body, query),
    staleTime: APPOINTMENTS_STALE_MS,
    // Keep previous results visible while new params load — prevents empty flash.
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? Boolean(body.businessId),
  });

  return { ...result, appointments: result.data ?? [] };
}

// ─── useAppointmentAvailability ───────────────────────────────────────────────

export type UseAvailabilityResult = UseQueryResult<AvailabilitySlot[], Error> & {
  /** Convenience alias for `data ?? []`. Never undefined. */
  slots: AvailabilitySlot[];
};

/**
 * Search available appointment slots for one or more services at a location.
 *
 * @param body    Required `businessId` + `bookingItems`; optional `appointmentDate`.
 * @param options Pass `{ enabled: false }` to defer fetching (e.g. until a date is picked).
 *
 * @example
 * const { slots, isPending, isError } = useAppointmentAvailability({
 *   businessId,
 *   appointmentDate: selectedDate,  // "YYYY-MM-DD"
 *   bookingItems: [{ serviceId, serviceProviderId }],
 * });
 *
 * if (isPending) return <Spinner />;
 * return slots.map(s => <TimeSlotGrid key={s.appointmentDate} slot={s} />);
 */
export function useAppointmentAvailability(
  body: SearchAvailabilityBody,
  options: { enabled?: boolean } = {},
): UseAvailabilityResult {
  const result = useQuery({
    queryKey: appointmentKeys.availability(body),
    queryFn:  () => searchAppointmentAvailability(body),
    staleTime: AVAILABILITY_STALE_MS,
    enabled: options.enabled ?? Boolean(body.businessId && body.bookingItems?.length),
  });

  return { ...result, slots: result.data ?? [] };
}

// ─── Error helper ─────────────────────────────────────────────────────────────

/**
 * Extracts a user-readable message from any error a hook might surface.
 *
 * @example
 * const { isError, error } = useAppointments(body);
 * if (isError) return <ErrorBanner message={getErrorMessage(error)} />;
 */
export function getErrorMessage(err: unknown): string {
  if (isVagaroClientError(err)) {
    return err.payload.message || err.message;
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

/**
 * useAppointments.ts
 *
 * TanStack Query v5 hooks for the Vagaro appointments API.
 *
 * SETUP REQUIRED — wrap your app root with QueryClientProvider once:
 *
 *   // main.tsx
 *   import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
 *   const queryClient = new QueryClient();
 *   root.render(
 *     <QueryClientProvider client={queryClient}>
 *       <App />
 *     </QueryClientProvider>
 *   );
 *
 * ─── Loading & error patterns (see bottom of file for component examples) ────
 *
 *  • `isPending`  — true on the very first fetch (no cached data yet).
 *                   Show a skeleton/spinner for this state.
 *  • `isFetching` — true whenever a request is in-flight, including background
 *                   refetches.  Use for a subtle top-bar progress indicator.
 *  • `isError`    — true when the latest fetch threw.  Show an error message.
 *  • `error`      — the thrown value (a VagaroClientError or AxiosError).
 *  • `refetch`    — manually re-trigger the query (e.g. a "Retry" button).
 *
 * For mutations:
 *  • `isPending`  — the mutation is currently in-flight.  Disable the button.
 *  • `isError`    — the mutation threw.
 *  • `reset`      — clears error/data state (useful after dismissing an error).
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";

import {
  fetchAppointments,
  createAppointment,
  getAppointmentById,
  updateAppointment,
  cancelAppointment,
  appointmentKeys,
  type Appointment,
  type AppointmentsPage,
  type FetchAppointmentsParams,
  type CreateAppointmentPayload,
  type UpdateAppointmentPayload,
} from "../api/appointmentService";

import { isVagaroClientError } from "../api/vagaroClient";

// ─── Shared stale time ────────────────────────────────────────────────────────
// Appointments change often — consider data stale after 2 minutes.
const APPOINTMENTS_STALE_MS = 2 * 60 * 1_000;

// ─── Return types (re-exported for component use) ─────────────────────────────

export type UseAppointmentsResult = UseQueryResult<AppointmentsPage, Error> & {
  appointments: Appointment[];
  totalCount: number;
};

export type UseAppointmentResult = UseQueryResult<Appointment | null, Error>;

export type UseCreateAppointmentResult = UseMutationResult<
  Appointment,
  Error,
  CreateAppointmentPayload
>;

export type UseUpdateAppointmentResult = UseMutationResult<
  Appointment,
  Error,
  { id: string; payload: UpdateAppointmentPayload }
>;

export type UseCancelAppointmentResult = UseMutationResult<void, Error, string>;

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetch a filtered, paginated list of appointments.
 *
 * - Results are cached per unique `params` object.
 * - While new params load, the previous page's data stays visible
 *   (`keepPreviousData`) so the UI doesn't flash empty.
 * - Pass `enabled: false` to skip fetching (e.g. until a location is selected).
 *
 * @example
 * const { appointments, isPending, isFetching, isError, error } = useAppointments({
 *   startDate: "2024-07-01",
 *   endDate:   "2024-07-31",
 *   locationId: selectedLocationId,
 * });
 */
export function useAppointments(
  params: FetchAppointmentsParams = {},
  options: { enabled?: boolean } = {},
): UseAppointmentsResult {
  const result = useQuery({
    queryKey: appointmentKeys.list(params),
    queryFn:  () => fetchAppointments(params),
    staleTime: APPOINTMENTS_STALE_MS,
    // Keep the previous page visible while the new one loads (prevents flicker
    // when the user changes date range or flips pages).
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });

  return {
    ...result,
    appointments: result.data?.data ?? [],
    totalCount:   result.data?.total ?? 0,
  };
}

/**
 * Fetch a single appointment by ID.
 *
 * Returns `null` (not an error) when the appointment is not found (404),
 * so you can render a "Not found" state separately from real errors.
 *
 * @example
 * const { data: appointment, isPending, isError } = useAppointment(appointmentId);
 * if (isPending)        return <Spinner />;
 * if (!appointment)     return <p>Appointment not found.</p>;
 * if (isError)          return <ErrorBanner />;
 */
export function useAppointment(id: string | null | undefined): UseAppointmentResult {
  return useQuery({
    queryKey: appointmentKeys.detail(id ?? ""),
    queryFn:  () => getAppointmentById(id!),
    staleTime: APPOINTMENTS_STALE_MS,
    // Don't fetch until we actually have an ID.
    enabled: Boolean(id),
  });
}

/**
 * Book a new appointment.
 *
 * On success, automatically invalidates the appointments list cache so
 * any open list views refetch and show the new booking.
 *
 * @example
 * const { mutate: book, isPending, isError, error } = useCreateAppointment();
 *
 * book(
 *   { customerId, locationId, employeeId, serviceId, startDateTime },
 *   {
 *     onSuccess: (newAppt) => navigate(`/appointments/${newAppt.id}`),
 *     onError:   (err)     => toast.error(err.message),
 *   }
 * );
 */
export function useCreateAppointment(): UseCreateAppointmentResult {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateAppointmentPayload) => createAppointment(payload),

    onSuccess: (newAppointment) => {
      // Seed the detail cache so navigating straight to the new appointment
      // is instant (no extra network round-trip).
      queryClient.setQueryData(
        appointmentKeys.detail(newAppointment.id),
        newAppointment,
      );
      // Invalidate all list queries — they need to refetch to include the new row.
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    },
  });
}

/**
 * Reschedule an appointment or update its notes / employee.
 *
 * Uses an optimistic update: the UI reflects the change immediately and
 * rolls back if the server rejects it — keeps the experience snappy.
 *
 * @example
 * const { mutate: reschedule, isPending } = useUpdateAppointment();
 *
 * reschedule(
 *   { id: appointment.id, payload: { startDateTime: newTime } },
 *   { onError: (err) => toast.error(err.message) }
 * );
 */
export function useUpdateAppointment(): UseUpdateAppointmentResult {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateAppointmentPayload }) =>
      updateAppointment(id, payload),

    // Optimistically patch the detail cache before the request completes.
    onMutate: async ({ id, payload }) => {
      // Cancel in-flight fetches for this appointment so they don't overwrite
      // our optimistic update.
      await queryClient.cancelQueries({ queryKey: appointmentKeys.detail(id) });

      // Snapshot the current value for rollback.
      const previous = queryClient.getQueryData<Appointment>(
        appointmentKeys.detail(id),
      );

      // Apply the optimistic patch.
      if (previous) {
        queryClient.setQueryData(appointmentKeys.detail(id), {
          ...previous,
          ...payload,
        });
      }

      return { previous, id };
    },

    // Roll back on failure.
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          appointmentKeys.detail(context.id),
          context.previous,
        );
      }
    },

    // Always sync with the server response (success or error).
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    },
  });
}

/**
 * Cancel an appointment.
 *
 * Removes the appointment from the detail cache and refetches all lists
 * so cancelled items disappear from the UI without a manual refresh.
 *
 * @example
 * const { mutate: cancel, isPending: cancelling } = useCancelAppointment();
 *
 * <button disabled={cancelling} onClick={() => cancel(appointment.id)}>
 *   {cancelling ? "Cancelling…" : "Cancel appointment"}
 * </button>
 */
export function useCancelAppointment(): UseCancelAppointmentResult {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => cancelAppointment(id),

    onSuccess: (_data, id) => {
      // Remove the stale detail entry immediately.
      queryClient.removeQueries({ queryKey: appointmentKeys.detail(id) });
      // Refetch all lists so the cancelled appointment disappears.
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    },
  });
}

// ─── Error helper (re-exported for components) ────────────────────────────────

/**
 * Extracts a human-readable message from any error a hook might surface.
 * Handles `VagaroClientError` (structured), `Error`, and plain strings.
 *
 * @example
 * const { isError, error } = useAppointments(params);
 * if (isError) return <p>{getErrorMessage(error)}</p>;
 */
export function getErrorMessage(err: unknown): string {
  if (isVagaroClientError(err)) {
    return (
      err.payload.error_description ??
      err.payload.message ??
      err.message
    );
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

// ─── Component usage examples ─────────────────────────────────────────────────
//
// ── 1. List with filters ──────────────────────────────────────────────────────
//
// function AppointmentList({ locationId }: { locationId: string }) {
//   const [page, setPage] = useState(1);
//   const {
//     appointments,
//     totalCount,
//     isPending,   // true on first load only — show a full-page skeleton
//     isFetching,  // true on every fetch — show a subtle spinner in the header
//     isError,
//     error,
//   } = useAppointments({ locationId, startDate: "2024-07-01", page });
//
//   if (isPending) return <SkeletonList />;
//   if (isError)   return <ErrorBanner message={getErrorMessage(error)} />;
//
//   return (
//     <>
//       {isFetching && <TopBarSpinner />}
//       <ul>{appointments.map(a => <AppointmentRow key={a.id} appt={a} />)}</ul>
//       <Pagination total={totalCount} page={page} onChange={setPage} />
//     </>
//   );
// }
//
// ── 2. Detail view ────────────────────────────────────────────────────────────
//
// function AppointmentDetail({ id }: { id: string }) {
//   const { data: appt, isPending, isError, error } = useAppointment(id);
//
//   if (isPending)  return <Spinner />;
//   if (!appt)      return <p>Appointment not found.</p>;  // 404 → null
//   if (isError)    return <ErrorBanner message={getErrorMessage(error)} />;
//
//   return <AppointmentCard appt={appt} />;
// }
//
// ── 3. Create form ────────────────────────────────────────────────────────────
//
// function BookAppointmentForm() {
//   const { mutate: book, isPending, isError, error, reset } = useCreateAppointment();
//
//   const handleSubmit = (formData: CreateAppointmentPayload) =>
//     book(formData, {
//       onSuccess: (appt) => navigate(`/appointments/${appt.id}`),
//       // onError handled via isError below — no need to duplicate
//     });
//
//   return (
//     <form onSubmit={...}>
//       {isError && (
//         <ErrorBanner message={getErrorMessage(error)} onDismiss={reset} />
//       )}
//       <button type="submit" disabled={isPending}>
//         {isPending ? "Booking…" : "Book appointment"}
//       </button>
//     </form>
//   );
// }
//
// ── 4. Reschedule (optimistic) ────────────────────────────────────────────────
//
// function RescheduleButton({ appt }: { appt: Appointment }) {
//   const { mutate: reschedule, isPending } = useUpdateAppointment();
//
//   return (
//     <button
//       disabled={isPending}
//       onClick={() =>
//         reschedule(
//           { id: appt.id, payload: { startDateTime: newTime } },
//           { onError: (err) => toast.error(getErrorMessage(err)) }
//         )
//       }
//     >
//       {isPending ? "Saving…" : "Reschedule"}
//     </button>
//   );
// }
//
// ── 5. Cancel ─────────────────────────────────────────────────────────────────
//
// function CancelButton({ apptId }: { apptId: string }) {
//   const { mutate: cancel, isPending } = useCancelAppointment();
//   return (
//     <button disabled={isPending} onClick={() => cancel(apptId)}>
//       {isPending ? "Cancelling…" : "Cancel"}
//     </button>
//   );
// }

/**
 * personalTaskService.ts — Vagaro V2 Personal Tasks
 *
 * Personal tasks block a service provider's calendar for non-appointment
 * time (e.g. breaks, vacations, training).
 *
 * Endpoints:
 *   POST /{region}/api/v2/personal-tasks/create                     — Create
 *   POST /{region}/api/v2/personal-tasks/retrieve                   — Retrieve
 *   PUT  /{region}/api/v2/personal-tasks/{personalTaskId}           — Update
 *   POST /{region}/api/v2/personal-tasks/delete/{personalTaskId}    — Delete
 */

import { vagaroClient, unwrap, type VagaroEnvelope } from "./vagaroClient";

// ─── Recurrence ───────────────────────────────────────────────────────────────

export type RecurrenceType = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  type: RecurrenceType;
  /** Repeat every N intervals (e.g. every 2 weeks = interval: 2, type: "weekly"). */
  interval: number;
  /** Required for monthly/yearly recurrence (1–12). */
  monthOfYear?: number;
  /** Required for weekly recurrence (0 = Sunday … 6 = Saturday). */
  dayOfWeek?: number;
  /** "YYYY-MM-DD" — date the series ends. */
  endDate?: string;
}

// ─── Personal Task ────────────────────────────────────────────────────────────

export interface PersonalTask {
  personalTaskId: string;
  /** Hex color code, e.g. "#e5b67f" */
  personalTaskHexCode: string;
  blockOnlineBooking: boolean;
  businessId: string;
  serviceProviderId: string;
  personalTaskName: string;
  personalTaskComment: string;
  /** ISO-8601 datetime in local time */
  startTime: string;
  /** ISO-8601 datetime in local time */
  endTime: string;
  recurrence?: Recurrence;
}

export interface PersonalTasksResponse {
  personalTasks: PersonalTask[];
  nextPage: string | null;
}

export interface CreateUpdateTaskResult {
  personalTaskIds: string[];
  recurringRuleIds: { [key: string]: unknown }[];
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreatePersonalTaskBody {
  businessId: string;
  serviceProviderId: string;
  personalTaskName?: string;
  personalTaskComment?: string;
  /** Default: "#e5b67f" */
  personalTaskHexCode?: string;
  /** Default: true */
  blockOnlineBooking?: boolean;
  /** ISO-8601 datetime in local time */
  startTime: string;
  /** ISO-8601 datetime in local time */
  endTime: string;
  recurrence?: Recurrence;
}

/**
 * `POST /{region}/api/v2/personal-tasks/create`
 *
 * Creates a personal task (calendar block) for a service provider.
 * For recurring tasks, the response `recurringRuleIds` should be used
 * (not `personalTaskIds`) for future retrieve/update/delete calls.
 * Required scope: "write access"
 */
export async function createPersonalTask(
  body: CreatePersonalTaskBody,
): Promise<CreateUpdateTaskResult> {
  const res = await vagaroClient.post<VagaroEnvelope<CreateUpdateTaskResult>>(
    "/personal-tasks/create",
    body,
  );
  return unwrap(res);
}

// ─── Retrieve ─────────────────────────────────────────────────────────────────

export interface RetrievePersonalTasksBody {
  businessId: string;
  serviceProviderId: string;
  /** Start of date range. Defaults to today if omitted. */
  startTime?: string;
  /** End of date range. Defaults to today if omitted. */
  endTime?: string;
  /**
   * A single task ID or recurring series rule ID.
   * When supplied, only that task (or series) is returned.
   */
  personalTaskId?: string;
}

export interface RetrievePersonalTasksQuery {
  pageNumber?: number;
  /** Default: 10. Max: 100. */
  pageSize?: number;
}

/**
 * `POST /{region}/api/v2/personal-tasks/retrieve`
 *
 * Returns personal tasks for a service provider within an optional date range.
 * Required scope: "read access"
 */
export async function retrievePersonalTasks(
  body: RetrievePersonalTasksBody,
  query?: RetrievePersonalTasksQuery,
): Promise<PersonalTasksResponse> {
  const res = await vagaroClient.post<VagaroEnvelope<PersonalTasksResponse>>(
    "/personal-tasks/retrieve",
    body,
    { params: query },
  );
  return unwrap(res);
}

// ─── Update ───────────────────────────────────────────────────────────────────

export interface UpdatePersonalTaskBody {
  businessId: string;
  serviceProviderId: string;
  personalTaskName?: string;
  personalTaskComment?: string;
  personalTaskHexCode?: string;
  blockOnlineBooking?: boolean;
  startTime?: string;
  endTime?: string;
  recurrence?: Recurrence;
  /** Required when modifying a recurring series. */
  recurring?: boolean;
  /**
   * Only for recurring series.
   * false → update only the single task matching startTime/endTime.
   * true  → update the entire series (must also provide a new `recurrence` object).
   */
  editSeries?: boolean;
}

/**
 * `PUT /{region}/api/v2/personal-tasks/{personalTaskId}`
 *
 * Updates a personal task or recurring series.
 * Pass the recurring rule ID (from `recurringRuleIds`) to modify a series.
 * Required scope: "write access"
 */
export async function updatePersonalTask(
  personalTaskId: string,
  body: UpdatePersonalTaskBody,
): Promise<CreateUpdateTaskResult> {
  const res = await vagaroClient.put<VagaroEnvelope<CreateUpdateTaskResult>>(
    `/personal-tasks/${personalTaskId}`,
    body,
  );
  return unwrap(res);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export interface DeletePersonalTaskBody {
  businessId: string;
  /** Whether the task is part of a recurring series. */
  recurring?: boolean;
  /**
   * Required when deleting from a recurring series via recurringRuleId.
   * "YYYY-MM-DD" format.
   */
  appointmentDate?: string;
  /**
   * Only for recurring series.
   * true  → deletes all tasks from appointmentDate onward.
   * false → deletes only the task on appointmentDate.
   */
  editSeries?: boolean;
}

/**
 * `POST /{region}/api/v2/personal-tasks/delete/{personalTaskId}`
 *
 * Deletes a personal task or a portion of a recurring series.
 * Required scope: "write access"
 */
export async function deletePersonalTask(
  personalTaskId: string,
  body: DeletePersonalTaskBody,
): Promise<void> {
  await vagaroClient.post(`/personal-tasks/delete/${personalTaskId}`, body);
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const personalTaskKeys = {
  all: ["personalTasks"] as const,
  lists: () => [...personalTaskKeys.all, "list"] as const,
  list: (body: RetrievePersonalTasksBody, query?: RetrievePersonalTasksQuery) =>
    [...personalTaskKeys.lists(), body, query] as const,
} as const;

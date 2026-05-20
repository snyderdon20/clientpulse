/**
 * employeeManagementService.ts — Vagaro V2 Employee Management
 *
 * These are the "merchant-level" operations: assigning/unassigning employees
 * across locations and managing their calendar working hours.
 *
 * Endpoints:
 *   POST /{region}/api/v2/merchants/employees/assign                       — Assign Employee
 *   POST /{region}/api/v2/merchants/employees/unassign                     — Unassign Employee
 *   PUT  /{region}/api/v2/employees/working-hours/{serviceProviderId}      — Update Working Hours
 */

import { vagaroClient } from "./vagaroClient";

// ─── Assign Employee ──────────────────────────────────────────────────────────

export interface AssignEmployeeBody {
  /**
   * Array of businessIds to assign the employee to.
   * One of businessIds or groupName is required.
   */
  businessIds?: string[];
  /**
   * Multi-location group name.
   * One of businessIds or groupName is required.
   */
  groupName?: string;
  /** accessLevelId from Get Access Levels API. */
  accesslevelId: string;
  emailId: string;
  /** true = create a calendar for this employee; false = no calendar. */
  calendar: boolean;
}

/**
 * `POST /{region}/api/v2/merchants/employees/assign`
 *
 * Assigns an employee to one or more business locations.
 * Supply either `businessIds` or `groupName` (not both).
 * Required scope: "write employee"
 */
export async function assignEmployee(body: AssignEmployeeBody): Promise<void> {
  await vagaroClient.post("/merchants/employees/assign", body);
}

// ─── Unassign Employee ────────────────────────────────────────────────────────

export interface UnassignEmployeeBody {
  emailId: string;
  /**
   * Array of businessIds to remove the employee from.
   * One of businessIds or groupName is required.
   */
  businessIds?: string[];
  /**
   * Multi-location group name.
   * One of businessIds or groupName is required.
   */
  groupName?: string;
  /**
   * true  = keep the employee's calendar (deactivate only).
   * false = remove the calendar entirely.
   */
  calendar: boolean;
}

/**
 * `POST /{region}/api/v2/merchants/employees/unassign`
 *
 * Deactivates an employee from one or more locations.
 * Supply either `businessIds` or `groupName` (not both).
 * Required scope: "write employee"
 */
export async function unassignEmployee(body: UnassignEmployeeBody): Promise<void> {
  await vagaroClient.post("/merchants/employees/unassign", body);
}

// ─── Update Employee Working Hours ────────────────────────────────────────────

export type WorkingHoursType = "calendarWorkingHours" | "regularWorkingHours";

export interface WorkingHoursSlot {
  /** "HH:MM" in 24-hour format, e.g. "09:00" */
  startTime: string;
  /** "HH:MM" in 24-hour format, e.g. "17:00" */
  endTime: string;
  /** Service IDs offered during this slot. */
  serviceIds?: string[];
  /**
   * Required when type = "regularWorkingHours".
   * 0 = Sunday … 6 = Saturday.
   */
  dayOfWeek?: number;
}

export interface UpdateWorkingHoursBody {
  businessId: string;
  /**
   * "calendarWorkingHours" → sets hours for a specific date (requires `date`).
   * "regularWorkingHours"  → sets recurring weekly hours (requires `dayOfWeek` in each slot).
   */
  type: WorkingHoursType;
  /**
   * Required when type = "calendarWorkingHours".
   * "YYYY-MM-DD" format, e.g. "2025-05-15"
   */
  date?: string;
  slots: WorkingHoursSlot[];
  /**
   * Only applies when type = "calendarWorkingHours".
   * When true, applies these hours to all occurrences of the same weekday.
   */
  repeatForSameDay?: boolean;
}

/**
 * `PUT /{region}/api/v2/employees/working-hours/{serviceProviderId}`
 *
 * Updates calendar or regular working hours for a service provider.
 *
 * - Use `calendarWorkingHours` + `date` to set hours for a specific date.
 * - Use `regularWorkingHours` + `dayOfWeek` in each slot to set recurring weekly hours.
 *
 * Required scope: "write access"
 */
export async function updateEmployeeWorkingHours(
  serviceProviderId: string,
  body: UpdateWorkingHoursBody,
): Promise<void> {
  await vagaroClient.put(`/employees/working-hours/${serviceProviderId}`, body);
}

/**
 * employeeService.ts — Vagaro V2 Employees
 *
 * Endpoints:
 *   POST /{region}/api/v2/employees/{serviceProviderId}  — Retrieve Employee
 *   PUT  /{region}/api/v2/employees/{serviceProviderId}  — Update Employee
 *   POST /{region}/api/v2/employees/{serviceProviderId}  — Delete Employee
 *
 * Note: Retrieve and Delete both use POST — they are differentiated by
 * whether a body with update fields is present. In practice the API
 * distinguishes them by path + method:
 *   Retrieve = POST /employees  (body: { businessId, serviceProviderId })
 *   Delete   = POST /employees/{serviceProviderId}  (body: { businessId })
 */

import { vagaroClient, unwrap, type VagaroEnvelope } from "./vagaroClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Employee {
  serviceProviderId: string;
  employeeFirstName: string;
  employeeLastName: string;
  businessGroupId: string;
  email: string;
  phone: string;
  streetAddress: string;
  city: string;
  regionCode: string;
  regionName: string;
  countryCode: string;
  countryName: string;
  /** "YYYY-MM-DD" */
  birthday: string;
  /** ISO-8601 datetime */
  startDate: string;
  /** serviceProviderId of the manager */
  reportsTo: string;
  postalCode: string;
  accessLevelId: string;
  employeeType: string;
  employeeCardId: number;
  createdDate: string;
  createdBy: string;
  isActive: boolean;
  isOnlineBookingActive: boolean;
}

// ─── Retrieve Employee ────────────────────────────────────────────────────────

export interface RetrieveEmployeeBody {
  businessId: string;
  serviceProviderId: string;
}

/**
 * `POST /{region}/api/v2/employees`
 *
 * Retrieves full profile for a single employee/service provider.
 */
export async function retrieveEmployee(body: RetrieveEmployeeBody): Promise<Employee> {
  const res = await vagaroClient.post<VagaroEnvelope<Employee>>("/employees", body);
  return unwrap(res);
}

// ─── Update Employee ──────────────────────────────────────────────────────────

export interface UpdateEmployeeBody {
  businessId: string;
  employeeFirstName?: string;
  employeeLastName?: string;
  dayPhone?: string;
  nightPhone?: string;
  street?: string;
  streetNo?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
  /** "YYYY-MM-DD" */
  birthday?: string;
  /** "YYYY-MM-DD" */
  startDate?: string;
  reportsTo?: string;
  employeeCardId?: number;
  isOnlineBookingActive?: boolean;
  isShownOnStaffPage?: boolean;
  showContactInformation?: boolean;
}

/**
 * `PUT /{region}/api/v2/employees/{serviceProviderId}`
 *
 * Updates information for an employee. Send only the fields to change.
 * Required scope: "write access"
 */
export async function updateEmployee(
  serviceProviderId: string,
  body: UpdateEmployeeBody,
): Promise<void> {
  await vagaroClient.put(`/employees/${serviceProviderId}`, body);
}

// ─── Delete Employee ──────────────────────────────────────────────────────────

export interface DeleteEmployeeBody {
  businessId: string;
}

/**
 * `POST /{region}/api/v2/employees/{serviceProviderId}`
 *
 * Deletes an employee from a business location.
 * Required scope: "write access"
 */
export async function deleteEmployee(
  serviceProviderId: string,
  body: DeleteEmployeeBody,
): Promise<void> {
  await vagaroClient.post(`/employees/${serviceProviderId}`, body);
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const employeeKeys = {
  all: ["employees"] as const,
  detail: (serviceProviderId: string) =>
    [...employeeKeys.all, "detail", serviceProviderId] as const,
} as const;

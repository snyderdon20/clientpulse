/**
 * customerService.ts — Vagaro V2 Customers
 *
 * Endpoints:
 *   POST /{region}/api/v2/customers               — Retrieve Customer
 *   POST /{region}/api/v2/customers/{customerId}  — Delete Customer
 */

import { vagaroClient, unwrap, type VagaroEnvelope } from "./vagaroClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Customer {
  customerId: string;
  customerFirstName: string;
  customerLastName: string;
  email: string;
  mobilePhone: string;
  dayPhone: string;
  nightPhone: string;
  streetAddress: string;
  city: string;
  /** e.g. "US-CA" */
  regionCode: string;
  regionName: string;
  /** e.g. "US" */
  countryCode: string;
  countryName: string;
  postalCode: string;
  generalTags: string[];
  /** "YYYY-MM-DD" */
  birthday: string;
  gender: string;
  pointsBalance: number;
  createdDate: string;
  createdBy: string;
}

// ─── Retrieve Customer ────────────────────────────────────────────────────────

export interface RetrieveCustomerBody {
  businessId: string;
  customerId: string;
}

/**
 * `POST /{region}/api/v2/customers`
 *
 * Retrieves full profile for a single customer.
 *
 * @example
 * const customer = await retrieveCustomer({ businessId, customerId });
 */
export async function retrieveCustomer(body: RetrieveCustomerBody): Promise<Customer> {
  const res = await vagaroClient.post<VagaroEnvelope<Customer>>("/customers", body);
  return unwrap(res);
}

// ─── Delete Customer ──────────────────────────────────────────────────────────

export interface DeleteCustomerBody {
  businessId: string;
}

/**
 * `POST /{region}/api/v2/customers/{customerId}`
 *
 * Permanently deletes a customer from a business location.
 * Required scope: "write access"
 */
export async function deleteCustomer(
  customerId: string,
  body: DeleteCustomerBody,
): Promise<void> {
  await vagaroClient.post(`/customers/${customerId}`, body);
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const customerKeys = {
  all: ["customers"] as const,
  detail: (customerId: string) => [...customerKeys.all, "detail", customerId] as const,
} as const;

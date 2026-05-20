/**
 * serviceService.ts — Vagaro V2 Services
 *
 * Endpoints:
 *   POST /{region}/api/v2/services — Retrieve Services
 */

import { vagaroClient, unwrap, type VagaroEnvelope } from "./vagaroClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServiceProviderPricing {
  serviceProviderId: string;
  price: number;
  priceWithTax: number;
  /** e.g. "USD" */
  currency: string;
  durationMinutes: number;
  pointsGiven: number;
  pointsRedeem: number;
}

export interface Service {
  /** ID of the parent category/group. */
  parentServiceId: string;
  parentServiceTitle: string;
  serviceId: string;
  serviceTitle: string;
  /** Business cost (before provider markup). */
  businessCost: number;
  currency: string;
  isLiveStreamService: boolean;
  isMobileService: boolean;
  cleanUpTimeMinutes: number;
  /** e.g. "ServiceAndPrice" | "ServiceOnly" | "Hidden" */
  showOnlineStatus: string;
  showPriceAsStartingPoint: boolean;
  /** e.g. "Service" | "Package" | "Membership" */
  type: string;
  /** IDs of add-on services that can be booked with this service. */
  addOnIds: string[];
  /** Per-provider pricing and duration — may differ from businessCost. */
  servicePerformedBy: ServiceProviderPricing[];
}

export interface ServicesResponse {
  services: Service[];
  /** URL of the next page, or null when on the last page. */
  nextPage: string | null;
}

// ─── Retrieve Services ────────────────────────────────────────────────────────

export interface RetrieveServicesBody {
  businessId: string;
  /** Supply to retrieve a single service by ID. Omit to list all services. */
  serviceId?: string;
}

export interface RetrieveServicesQuery {
  /** 1-based page number. Default: 1. */
  pageNumber?: number;
  /** Results per page. Default: 20. Max: 100. */
  pageSize?: number;
}

/**
 * `POST /{region}/api/v2/services`
 *
 * Returns all services for a business location, or a single service if
 * `serviceId` is supplied. Paginated.
 *
 * @example
 * // All services:
 * const { services } = await retrieveServices({ businessId });
 *
 * // Single service:
 * const { services } = await retrieveServices({ businessId, serviceId });
 */
export async function retrieveServices(
  body: RetrieveServicesBody,
  query?: RetrieveServicesQuery,
): Promise<ServicesResponse> {
  const res = await vagaroClient.post<VagaroEnvelope<ServicesResponse>>(
    "/services",
    body,
    { params: query },
  );
  return unwrap(res);
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const serviceKeys = {
  all: ["services"] as const,
  lists: () => [...serviceKeys.all, "list"] as const,
  list: (body: RetrieveServicesBody, query?: RetrieveServicesQuery) =>
    [...serviceKeys.lists(), body, query] as const,
} as const;

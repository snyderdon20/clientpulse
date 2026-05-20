/**
 * locationService.ts — Vagaro V2 Business Locations
 *
 * Endpoints:
 *   POST /{region}/api/v2/locations              — Retrieve Business Locations
 *   PUT  /{region}/api/v2/locations/{businessId} — Update Business Location
 */

import { vagaroClient, unwrap, type VagaroEnvelope } from "./vagaroClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BusinessLocation {
  businessId: string;
  businessGroupId: string;
  businessName: string;
  businessAlias: string;
  businessPhone: string;
  businessEmail: string;
  streetAddress: string;
  businessWebsite: string;
  vagaroListingUrl: string;
  city: string;
  /** e.g. "NY" */
  regionCode: string;
  regionName: string;
  /** e.g. "US" */
  countryCode: string;
  countryName: string;
  postalCode: string;
  listedOnVagaro: boolean;
  /** ISO-8601 datetime */
  createdDate: string;
}

export interface LocationsResponse {
  locations: BusinessLocation[];
  /** URL for the next page, or null if on the last page. */
  nextPage: string | null;
}

// ─── Retrieve Locations ───────────────────────────────────────────────────────

export interface RetrieveLocationsBody {
  /** Omit to retrieve all locations; supply to get a specific one. */
  businessId?: string;
}

export interface RetrieveLocationsQuery {
  /** 1-based page number. Default: 1. */
  pageNumber?: number;
  /** Results per page. Default: 25. Max: 100. */
  pageSize?: number;
}

/**
 * `POST /{region}/api/v2/locations`
 *
 * Returns all business locations, or a single location if businessId is supplied.
 * Paginated — use `nextPage` from the response to fetch subsequent pages.
 *
 * @example
 * // All locations:
 * const { locations } = await retrieveLocations();
 *
 * // Single location:
 * const { locations } = await retrieveLocations({ businessId });
 */
export async function retrieveLocations(
  body: RetrieveLocationsBody = {},
  query?: RetrieveLocationsQuery,
): Promise<LocationsResponse> {
  const res = await vagaroClient.post<VagaroEnvelope<LocationsResponse>>(
    "/locations",
    body,
    { params: query },
  );
  return unwrap(res);
}

// ─── Update Location ──────────────────────────────────────────────────────────

export type ServiceLocation = "AtBusiness" | "AtClientsLocation" | "Both";

export interface BusinessHours {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface UpdateLocationBody {
  businessName?: string;
  /** Only effective for multi-location businesses. */
  businessAlias?: string;
  /** 10 digits including country code. */
  businessPhone?: string;
  businessEmail?: string;
  street?: string;
  streetNo?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** e.g. "US" — see https://countrycode.org/ */
  countryCode?: string;
  serviceLocation?: ServiceLocation;
  /** Fully qualified URL, e.g. "https://mysalon.com" */
  businessWebsite?: string;
  /**
   * Path segment of the Vagaro listing URL.
   * e.g. for https://www.vagaro.com/mysalon pass "mysalon"
   */
  vagaroListingUrl?: string;
  listedOnVagaro?: boolean;
  listedOnGoogle?: boolean;
  listedOnAppleMaps?: boolean;
  showContactInformation?: boolean;
  showVagaroConnect?: boolean;
  /** When true, location hours are derived from employee working hours. */
  useEmployeeHours?: boolean;
  /** Omit a day to leave it unchanged. */
  businessHours?: BusinessHours[];
  outCallPrice?: number;
  outCallTime?: number;
  mobileServiceRadius?: number;
  outCallPointRedeem?: number;
}

/**
 * `PUT /{region}/api/v2/locations/{businessId}`
 *
 * Updates information for a specific business location.
 * Send only the fields you want to change.
 * Required scope: "write access"
 */
export async function updateLocation(
  businessId: string,
  body: UpdateLocationBody,
): Promise<void> {
  await vagaroClient.put(`/locations/${businessId}`, body);
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const locationKeys = {
  all: ["locations"] as const,
  lists: () => [...locationKeys.all, "list"] as const,
  list: (query?: RetrieveLocationsQuery) => [...locationKeys.lists(), query] as const,
  detail: (businessId: string) => [...locationKeys.all, "detail", businessId] as const,
} as const;

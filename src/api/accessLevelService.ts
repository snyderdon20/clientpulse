/**
 * accessLevelService.ts — Vagaro V2 Access Levels
 *
 * Endpoints:
 *   GET /{region}/api/v2/merchants/access-levels — Get Access Levels
 */

import { vagaroClient, unwrap, type VagaroEnvelope } from "./vagaroClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccessLevel {
  accessLevelId: string;
  accessLevelName: string;
  isActive: boolean;
}

// ─── Get Access Levels ────────────────────────────────────────────────────────

/**
 * `GET /{region}/api/v2/merchants/access-levels?businessId={businessId}`
 *
 * Returns all access levels defined for a business location.
 * Use `accessLevelId` values when calling Assign Employee.
 * Required scope: "read access"
 *
 * @example
 * const levels = await getAccessLevels(businessId);
 * // [{ accessLevelId: "...", accessLevelName: "Admin", isActive: true }, ...]
 */
export async function getAccessLevels(businessId: string): Promise<AccessLevel[]> {
  const res = await vagaroClient.get<VagaroEnvelope<AccessLevel[]>>(
    "/merchants/access-levels",
    { params: { businessId } },
  );
  return unwrap(res) ?? [];
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const accessLevelKeys = {
  all: ["accessLevels"] as const,
  list: (businessId: string) => [...accessLevelKeys.all, businessId] as const,
} as const;

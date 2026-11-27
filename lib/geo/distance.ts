import type { PlacePosition } from "@/lib/workflow/place-position";

/**
 * Straight-line distance ("fågelvägen") between two WGS 84 positions, in kilometres, with the haversine formula on a
 * sphere of mean radius 6 371,0088 km. It is never a road distance: everything that shows or stores it must say
 * "fågelvägen" (2026-10-08: the straight line may never be an unmarked basis for a car cost).
 */
export const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number) => degrees * Math.PI / 180;

export function haversineKm(from: PlacePosition, to: PlacePosition): number {
  const latitude1 = toRadians(from.latitude);
  const latitude2 = toRadians(to.latitude);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Kilometres rounded for display and for a saved row: one decimal, never negative. */
export const roundKm = (km: number) => Math.max(0, Math.round(km * 10) / 10);

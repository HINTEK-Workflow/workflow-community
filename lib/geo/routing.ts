import type { PlacePosition } from "@/lib/workflow/place-position";
import { haversineKm, roundKm } from "./distance";

/**
 * Distance providers for the car cost (2026-10-08). Only the straight-line provider is active: no road routing
 * service is agreed or hosted (see docs/proposals/korstracka-och-bilkostnad-2026-10-08.md for OSRM, Google, Mapbox and
 * HERE). A result always carries its basis, so a straight line is never shown or saved as a road distance.
 */
export type DistanceBasis = "straight_line" | "road" | "manual";
export type DistanceResult = { km: number; basis: DistanceBasis; providerId: string };
export type RoutingProvider = {
  id: string;
  /** What the person sees beside the distance, e.g. "fågelvägen". */
  label: string;
  basis: Exclude<DistanceBasis, "manual">;
  distanceKm: (from: PlacePosition, to: PlacePosition) => Promise<DistanceResult>;
};

export const straightLineProvider: RoutingProvider = {
  id: "straight_line",
  label: "fågelvägen",
  basis: "straight_line",
  distanceKm: async (from, to) => ({ km: roundKm(haversineKm(from, to)), basis: "straight_line", providerId: "straight_line" }),
};

/** The provider in use. A road provider would be chosen here, by server configuration, once one is agreed. */
export const activeRoutingProvider = (): RoutingProvider => straightLineProvider;

/** True when the installation can give a distance along the road; today never. */
export const roadDistanceAvailable = () => activeRoutingProvider().basis === "road";

export const DISTANCE_BASIS_LABELS: Record<DistanceBasis, string> = {
  straight_line: "fågelvägen",
  road: "längs väg",
  manual: "enligt bilens mätare",
};

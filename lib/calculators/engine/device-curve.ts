/**
 * A protective device's time–current curve as points the company enters (KA4, 2026-11-01). Workflow delivers no curve:
 * the points are the rows of Mina skyddsapparater with the same device type and rated current. Pure and in SI units.
 *
 * The answer is never read outside the entered points. A required time or a current between two points is read in one of two ways:
 *  - `logLog`: a straight line between the points on log–log axes, the way a fuse's melting curve is drawn;
 *  - `safeSide`: the point that is certain, because a curve only falls: for a time, the current of the point with the
 *    shorter time; for a current, the time of the point with the longer time. A miniature breaker's curve has a step between
 *    its thermal and its magnetic part, and a line across that step would give too low a current, so a breaker reads this way.
 */
export type CurvePoint = { timeS: number; tripA: number };
export type CurveMethod = "logLog" | "safeSide";

/** The points by rising time. */
export const sortedCurve = (points: readonly CurvePoint[]): CurvePoint[] => [...points].sort((a, b) => a.timeS - b.timeS);

/** A longer time never needs a larger current. A curve that does not fall was entered wrong and answers nothing. */
export function curveFalls(points: readonly CurvePoint[]): boolean {
  const sorted = sortedCurve(points);
  return sorted.every((point, index) => point.timeS > 0 && point.tripA > 0 && (index === 0 || (point.tripA <= sorted[index - 1]!.tripA && point.timeS > sorted[index - 1]!.timeS)));
}

export type CurveTrip = { tripA: number; how: "point" | "between"; shorter: CurvePoint; longer: CurvePoint };

/** The current that trips the device within the time; null outside the points or on a curve that does not fall. */
export function tripCurrentOnCurve(points: readonly CurvePoint[], timeS: number, method: CurveMethod): CurveTrip | null {
  if (!(timeS > 0) || !curveFalls(points)) return null;
  const sorted = sortedCurve(points);
  const exact = sorted.find((point) => Math.abs(point.timeS - timeS) <= 1e-9 * Math.max(1, timeS));
  if (exact) return { tripA: exact.tripA, how: "point", shorter: exact, longer: exact };
  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index]!;
    const next = sorted[index + 1];
    if (!next || timeS < point.timeS || timeS > next.timeS) continue;
    if (method === "safeSide") return { tripA: point.tripA, how: "between", shorter: point, longer: next };
    const part = Math.log(timeS / point.timeS) / Math.log(next.timeS / point.timeS);
    return { tripA: point.tripA * (next.tripA / point.tripA) ** part, how: "between", shorter: point, longer: next };
  }
  return null;
}

export type CurveTime =
  /** Trips within this time. `atMost`: the current is above the curve's largest point, so the shortest time entered is an upper bound. */
  | { kind: "time"; timeS: number; how: "point" | "between" | "atMost" }
  /** The current is below every point: the curve says nothing about a trip. */
  | { kind: "below"; lowestA: number; longestS: number };

/** How long the device takes at a current; null on a curve that does not fall. */
export function tripTimeOnCurve(points: readonly CurvePoint[], currentA: number, method: CurveMethod): CurveTime | null {
  if (!(currentA > 0) || !curveFalls(points)) return null;
  const sorted = sortedCurve(points);
  const shortest = sorted[0];
  const longest = sorted[sorted.length - 1];
  if (!shortest || !longest) return null;
  if (currentA < longest.tripA) return { kind: "below", lowestA: longest.tripA, longestS: longest.timeS };
  if (currentA > shortest.tripA) return { kind: "time", timeS: shortest.timeS, how: "atMost" };
  // On a flat part the shortest time of equal currents is the one the curve promises.
  const exact = sorted.find((point) => Math.abs(point.tripA - currentA) <= 1e-9 * Math.max(1, currentA));
  if (exact) return { kind: "time", timeS: exact.timeS, how: "point" };
  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index]!;
    const next = sorted[index + 1];
    if (!next || currentA > point.tripA || currentA < next.tripA) continue;
    if (method === "safeSide") return { kind: "time", timeS: next.timeS, how: "between" };
    const part = Math.log(currentA / point.tripA) / Math.log(next.tripA / point.tripA);
    return { kind: "time", timeS: point.timeS * (next.timeS / point.timeS) ** part, how: "between" };
  }
  return null;
}

/**
 * SWEREF 99 TM (EPSG:3006) from and to WGS 84 (2026-10-08, adresshämtning). Lantmäteriet's address API only
 * takes SWEREF 99 coordinates (SRID 3006–3018), while Workflow stores every position as WGS 84 latitude/longitude, so
 * the server converts before asking and when measuring the distance to the address point it gets back.
 *
 * Gauss–Krüger (transverse Mercator) on GRS 80 with the Krüger series, the same formulas Lantmäteriet publishes for the
 * projection: central meridian 15° E, scale 0.9996, false easting 500 000 m, false northing 0. For practical purposes
 * SWEREF 99 and WGS 84 are the same datum (they differ by less than a metre), so no datum shift is applied.
 * Accuracy of the series: well under a millimetre within Sweden.
 */
const A = 6_378_137;
const F = 1 / 298.257_222_101;
const CENTRAL_MERIDIAN = 15;
const SCALE = 0.9996;
const FALSE_EASTING = 500_000;
const FALSE_NORTHING = 0;

const E2 = F * (2 - F);
const N = F / (2 - F);
const A_HAT = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const RAD = Math.PI / 180;

/** Metres: northing (N) and easting (E) in SWEREF 99 TM. */
export type Sweref99Tm = { northing: number; easting: number };

/** WGS 84 latitude/longitude (degrees) to SWEREF 99 TM metres. */
export function toSweref99Tm(latitude: number, longitude: number): Sweref99Tm {
  const phi = latitude * RAD;
  const lambda = (longitude - CENTRAL_MERIDIAN) * RAD;
  // Conformal latitude.
  const aa = E2;
  const bb = (5 * E2 ** 2 - E2 ** 3) / 6;
  const cc = (104 * E2 ** 3 - 45 * E2 ** 4) / 120;
  const dd = (1237 * E2 ** 4) / 1260;
  const sin = Math.sin(phi);
  const phiStar = phi - sin * Math.cos(phi) * (aa + bb * sin ** 2 + cc * sin ** 4 + dd * sin ** 6);
  const xiPrime = Math.atan(Math.tan(phiStar) / Math.cos(lambda));
  const etaPrime = Math.atanh(Math.cos(phiStar) * Math.sin(lambda));
  const b1 = N / 2 - (2 * N ** 2) / 3 + (5 * N ** 3) / 16 + (41 * N ** 4) / 180;
  const b2 = (13 * N ** 2) / 48 - (3 * N ** 3) / 5 + (557 * N ** 4) / 1440;
  const b3 = (61 * N ** 3) / 240 - (103 * N ** 4) / 140;
  const b4 = (49_561 * N ** 4) / 161_280;
  const northing = SCALE * A_HAT * (xiPrime
    + b1 * Math.sin(2 * xiPrime) * Math.cosh(2 * etaPrime)
    + b2 * Math.sin(4 * xiPrime) * Math.cosh(4 * etaPrime)
    + b3 * Math.sin(6 * xiPrime) * Math.cosh(6 * etaPrime)
    + b4 * Math.sin(8 * xiPrime) * Math.cosh(8 * etaPrime)) + FALSE_NORTHING;
  const easting = SCALE * A_HAT * (etaPrime
    + b1 * Math.cos(2 * xiPrime) * Math.sinh(2 * etaPrime)
    + b2 * Math.cos(4 * xiPrime) * Math.sinh(4 * etaPrime)
    + b3 * Math.cos(6 * xiPrime) * Math.sinh(6 * etaPrime)
    + b4 * Math.cos(8 * xiPrime) * Math.sinh(8 * etaPrime)) + FALSE_EASTING;
  return { northing, easting };
}

/** SWEREF 99 TM metres to WGS 84 latitude/longitude (degrees). */
export function fromSweref99Tm({ northing, easting }: Sweref99Tm): { latitude: number; longitude: number } {
  const xi = (northing - FALSE_NORTHING) / (SCALE * A_HAT);
  const eta = (easting - FALSE_EASTING) / (SCALE * A_HAT);
  const d1 = N / 2 - (2 * N ** 2) / 3 + (37 * N ** 3) / 96 - N ** 4 / 360;
  const d2 = N ** 2 / 48 + N ** 3 / 15 - (437 * N ** 4) / 1440;
  const d3 = (17 * N ** 3) / 480 - (37 * N ** 4) / 840;
  const d4 = (4397 * N ** 4) / 161_280;
  const xiPrime = xi
    - d1 * Math.sin(2 * xi) * Math.cosh(2 * eta)
    - d2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
    - d3 * Math.sin(6 * xi) * Math.cosh(6 * eta)
    - d4 * Math.sin(8 * xi) * Math.cosh(8 * eta);
  const etaPrime = eta
    - d1 * Math.cos(2 * xi) * Math.sinh(2 * eta)
    - d2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
    - d3 * Math.cos(6 * xi) * Math.sinh(6 * eta)
    - d4 * Math.cos(8 * xi) * Math.sinh(8 * eta);
  const phiStar = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  const deltaLambda = Math.atan(Math.sinh(etaPrime) / Math.cos(xiPrime));
  const aStar = E2 + E2 ** 2 + E2 ** 3 + E2 ** 4;
  const bStar = -(7 * E2 ** 2 + 17 * E2 ** 3 + 30 * E2 ** 4) / 6;
  const cStar = (224 * E2 ** 3 + 889 * E2 ** 4) / 120;
  const dStar = -(4279 * E2 ** 4) / 1260;
  const sin = Math.sin(phiStar);
  const phi = phiStar + sin * Math.cos(phiStar) * (aStar + bStar * sin ** 2 + cStar * sin ** 4 + dStar * sin ** 6);
  return { latitude: phi / RAD, longitude: CENTRAL_MERIDIAN + deltaLambda / RAD };
}

/** Straight-line distance in metres between two SWEREF 99 TM points (the plane is accurate enough for an address). */
export function sweref99Distance(a: Sweref99Tm, b: Sweref99Tm) {
  return Math.hypot(a.northing - b.northing, a.easting - b.easting);
}

/** "6400000,320000" – northing then easting with a comma, the order Lantmäteriet's address API wants. */
export function sweref99Query(point: Sweref99Tm, decimals = 2) {
  return `${point.northing.toFixed(decimals)},${point.easting.toFixed(decimals)}`;
}

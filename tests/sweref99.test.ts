import assert from "node:assert/strict";
import { test } from "node:test";
import { fromSweref99Tm, sweref99Distance, sweref99Query, toSweref99Tm } from "../lib/geo/sweref99";

// Lantmäteriet's published control points for SWEREF 99 TM (latitude, longitude in degrees → N, E in metres); the
// implementation agrees with every one of them to the millimetre.
const CONTROL: [number, number, number, number][] = [
  [55 + 0 / 60, 12 + 45 / 60, 6_097_106.672, 356_083.438],
  [55 + 0 / 60, 14 + 15 / 60, 6_095_048.642, 452_024.069],
  [57 + 0 / 60, 12 + 45 / 60, 6_319_636.937, 363_331.554],
  [57 + 0 / 60, 19 + 30 / 60, 6_326_392.707, 773_251.054],
  [59 + 0 / 60, 11 + 15 / 60, 6_546_096.724, 284_626.066],
  [59 + 0 / 60, 19 + 30 / 60, 6_548_757.206, 758_410.519],
  [61 + 0 / 60, 12 + 45 / 60, 6_764_877.311, 378_323.440],
];
// Pins across the whole country, for the round trip (Kiruna, Umeå, Östersund, Visby, Malmö).
const AROUND: [number, number][] = [[67.8558, 20.2253], [63.8258, 20.263], [63.1792, 14.6357], [57.6348, 18.2948], [55.605, 13.0038]];

test("WGS 84 to SWEREF 99 TM matches Lantmäteriet's control points to the millimetre", () => {
  for (const [latitude, longitude, northing, easting] of CONTROL) {
    const point = toSweref99Tm(latitude, longitude);
    assert.ok(Math.abs(point.northing - northing) < 0.002, `${latitude},${longitude}: N ${point.northing} vs ${northing}`);
    assert.ok(Math.abs(point.easting - easting) < 0.002, `${latitude},${longitude}: E ${point.easting} vs ${easting}`);
  }
});

test("SWEREF 99 TM back to WGS 84 closes the loop", () => {
  for (const [latitude, longitude, northing, easting] of CONTROL) {
    const back = fromSweref99Tm({ northing, easting });
    assert.ok(Math.abs(back.latitude - latitude) < 1e-8, `lat ${back.latitude} vs ${latitude}`);
    assert.ok(Math.abs(back.longitude - longitude) < 1e-8, `lon ${back.longitude} vs ${longitude}`);
  }
  for (const [latitude, longitude] of AROUND) {
    const back = fromSweref99Tm(toSweref99Tm(latitude, longitude));
    assert.ok(Math.abs(back.latitude - latitude) < 1e-9 && Math.abs(back.longitude - longitude) < 1e-9, `${latitude},${longitude}`);
  }
  // Göteborg, an everyday pin, round-trips to within a tenth of a millimetre.
  const göteborg = toSweref99Tm(57.7089, 11.9746);
  const back = fromSweref99Tm(göteborg);
  assert.ok(Math.abs(back.latitude - 57.7089) < 1e-9 && Math.abs(back.longitude - 11.9746) < 1e-9);
  assert.ok(göteborg.northing > 6_390_000 && göteborg.northing < 6_410_000 && göteborg.easting > 310_000 && göteborg.easting < 330_000, "Göteborg lies where it should");
});

test("distance and the query string", () => {
  assert.equal(sweref99Distance({ northing: 6_400_000, easting: 320_000 }, { northing: 6_400_030, easting: 320_040 }), 50);
  assert.equal(sweref99Query({ northing: 6_400_000.123_4, easting: 320_000.5 }), "6400000.12,320000.50");
});

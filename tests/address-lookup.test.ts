import assert from "node:assert/strict";
import { test } from "node:test";
import { composeAddressLine, EXACT_WITHIN_M, formatPostalCode, judgeProposal, MAX_SUGGESTION_M, parseAddressCollection, QA_ADDRESS, QA_ADDRESS_POINT, qaAddressLookup } from "../lib/geo/address-parse";
import { toSweref99Tm } from "../lib/geo/sweref99";
import { ADDRESS_ATTRIBUTION_TEXT, ADDRESS_SOURCE_NAME } from "../lib/map/attribution";

// A feature as Belägenhetsadress Direkt v4.2 gives it (shape from the published JSON schema), with made-up values.
const feature = (overrides: Record<string, unknown> = {}, point: [number, number] | null = [320_010, 6_400_020]) => ({
  type: "Feature", id: "00000000-0000-0000-0000-000000000001",
  geometry: point ? { type: "Point", coordinates: point } : null,
  properties: {
    objektidentitet: "00000000-0000-0000-0000-000000000001",
    adressplatsattribut: {
      adressplatsbeteckning: { adressplatsnummer: "2", bokstavstillagg: "C" },
      adressplatstyp: "Gatuadressplats", insamlingslage: "Ingång", statusForBelagenhetsadress: "Gällande", objektstatus: "Gällande",
      postnummer: 80182, postort: "Provstad",
    },
    adressomrade: { faststalltNamn: "Provgatan", adressomradestyp: "Gatuadressområde", objektstatus: "Gällande", kommundel: { faststalltNamn: "Provdelen", objektstatus: "Gällande", kommun: { kommunkod: "2180", kommunnamn: "Provkommun" } } },
    ...overrides,
  },
});
const pin = { northing: 6_400_000, easting: 320_000 };

test("the address line is composed only from what Lantmäteriet gives", () => {
  assert.equal(composeAddressLine(feature()), "Provgatan 2C");
  assert.equal(composeAddressLine(feature({ adressplatsattribut: { adressplatsbeteckning: { adressplatsnummer: "12", lagestillagg: "UH", lagestillaggsnummer: 3 } } })), "Provgatan 12 UH3");
  assert.equal(composeAddressLine(feature({ adressplatsattribut: { adressplatsbeteckning: { adressplatsnummer: "1", avvikandeAdressplatsbeteckning: "Lgh 1101", avvikerFranStandarden: true } } })), "Provgatan Lgh 1101");
  // A farm address: area, farm, number.
  assert.equal(composeAddressLine(feature({ adressomrade: undefined, gardsadressomrade: { faststalltNamn: "Provgården", adressomrade: { faststalltNamn: "Provbyn" } }, adressplatsattribut: { adressplatsbeteckning: { adressplatsnummer: "4" } } })), "Provbyn Provgården 4");
  // No area name: no line – the kommun is never used as a stand-in.
  assert.equal(composeAddressLine(feature({ adressomrade: undefined })), "");
});

test("postal codes get their space; the postort is the postort, never the kommun", () => {
  assert.equal(formatPostalCode(80182), "801 82");
  assert.equal(formatPostalCode("801 82"), "801 82");
  assert.equal(formatPostalCode(undefined), "");
  const proposal = parseAddressCollection({ type: "FeatureCollection", features: [feature({ adressplatsattribut: { adressplatsbeteckning: { adressplatsnummer: "2" }, postnummer: 80182 } })] }, pin)!;
  assert.equal(proposal.city, "", "no postort given → empty, not Provkommun");
  assert.equal(proposal.postalCode, "801 82");
  assert.equal(proposal.address, "Provgatan 2");
});

test("the distance to the address point decides exact versus nearby", () => {
  // 10 m east and 20 m north: 22 m – on the address.
  const exact = parseAddressCollection({ features: [feature()] }, pin)!;
  assert.equal(exact.distanceM, 22);
  assert.equal(exact.exact, true);
  assert.equal(exact.source, ADDRESS_SOURCE_NAME);
  assert.ok(exact.point && Math.abs(exact.point.latitude - 57.7) < 0.2 && Math.abs(exact.point.longitude - 12) < 0.2, "the address point comes back as WGS 84");
  // 300 m away: a suggestion from a nearby address point.
  const nearby = parseAddressCollection({ features: [feature({}, [320_300, 6_400_000])] }, pin)!;
  assert.equal(nearby.distanceM, 300);
  assert.equal(nearby.exact, false);
  assert.ok(nearby.distanceM > EXACT_WITHIN_M);
  // Without a geometry nothing can be measured, so it is never called exact.
  const unmeasured = parseAddressCollection({ features: [feature({}, null)] }, pin)!;
  assert.equal(unmeasured.exact, false);
  assert.equal(unmeasured.point, null);
  // Nothing at all.
  assert.equal(parseAddressCollection({ features: [] }, pin), null);
  assert.equal(parseAddressCollection({}, pin), null);
});

test("far-away and missing answers become a plain reason, never a proposal", () => {
  assert.deepEqual(judgeProposal(null), { found: false, reason: "Lantmäteriet har ingen adress för den här punkten." });
  const far = parseAddressCollection({ features: [feature({}, [320_000 + MAX_SUGGESTION_M + 500, 6_400_000])] }, pin)!;
  const judged = judgeProposal(far);
  assert.equal(judged.found, false);
  assert.match((judged as { reason: string }).reason, /km bort/);
  const near = judgeProposal(parseAddressCollection({ features: [feature()] }, pin));
  assert.equal(near.found, true);
});

test("the QA stand-in answers from a fixed point and never from Lantmäteriet", () => {
  const onIt = qaAddressLookup(QA_ADDRESS_POINT.latitude, QA_ADDRESS_POINT.longitude);
  assert.ok(onIt.found && onIt.proposal.exact && onIt.proposal.distanceM === 0);
  assert.ok(onIt.found && onIt.proposal.address === QA_ADDRESS.address && onIt.proposal.city === QA_ADDRESS.city);
  assert.ok(onIt.found && onIt.proposal.source.includes("QA"));
  // About 110 m north: a nearby suggestion.
  const moved = qaAddressLookup(QA_ADDRESS_POINT.latitude + 0.001, QA_ADDRESS_POINT.longitude);
  assert.ok(moved.found && !moved.proposal.exact && moved.proposal.distanceM > 100 && moved.proposal.distanceM < 120);
  // Stockholm: too far for a suggestion.
  assert.equal(qaAddressLookup(59.33, 18.07).found, false);
  // The pin converts to the coordinates Lantmäteriet would be asked with.
  const sweref = toSweref99Tm(QA_ADDRESS_POINT.latitude, QA_ADDRESS_POINT.longitude);
  assert.ok(sweref.northing > 6_390_000 && sweref.easting > 310_000);
});

test("the source statement names the product, Lantmäteriet and the licence", () => {
  assert.match(ADDRESS_ATTRIBUTION_TEXT, /Belägenhetsadress Direkt ©Lantmäteriet, CC BY 4\.0/);
});

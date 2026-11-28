import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { capChangeText, capRefusal, capText, effectiveCap, MACHINE_CAP_DEFAULT, machineCapInput, PLACE_CAP_DEFAULT, placeCapInput } from "../lib/maintenance/caps";
import { PART_LIMIT } from "../lib/maintenance/model";
import { PLACE_LIMIT } from "../lib/maintenance/place-model";

const text = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const plain = (value: string) => value.replace(/\s/g, " ");

// Justerbart tak (0.92.0): today's values are the default; the product owner may set a lower cap per company.
test("maintenance caps: today's values are the default and the ceiling", () => {
  assert.equal(MACHINE_CAP_DEFAULT, PART_LIMIT);
  assert.equal(PLACE_CAP_DEFAULT, PLACE_LIMIT);
  assert.equal(effectiveCap(null, PLACE_CAP_DEFAULT), PLACE_CAP_DEFAULT, "null = the default");
  assert.equal(effectiveCap(undefined, PLACE_CAP_DEFAULT), PLACE_CAP_DEFAULT);
  assert.equal(effectiveCap(25, PLACE_CAP_DEFAULT), 25);
  assert.equal(effectiveCap(0, PLACE_CAP_DEFAULT), PLACE_CAP_DEFAULT, "a broken value never stops everything");
  assert.equal(effectiveCap(PLACE_CAP_DEFAULT + 1, PLACE_CAP_DEFAULT), PLACE_CAP_DEFAULT, "never above the ceiling the lists read");
  assert.equal(effectiveCap(2.5, PLACE_CAP_DEFAULT), PLACE_CAP_DEFAULT);
});

test("maintenance caps: one more may be added below the cap, never at it", () => {
  assert.equal(capRefusal("machine", 9, 10), null);
  assert.match(capRefusal("machine", 10, 10) ?? "", /högst 10 maskiner/);
  assert.match(capRefusal("machine", 12, 10) ?? "", /högst 10 maskiner/, "over a lowered cap: what is there stays, nothing more");
  assert.match(capRefusal("machine", 1, 1) ?? "", /högst 1 maskin /);
  assert.match(plain(capRefusal("place", 2000, PLACE_CAP_DEFAULT) ?? ""), /högst 2 000 platser/);
  assert.match(capRefusal("place", 3, 3) ?? "", /Kontakta installationens administratör/);
});

test("maintenance caps: the product owner's input is 1 up to the default, or empty for the default", () => {
  assert.equal(machineCapInput.safeParse(null).success, true);
  assert.equal(machineCapInput.safeParse(50).success, true);
  assert.equal(machineCapInput.safeParse(0).success, false);
  assert.equal(machineCapInput.safeParse(MACHINE_CAP_DEFAULT + 1).success, false);
  assert.equal(placeCapInput.safeParse(1.5).success, false);
  assert.equal(placeCapInput.safeParse(PLACE_CAP_DEFAULT).success, true);
  assert.equal(plain(capText(null, PLACE_CAP_DEFAULT)), "2 000 (förval)");
  assert.equal(capText(40, PLACE_CAP_DEFAULT), "40");
  assert.equal(capChangeText("machine", null, undefined), "", "left out");
  assert.equal(capChangeText("machine", 40, 40), "", "unchanged");
  assert.equal(capChangeText("place", null, null), "");
  assert.match(plain(capChangeText("machine", null, 40)), /högst 40 maskiner \(förut 5 000 \(förval\)\)/);
});

test("maintenance caps: the server checks the cap where a machine or a place is added, and only the superadmin changes it", () => {
  const server = text("lib/maintenance/server.ts");
  assert.match(server, /capRefusal\("machine"/);
  assert.match(server, /becomesMachine/, "a part made into a machine counts too");
  assert.match(text("lib/maintenance/place-server.ts"), /capRefusal\("place"/);
  const route = text("app/api/superadmin/customer-companies/route.ts");
  assert.match(route, /maintenanceMachineCap: machineCapInput\.optional\(\)/);
  assert.match(route, /if \(ctx\.user\.role !== "SUPERADMIN"\)[\s\S]*?update_company/, "the superadmin only");
  assert.match(text("prisma/migrations/20261128230000_machine_location/migration.sql"), /"maintenanceMachineCap" IS NULL OR "maintenanceMachineCap" BETWEEN 1 AND 5000/);
});

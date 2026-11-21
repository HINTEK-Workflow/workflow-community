import assert from "node:assert/strict";
import test from "node:test";

/**
 * Driftronder i demon (plan 1I, 2026-10-11): the demo plans rounds – Ny rond, Ändra, Ta bort – with the same rules
 * as Cloud (lib/workflow/round-planning.ts), in memory for the session. The protocol a round starts is the editor's own
 * save, so "Starta nu" needs nothing more than the round's address.
 */
test("the demo plans rounds like Cloud: the admin saves, changes and removes; a member without the right is refused", async () => {
  const { handleDemoRequest, setDemoUser } = await import("../features/demo/demo-backend");
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await handleDemoRequest(method, new URL(path, "http://localhost"), body === undefined ? null : JSON.stringify(body));
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  type Round = { id: string; version: number; title: string; templateName: string; facilityName: string; customerName: string; canEdit: boolean; assignedToName: string };
  setDemoUser("demo-elna");
  const before = await call("GET", "/api/form-schedules");
  assert.equal(before.json.canPlan, true, "the admin plans rounds");
  assert.equal(before.json.canPlanOthers, true);
  const seeded = before.json.schedules as Round[];
  assert.ok(seeded.length >= 2, "the demo's invented rounds are still there");
  assert.ok(seeded.every((round) => round.canEdit), "the admin may change every round");
  assert.equal((await call("GET", "/api/form-schedules?canPlan=1")).json.canPlan, true);

  const forms = (await call("GET", "/api/forms")).json.forms as { id: string; name: string }[];
  // The round is the time rules (2026-10-27 kväll): a place an older client sends is not stored – the work order brings it.
  const rule = { frequency: "WEEKLY", interval: 1, weekdays: [2], startDate: "2026-10-01", endDate: "" };
  const draft = { title: "Tisdagsrond pumphuset", templateId: forms[0].id, customerId: "demo-customer-x", facilityId: "demo-facility-x", projectId: null, assignedToUserId: "demo-elon", assignedToName: "", active: true, rule, reminders: { bell: true, email: false } };
  const created = await call("POST", "/api/form-schedules", { action: "save", schedule: draft });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const id = created.json.id as string;
  const after = (await call("GET", "/api/form-schedules")).json.schedules as (Round & { holder: unknown; legacyPlace?: unknown; facilityId?: unknown })[];
  const saved = after.find((round) => round.id === id)!;
  assert.ok(saved, "the new round is listed");
  assert.equal(saved.templateName, forms[0].name);
  assert.equal(saved.assignedToName, "Elon Relässon");
  assert.equal(saved.version, 1);
  assert.deepEqual([saved.holder, saved.legacyPlace ?? null, saved.facilityId], [null, null, undefined], "no place of its own, and no work order holds it yet");
  // The invented rounds: the standby round is held by its work order at Ställverket; the garage round has only its old place.
  const standby = after.find((round) => round.id === "demo-schedule-reservkraft") as unknown as { holder: { facilityName: string } | null };
  assert.ok(standby.holder?.facilityName, "the place of its work order");
  const garage = after.find((round) => round.id === "demo-schedule-skyddsrond") as unknown as { holder: unknown; legacyPlace: { facilityId: string } | null };
  assert.equal(garage.holder, null);
  assert.ok(garage.legacyPlace?.facilityId, "its old place is kept as the suggestion");

  // Ändra: the version guards against a stale form, as in Cloud.
  const stale = await call("POST", "/api/form-schedules", { action: "save", schedule: { ...draft, id, version: 7, title: "Fel version" } });
  assert.equal(stale.status, 409);
  const changed = await call("POST", "/api/form-schedules", { action: "save", schedule: { ...draft, id, version: 1, title: "Onsdagsrond pumphuset" } });
  assert.equal(changed.status, 200);
  const renamed = ((await call("GET", "/api/form-schedules")).json.schedules as Round[]).find((round) => round.id === id)!;
  assert.equal(renamed.title, "Onsdagsrond pumphuset");
  assert.equal(renamed.version, 2);
  // Validation as in Cloud: an unknown form or member is refused.
  assert.equal((await call("POST", "/api/form-schedules", { action: "save", schedule: { ...draft, templateId: "no-such-form" } })).status, 400);
  assert.equal((await call("POST", "/api/form-schedules", { action: "save", schedule: { ...draft, assignedToUserId: "nobody" } })).status, 400);

  // A member who reads and reports but may not create protocols cannot plan; she still reads the rounds, without Ändra.
  setDemoUser("demo-elin");
  const member = await call("GET", "/api/form-schedules");
  assert.equal(member.json.canPlan, false);
  assert.equal((await call("GET", "/api/form-schedules?canPlan=1")).json.canPlan, false);
  assert.ok((member.json.schedules as Round[]).every((round) => !round.canEdit));
  assert.equal((await call("POST", "/api/form-schedules", { action: "save", schedule: { ...draft, title: "Elins rond" } })).status, 403);
  assert.equal((await call("POST", "/api/form-schedules", { action: "delete", id })).status, 403);

  // Ta bort by the admin; a round that is gone gives 404.
  setDemoUser("demo-elna");
  assert.equal((await call("POST", "/api/form-schedules", { action: "delete", id })).status, 200);
  assert.ok(!((await call("GET", "/api/form-schedules")).json.schedules as Round[]).some((round) => round.id === id));
  assert.equal((await call("POST", "/api/form-schedules", { action: "delete", id })).status, 404);
});

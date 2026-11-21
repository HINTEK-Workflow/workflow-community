import assert from "node:assert/strict";
import test from "node:test";
import { canPlanRounds, roundChangeRefusal, roundPlanRefusal } from "../lib/workflow/round-planning";
import type { WorkflowPermissionProfile } from "../lib/workflow/permissions";

// Driftronder planeras efter samma rättigheter som bokningar (2026-10-10, kartläggningen 5.11; förut bara admin).
const profile = (...grants: string[]) => ({ version: 1 as const, grants: grants as WorkflowPermissionProfile["grants"] });
const member = (...grants: string[]) => ({ admin: false, userId: "me", permissions: profile(...grants) });
const round = (patch: Partial<Parameters<typeof roundPlanRefusal>[1]> = {}) => ({ formArea: "forms", projectId: null, assignedToUserId: null, ...patch });

test("the right to create the form's protocols plans one's own rounds and rounds without a responsible person", () => {
  const worker = member("forms:read", "forms:create");
  assert.equal(roundPlanRefusal(worker, round()), null);
  assert.equal(roundPlanRefusal(worker, round({ assignedToUserId: "me" })), null);
  assert.match(roundPlanRefusal(member("forms:read"), round()) ?? "", /skapa protokoll av det här formuläret/);
  // The form's area decides: a control form needs the control right.
  assert.notEqual(roundPlanRefusal(worker, round({ formArea: "kfid" })), null);
  assert.equal(roundPlanRefusal(member("kfid:read", "kfid:create"), round({ formArea: "kfid" })), null);
  assert.equal(canPlanRounds(false, worker.permissions), true);
  assert.equal(canPlanRounds(false, profile("forms:read", "projects:read", "projects:create")), false);
  assert.equal(canPlanRounds(true, profile()), true);
});

test("others' rounds: an admin, or in a project its responsible person or stand-in", () => {
  const worker = member("forms:read", "forms:create", "projects:read", "projects:edit");
  assert.match(roundPlanRefusal(worker, round({ assignedToUserId: "anna" })) ?? "", /bara av en företagsadministratör/);
  assert.match(roundPlanRefusal(worker, round({ assignedToUserId: "anna", projectId: "p", project: { responsibleUserId: "someone" } })) ?? "", /projektansvarig/);
  assert.equal(roundPlanRefusal(worker, round({ assignedToUserId: "anna", projectId: "p", project: { responsibleUserId: "me" } })), null);
  assert.equal(roundPlanRefusal(worker, round({ assignedToUserId: "anna", projectId: "p", project: { planningDelegateUserId: "me" } })), null);
  assert.equal(roundPlanRefusal({ admin: true, userId: "boss", permissions: profile() }, round({ assignedToUserId: "anna", formArea: "kfid" })), null);
});

test("a project's round needs the project right; a change is checked before and after", () => {
  assert.match(roundPlanRefusal(member("forms:read", "forms:create"), round({ projectId: "p", project: { responsibleUserId: "me" } })) ?? "", /ändra projekt/);
  const worker = member("forms:read", "forms:create");
  // Taking over someone else's round is refused even if the new state would be one's own.
  assert.notEqual(roundChangeRefusal(worker, round({ assignedToUserId: "anna" }), round({ assignedToUserId: "me" })), null);
  assert.equal(roundChangeRefusal(worker, round({ assignedToUserId: "me" }), round()), null);
  assert.equal(roundChangeRefusal(worker, null, round()), null);
  assert.notEqual(roundChangeRefusal(worker, null, round({ assignedToUserId: "anna" })), null);
});

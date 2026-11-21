import assert from "node:assert/strict";
import test from "node:test";
import { grantForClaimedCode, type ClaimedCode } from "../lib/oauth/code-grant";

// Security hardening step 2: a membership removed between the approval and the token exchange gives invalid_grant
// (null here), never a 500 from the database's membership trigger.
const code: ClaimedCode = { id: "code-1", clientId: "client-1", organizationId: "org-a", userId: "user-a", scopes: ["mcp:read"], resource: "http://localhost/api/mcp" };

function fakeDb(options: { members: Array<{ id: string } | null>; triggerRefuses?: boolean; otherFailure?: boolean }) {
  const calls = { grants: 0, codeUpdates: 0, memberChecks: [] as unknown[] };
  const members = [...options.members];
  const tx = {
    oAuthGrant: { create: async ({ data }: { data: Record<string, unknown> }) => {
      if (options.triggerRefuses) throw Object.assign(new Error("Personen är inte medlem i organisationen."), { code: "P2010" });
      if (options.otherFailure) throw new Error("connection lost");
      calls.grants += 1;
      return { id: "grant-1", ...data };
    } },
    oAuthAuthorizationCode: { update: async () => { calls.codeUpdates += 1; return {}; } },
  };
  const db = {
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    organizationMember: { findFirst: async (args: unknown) => { calls.memberChecks.push(args); return members.shift() ?? null; } },
  };
  return { db: db as never, calls };
}

test("an active member gets the connection and the code is bound to it", async () => {
  const { db, calls } = fakeDb({ members: [{ id: "m" }] });
  const grant = await grantForClaimedCode(db, code);
  assert.equal(grant?.id, "grant-1");
  assert.equal(calls.grants, 1);
  assert.equal(calls.codeUpdates, 1);
  assert.deepEqual(calls.memberChecks[0], { where: { organizationId: "org-a", userId: "user-a", isActive: true }, select: { id: true } });
});

test("a person no longer (actively) a member gets no connection and nothing is written", async () => {
  const { db, calls } = fakeDb({ members: [null] });
  assert.equal(await grantForClaimedCode(db, code), null);
  assert.equal(calls.grants, 0);
  assert.equal(calls.codeUpdates, 0);
});

test("a membership removed between the check and the insert: the trigger's refusal becomes null", async () => {
  const { db, calls } = fakeDb({ members: [{ id: "m" }, null], triggerRefuses: true });
  assert.equal(await grantForClaimedCode(db, code), null);
  assert.equal(calls.memberChecks.length, 2);
  assert.deepEqual(calls.memberChecks[1], { where: { organizationId: "org-a", userId: "user-a" }, select: { id: true } }, "the second check asks for any membership");
});

test("any other failure while the person is still a member is not hidden", async () => {
  const { db } = fakeDb({ members: [{ id: "m" }, { id: "m" }], otherFailure: true });
  await assert.rejects(grantForClaimedCode(db, code), /connection lost/);
});

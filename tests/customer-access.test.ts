// Kundväljaren utan Kunder (2026-10-24): the register's own notes are blanked for a member without Kunder.
import assert from "node:assert/strict";
import test from "node:test";
import { customerForMember, mayReadCustomerRegister } from "../lib/kfid/customer-access";

const row = { id: "c1", name: "Kalle", address: "Gatan 1", email: "k@example.invalid", notes: "Betalar sent", specialRequirements: "Nyckel", accountingCustomerNumber: "K-17" };
const member = (grants: string[]) => ({ admin: false, workflowPermissions: { version: 1 as const, grants } as never });

test("without Kunder the notes, the special requirements and the customer number are blank", () => {
  const seen = customerForMember(member(["work-order:read"]), row);
  assert.deepEqual(seen, { ...row, notes: "", specialRequirements: "", accountingCustomerNumber: "" });
  assert.equal(row.notes, "Betalar sent", "the row itself is not changed");
});

test("with Kunder or as administrator the customer is unchanged", () => {
  assert.equal(customerForMember(member(["customers:read"]), row), row);
  assert.equal(customerForMember({ admin: true, workflowPermissions: { version: 1, grants: [] } as never }, row), row);
  assert.equal(mayReadCustomerRegister(member([])), false);
});

test("a field that is not there is not added", () => {
  assert.deepEqual(customerForMember(member([]), { id: "c2", name: "Bo" }), { id: "c2", name: "Bo" });
});

test("the card leaves out the withheld rows instead of showing an empty Särskilda krav (2026-10-24)", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/customer-card/route.ts", "utf8");
  const card = readFileSync("features/kfid/customer-card.tsx", "utf8");
  assert.ok(route.includes("registerNotes: mayReadCustomerRegister(ctx)"), "the card is told whether the notes are withheld");
  assert.ok(card.includes("{data.registerNotes === false ? null : <div className=\"sm:col-span-2\"><dt className=\"text-xs text-muted-foreground\">Särskilda krav</dt>"), "no Särskilda krav row when withheld");
  assert.ok(card.includes(".filter(([label]) => data.registerNotes !== false || (label !== \"Kundnummer i bokföringen\" && label !== \"Anteckningar\"))"), "no Anteckningar or customer number row when withheld");
});

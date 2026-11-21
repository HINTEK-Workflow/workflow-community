// Webbplatskartans öppna fynd (2026-10-24): the menu, Sök and the old addresses follow the same rights as the pages and the
// server, and the customer register's list answers a member without Kunder only with the picker's fields.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { menuItemAllowed, resolveMenu } from "../lib/workflow/menu-items";
import { canReadRounds, type WorkflowPermissionProfile } from "../lib/workflow/permissions";
import { SEARCH_COMMANDS, type SearchAccess } from "../lib/search/commands";
import { oldFacilitiesTarget } from "../lib/workflow/old-addresses";
import { pickerAnswer, pickerCustomer, pickerMatches, readsCustomerRegister } from "../lib/kfid/customer-picker-fields";

const profile = (...grants: string[]) => ({ version: 1, grants }) as unknown as WorkflowPermissionProfile;
const member = (...grants: string[]) => ({ memberRole: "MEMBER" as const, workflowPermissions: profile(...grants) });

test("Driftronder in the menu only for someone who may read a form's area – the server's own rule", () => {
  // The QA member: work orders only. Before: Driftronder in the menu, the page the permission box.
  const workOrders = member("work-order:read", "work-order:create");
  assert.equal(menuItemAllowed("rounds", workOrders), false);
  assert.equal(canReadRounds(false, workOrders.workflowPermissions), false);
  assert.ok(!resolveMenu(workOrders, { hidden: [], shortcuts: [] }).flat().some((entry) => entry.key === "rounds"));
  // Arbetsordrar and Tid stay: they are not rounds.
  assert.equal(menuItemAllowed("work_orders", workOrders), true);
  assert.equal(menuItemAllowed("time", workOrders), true);
  for (const area of ["forms", "kfid", "risk-assessment"]) {
    assert.equal(menuItemAllowed("rounds", member(`${area}:read`)), true, area);
    assert.equal(canReadRounds(false, profile(`${area}:read`)), true, area);
  }
  assert.equal(menuItemAllowed("rounds", { memberRole: "ADMIN", workflowPermissions: profile() }), true);
  assert.equal(canReadRounds(true, profile()), true);
});

test("Sök offers Driftronder and Ny driftrond by the same rule", () => {
  const access = (...grants: string[]): SearchAccess => ({
    admin: false, superadmin: false, local: false, canBuildForms: false,
    can: (subject, action) => grants.includes(`${subject}:${action}`),
    features: { credits: false, billing: false, ai: false, integrations: false, landingEditor: false, import: false },
  });
  const shown = (id: string, a: SearchAccess) => SEARCH_COMMANDS.find((command) => command.id === id)!.shown(a);
  assert.equal(shown("rounds", access("work-order:read")), false);
  assert.equal(shown("new_round", access("work-order:read", "work-order:create")), false);
  assert.equal(shown("rounds", access("forms:read")), true);
  assert.equal(shown("new_round", access("forms:read")), false, "planning a round needs the right to create its protocols");
  assert.equal(shown("new_round", access("kfid:read", "kfid:create")), true);
  assert.equal(shown("new_round", access("kfid:create")), false, "Ny driftrond opens the rounds page, so it needs reading too");
});

test("the rounds page shows the permission box exactly when the menu hides Driftronder (webbplatskartan 2026-10-25)", () => {
  // The QA member could read and plan forms but none of the company's rounds: the menu offered the page, the page was the box.
  const route = readFileSync(new URL("../app/api/form-schedules/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(!canReadRounds\(ctx\.admin, ctx\.workflowPermissions\)\) return NextResponse\.json\(\{ canRead: false, canPlan: false/);
  assert.match(route, /canRead: true, canPlan: canPlanRounds/);
  const page = readFileSync(new URL("../features/workflow/form-rounds.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(data\?\.canRead === false\) return native \? <NativePage testId="form-rounds"><NoRoundsAccess native \/><\/NativePage> : <NoRoundsAccess \/>;/);
  assert.doesNotMatch(page, /data\?\.hidden && !schedules\.length\) return/, "hidden rounds alone are not the permission box");
});

test("the old address ?view=facilities leads the admin to Företaget and anyone else to Översikt", () => {
  assert.equal(oldFacilitiesTarget("OWNER", null), "/?view=company");
  assert.equal(oldFacilitiesTarget("ADMIN", null), "/?view=company");
  assert.equal(oldFacilitiesTarget("MEMBER", null), "/?view=stats");
  assert.equal(oldFacilitiesTarget(null, null), "/?view=stats");
  assert.equal(oldFacilitiesTarget("OWNER", "member"), "/?view=stats", "the superadmin previewing a member meets what a member meets");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(view === "facilities"\) redirect\(oldFacilitiesTarget\(activeMemberRole, viewAs\)\)/);
});

test("without Kunder the register's list answers with the picker's fields only", () => {
  assert.equal(readsCustomerRegister({ admin: false, workflowPermissions: profile("work-order:read") }), false);
  assert.equal(readsCustomerRegister({ admin: false, workflowPermissions: profile("customers:read") }), true);
  assert.equal(readsCustomerRegister({ admin: true, workflowPermissions: profile() }), true);
  const row = {
    id: "c1", name: "Kalle Ström", company: "Ström AB", address: "Gatan 1", postalCode: "12345", city: "Elstad", email: "k@example.invalid",
    phone: "070", mobile: "", lat: null, lng: null, customerType: "COMPANY", version: 3, deletedAt: null, organizationId: "o1",
    notes: "Betalar sent", specialRequirements: "Nyckel hos grannen", accountingCustomerNumber: "K-17", createdAt: "x", updatedAt: "y", ownCompany: false,
    work: { projects: 2, workOrders: 5, riskAssessments: 1 },
  };
  const seen = pickerCustomer(row);
  assert.deepEqual(Object.keys(seen).sort(), ["accountingCustomerNumber", "address", "city", "company", "customerType", "deletedAt", "email", "id", "lat", "lng", "mobile", "name", "notes", "ownCompany", "phone", "postalCode", "specialRequirements", "version"].sort());
  assert.equal(seen.notes, "");
  assert.equal(seen.specialRequirements, "");
  assert.equal(seen.accountingCustomerNumber, "");
  assert.equal("work" in seen, false, "no counts of the customer's work");
  assert.equal("organizationId" in seen, false);
  // A search never matches on the notes, so it cannot probe them; no total counts such a match either.
  assert.equal(pickerMatches(row, "betalar"), false);
  assert.equal(pickerMatches(row, "STRÖM"), true);
  assert.equal(pickerMatches(row, ""), true);
  const many = Array.from({ length: 30 }, (_, index) => ({ ...row, id: `c${index}` }));
  const answer = pickerAnswer({ items: [{ ...row, id: "hidden", name: "Bo", company: "", notes: "nyckel" }, ...many], limit: 100 }, "ström");
  assert.equal(answer.items.length, 20);
  assert.deepEqual({ total: answer.total, page: answer.page, pages: answer.pages, limit: answer.limit }, { total: 20, page: 1, pages: 1, limit: 20 });
  assert.equal(pickerAnswer({ items: [{ ...row, name: "Bo", company: "", notes: "nyckel" }], limit: 25 }, "nyckel").total, 0);
});

test("the register's API and page check Kunder on the server and in the workspace", () => {
  const route = readFileSync(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(readsCustomerRegister\(ctx\)\) return NextResponse\.json\(await listRecords\(ctx, query\)\);/);
  assert.match(route, /pickerAnswer\(/);
  const workspace = readFileSync(new URL("../features/kfid/workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /view === "customers" && !customerId && overview && user && !localMode && !shownAdmin && !hasWorkflowPermission\([^)]*\), "customers", "read"\)\)\s*\n\s*content = <NoPermissionBox page \/>/);
});

test("the timeline's day labels and Egenkontroll's section links pass axe (webbplatskartan 2026-10-24)", () => {
  for (const file of ["../features/workflow/project-schedule.tsx", "../features/workflow/project-portfolio.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /cell\.off && "text-muted-foreground\/60"/, file);
  }
  const document = readFileSync(new URL("../features/self-inspection/document-view.tsx", import.meta.url), "utf8");
  assert.match(document, /className="mr-2 inline-flex min-h-6 items-center text-left text-primary/);
});

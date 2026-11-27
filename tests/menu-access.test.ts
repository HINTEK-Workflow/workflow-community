import assert from "node:assert/strict";
import test from "node:test";
import { MENU_HIDEABLE, calendarAllowed, menuButtonHref, menuItemAllowed, menuItemHref } from "../lib/workflow/menu-items";
import { noWorkflowPermissionProfile, workflowPermissionPresets, type WorkflowPermissionProfile } from "../lib/workflow/permissions";

const preset = (id: string): WorkflowPermissionProfile => ({ version: 1, grants: [...workflowPermissionPresets.find((item) => item.id === id)!.profile.grants] });

test("the menu and Visa i menyn offer only what the person may do (proposal 2026-10-08, step 4)", () => {
  const none = { memberRole: "MEMBER" as const, workflowPermissions: noWorkflowPermissionProfile() };
  // Ingen åtkomst: only what every active member has: Avvikelser, Egenkontroll, Instrument, Kalkylator and Nyheter (2026-11-21).
  assert.deepEqual(MENU_HIDEABLE.filter((key) => menuItemAllowed(key, none)), ["deviations", "self_inspection", "instruments", "calculators", "news"]);
  assert.equal(menuItemAllowed("news", { ...none, localStorageMode: true }), false, "Nyheter needs the server");
  // Kundregister follows the customers permission (decision 2.2).
  const reader = { memberRole: "MEMBER" as const, workflowPermissions: preset("report") };
  assert.equal(menuItemAllowed("customers", reader), true);
  assert.equal(menuItemAllowed("customers", { ...reader, workflowPermissions: { version: 1, grants: reader.workflowPermissions.grants.filter((grant) => !grant.startsWith("customers:")) } }), false);
  // An admin has everything the installation has; Skapa formulär, Workflow AI and Import only where they exist.
  const admin = { memberRole: "ADMIN" as const, workflowPermissions: noWorkflowPermissionProfile() };
  for (const key of ["planning", "work_orders", "projects", "rounds", "time", "report_archive", "customers"] as const) assert.equal(menuItemAllowed(key, admin), true, key);
  assert.equal(menuItemAllowed("forms", admin), false);
  assert.equal(menuItemAllowed("forms", { ...admin, canBuildForms: true }), true);
  assert.equal(menuItemAllowed("import", { ...admin, importPage: true }), true);
  assert.equal(menuItemAllowed("import", { ...admin, importPage: true, localStorageMode: true }), false);
  // A member sees Import only with the right to create something it imports (N11).
  const member = (...grants: string[]) => ({ memberRole: "MEMBER" as const, importPage: true, workflowPermissions: { version: 1 as const, grants: grants as WorkflowPermissionProfile["grants"] } });
  assert.equal(menuItemAllowed("import", member()), false);
  assert.equal(menuItemAllowed("import", member("customers:read", "work-order:read")), false);
  for (const grant of ["customers:create", "projects:create", "work-order:create", "catalogue:edit"]) assert.equal(menuItemAllowed("import", member(grant)), true, grant);
  assert.equal(menuItemAllowed("report_archive", { ...admin, localStorageMode: true }), false);
  assert.equal(menuItemAllowed("ai", admin), false);
  // Signed out: nothing.
  assert.equal(menuItemAllowed("self_inspection", null), false);
});

test("Tidrapport and Kalender follow the server's rules for time and bookings (kartläggningen 5.11, 2026-10-10)", () => {
  const only = (...grants: string[]) => ({ memberRole: "MEMBER" as const, workflowPermissions: { version: 1 as const, grants: grants as WorkflowPermissionProfile["grants"] } });
  // Time can be written on a standalone protocol, so the right to a protocol's area alone shows Tidrapport.
  for (const grants of [["kfid:read"], ["forms:read"], ["work-order:read"], ["risk-assessment:read"]]) assert.equal(menuItemAllowed("time", only(...grants)), true, grants.join());
  assert.equal(menuItemAllowed("time", only("projects:read")), false, "a project right alone writes no time");
  assert.equal(menuItemAllowed("time", only("customers:read")), false);
  // A standalone job's bookings follow the job: a job right shows Kalender, as does the project right, and with it the menu
  // button Planering (2026-11-01). The special case that Projekt led a job right alone to Kalender is gone.
  assert.equal(calendarAllowed(only("forms:read")), true);
  assert.equal(calendarAllowed(only("projects:read")), true);
  assert.equal(calendarAllowed(only("customers:read")), false);
  assert.equal(calendarAllowed(null), false);
  assert.equal(menuItemAllowed("planning", only("forms:read")), true, "a job right alone has Planering");
  assert.equal(menuItemAllowed("planning", only("projects:read")), true);
  assert.equal(menuItemAllowed("planning", only("customers:read")), false);
  assert.equal(menuItemAllowed("projects", only("forms:read")), false, "a job right alone has no Projekt");
  assert.equal(menuItemHref("projects", false), "/?view=new_project");
  // Uppgifter is a tab of Arbetsordrar (2026-11-01): the rights do not change, the button leads to what the person has.
  assert.equal(menuItemAllowed("work_orders", only("forms:read")), true, "whoever reads only tasks still has the button");
  assert.equal(menuItemAllowed("work_orders", only("kfid:create")), true, "whoever only creates tasks still has the button");
  assert.equal(menuItemAllowed("work_orders", only("work-order:read")), true);
  assert.equal(menuItemAllowed("work_orders", only("projects:read")), false);
  const tasksOnly = { work_orders: false, tasks: true };
  assert.equal(menuButtonHref("work_orders", tasksOnly, { work_orders: false }), "/?view=tasks");
  assert.equal(menuButtonHref("work_orders", { work_orders: false, tasks: false }, { work_orders: false }), "/?view=new_task");
  assert.equal(menuButtonHref("work_orders", { work_orders: false, tasks: false }, { work_orders: true }), "/?view=workflow_task&taskType=WORK_ORDER");
  assert.equal(menuButtonHref("work_orders", { work_orders: true, tasks: true }), "/?view=work_orders");
  assert.equal(menuButtonHref("quotes", { quotes: false }), "/?view=quote");
  assert.equal(menuItemAllowed("projects", only("customers:read")), false);
});

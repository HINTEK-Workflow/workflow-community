import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALWAYS_ON_SELF_INSPECTION_ACTIONS, applyModuleChanges, enabledModules, MODULE_DEFINITIONS, MODULE_EFFECTS, MODULE_KEYS, MODULE_OF_COMMAND, MODULE_OF_MENU_ITEM, MODULE_OF_SEARCH_TYPE, MODULE_PACKAGES, MODULE_REQUIRES,
  moduleChangeDetail, moduleInList, moduleOfPage, moduleOfView, moduleOffNotice, moduleOffText, moduleOn, moduleOnWhere, modulePackageChanges, MODULES_OUTSIDE_PACKAGES, NEW_COMPANY_DISABLED_MODULES, normalizeDisabledModules, organizationModuleOn, selfInspectionActionNeedsModule, type ModuleKey,
} from "../lib/workflow/modules";
import { calendarAllowed, MENU_HIDEABLE, menuButtonHref, menuItemAllowed, menuItemLabel, projectPageAllowed, resolveMenu, type MenuAccess, type MenuHideable } from "../lib/workflow/menu-items";
import { nativeLayoutAllowed } from "../lib/workflow/native-layout";
import { activitiesInUse } from "../lib/workflow/capacity-summary";
import { defaultWorkflowPermissionProfile, workflowPermissionPresets } from "../lib/workflow/permissions";
import { canSeePrices } from "../lib/workflow/material-prices";
import { overviewTabs } from "../lib/overview/tabs";
import { teamTabAccess } from "../lib/overview/team-model";
import { customersTabAccess } from "../lib/overview/customers-model";
import { economyAccess } from "../lib/overview/economy-model";
import { commandCandidates, SEARCH_COMMANDS, type SearchAccess } from "../lib/search/commands";
import { parseSearchQuery } from "../lib/search/query";
import { searchSpecs } from "../lib/search/sql";
import { SEARCH_TYPES } from "../lib/search/types";
import { selfInspectionActionSchema } from "../lib/self-inspection/model";
import { setupStartLinks } from "../lib/setup-guide";
import { WORK_AREAS } from "../lib/workflow/work-profile";

// Företagets moduler (0.39.0): the pure rules. tests/modules-guard.test.ts reads the routes; tests/company-modules.integration.ts runs them.
const off = (...keys: ModuleKey[]) => enabledModules(keys);
const admin = (modules?: readonly string[] | null): MenuAccess => ({ memberRole: "ADMIN", workflowPermissions: defaultWorkflowPermissionProfile(), ai: true, importPage: true, canBuildForms: true, modules });
const field = () => workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;

// ---------- what is stored ----------

test("an empty list is everything on, so a company that never chose is unaffected", () => {
  assert.deepEqual(enabledModules([]), [...MODULE_KEYS]);
  assert.deepEqual(enabledModules(undefined), [...MODULE_KEYS]);
  assert.deepEqual(enabledModules(null), [...MODULE_KEYS]);
  for (const key of MODULE_KEYS) {
    assert.equal(moduleOn([], key), true);
    assert.equal(moduleInList(undefined, key), true, "the demo has no list and everything on");
    assert.equal(organizationModuleOn(null, key), true);
    assert.equal(organizationModuleOn({}, key), true);
  }
  assert.deepEqual(normalizeDisabledModules([]), []);
});

test("a stored list is read safely: unknown keys go, each key once, in a fixed order", () => {
  assert.deepEqual(normalizeDisabledModules(["rounds", "okänd", "rounds", 7, null]), ["rounds"]);
  assert.deepEqual(normalizeDisabledModules("rounds"), []);
  assert.deepEqual(normalizeDisabledModules(["upkeep", "rounds"]), ["rounds", "upkeep"]);
});

// ---------- the dependency matrix ----------

test("the hard dependencies are these three and no others", () => {
  assert.deepEqual(MODULE_REQUIRES, { staff_register: ["projects"], quotes: ["customers"], invoicing: ["customers"] });
});

test("the matrix: every module off alone takes exactly what needs it, and nothing else", () => {
  const expected: Record<ModuleKey, ModuleKey[]> = {
    customers: ["customers", "quotes", "invoicing"], projects: ["projects", "staff_register"], planning: ["planning"], rounds: ["rounds"], upkeep: ["upkeep"], time: ["time"],
    quotes: ["quotes"], invoicing: ["invoicing"], purchasing: ["purchasing"], staff_register: ["staff_register"], self_inspection: ["self_inspection"], boards: ["boards"], web_posts: ["web_posts"], news: ["news"],
  };
  for (const key of MODULE_KEYS) {
    const change = applyModuleChanges([], { [key]: false });
    assert.deepEqual([...change.turnedOff].sort(), [...expected[key]].sort(), key);
    assert.deepEqual(change.turnedOn, []);
    assert.deepEqual([...change.disabled].sort(), [...expected[key]].sort(), key);
  }
});

test("the matrix: every module on again brings what it needs, and nothing else", () => {
  const everythingOff = [...MODULE_KEYS];
  const expected: Partial<Record<ModuleKey, ModuleKey[]>> = { staff_register: ["staff_register", "projects"], quotes: ["quotes", "customers"], invoicing: ["invoicing", "customers"] };
  for (const key of MODULE_KEYS) {
    const change = applyModuleChanges(everythingOff, { [key]: true });
    assert.deepEqual([...change.turnedOn].sort(), [...(expected[key] ?? [key])].sort(), key);
    assert.deepEqual(change.turnedOff, []);
  }
});

test("off and on again gives back exactly what it was; asking for what already is changes nothing", () => {
  for (const key of MODULE_KEYS) {
    const down = applyModuleChanges([], { [key]: false });
    const up = applyModuleChanges(down.disabled, Object.fromEntries(down.turnedOff.map((item) => [item, true])));
    assert.deepEqual(up.disabled, [], key);
    const again = applyModuleChanges(down.disabled, { [key]: false });
    assert.deepEqual(again.turnedOff, [], key);
    assert.deepEqual(again.turnedOn, [], key);
  }
});

test("a choice that asks for both: on wins, because the admin asked for that module to work", () => {
  const change = applyModuleChanges([], { quotes: true, customers: false });
  assert.equal(moduleOn(change.disabled, "customers"), true);
  assert.equal(moduleOn(change.disabled, "quotes"), true);
});

test("no change, whatever the start, leaves a module on without what it needs (every pair)", () => {
  const holds = (disabled: readonly string[]) => MODULE_KEYS.every((key) => !moduleOn(disabled, key) || (MODULE_REQUIRES[key] ?? []).every((needed) => moduleOn(disabled, needed)));
  for (const first of MODULE_KEYS) for (const second of MODULE_KEYS) for (const on of [true, false]) {
    assert.ok(holds(applyModuleChanges([first], { [second]: on }).disabled), `${first} off, ${second} ${on}`);
  }
});

test("every module says what happens, has a name, a line and a way to its history", () => {
  assert.deepEqual(MODULE_DEFINITIONS.map((item) => item.key).sort(), [...MODULE_KEYS].sort());
  for (const definition of MODULE_DEFINITIONS) {
    assert.ok(definition.title && definition.short, definition.key);
    assert.ok(definition.historyHref, `${definition.key}: the history can be reached`);
    assert.ok(MODULE_EFFECTS[definition.key].length >= 1, `${definition.key}: says what happens`);
    assert.match(moduleOffText(definition.key), /avstängd|avstängt/);
    assert.match(moduleOffText(definition.key), /Arbetssätt/, "says where to turn it on");
    assert.match(moduleOffNotice(definition.key), /läsa/, "says the history can be read");
  }
});

test("Personalliggare says that the Kontrollvy and the export always work", () => {
  assert.match(moduleOffText("staff_register"), /Kontrollvyn och exporten går alltid att nå/);
  assert.match(MODULE_DEFINITIONS.find((item) => item.key === "staff_register")!.short, /Kontrollvyn och exporten/);
});

test("Underhåll is not the feature key `maintenance`, which is Objektdata på platser", () => {
  assert.equal((MODULE_KEYS as readonly string[]).includes("maintenance"), false);
  assert.equal(MODULE_OF_MENU_ITEM.maintenance, "upkeep", "the menu's Underhåll is the module");
});

test("the audit line says what went off and what went on", () => {
  assert.equal(moduleChangeDetail(applyModuleChanges([], { customers: false })), "Moduler av: Kunder, Offerter, Fakturaunderlag.");
  assert.equal(moduleChangeDetail(applyModuleChanges(["rounds"], { rounds: true })), "Moduler på: Driftronder.");
  assert.equal(moduleChangeDetail(applyModuleChanges([], {})), "");
});

test("a background job's filter names the module", () => {
  assert.deepEqual(moduleOnWhere("rounds"), { NOT: { disabledModules: { has: "rounds" } } });
});

// ---------- packages per line of business ----------

test("nothing chosen proposes nothing, so skipping the step leaves everything on", () => {
  assert.equal(modulePackageChanges([]), null);
});

test("every combination of what the company works with gives a package whose dependencies hold", () => {
  for (let mask = 1; mask < 2 ** WORK_AREAS.length; mask += 1) {
    const areas = WORK_AREAS.filter((_, index) => mask & (1 << index));
    const changes = modulePackageChanges(areas)!;
    assert.equal(Object.keys(changes).length, MODULE_KEYS.length - MODULES_OUTSIDE_PACKAGES.length, "says on or off for every module a line of business decides");
    const { disabled } = applyModuleChanges([], changes);
    for (const key of MODULE_KEYS.filter((item) => !MODULES_OUTSIDE_PACKAGES.includes(item))) {
      // What the package proposes is what comes out: the dependency rule never has to change the proposal, so the admin sees the truth.
      assert.equal(moduleOn(disabled, key), changes[key], `${areas.join("+")}: ${key}`);
    }
  }
});

test("the packages by line of business, and the sum for a company with several", () => {
  assert.deepEqual([...MODULE_PACKAGES.industry].sort(), ["boards", "planning", "purchasing", "rounds", "time", "upkeep"]);
  // Tavlor och skärmar belongs to no line of business: it is in every package (2026-11-18).
  for (const area of Object.keys(MODULE_PACKAGES) as (keyof typeof MODULE_PACKAGES)[]) assert.ok(MODULE_PACKAGES[area].includes("boards"), area);
  assert.equal(modulePackageChanges(["industry"])!.customers, false, "an industrial company works without a customer register");
  assert.equal(modulePackageChanges(["electric"])!.upkeep, false);
  assert.equal(modulePackageChanges(["electric"])!.staff_register, true);
  const both = modulePackageChanges(["electric", "industry"])!;
  assert.equal(both.upkeep, true, "the sum of what is used");
  assert.equal(both.staff_register, true);
  assert.equal(both.customers, true);
});

test("Webb och inlägg (2026-11-20): off for a new company, outside every package, so a package never turns it on or off", () => {
  assert.deepEqual([...NEW_COMPANY_DISABLED_MODULES], ["web_posts"]);
  assert.deepEqual([...MODULES_OUTSIDE_PACKAGES], ["web_posts", "news"]);
  for (const area of WORK_AREAS) {
    assert.equal(MODULE_PACKAGES[area].includes("web_posts"), false, area);
    assert.equal("web_posts" in modulePackageChanges([area])!, false, `${area}: the package leaves it as it is`);
  }
  const used = applyModuleChanges([], modulePackageChanges(["electric"])!);
  assert.equal(moduleOn(used.disabled, "web_posts"), true, "a company that has it on keeps it after a package");
  const fresh = applyModuleChanges([...NEW_COMPANY_DISABLED_MODULES], modulePackageChanges(["office"])!);
  assert.equal(moduleOn(fresh.disabled, "web_posts"), false, "a new company keeps it off after a package");
  for (const view of ["company_posts", "company_website", "web_posts"]) assert.equal(moduleOfView(view), "web_posts", view);
  assert.equal(moduleOfPage("advanced", "web"), "web_posts", "Webb och sociala medier under Kopplingar");
  assert.equal(menuItemAllowed("web_posts", admin(null)), true);
  assert.equal(menuItemAllowed("web_posts", admin(off("web_posts"))), false);
  assert.equal(menuItemAllowed("web_posts", { ...admin(null), memberRole: "MEMBER" }), false, "the company's admin only");
  assert.equal(menuItemAllowed("web_posts", { ...admin(null), localStorageMode: true }), false, "not in a company with its data in a file");
  assert.equal(menuItemAllowed("web_posts", { ...admin(null), demo: true }), false, "not in the demo");
});

test("Nyheter (2026-11-21): on from the start, outside every package, for every member where the server keeps the data", () => {
  assert.equal(NEW_COMPANY_DISABLED_MODULES.includes("news"), false, "on for a new company");
  for (const area of WORK_AREAS) {
    assert.equal(MODULE_PACKAGES[area].includes("news"), false, area);
    assert.equal("news" in modulePackageChanges([area])!, false, `${area}: the package leaves it as it is`);
  }
  assert.equal(moduleOfView("news"), "news");
  assert.equal(menuItemAllowed("news", admin(null)), true);
  assert.equal(menuItemAllowed("news", admin(off("news"))), false);
  assert.equal(menuItemAllowed("news", { memberRole: "MEMBER", workflowPermissions: { version: 1, grants: [] } }), true, "every member reads the news");
  assert.equal(menuItemAllowed("news", { ...admin(null), localStorageMode: true }), false, "not in a company with its data in a file");
  assert.equal(menuItemAllowed("news", { ...admin(null), demo: true }), true, "the demo has invented posts");
});

// ---------- modules and permissions stay apart: the isolation matrix ----------

test("a module off is off for everyone: no right, not even an admin's, brings the button back", () => {
  for (const [item, key] of Object.entries(MODULE_OF_MENU_ITEM)) {
    const button = item as MenuHideable;
    assert.equal(menuItemAllowed(button, admin(off(key))), false, `${button} with ${key} off`);
  }
});

test("a module on gives no right: a member without the right gets nothing from it", () => {
  const nothing: MenuAccess = { memberRole: "MEMBER", workflowPermissions: { version: 1, grants: [] }, modules: enabledModules([]) };
  for (const button of ["customers", "projects", "quotes", "purchases", "maintenance", "time", "planning", "rounds"] as const) {
    assert.equal(menuItemAllowed(button, nothing), false, button);
  }
});

test("turning one module off takes only that module's button; the always-on parts stay in every state", () => {
  const always: MenuHideable[] = ["work_orders", "deviations", "report_archive", "instruments", "calculators", "administration"];
  for (const key of MODULE_KEYS) {
    const access = admin(off(key));
    for (const button of always) assert.equal(menuItemAllowed(button, access), true, `${button} with ${key} off`);
    for (const button of MENU_HIDEABLE) {
      const owner = MODULE_OF_MENU_ITEM[button];
      if (owner && owner !== key) assert.equal(menuItemAllowed(button, access), menuItemAllowed(button, admin(null)), `${button} with ${key} off`);
    }
  }
  const allOff = admin([]);
  for (const button of always) assert.equal(menuItemAllowed(button, allOff), true, `${button} with everything off`);
});

test("without a list the menu is exactly what it was", () => {
  for (const button of MENU_HIDEABLE) assert.equal(menuItemAllowed(button, admin(undefined)), menuItemAllowed(button, admin(enabledModules([]))), button);
});

test("Fakturaunderlag shares Offerter's button: it stays while either is on, and leads and is named right", () => {
  assert.equal(menuItemAllowed("quotes", admin(off("quotes"))), true);
  assert.equal(menuItemAllowed("quotes", admin(off("invoicing"))), true);
  assert.equal(menuItemAllowed("quotes", admin(off("quotes", "invoicing"))), false);
  assert.equal(menuButtonHref("quotes", {}, {}, off("quotes")), "/?view=invoice_bases");
  assert.equal(menuItemLabel("quotes", off("quotes")), "Fakturaunderlag");
  assert.equal(menuButtonHref("quotes", {}, {}, off("invoicing")), "/?view=quotes");
  assert.equal(menuItemLabel("quotes", off("invoicing")), "Offerter");
  assert.equal(menuItemLabel("quotes"), "Offerter");
});

test("Planering's pages: Kalender needs Planering; Tidplan also needs Projekt; Projektstatistik needs Projekt", () => {
  assert.equal(calendarAllowed(admin(off("planning"))), false);
  assert.equal(calendarAllowed(admin(off("projects"))), true, "the calendar works without projects");
  assert.equal(projectPageAllowed("project_planning", admin(off("projects"))), false);
  assert.equal(projectPageAllowed("project_planning", admin(off("planning"))), false);
  assert.equal(projectPageAllowed("project_summary", admin(off("planning"))), true);
  assert.equal(projectPageAllowed("project_summary", admin(off("projects"))), false);
});

test("the menu never lifts a yrkesprofil's button past a module that is off", () => {
  const groups = resolveMenu(admin(off("upkeep")), { hidden: [], shortcuts: [] }, null, ["maintenance", "work_orders"]);
  const keys = groups.flat().map((entry) => entry.key);
  assert.equal(keys.includes("maintenance"), false);
  assert.equal(keys[0], "work_orders");
});

test("a module off is not shown even as the open page's button, so a direct link never brings it into the menu", () => {
  const keys = resolveMenu(admin(off("quotes", "invoicing")), { hidden: [], shortcuts: [] }, "quotes").flat().map((entry) => entry.key);
  assert.equal(keys.includes("quotes"), false);
});

test("Hem's tiles and the tab bar follow, by the menu's own rule", () => {
  const all = nativeLayoutAllowed(admin(enabledModules([])));
  for (const [key, tile] of [["rounds", "rounds"], ["upkeep", "maintenance"], ["time", "time"], ["planning", "planning"], ["time", "absence"], ["staff_register", "checkin"]] as const) {
    assert.ok(all.allowedHome.includes(tile), `${tile} with everything on`);
    assert.equal(nativeLayoutAllowed(admin(off(key))).allowedHome.includes(tile), false, `${tile} with ${key} off`);
  }
  for (const [key, tab] of [["rounds", "rounds"], ["upkeep", "maintenance"], ["time", "time"], ["planning", "planning"], ["projects", "projects"], ["customers", "customers"]] as const) {
    assert.ok(all.allowedTabs.includes(tab), `${tab} with everything on`);
    assert.equal(nativeLayoutAllowed(admin(off(key))).allowedTabs.includes(tab), false, `${tab} with ${key} off`);
  }
  const bare = nativeLayoutAllowed(admin([]));
  assert.ok(bare.allowedHome.includes("jobs") && bare.allowedTabs.includes("home") && bare.allowedTabs.includes("new"), "Hem, jobs and Ny always stay: Ny holds Avvikelse");
});

test("a page of a module that is off says so; always-on pages never do", () => {
  assert.equal(moduleOfView("quotes"), "quotes");
  assert.equal(moduleOfView("invoice_bases"), "invoicing");
  assert.equal(moduleOfView("maintenance"), "upkeep");
  for (const view of ["stats", "tasks", "work_orders", "workflow_task", "deviations", "instruments", "administration", "company_features", "report_archive"]) assert.equal(moduleOfView(view), null, view);
  assert.equal(moduleOfView("place"), null, "a place may be the company's own");
});

// ---------- search ----------

test("Sök leaves out a module's records and pages; only those of that module", () => {
  const parsed = parseSearchQuery("test sak");
  const access = { organizationId: "org", userId: "me", admin: true, workflowPermissions: defaultWorkflowPermissionProfile() };
  const everything = searchSpecs(access, parsed).map((spec) => spec.type as string);
  for (const [type, key] of Object.entries(MODULE_OF_SEARCH_TYPE)) {
    assert.ok((SEARCH_TYPES as readonly string[]).includes(type), type);
    assert.ok(everything.includes(type), `${type} is searched with everything on`);
    const without = searchSpecs({ ...access, disabledModules: [key] }, parsed).map((spec) => spec.type as string);
    assert.equal(without.includes(type), false, `${type} with ${key} off`);
    assert.equal(without.length, everything.length - everything.filter((item) => MODULE_OF_SEARCH_TYPE[item] === key).length);
  }
  const bare = searchSpecs({ ...access, disabledModules: [...MODULE_KEYS] }, parsed).map((spec) => spec.type as string);
  for (const type of ["task", "report", "deviation", "place"]) assert.ok(bare.includes(type), `${type} is always searched`);
});

test("Sök's pages: every page that belongs to a module exists, and goes when the module does", () => {
  const can = () => true;
  const access: SearchAccess = { admin: true, superadmin: false, local: false, canBuildForms: true, can, features: { credits: true, billing: true, ai: true, integrations: true, landingEditor: true, import: true } };
  const ids = SEARCH_COMMANDS.map((command) => command.id);
  for (const id of Object.keys(MODULE_OF_COMMAND)) assert.ok(ids.includes(id), `${id} is a page in Sök`);
  const shown = (modules?: readonly string[]) => commandCandidates({ ...access, modules }).map((hit) => hit.id);
  assert.deepEqual(shown(enabledModules([])), shown(undefined), "everything on is as before");
  for (const [id, key] of Object.entries(MODULE_OF_COMMAND)) assert.equal(shown(off(key)).includes(id), false, `${id} with ${key} off`);
  for (const id of ["deviations", "new_deviation", "instruments", "company_features", "quote_settings"]) assert.ok(shown([]).includes(id), `${id} stays with everything off`);
});

// ---------- summaries, and prices ----------

const viewer = { admin: true, workflowPermissions: defaultWorkflowPermissionProfile() };

test("Översiktens tabs: Kunder needs Kunder, Ekonomi needs Offerter or Fakturaunderlag; Jag and Teamet stay", () => {
  const tabs = (...keys: ModuleKey[]) => overviewTabs({ ...viewer, organization: { disabledModules: keys } });
  assert.deepEqual(overviewTabs(viewer), { me: true, team: true, economy: true, customers: true });
  assert.deepEqual(tabs(), { me: true, team: true, economy: true, customers: true });
  assert.equal(tabs("customers").customers, false);
  assert.equal(tabs("quotes").economy, true);
  assert.equal(tabs("invoicing").economy, true);
  assert.equal(tabs("quotes", "invoicing").economy, false);
  const bare = overviewTabs({ ...viewer, organization: { disabledModules: [...MODULE_KEYS] } });
  assert.equal(bare.me && bare.team, true, "Översikt is always on");
});

test("Teamet stops counting what is off, and a right alone never shows it", () => {
  const access = (...keys: ModuleKey[]) => teamTabAccess({ ...viewer, organization: { disabledModules: keys } });
  assert.equal(access().projects, true);
  assert.equal(access("projects").projects, false);
  assert.equal(access("quotes").quotes, false);
  assert.equal(access("rounds").rounds, false);
  assert.equal(access("projects", "quotes", "rounds").workOrders, true, "work orders are always on");
  assert.equal(access("projects", "quotes", "rounds").deviationsCompany, true, "the deviation log is always on");
});

test("Kunder and Ekonomi on Översikten follow the modules; each part still needs its right", () => {
  const customers = (...keys: ModuleKey[]) => customersTabAccess({ ...viewer, organization: { disabledModules: keys } });
  assert.equal(customers("customers").customers, false);
  assert.equal(customers("quotes").quotes, true, "Fakturaunderlag still needs the figures");
  assert.equal(customers("quotes", "invoicing").quotes, false);
  const economy = (...keys: ModuleKey[]) => economyAccess({ ...viewer, organization: { disabledModules: keys } });
  assert.equal(economy("quotes").readQuotes, false);
  assert.equal(economy("invoicing").readBases, false);
  assert.equal(economy("invoicing").createBases, false);
  const member = { admin: false, workflowPermissions: { version: 1 as const, grants: [] } };
  assert.equal(customersTabAccess(member).customers, false, "a module on gives no right");
  assert.equal(economyAccess(member).readQuotes, false);
});

test("prices follow their own right, never a module", () => {
  const permissions = defaultWorkflowPermissionProfile();
  assert.equal(canSeePrices({ admin: false, permissions }), true);
  assert.equal(canSeePrices.length, 1, "takes only the person");
  for (const key of MODULE_KEYS) assert.equal(economyAccess({ admin: true, workflowPermissions: permissions, organization: { disabledModules: [key] } }).prices, true, key);
  assert.equal(economyAccess({ admin: true, workflowPermissions: permissions, organization: { disabledModules: [...MODULE_KEYS] } }).prices, true);
});

test("a booking on a project is no load while Projekt is off; a booking on a job counts; nothing is removed from the list given", () => {
  const rows = [{ id: "p", projectId: "x" }, { id: "j", projectId: null }];
  assert.deepEqual(activitiesInUse(rows, { disabledModules: [] }).map((row) => row.id), ["p", "j"]);
  assert.deepEqual(activitiesInUse(rows, null).map((row) => row.id), ["p", "j"]);
  assert.deepEqual(activitiesInUse(rows, { disabledModules: ["projects"] }).map((row) => row.id), ["j"]);
  assert.equal(rows.length, 2);
});

// ---------- always-on parts on a module's route ----------

test("the deviation log and the instruments stay open on /api/self-inspection; all else there is the programme", () => {
  const actions = selfInspectionActionSchema.options.map((option) => String(option.shape.action.value));
  for (const action of ALWAYS_ON_SELF_INSPECTION_ACTIONS) {
    assert.ok(actions.includes(action), `${action} is an action of the route`);
    assert.equal(selfInspectionActionNeedsModule(action), false, action);
  }
  const gated = actions.filter(selfInspectionActionNeedsModule);
  assert.ok(gated.includes("approve") && gated.includes("save_role") && gated.includes("confirm_read") && gated.includes("save_competence_card") && gated.includes("set_assignment"));
  assert.equal(gated.some((action) => /deviation|instrument/.test(action)), false, "no deviation or instrument action is stopped");
});

test("the guide's first steps leave out a module that is off", () => {
  assert.deepEqual(setupStartLinks(false).map((link) => link.href), setupStartLinks(false, enabledModules([])).map((link) => link.href));
  assert.equal(setupStartLinks(false, off("projects")).some((link) => link.href === "/?view=new_project"), false);
  assert.equal(setupStartLinks(true, off("customers")).some((link) => link.href === "/?view=customers"), false);
  assert.ok(setupStartLinks(false, []).some((link) => link.href === "/?view=new_task"), "the jobs are always there");
});

test("a member's preset is not changed by what the company has on", () => {
  // The permission layer knows nothing of modules: the same profile before and after.
  const profile = field();
  const before = JSON.stringify(profile);
  menuItemAllowed("time", { memberRole: "MEMBER", workflowPermissions: profile, modules: off("time") });
  assert.equal(JSON.stringify(profile), before);
});

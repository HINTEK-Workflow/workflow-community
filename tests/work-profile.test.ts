import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { menuChoicesFor, menuChoicesPatch, mergePreferences, preferencesSchema } from "../lib/kfid/preferences";
import { overviewStartTab, overviewTabs, isOverviewTab } from "../lib/overview/tabs";
import { MENU_HIDEABLE, menuItemAllowed, resolveMenu, type MenuAccess } from "../lib/workflow/menu-items";
import { activeTab, ABSENCE_HREF, DEFAULT_HOME_TILES, HOME_TILE, HOME_TILE_KEYS, MAX_TABS, nativeLayoutAllowed, normalizeNativeLayout, TAB, TAB_KEYS, TEAM_HREF } from "../lib/workflow/native-layout";
import { nativeMoreSections, nativeMoreTiles, nativeMoreTools } from "../lib/workflow/native-mode";
import { nativeNewChoices, orderNewChoices } from "../lib/workflow/new-choices";
import { hasWorkflowPermission, noWorkflowPermissionProfile, normalizeWorkflowPermissionProfile, workflowPermissionPresets, workflowPermissionProfileSchema } from "../lib/workflow/permissions";
import { MODULE_PACKAGES } from "../lib/workflow/modules";
import { setupStartLinks, setupStepsFor } from "../lib/setup-guide";
import { readWorkView, WORK_VIEW_LABEL, withWorkView } from "../lib/workflow/work-view";
import {
  currentWorkProfile, effectiveMenuChoices, effectiveNativeLayout, effectiveWorkProfile, effectiveWorkView, findWorkProfileTitles, isWorkProfile, keepWorkAreas, NO_ADMIN_WORK_CHOICES, nextWorkProfileSetting, normalizeWorkAreas, ownWorkProfileChoice, ownWorkProfileShown,
  profileNativeLayout, profileRightsStep, readWorkProfile, RESET_CHOICE_BASIS, RETIRED_WORK_PROFILE, FIELD_GRANTS, READ_GRANTS, OFFICE_GRANTS, MAINTENANCE_GRANTS, suggestedRights, WORK_AREAS, WORK_PROFILE, WORK_PROFILES, workProfileFirstSteps, workProfileGroups, workProfileMenuFirst, workProfileNewFirst, workProfileStartTab, workProfileTucked, withWorkProfile,
  type AdminWorkChoices,
} from "../lib/workflow/work-profile";

const NOW = new Date("2026-11-01T10:00:00.000Z");
const LATER = new Date("2026-11-02T10:00:00.000Z");
const stored = (data: unknown = {}) => preferencesSchema.parse(data);
const adminChose = (profile: (typeof WORK_PROFILES)[number]): AdminWorkChoices => ({ view: null, profile: { profile, setAt: NOW.toISOString() } });
const member = (grants: string[] = []): MenuAccess => ({ memberRole: "MEMBER", workflowPermissions: workflowPermissionProfileSchema.parse({ version: 1, grants }) });
const owner: MenuAccess = { memberRole: "OWNER", workflowPermissions: noWorkflowPermissionProfile() };

test("the table: one row per kind of work under seven groups, neutral work views, and no admin among them", () => {
  assert.equal(WORK_PROFILES.length, 19);
  assert.equal(new Set(WORK_PROFILES).size, WORK_PROFILES.length, "every key once");
  const groups = workProfileGroups();
  assert.deepEqual(groups.map((group) => group.label), ["El och service", "Elkraft och elnät", "Automation", "Industri och underhåll", "Fastighet och drift", "Projekt och arbetsledning", "Kontor och administration"]);
  assert.deepEqual(groups.map((group) => group.profiles.length > 0), groups.map(() => true), "every group has a profile");
  assert.deepEqual(groups.flatMap((group) => group.profiles).sort(), [...WORK_PROFILES].sort(), "every profile is offered once");
  // One title per row: never "A / B", and no two rows with the same title.
  const labels = WORK_PROFILES.map((profile) => WORK_PROFILE[profile].label);
  assert.ok(labels.every((label) => !label.includes("/") && !/ (eller|samt) /.test(label)));
  assert.equal(new Set(labels).size, labels.length, "no title twice");
  assert.ok(!labels.some((label) => /^(företags)?admin$/i.test(label)), "Företagsadmin is a role, not a profile");
  assert.deepEqual(WORK_VIEW_LABEL, { fitter: "Utförande", lead: "Ledande", supervisor: "Arbetsledning" });
});

test("every row is different: no two rows share their defaults", () => {
  const defaults = (profile: (typeof WORK_PROFILES)[number]) => { const { workView, menuFirst, menuHidden, home, tabs, startTab, newFirst, firstSteps } = WORK_PROFILE[profile]; return JSON.stringify({ workView, menuFirst, menuHidden, home, tabs, startTab, newFirst, firstSteps }); };
  const seen = new Map<string, string>();
  for (const profile of WORK_PROFILES) {
    assert.equal(seen.get(defaults(profile)), undefined, `${profile} has the same defaults as ${seen.get(defaults(profile))}`);
    seen.set(defaults(profile), profile);
  }
  for (const profile of WORK_PROFILES) assert.ok(WORK_PROFILE[profile].menuFirst.length === 3 && WORK_PROFILE[profile].firstSteps.length === 3 && WORK_PROFILE[profile].newFirst.length >= 2, profile);
});

// The 49 rows of 2026-11-02 and the row each is read as now.
const OLD_ROWS: Readonly<Record<string, readonly [string, (typeof WORK_PROFILES)[number]]>> = {
  electrician: ["Elektriker", "electrician"], installation_electrician: ["Installationselektriker", "electrician"], service_electrician: ["Serviceelektriker", "service_electrician"], solar_fitter: ["Solcellsmontör", "electrician"], fitter: ["Montör", "electrician"], lead_electrician: ["Ledande montör", "lead_electrician"],
  distribution_electrician: ["Distributionselektriker", "grid_fitter"], grid_fitter: ["Montör, elnät", "grid_fitter"], line_fitter: ["Linjemontör", "grid_fitter"], cable_fitter: ["Kabelmontör", "grid_fitter"], station_technician: ["Stationstekniker", "grid_fitter"], power_technician: ["Elkrafttekniker", "power_technician"], power_engineer: ["Elkraftsingenjör", "project_manager"], operations_engineer: ["Driftingenjör", "work_lead"], grid_operations_technician: ["Drifttekniker, elnät", "property_operations_technician"], grid_planner: ["Beredare", "designer"],
  automation_electrician: ["Automationselektriker", "automation_technician"], automation_technician: ["Automationstekniker", "automation_technician"], automation_engineer: ["Automationsingenjör", "maintenance_lead"], control_technician: ["Styr- och reglertekniker", "automation_technician"], instrument_technician: ["Instrumenttekniker", "automation_technician"],
  maintenance_technician: ["Underhållstekniker", "maintenance_technician"], maintenance_mechanic: ["Underhållsmekaniker", "maintenance_technician"], industrial_electrician: ["Industrielektriker", "maintenance_electrician"], operations_electrician: ["Driftelektriker", "maintenance_electrician"], maintenance_electrician: ["Underhållselektriker", "maintenance_electrician"], repairer: ["Reparatör", "maintenance_technician"], operator: ["Operatör", "operator"],
  caretaker: ["Vaktmästare", "caretaker"], property_technician: ["Fastighetstekniker", "caretaker"], property_caretaker: ["Fastighetsskötare", "caretaker"], property_operations_technician: ["Drifttekniker, fastighet", "property_operations_technician"], hvac_fitter: ["VVS-montör", "service_electrician"], refrigeration_technician: ["Kyltekniker", "service_electrician"],
  project_manager: ["Projektledare", "project_manager"], work_lead: ["Arbetsledare", "work_lead"], maintenance_lead: ["Underhållsledare", "maintenance_lead"], site_manager: ["Platschef", "project_manager"], designer: ["Projektör", "designer"], electrical_designer: ["Elkonstruktör", "designer"], estimator: ["Kalkylator", "estimator"],
  finance_assistant: ["Ekonomiassistent", "administrator"], purchaser: ["Inköpare", "purchaser"],
  blue_collar: ["Kollektivanställd", "electrician"], white_collar: ["Tjänsteman", "administrator"], administrator: ["Administratör", "administrator"], engineer: ["Ingenjör", "designer"], technician: ["Tekniker", "electrician"], it: ["IT", "it"],
};

test("a stored key always reads as a profile: every old row maps to its replacement, with nothing rewritten", () => {
  assert.equal(Object.keys(OLD_ROWS).length, 49, "the whole list of 2026-11-02");
  for (const [key, [, replacement]] of Object.entries(OLD_ROWS)) {
    assert.equal(readWorkProfile({ workProfile: { profile: key, setAt: "x" } })?.profile, replacement, `${key} in the member's record`);
    assert.equal(stored({ ownWorkProfile: { profile: key, setAt: "x", basis: "|" } }).ownWorkProfile?.profile, replacement, `${key} as the person's own choice`);
    assert.equal(currentWorkProfile(key), replacement);
  }
  assert.equal(readWorkProfile({ workProfile: { profile: "office", setAt: "x" } })?.profile, "administrator", "Kontor, retired 2026-11-03");
  for (const replacement of Object.values(RETIRED_WORK_PROFILE)) assert.ok(isWorkProfile(replacement), `${replacement} is a row`);
  for (const key of Object.keys(RETIRED_WORK_PROFILE)) assert.ok(!isWorkProfile(key), `${key} cannot be chosen again`);
  // The stamp stays: what the person saved under the old key still counts.
  const setAt = NOW.toISOString();
  const read = readWorkProfile({ workProfile: { profile: "operations_electrician", setAt } })!;
  const inForce = effectiveWorkProfile({ view: null, profile: read }, null);
  assert.equal(inForce.stamp, setAt);
  const saved = mergePreferences({}, { ...menuChoicesPatch("desktop", { hiddenMenuItems: ["time"], menuShortcuts: [] }, setAt) });
  assert.deepEqual(effectiveMenuChoices(inForce, saved).hiddenMenuItems, ["time"]);
  // The admin's API takes an old key from a page opened before the merge.
  assert.match(readFileSync("app/api/administration/route.ts", "utf8"), /z\.preprocess\(currentWorkProfile, z\.enum\(WORK_PROFILES\)/);
  assert.equal(readWorkProfile({ workProfile: { profile: "chef", setAt: "x" } })?.profile, null, "an unknown key is still no profile");
});

test("every old title is findable, and finds the row it maps to", () => {
  for (const [key, [title, replacement]] of Object.entries(OLD_ROWS)) {
    const hit = findWorkProfileTitles(title).find((item) => item.title === title);
    assert.equal(hit?.profile, replacement, `${title} (${key})`);
  }
  // The names asked for by name.
  assert.equal(WORK_PROFILE.power_technician.label, "Elkrafttekniker");
  assert.equal(WORK_PROFILE.grid_fitter.label, "Montör, elnät");
  assert.equal(WORK_PROFILE.maintenance_electrician.label, "Underhållselektriker");
  assert.deepEqual(findWorkProfileTitles("driftel"), [{ profile: "maintenance_electrician", title: "Driftelektriker" }]);
  assert.deepEqual(findWorkProfileTitles("SOLCELL"), [{ profile: "electrician", title: "Solcellsmontör" }]);
  assert.deepEqual(findWorkProfileTitles("k"), [], "two letters are needed");
  assert.equal(findWorkProfileTitles("drifttekniker")[0].profile, "property_operations_technician");
  assert.ok(findWorkProfileTitles("montör").length <= 6, "a short list");
  assert.ok(findWorkProfileTitles("montör")[0].title.toLowerCase().startsWith("montör"), "what starts with the search comes first");
});

test("the existing keys still resolve, under the titles the trades use", () => {
  for (const key of ["electrician", "lead_electrician", "project_manager", "work_lead", "caretaker", "maintenance_technician", "administrator"] as const) assert.ok(isWorkProfile(key), key);
  assert.equal(WORK_PROFILE.lead_electrician.label, "Ledande montör", "the term of Installationsavtalet; 'ledande elektriker' is not in use");
  assert.equal(WORK_PROFILE.caretaker.label, "Vaktmästare");
  assert.equal(WORK_PROFILE.work_lead.label, "Arbetsledare");
  assert.equal(WORK_PROFILE.maintenance_lead.label, "Underhållsledare");
  assert.equal(readWorkProfile({ workProfile: { profile: "lead_electrician", setAt: "x" } })?.profile, "lead_electrician", "a stored key reads as before");
  assert.equal(stored({ ownWorkProfile: { profile: "designer", setAt: "x", basis: "|" } }).ownWorkProfile?.profile, "designer", "a key passes the preferences schema");
  // The electrical safety roles are functions in the work, not profiles.
  assert.ok(!WORK_PROFILES.some((profile) => /driftledare|säkerhetsledare|kopplings/i.test(WORK_PROFILE[profile].label)));
});

test("no profile suggests more than the admin preset it builds on, and what stands first is allowed by what it suggests", () => {
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile.grants as readonly string[];
  const read = workflowPermissionPresets.find((preset) => preset.id === "report")!.profile.grants as readonly string[];
  const office = WORK_PROFILE.administrator.grants as readonly string[];
  const ceilings: readonly (readonly string[])[] = [
    field, read, office,
    [...field, "maintenance:read", "maintenance:edit"],
    [...field, "team:read", "projects:archive"],
    [...field, "team:read", "maintenance:read", "maintenance:edit"],
  ];
  const today = new Set([...field, ...read, ...office, "team:read", "projects:archive", "maintenance:read", "maintenance:edit"]);
  for (const profile of WORK_PROFILES) {
    const definition = WORK_PROFILE[profile];
    assert.ok(ceilings.some((ceiling) => definition.grants.every((grant) => ceiling.includes(grant))), `${profile}: within one of the presets`);
    assert.ok(definition.grants.every((grant) => today.has(grant)), `${profile}: nothing beyond the 2026-11-01 profiles`);
    if (definition.workView === "fitter") assert.ok(!definition.grants.includes("team:read"), `${profile}: Teamet is for whoever leads`);
    const access: MenuAccess = { ...member([...definition.grants]), importPage: true, canBuildForms: false };
    for (const key of definition.menuFirst) assert.ok(menuItemAllowed(key, access), `${profile}: ${key} must be allowed by what the profile suggests`);
    const layout = nativeLayoutAllowed(access);
    for (const key of definition.home) assert.ok(layout.allowedHome.includes(key), `${profile}: Hem ${key}`);
    for (const key of definition.tabs) assert.ok(layout.allowedTabs.includes(key), `${profile}: tab ${key}`);
    assert.ok(definition.description.endsWith("först."), `${profile}: one line of plain Swedish about what stands first`);
    for (const step of definition.firstSteps) assert.ok(menuItemAllowed(step.menu, access), `${profile}: the first step ${step.title}`);
  }
  assert.deepEqual(WORK_PROFILE.it.grants, read, "IT reads mostly");
  assert.equal(WORK_PROFILE.maintenance_lead.workView, "supervisor");
  assert.deepEqual(WORK_PROFILE.maintenance_technician.menuFirst, ["maintenance", "work_orders", "rounds"]);
});

test("the company's areas propose a package for the new groups too", () => {
  assert.deepEqual(WORK_AREAS, ["electric", "power", "automation", "industry", "property", "projects", "office"]);
  assert.ok(MODULE_PACKAGES.power.includes("rounds") && MODULE_PACKAGES.power.includes("projects") && !MODULE_PACKAGES.power.includes("quotes"));
  assert.ok(MODULE_PACKAGES.automation.includes("upkeep") && MODULE_PACKAGES.automation.includes("projects"));
});

test("every profile's rights are valid together and its menu, Hem, tab bar and start tab exist", () => {
  for (const profile of WORK_PROFILES) {
    const definition = WORK_PROFILE[profile];
    assert.doesNotThrow(() => workflowPermissionProfileSchema.parse(suggestedRights(profile)), `${profile}: every right has what it depends on`);
    assert.ok(definition.rights.length > 0, `${profile}: the admin is told what is suggested`);
    for (const key of [...definition.menuFirst, ...definition.menuHidden]) assert.ok(MENU_HIDEABLE.includes(key), `${profile}: ${key}`);
    assert.ok(!definition.menuFirst.some((key) => definition.menuHidden.includes(key)), `${profile}: nothing is both first and hidden`);
    for (const key of definition.home) assert.ok(HOME_TILE_KEYS.includes(key) && HOME_TILE[key], `${profile}: ${key}`);
    for (const key of definition.tabs) assert.ok(TAB_KEYS.includes(key) && TAB[key], `${profile}: ${key}`);
    assert.ok(definition.tabs.length <= MAX_TABS, `${profile}: the tab bar's room`);
    assert.deepEqual(normalizeNativeLayout(profileNativeLayout(profile)), profileNativeLayout(profile), `${profile}: reads back as it is`);
    assert.ok(isOverviewTab(definition.startTab), `${profile}: start tab`);
  }
});

test("the suggestions follow the report: the field right, plus Teamet and Underhåll where they belong", () => {
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile.grants;
  assert.deepEqual(suggestedRights("electrician").grants, field);
  assert.ok(hasWorkflowPermission(suggestedRights("project_manager"), "team", "read"));
  assert.ok(!hasWorkflowPermission(suggestedRights("electrician"), "team", "read"), "Teamet stays opt-in");
  assert.ok(hasWorkflowPermission(suggestedRights("maintenance_technician"), "maintenance", "edit"));
  assert.ok(hasWorkflowPermission(suggestedRights("work_lead"), "team", "read") && hasWorkflowPermission(suggestedRights("work_lead"), "maintenance", "read"));
  assert.ok(hasWorkflowPermission(suggestedRights("administrator"), "economy", "read") && !hasWorkflowPermission(suggestedRights("administrator"), "work-order", "edit"));
});

test("a profile never grants anything: it is stored beside the permissions, and no permission check reads it", () => {
  const profile = { profile: "work_lead" as const, setAt: NOW.toISOString() };
  const view = { view: "lead" as const, setAt: NOW.toISOString() };
  const record = withWorkProfile(withWorkView(noWorkflowPermissionProfile(), view), profile);
  assert.deepEqual(readWorkProfile(record), profile);
  assert.deepEqual(readWorkView(record), view);
  assert.deepEqual(normalizeWorkflowPermissionProfile(record), noWorkflowPermissionProfile(), "the rights read exactly as before, also for a profile that suggests more");
  assert.deepEqual(readWorkProfile(withWorkView(record, null)), profile, "saving the view leaves the profile");
  assert.deepEqual(readWorkView(withWorkProfile(record, null)), view, "saving the profile leaves the view");
  assert.equal(readWorkProfile(withWorkProfile(record, null)), null);
  for (const raw of [null, [], { workProfile: "x" }, { workProfile: { profile: "x" } }, { workProfile: { setAt: "" } }]) assert.equal(readWorkProfile(raw), null);
  assert.equal(readWorkProfile({ workProfile: { profile: "chef", setAt: "x" } })?.profile, null, "an unknown profile is no profile");
  for (const file of ["lib/workflow/permissions.ts", "lib/kfid/server.ts", "lib/workflow/task-access.ts", "lib/overview/tabs.ts"]) assert.ok(!/work-profile/.test(readFileSync(file, "utf8")), `${file} must not read the profile`);
});

test("the invitation carries the profile as it is, and the API sends rights only as the admin chose", () => {
  assert.ok(/workflowPermissions: invitation\.workflowPermissions \?\? undefined/.test(readFileSync("lib/auth/invitations.ts", "utf8")), "the whole JSON record is copied at accept");
  const route = readFileSync("app/api/administration/route.ts", "utf8");
  assert.ok(route.includes("withWorkProfile(invitedRecord"), "invitation_create");
  assert.ok(route.includes("withWorkProfile(withWorkView(workflowPermissions ?? membership.workflowPermissions"), "member_save keeps the profile when only the rights change");
  assert.ok(!/suggestedRights/.test(route), "the server never turns a profile into rights");
});

test("the admin's save: a new stamp only when the profile changes or the person's choices are reset", () => {
  const current = { profile: "electrician" as const, setAt: NOW.toISOString() };
  assert.equal(nextWorkProfileSetting(current, undefined, false, LATER), undefined);
  assert.equal(nextWorkProfileSetting(current, "electrician", false, LATER), undefined);
  assert.deepEqual(nextWorkProfileSetting(current, "caretaker", false, LATER), { profile: "caretaker", setAt: LATER.toISOString() });
  assert.deepEqual(nextWorkProfileSetting(current, null, false, LATER), { profile: null, setAt: LATER.toISOString() });
  assert.deepEqual(nextWorkProfileSetting(current, undefined, true, LATER), { profile: "electrician", setAt: LATER.toISOString() });
  assert.equal(nextWorkProfileSetting(null, null, false, LATER), undefined);
  assert.equal(nextWorkProfileSetting(null, undefined, true, LATER), undefined, "resetting without a profile writes none");
});

test("choosing a profile: a new invitation is filled in, everything else asks, rights never change silently", () => {
  const base = { isNew: true, role: "MEMBER", current: [] as string[], previous: null, next: "electrician" as const };
  const field = suggestedRights("electrician").grants;
  assert.equal(profileRightsStep(base), "fill");
  assert.equal(profileRightsStep({ ...base, current: ["customers:read"] }), "ask", "the admin has chosen rights: asked");
  assert.equal(profileRightsStep({ ...base, current: field, previous: "electrician", next: "work_lead" }), "fill", "still the earlier suggestion on a new invitation");
  assert.equal(profileRightsStep({ ...base, isNew: false, current: field, next: "work_lead" }), "ask", "an existing person is always asked");
  assert.equal(profileRightsStep({ ...base, isNew: false }), "ask", "also with no rights yet");
  assert.equal(profileRightsStep({ ...base, isNew: false, current: field }), "keep", "already what is suggested");
  assert.equal(profileRightsStep({ ...base, next: null }), "keep");
  assert.equal(profileRightsStep({ ...base, role: "ADMIN" }), "keep", "an admin holds every right by role");
});

test("the person's own choice is display only and stops counting when the admin changes something", () => {
  const none = NO_ADMIN_WORK_CHOICES;
  assert.deepEqual(effectiveWorkProfile(none, null), { profile: null, stamp: "", own: false }, "nothing chosen");
  assert.equal(effectiveWorkView(none, null), null, "nothing chosen: no work view, as today");
  const own = ownWorkProfileChoice(none, "caretaker", NOW);
  assert.deepEqual(effectiveWorkProfile(none, own), { profile: "caretaker", stamp: NOW.toISOString(), own: true });
  assert.deepEqual(effectiveWorkView(none, own), { view: "fitter", setAt: NOW.toISOString() });
  assert.equal(ownWorkProfileShown(none, own), "caretaker");
  const admin = adminChose("work_lead");
  assert.deepEqual(effectiveWorkProfile(admin, own), { profile: "work_lead", stamp: NOW.toISOString(), own: false }, "the admin's new choice wins over an older own one");
  assert.equal(ownWorkProfileShown(admin, own), null);
  assert.deepEqual(effectiveWorkView(admin, own), { view: "supervisor", setAt: NOW.toISOString() }, "the profile's view when none was chosen under Anpassa");
  const ownUnder = ownWorkProfileChoice(admin, "electrician", LATER);
  assert.equal(effectiveWorkProfile(admin, ownUnder).profile, "electrician", "the person may change the display under the admin's choice");
  assert.equal(effectiveWorkProfile({ ...admin, view: { view: "lead", setAt: LATER.toISOString() } }, ownUnder).profile, "work_lead", "a changed view is a change too");
  const chosenView = { view: "lead" as const, setAt: LATER.toISOString() };
  assert.deepEqual(effectiveWorkView({ ...admin, view: chosenView }, null), chosenView, "a view chosen under Anpassa wins over the profile's");
  assert.deepEqual(effectiveWorkView({ profile: null, view: { view: null, setAt: "x" } }, null), { view: null, setAt: "x" }, "a view taken away stays as it was");
});

test("not chosen and chosen empty are told apart by the stamp; without a profile everything reads as today", () => {
  const profile = effectiveWorkProfile(adminChose("administrator"), null);
  const noProfile = effectiveWorkProfile(NO_ADMIN_WORK_CHOICES, null);
  // No profile: the stored lists, also the ones written back by a save.
  assert.deepEqual(effectiveMenuChoices(noProfile, stored({ hiddenMenuItems: ["time"] })).hiddenMenuItems, ["time"]);
  assert.deepEqual(effectiveMenuChoices(noProfile, stored()), { hiddenMenuItems: [], menuShortcuts: [], phoneMenu: null });
  assert.deepEqual(effectiveNativeLayout(noProfile, stored()), normalizeNativeLayout(undefined));
  assert.deepEqual(effectiveNativeLayout(noProfile, stored()).home, [...DEFAULT_HOME_TILES]);
  // A profile and nothing chosen: its defaults, though an earlier save wrote empty lists and today's layout back.
  const written = mergePreferences({}, { theme: "dark" });
  assert.deepEqual(effectiveMenuChoices(profile, written).hiddenMenuItems, [...WORK_PROFILE.administrator.menuHidden]);
  assert.deepEqual(effectiveNativeLayout(profile, written), profileNativeLayout("administrator"));
  // Chosen empty under the profile: empty, and it wins while the profile stands.
  const empty = mergePreferences(written, { ...menuChoicesPatch("desktop", { hiddenMenuItems: [], menuShortcuts: [] }, profile.stamp), nativeLayout: { home: [], tabs: ["home"] }, choiceBasis: { ...menuChoicesPatch("desktop", { hiddenMenuItems: [], menuShortcuts: [] }, profile.stamp).choiceBasis, native: profile.stamp } });
  assert.deepEqual(effectiveMenuChoices(profile, empty).hiddenMenuItems, []);
  assert.deepEqual(effectiveNativeLayout(profile, empty).home, []);
  // The admin changes the profile: the choices made under the old one stop counting.
  const changed = effectiveWorkProfile({ view: null, profile: { profile: "caretaker", setAt: LATER.toISOString() } }, null);
  assert.deepEqual(effectiveMenuChoices(changed, empty).hiddenMenuItems, [...WORK_PROFILE.caretaker.menuHidden]);
  assert.deepEqual(effectiveNativeLayout(changed, empty), profileNativeLayout("caretaker"));
  // A choice from before profiles does not bypass a profile; Återställ goes back to the profile's.
  assert.deepEqual(effectiveMenuChoices(profile, stored({ hiddenMenuItems: ["time"] })).hiddenMenuItems, [...WORK_PROFILE.administrator.menuHidden]);
  const reset = mergePreferences(empty, { choiceBasis: RESET_CHOICE_BASIS });
  assert.deepEqual(effectiveNativeLayout(profile, reset), profileNativeLayout("administrator"));
  assert.deepEqual(reset.choiceBasis, RESET_CHOICE_BASIS);
});

test("Mer on the phone has its own stamp and otherwise follows the menu in force", () => {
  const profile = effectiveWorkProfile(adminChose("caretaker"), null);
  const phone = mergePreferences({}, menuChoicesPatch("phone", { hiddenMenuItems: ["time"], menuShortcuts: [] }, profile.stamp));
  const inForce = effectiveMenuChoices(profile, phone);
  assert.deepEqual(inForce.phoneMenu, { hiddenMenuItems: ["time"], menuShortcuts: [] });
  assert.deepEqual(inForce.hiddenMenuItems, [...WORK_PROFILE.caretaker.menuHidden], "the computer's menu is not touched by the phone's choice");
  assert.deepEqual(menuChoicesFor(inForce, "desktop").hiddenMenuItems, [...WORK_PROFILE.caretaker.menuHidden]);
  assert.equal(effectiveMenuChoices(profile, mergePreferences({}, { phoneMenu: { hiddenMenuItems: ["time"], menuShortcuts: [] } })).phoneMenu, null, "without the stamp Mer follows the profile's menu");
  assert.deepEqual(Object.keys(menuChoicesPatch("phone", { hiddenMenuItems: [], menuShortcuts: [] })), ["phoneMenu"], "without a profile the save is as before");
});

test("the preferences read the new keys safely and merge the stamps one by one", () => {
  assert.equal(stored().ownWorkProfile, null);
  assert.deepEqual(stored().choiceBasis, {});
  assert.equal(stored({ ownWorkProfile: { profile: "chef", setAt: "x", basis: "|" } }).ownWorkProfile, null, "an unknown profile is no choice");
  assert.deepEqual(stored({ choiceBasis: "x" }).choiceBasis, {});
  const merged = mergePreferences({ choiceBasis: { menu: "a", phone: "b" } }, { choiceBasis: { phone: "c" } });
  assert.deepEqual(merged.choiceBasis, { menu: "a", phone: "c" }, "a device's save leaves the others' stamps");
  const own = ownWorkProfileChoice(NO_ADMIN_WORK_CHOICES, "administrator", NOW);
  assert.deepEqual(mergePreferences({}, { ownWorkProfile: own }).ownWorkProfile, own);
  assert.equal(mergePreferences({ ownWorkProfile: own }, { ownWorkProfile: null }).ownWorkProfile, null);
});

test("what a profile puts first is only ever what the person may use", () => {
  const groups = (access: MenuAccess, first: Parameters<typeof resolveMenu>[3]) => resolveMenu(access, { hidden: [], shortcuts: [] }, null, first);
  const keys = (all: ReturnType<typeof groups>) => all.flat().map((entry) => entry.key);
  // Nothing first: the menu is exactly what it was.
  assert.deepEqual(groups(owner, []), resolveMenu(owner, { hidden: [], shortcuts: [] }));
  const lifted = groups(owner, workProfileMenuFirst("maintenance_technician"));
  assert.deepEqual(lifted[0].map((entry) => entry.key), ["maintenance", "work_orders", "rounds"]);
  assert.equal(new Set(keys(lifted)).size, keys(lifted).length, "no button twice");
  assert.deepEqual([...keys(lifted)].sort(), [...keys(groups(owner, []))].sort(), "the same buttons, another order");
  // A page of Verktyg lifted is a shortcut of its own, and no longer among Verktyg's.
  const lead = groups(owner, workProfileMenuFirst("lead_electrician"));
  assert.deepEqual(lead[0][1], { type: "shortcut", key: "self_inspection" });
  assert.ok(!lead.flat().some((entry) => entry.type === "group" && entry.children.includes("self_inspection")));
  // Without the right the button is not drawn, whatever the profile says; a hidden one neither.
  const without = groups(member(["work-order:read"]), workProfileMenuFirst("maintenance_technician"));
  assert.ok(!keys(without).includes("maintenance") && !menuItemAllowed("maintenance", member(["work-order:read"])));
  assert.ok(!keys(resolveMenu(owner, { hidden: ["maintenance"], shortcuts: [] }, null, ["maintenance"])).includes("maintenance"));
  // Local and the demo: a Cloud button stays away.
  assert.ok(!keys(groups({ ...owner, localStorageMode: true }, ["maintenance"])).includes("maintenance"));
  // The open page's button is shown as always.
  assert.ok(keys(resolveMenu(owner, { hidden: ["maintenance"], shortcuts: [] }, "maintenance", ["maintenance"])).includes("maintenance"));
});

test("the start tab is the profile's only within what the person may see", () => {
  const viewer = (grants: string[], admin = false) => overviewTabs({ admin, workflowPermissions: workflowPermissionProfileSchema.parse({ version: 1, grants }) });
  assert.equal(overviewStartTab(viewer(["team:read"]), "supervisor", null, workProfileStartTab("project_manager")), "team");
  assert.equal(overviewStartTab(viewer([]), "supervisor", null, workProfileStartTab("project_manager")), "me", "without team:read: Jag");
  assert.equal(overviewStartTab(viewer(["economy:read"]), null, null, workProfileStartTab("administrator")), "economy");
  assert.equal(overviewStartTab(viewer([]), null, null, workProfileStartTab("administrator")), "me", "the profile opens nothing");
  assert.equal(overviewStartTab(viewer(["team:read"]), "supervisor", null, workProfileStartTab("electrician")), "me", "an electrician starts on Jag also with a view that would open Teamet");
  assert.equal(overviewStartTab(viewer(["team:read"]), null, "team", workProfileStartTab("electrician")), "team", "the address wins when allowed");
  assert.equal(overviewStartTab(viewer(["team:read"]), "supervisor", null, null), "team", "no profile: as before");
  assert.equal(workProfileStartTab(null), null);
});

test("the phone's quickest steps: Avvikelse and Frånvaro under Ny, Teamet in Mer and on Hem by the right", () => {
  const can = { workOrder: true, task: true, project: true, deviation: true, absence: true, round: true, purchase: true };
  assert.deepEqual(nativeNewChoices(can).map((choice) => choice.key), ["work-order", "task", "deviation", "absence", "round", "project", "purchase"]);
  assert.deepEqual(nativeNewChoices({ workOrder: false, task: false, project: false, deviation: true, absence: true }).map((choice) => choice.href), ["/?view=deviations&new=1", ABSENCE_HREF], "everyone may report a deviation and their own absence");
  assert.deepEqual(nativeNewChoices({ workOrder: true, task: false, project: false }).map((choice) => choice.key), ["work-order"], "only when the caller says so");

  const plain = nativeLayoutAllowed(member([]));
  assert.ok(plain.allowedTabs.includes("new"), "Ny holds Avvikelse for everyone");
  assert.ok(!plain.allowedHome.includes("new"), "the tile Nytt jobb is about jobs");
  assert.ok(plain.allowedHome.includes("absence"));
  assert.ok(!plain.allowedHome.includes("team") && !plain.allowedTabs.includes("team"), "Teamet by the right");
  assert.ok(!plain.allowedHome.includes("maintenance"));
  const team = nativeLayoutAllowed(member(["team:read", "maintenance:read"]));
  assert.ok(team.allowedHome.includes("team") && team.allowedTabs.includes("team") && team.allowedTabs.includes("maintenance"));
  const local = nativeLayoutAllowed({ ...owner, localStorageMode: true });
  assert.ok(!local.allowedHome.includes("team") && !local.allowedHome.includes("absence"), "both live on Översikten, which Local does not have");
  assert.ok(!nativeLayoutAllowed(null).allowedTabs.includes("new"));
  assert.ok(!DEFAULT_HOME_TILES.includes("team") && !DEFAULT_HOME_TILES.includes("absence"), "nobody's Hem changes without a choice");

  assert.equal(HOME_TILE.team.href, TEAM_HREF);
  assert.equal(TAB.team.href, TEAM_HREF);
  assert.equal(activeTab(["home", "team"], "stats", false, "team"), "team");
  assert.equal(activeTab(["home", "team"], "stats", false, null), "home");
  assert.equal(activeTab(["home", "jobs"], "stats", false, "team"), "home", "without the tab Hem stays marked");

  const more = (team?: boolean) => nativeMoreSections([[{ type: "link", key: "time" }]], { team }).flatMap((section) => section.rows).map((row) => row.key);
  assert.ok(more(true).includes("team"));
  assert.ok(!more(false).includes("team") && !more().includes("team"));
  const mixed = nativeMoreSections([[{ type: "link", key: "work_orders" }, { type: "shortcut", key: "self_inspection" }]]);
  assert.equal(mixed[0].title, undefined, "a profile's first group is no Verktyg group");
  assert.equal(nativeMoreSections([[{ type: "shortcut", key: "self_inspection" }]])[0].title, "Verktyg");
});

test("a save of the company's details keeps what the company works with", () => {
  const details = { phone: "010-123 45 67" };
  assert.deepEqual(keepWorkAreas(details, { phone: "gammalt", workAreas: ["property", "industry"] }), { phone: "010-123 45 67", workAreas: ["property", "industry"] });
  // Nothing chosen stays nothing, and nothing but the answer comes from what was stored.
  assert.deepEqual(keepWorkAreas(details, { phone: "gammalt" }), details);
  assert.deepEqual(keepWorkAreas(details, { workAreas: [] }), details);
  assert.deepEqual(keepWorkAreas(details, null), details);
  assert.deepEqual(keepWorkAreas(details, "inte ett objekt"), details);
  assert.deepEqual(keepWorkAreas(details, { workAreas: ["okänd", "office"] }), { phone: "010-123 45 67", workAreas: ["office"] });
  // Every way that writes the whole profile goes through it.
  const company = readFileSync("app/api/administration/route.ts", "utf8");
  assert.match(company, /keepWorkAreas\(details, stored\?\.profile\)/);
  assert.equal(company.includes("profile: details,"), false, "company_save never writes the bare form");
  assert.match(readFileSync("app/api/superadmin/customer-companies/route.ts", "utf8"), /keepWorkAreas\(companyProfileSchema\.parse/);
});

test("what the company works with is read safely and only orders the list", () => {
  assert.deepEqual(normalizeWorkAreas(["industry", "x", "industry", 3]), ["industry"]);
  assert.deepEqual(normalizeWorkAreas("industry"), []);
  const groups = workProfileGroups(["industry", "property"]);
  assert.deepEqual(groups.slice(0, 2).map((group) => group.area), ["industry", "property"]);
  assert.equal(groups.length, WORK_AREAS.length, "every profile stays offered: no locks");
});

test("what a profile tucks away stands under Fler: reachable, never forbidden", () => {
  const profile = "operator" as const;
  const hidden = [...WORK_PROFILE[profile].menuHidden] as string[];
  const tucked = workProfileTucked(profile, hidden);
  assert.deepEqual([...tucked].sort(), ["customers", "projects", "quotes"]);
  const groups = resolveMenu(owner, { hidden, shortcuts: [] }, null, workProfileMenuFirst(profile), tucked);
  const fler = groups.flat().find((entry) => entry.type === "more");
  assert.deepEqual(fler && fler.type === "more" ? [...fler.children].sort() : null, ["customers", "projects", "quotes"]);
  assert.ok(!groups.flat().some((entry) => entry.type === "link" && tucked.includes(entry.key)), "not among the buttons");
  // Whoever may not use a button does not find it there either: Fler never gives anything.
  const without = resolveMenu(member(["work-order:read"]), { hidden, shortcuts: [] }, null, [], tucked).flat().find((entry) => entry.type === "more");
  assert.ok(!without || (without.type === "more" && !without.children.includes("quotes") && !without.children.includes("projects")));
  // The open page's button stays in its place, and a button brought back in Anpassa menyn leaves Fler.
  const open = resolveMenu(owner, { hidden, shortcuts: [] }, "quotes", [], tucked).flat().find((entry) => entry.type === "more");
  assert.ok(open?.type === "more" && !open.children.includes("quotes"));
  assert.deepEqual(workProfileTucked(profile, ["quotes"]), ["quotes"]);
  assert.deepEqual(workProfileTucked(null, hidden), [], "no profile, no Fler");
  assert.equal(resolveMenu(owner, { hidden, shortcuts: [] }).flat().some((entry) => entry.type === "more"), false, "a person's own hidden buttons stay hidden");
  // The phone: a section of Mer, with the rows as rows.
  const sections = nativeMoreSections(groups, {});
  const section = sections.find((item) => item.title === "Fler");
  assert.deepEqual(section?.rows.map((row) => row.key).sort(), ["customers", "projects", "quotes"]);
  // As the shell shows Mer: the office's rows in their group Kontor, the rest under Fler.
  const shown = nativeMoreTools(sections, 3);
  assert.deepEqual(shown.find((item) => item.title === "Kontor")?.rows.map((row) => row.key).filter((key) => tucked.includes(key as never)).sort(), ["customers", "projects", "quotes"]);
  const rounds = resolveMenu(owner, { hidden: ["rounds"], shortcuts: [] }, null, [], ["rounds"]);
  const tiles = nativeMoreTiles(nativeMoreSections(rounds, {}));
  assert.ok(!tiles.tiles.some((row) => row.key === "rounds"), "what is tucked away is no big tile");
  assert.ok(tiles.sections.find((item) => item.title === "Fler")?.rows.some((row) => row.key === "rounds"));
});

test("Ny on the phone follows the profile's order and offers nothing new", () => {
  const can = { workOrder: true, task: true, project: true, customer: true, quote: true, deviation: true, absence: true, round: true, purchase: true };
  const base = nativeNewChoices(can);
  const keys = (profile: (typeof WORK_PROFILES)[number]) => orderNewChoices(base, workProfileNewFirst(profile)).map((choice) => choice.key);
  assert.deepEqual(keys("operator").slice(0, 2), ["deviation", "absence"]);
  assert.deepEqual(keys("estimator").slice(0, 2), ["quote", "customer"]);
  assert.deepEqual(keys("project_manager")[0], "project");
  for (const profile of WORK_PROFILES) assert.deepEqual([...keys(profile)].sort(), base.map((choice) => choice.key).sort(), `${profile}: the same choices, another order`);
  assert.deepEqual(orderNewChoices(base).map((choice) => choice.key), base.map((choice) => choice.key), "no profile: as before");
  const few = nativeNewChoices({ workOrder: false, task: false, project: false, deviation: true, absence: true });
  assert.deepEqual(orderNewChoices(few, workProfileNewFirst("project_manager")).map((choice) => choice.key), ["deviation", "absence"], "the profile opens nothing");
});

test("the first steps follow the profile and only what the person may use", () => {
  const nothing = member([]);
  assert.deepEqual(workProfileFirstSteps(null, owner), []);
  assert.deepEqual(workProfileFirstSteps("maintenance_technician", member(["work-order:read"])).some((step) => step.menu === "maintenance"), false, "no Underhåll without the right");
  assert.ok(workProfileFirstSteps("maintenance_technician", owner).some((step) => step.menu === "maintenance"));
  assert.equal(workProfileFirstSteps("project_manager", nothing).some((step) => step.menu === "projects"), false);
  for (const profile of WORK_PROFILES) for (const step of WORK_PROFILE[profile].firstSteps) {
    assert.ok(step.href.startsWith("/?view="), `${profile}: ${step.title}`);
    assert.ok(step.title.length <= 22, `${profile}: ${step.title} must fit on one line`);
    assert.ok(step.text.length <= 60, `${profile}: ${step.text} is short`);
  }
  assert.deepEqual(setupStartLinks(false, null, { admin: false, steps: workProfileFirstSteps("caretaker", owner) }).map((link) => link.title), ["Öppna dina jobb", "Gå en driftrond", "Rapportera avvikelse"]);
  assert.equal(setupStartLinks(false, null, { admin: true, steps: workProfileFirstSteps("caretaker", owner) })[0].title, "Bjud in kollegor", "an admin sets up the company first");
  assert.deepEqual(setupStartLinks(false, null, { admin: true, steps: [] }).map((link) => link.title), setupStartLinks(false).map((link) => link.title), "no profile: as before");
  assert.equal(setupStartLinks(true, null, { admin: false, steps: workProfileFirstSteps("caretaker", owner) })[0].title, setupStartLinks(true)[0].title, "Local: as before");
  assert.deepEqual(setupStepsFor(false, false, true).map((step) => step.key), ["legal", "display", "start"], "a member with a profile ends on Kom igång");
  assert.deepEqual(setupStepsFor(false, true, false).map((step) => step.key), ["legal", "profile", "display"], "without a profile as before");
});

test("a profile never changes what the API allows", () => {
  // The rights read from the member's record are the same whatever profile stands in it, for every row and every old key.
  const samples = [[], FIELD_GRANTS, READ_GRANTS, OFFICE_GRANTS, [...FIELD_GRANTS, ...MAINTENANCE_GRANTS]] as const;
  for (const grants of samples) {
    const record = workflowPermissionProfileSchema.parse({ version: 1, grants: [...grants] });
    const without = normalizeWorkflowPermissionProfile(record);
    const subjects = ["team", "maintenance", "quotes", "economy", "projects", "customers", "work-order"] as const;
    for (const key of [...WORK_PROFILES, ...Object.keys(RETIRED_WORK_PROFILE)]) {
      const withProfile = withWorkProfile(record, { profile: key as (typeof WORK_PROFILES)[number], setAt: NOW.toISOString() });
      assert.deepEqual(normalizeWorkflowPermissionProfile(withProfile), without, `${key} leaves the rights as they are`);
      for (const subject of subjects) for (const action of ["read", "edit", "create"] as const) {
        assert.equal(hasWorkflowPermission(normalizeWorkflowPermissionProfile(withProfile), subject, action), hasWorkflowPermission(without, subject, action), `${key}: ${subject}:${action}`);
      }
    }
  }
  // No server route and no rule of access reads the profile: only the shell's first frame, the admin's save and the invitation's step.
  const readers: string[] = [];
  const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(path); } else if (/\.tsx?$/.test(entry.name) && /from "[^"]*work-profile"/.test(readFileSync(path, "utf8"))) readers.push(path);
  } };
  for (const dir of ["app/api", "lib", "ee"]) if (existsSync(dir)) walk(dir);
  assert.deepEqual(readers.sort(), ["app/api/administration/route.ts", "app/api/superadmin/customer-companies/route.ts", "app/api/workspace/route.ts", "lib/auth/invitations.ts", "lib/kfid/preferences.ts", "lib/workflow/first-frame-server.ts", "lib/workflow/modules.ts"].sort(), "a new reader of the profile on the server must be looked at");
  // What those routes take from it: the company's areas, and the admin's save of the profile itself. Never a right.
  assert.doesNotMatch(readFileSync("app/api/workspace/route.ts", "utf8"), /(suggestedRights|readWorkProfile|WORK_PROFILE\b)/);
  assert.doesNotMatch(readFileSync("app/api/superadmin/customer-companies/route.ts", "utf8"), /(suggestedRights|readWorkProfile|WORK_PROFILE\b)/);
  assert.doesNotMatch(readFileSync("app/api/administration/route.ts", "utf8"), /suggestedRights/);
});

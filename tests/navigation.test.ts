import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { breadcrumbTrail, customerPlaceHref, menuViewOfPage, parentCrumb, safeReturnTo, viewGroupLabel, withParam, VIEW_LABEL } from "../lib/workflow/navigation";
import { activeTab as nativeActiveTab } from "../lib/workflow/native-layout";
import { COMPANY_VIEWS } from "../lib/workflow/settings-tabs";
import { canGoBack, canGoForward, emptyHistory, HISTORY_LIMIT, parseHistory, recordNavigation, rememberScroll } from "../lib/workflow/history-stack";
import { bottomBarMode, resolveBottomBar } from "../lib/workflow/bottom-bar";
import { dialogPresentation, formPresentation } from "../lib/workflow/dialog-mode";
import { MENU_HIDEABLE, MENU_ITEM_GROUPS, MENU_LABEL, MENU_SUBTITLE, PROJECT_PAGE_SUBTITLE, TOOLS_LABEL, assistantIconAllowed, joinsOverview, menuChoiceOffered, sidebarMenu, menuChoicesOf, menuItemAllowed, menuItemHref, menuKeyOfView, normalizeMenuHidden, projectPageAllowed, resolveMenu, type MenuAccess } from "../lib/workflow/menu-items";
import { preferencesSchema } from "../lib/kfid/preferences";
import { FIRST_LIST_LIMIT, firstList } from "../lib/search/first-list";
import { defaultWorkflowPermissionProfile, noWorkflowPermissionProfile, workflowPermissionPresets } from "../lib/workflow/permissions";

const labels = (trail: { label: string }[]) => trail.map((crumb) => crumb.label);

// Sök på mobilen (2026-10-09): a short first list, every heading kept, the rest behind "Visa alla träffar".
test("search: the phone's first list is cut to a few hits in all, keeping the groups in order", () => {
  const groups = [{ type: "task", hits: [1, 2, 3] }, { type: "customer", hits: [4, 5, 6] }, { type: "place", hits: [7, 8, 9] }];
  const cut = firstList(groups, FIRST_LIST_LIMIT);
  assert.equal(cut.flatMap((group) => group.hits).length, FIRST_LIST_LIMIT);
  assert.deepEqual(cut.map((group) => group.type), ["task", "customer", "place"]);
  assert.deepEqual(firstList(groups, 4).map((group) => group.hits), [[1, 2, 3], [4]], "a group that gets nothing is left out");
});

// Brödsmulor (2026-10-09): every parent leads right, the current page has no link.
test("breadcrumbs: every parent has a link, the page itself none, and Översikt is the root", () => {
  const overview = breadcrumbTrail({ view: "stats" });
  assert.deepEqual(overview, [{ label: "Översikt", href: null }]);
  const project = breadcrumbTrail({ view: "project", params: { projectId: "p1" }, labels: { project: "Volvo etapp 2" } });
  assert.deepEqual(project, [{ label: "Översikt", href: "/?view=stats" }, { label: "Projekt", href: "/?view=projects" }, { label: "Volvo etapp 2", href: null }]);
  for (const view of Object.keys(VIEW_LABEL)) {
    const trail = breadcrumbTrail({ view, params: { taskId: "t", customerId: "c", projectId: "p" } });
    assert.equal(trail.at(-1)!.href, null, `${view}: the current page is not a link`);
    assert.ok(trail.slice(0, -1).every((crumb) => crumb.href?.startsWith("/?view=")), `${view}: every parent is a link inside the workspace`);
    if (view !== "stats") assert.equal(trail[0].label, "Översikt", `${view}: starts at Översikt`);
  }
});

test("breadcrumbs: a saved purchase is named, not \"Inköp › Inköp\" (Lika är rätt 2026-11-13)", () => {
  assert.deepEqual(labels(breadcrumbTrail({ view: "purchase", params: { purchaseId: "p1" }, labels: { purchase: "Kabel till hus 2" } })), ["Översikt", "Inköp", "Kabel till hus 2"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "purchase", params: { purchaseId: "p1" } })), ["Översikt", "Inköp", "Inköp"], "the kind until the purchase is read");
  assert.deepEqual(labels(breadcrumbTrail({ view: "purchase" })), ["Översikt", "Inköp", VIEW_LABEL.purchase]);
});

test("breadcrumbs: a task shows its project or its work order; a work order its list", () => {
  assert.deepEqual(labels(breadcrumbTrail({ view: "workflow_task", params: { taskId: "w1", taskType: "WORK_ORDER" }, labels: { task: "Byt armatur" } })), ["Översikt", "Arbetsordrar", "Byt armatur"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "workflow_task", params: { taskType: "WORK_ORDER" } })), ["Översikt", "Arbetsordrar", "Ny arbetsorder"]);
  // A new protocol is named by its heading (simulation 0.6.3: "Ny uppgift" in the trail, "Ny kontroll" as the heading).
  assert.deepEqual(labels(breadcrumbTrail({ view: "workflow_task", params: { taskType: "FORM" }, labels: { heading: "Ny kontroll" } })), ["Översikt", "Uppgifter", "Ny kontroll"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "workflow_task", params: { taskType: "FORM" } })), ["Översikt", "Uppgifter", "Ny uppgift"], "without a heading the kind of page");
  assert.equal(labels(breadcrumbTrail({ view: "workflow_task", params: { taskId: "t1", taskType: "FORM" }, labels: { task: "Villa Ek", heading: "Ny kontroll" } })).at(-1), "Villa Ek", "a saved task is named by its title");
  assert.deepEqual(labels(breadcrumbTrail({ view: "workflow_task", params: { taskId: "t1", taskType: "FORM" }, labels: { task: "Termografering" } })), ["Översikt", "Uppgifter", "Termografering"]);
  const inProject = breadcrumbTrail({ view: "workflow_task", params: { taskId: "t1", taskType: "FORM", projectId: "p1", workOrderId: "w1" }, labels: { task: "Kontroll", project: "Etapp 2", workOrder: "AO 12" } });
  assert.deepEqual(labels(inProject), ["Översikt", "Projekt", "Etapp 2", "AO 12", "Kontroll"]);
  assert.equal(inProject[2].href, "/?view=project&projectId=p1");
  assert.equal(inProject[3].href, "/?view=workflow_task&taskId=w1&taskType=WORK_ORDER", "the work order leads to the work order");
  // A name not read yet falls back to the kind of page; a long one is shortened.
  assert.deepEqual(labels(breadcrumbTrail({ view: "workflow_task", params: { taskId: "t1", taskType: "RISK_ASSESSMENT", workOrderId: "w1" } })), ["Översikt", "Arbetsordrar", "Arbetsorder", "Uppgift"]);
  assert.ok(labels(breadcrumbTrail({ view: "project", params: { projectId: "p" }, labels: { project: "x".repeat(80) } })).at(-1)!.length <= 48);
});

test("breadcrumbs: Kunder on its own, the registers under Register, settings under Inställningar (B1/B2)", () => {
  assert.deepEqual(labels(breadcrumbTrail({ view: "customers" })), ["Översikt", "Kunder"]);
  // Ny kund sits in the register like a customer card (simulation 0.6.3).
  const newCustomer = breadcrumbTrail({ view: "customers", params: { new: "1" } });
  assert.deepEqual(labels(newCustomer), ["Översikt", "Kunder", "Ny kund"]);
  assert.equal(newCustomer[1].href, "/?view=customers");
  assert.deepEqual(labels(breadcrumbTrail({ view: "customers", params: { customerId: "c1" }, labels: { customer: "Fastighets AB" } })), ["Översikt", "Kunder", "Fastighets AB"]);
  const editing = breadcrumbTrail({ view: "customers", params: { customerId: "c1", edit: "1" }, labels: { customer: "Fastighets AB" } });
  assert.deepEqual(labels(editing), ["Översikt", "Kunder", "Fastighets AB", "Redigera kund"]);
  assert.equal(editing[2].href, "/?view=customers&customerId=c1");
  // A place opens on its customer's page (2026-10-14), so its address has that page's trail while it loads (no extra crumb).
  assert.deepEqual(labels(breadcrumbTrail({ view: "place", params: { placeId: "pl", customerId: "c1" }, labels: { customer: "Fastighets AB", place: "Elcentral" } })), ["Översikt", "Kunder", "Fastighets AB"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "place", params: { placeId: "pl" } })), ["Översikt", "Kunder", "Kund"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "instruments" })), ["Översikt", "Mer", "Instrument"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "administration" })), ["Översikt", "Inställningar", "Användare"], "a tab of Inställningar (2026-11-02)");
  assert.deepEqual(labels(breadcrumbTrail({ view: "administration", params: { person: "u1" }, labels: { heading: "Elin Ström" } })), ["Översikt", "Inställningar", "Användare", "Elin Ström"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "operator_accounts" })), ["Översikt", "Inställningar", "Användare", "Operatörskonton"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "operator_accounts", params: { account: "a1" }, labels: { heading: "Press 4" } })), ["Översikt", "Inställningar", "Användare", "Operatörskonton", "Press 4"]);
  // The first tab has its own crumb too, so the last one is the page's heading (2026-10-24).
  assert.deepEqual(labels(breadcrumbTrail({ view: "settings" })), ["Översikt", "Inställningar", "Mina inställningar"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "company" })), ["Översikt", "Inställningar", "Företag"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "customer_companies" })), ["Översikt", "Installation", "Kundföretag"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "server_keys" })), ["Översikt", "Installation", "Tjänster och nycklar"], "one page per tab (2026-10-15)");
  // Skapa formulär hör till Verktyg (2026-10-23).
  assert.deepEqual(labels(breadcrumbTrail({ view: "forms" })), ["Översikt", "Mer", "Skapa formulär"], "the form builder is one of Verktyg's pages");
  assert.equal(parentCrumb(breadcrumbTrail({ view: "instruments" }))?.label, "Mer");
  assert.equal(parentCrumb(breadcrumbTrail({ view: "stats" })), null);
});

test("returnTo is followed only inside the workspace", () => {
  assert.equal(safeReturnTo("/?view=workflow_task&taskId=t1&taskType=WORK_ORDER"), "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER");
  for (const bad of ["https://evil.example/?view=stats", "//evil.example/?x", "/\\evil", "javascript:alert(1)", "/api/x", "", null]) assert.equal(safeReturnTo(bad), null, String(bad));
  assert.equal(withParam("/?view=workflow_task&taskType=WORK_ORDER", "pickCustomer", "c 1"), "/?view=workflow_task&taskType=WORK_ORDER&pickCustomer=c+1");
  // The place pen (2026-10-24): one page for places – the customer's page at the place; Bakåt returns to the work.
  const params = new URLSearchParams(customerPlaceHref("c 1", "p 1").slice(2));
  assert.deepEqual([params.get("view"), params.get("customerId"), params.get("place"), params.get("step")], ["customers", "c 1", "p 1", null]);
  assert.equal(new URLSearchParams(customerPlaceHref("c1", "p1", true).slice(2)).get("step"), "platser", "level 1 opens the Platser screen");
});

// Bakåt/framåt (2026-10-09): the person's own visits in this tab; never out of Workflow.
test("history: push, back, forward, replace and an unknown entry", () => {
  let state = emptyHistory();
  assert.equal(canGoBack(state), false);
  state = recordNavigation(state, { kind: "visit", id: "a", url: "/?view=tasks" });
  assert.equal(canGoBack(state), false, "the first page has no way back inside Workflow");
  state = recordNavigation(state, { kind: "push", id: "b", url: "/?view=workflow_task&taskId=t1" });
  state = recordNavigation(state, { kind: "push", id: "c", url: "/?view=workflow_task&taskId=w1&taskType=WORK_ORDER" });
  assert.equal(canGoBack(state), true);
  assert.equal(canGoForward(state), false);
  state = recordNavigation(state, { kind: "visit", id: "b", url: "/?view=workflow_task&taskId=t1" });
  assert.equal(state.index, 1, "back to the task the work order was opened from");
  assert.equal(canGoForward(state), true);
  state = recordNavigation(state, { kind: "replace", id: "b2", url: "/?view=workflow_task&taskId=t1&x=1" });
  assert.equal(state.entries.length, 3, "a replace keeps the entries");
  assert.equal(state.entries[1].url, "/?view=workflow_task&taskId=t1&x=1");
  state = recordNavigation(state, { kind: "push", id: "d", url: "/?view=customers" });
  assert.deepEqual(state.entries.map((entry) => entry.id), ["a", "b2", "d"], "a new page drops what lay ahead");
  assert.equal(canGoForward(state), false);
  state = recordNavigation(state, { kind: "visit", id: "zzz", url: "/?view=stats" });
  assert.deepEqual(state, { entries: [{ id: "zzz", url: "/?view=stats" }], index: 0 }, "an entry this tab never saw starts over");
});

test("history: bounded, scroll remembered, and stored state read safely", () => {
  let state = emptyHistory();
  for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) state = recordNavigation(state, { kind: "push", id: `e${index}`, url: `/?view=tasks&p=${index}` });
  assert.equal(state.entries.length, HISTORY_LIMIT);
  assert.equal(state.index, HISTORY_LIMIT - 1);
  state = rememberScroll(state, `e${HISTORY_LIMIT + 9}`, 812.4);
  assert.equal(state.entries.at(-1)!.scrollY, 812);
  assert.equal(rememberScroll(state, "missing", 10), state);
  assert.deepEqual(parseHistory("not json"), emptyHistory());
  assert.deepEqual(parseHistory(JSON.stringify({ entries: [{ id: "a", url: "/?view=stats" }, { bad: true }], index: 9 })), { entries: [{ id: "a", url: "/?view=stats" }], index: 0 });
});

// Bottenraden (2026-10-09; plan 1O 2026-10-11: no mode for a temporary view any more): Hem and Sök always.
test("bottom bar: standard and editor", () => {
  const keys = (input: Parameters<typeof resolveBottomBar>[0]) => resolveBottomBar(input).map((slot) => slot.key);
  assert.deepEqual(keys({}), ["home", "search", "new", "save", "menu"]);
  assert.equal(resolveBottomBar({}).find((slot) => slot.key === "save")!.disabled, true, "Spara is inactive outside an editor");
  assert.equal(bottomBarMode({ editor: { canSave: true, busy: false, dirty: true } }), "editor");
  const editor = resolveBottomBar({ editor: { canSave: true, busy: false, dirty: true } });
  assert.equal(editor.find((slot) => slot.key === "save")!.disabled, false);
  assert.equal(editor.find((slot) => slot.key === "save")!.dirty, true);
  assert.equal(resolveBottomBar({ editor: { canSave: true, busy: true, dirty: true } }).find((slot) => slot.key === "save")!.disabled, true, "busy blocks Spara");
  for (const input of [{}, { editor: { canSave: true, busy: false, dirty: false } }]) {
    const all = keys(input);
    assert.deepEqual(all.slice(0, 2), ["home", "search"], "Hem and Sök are always first");
    assert.equal(new Set(all).size, all.length, "no button twice");
  }
});

// Sidor och små dialoger (2026-10-11, plan 1O): a large view exists only at level 1 on a phone.
test("dialogs: never a large view outside level 1", () => {
  for (const device of ["desktop", "tablet", "phone"] as const) for (const size of ["auto", "compact", "page", "view"] as const) {
    assert.equal(dialogPresentation({ size, device, contentHeight: 900, wasView: true }), "box", `${size} on ${device} stays a dialog when not level 1`);
  }
  assert.equal(dialogPresentation({ size: "compact", device: "phone", contentHeight: 900, native: true }), "box");
  assert.equal(dialogPresentation({ size: "view", device: "phone", native: true }), "view", "level 1 draws a screen");
  assert.equal(dialogPresentation({ size: "auto", device: "phone", contentHeight: 300, native: true }), "box");
  assert.equal(dialogPresentation({ size: "auto", device: "phone", contentHeight: 420, native: true }), "view");
  assert.equal(dialogPresentation({ size: "auto", device: "phone", contentHeight: 600, keyboard: true, native: true }), "box", "the keyboard never turns a dialog into a screen");
  assert.equal(dialogPresentation({ size: "auto", device: "phone", contentHeight: 200, wasView: true, native: true }), "view", "a screen stays until it closes");
});

// Menyn efter arbetet (2026-10-09); visibility is never permission.
const admin: MenuAccess = { memberRole: "ADMIN", workflowPermissions: defaultWorkflowPermissionProfile(), canBuildForms: true, ai: true, importPage: true };
const flat = (groups: ReturnType<typeof resolveMenu>) => groups.map((group) => group.map((entry) => entry.type === "group" ? `tools(${entry.children.join(",")})` : `${entry.type === "shortcut" ? "*" : ""}${entry.key}`));

// B1/B2 (2026-10-21, point 5): nouns in the order of the work – Inköp · Offerter · Projekt · Arbetsordrar ·
// Uppgifter · Driftronder · Tid · Kunder · Verktyg · Workflow AI. At the review (2026-10-23): no rows under Projekt
// (Planering and Projektstatistik are reached from it), Skapa formulär under Verktyg, which is called Verktyg again.
// The menu of the decisions 2026-11-01: Planering its own button, Uppgifter a tab of Arbetsordrar, Kalkylator in Verktyg.
test("menu: Planering first, the work, customers and business, Verktyg with its six pages", () => {
  assert.deepEqual(flat(resolveMenu(admin, { hidden: [], shortcuts: [] })), [
    ["planning"],
    ["work_orders", "rounds", "deviations", "maintenance", "time"],
    ["customers", "projects"],
    ["quotes", "purchases"],
    ["tools(report_archive,self_inspection,instruments,calculators,forms,import)"],
    ["ai"],
    ["administration", "operator_accounts"],
  ]);
  // Användare and Operatörskonton (2026-10-31): the company's admin only; operator accounts need Cloud, the demo has invented ones.
  const company = (access: MenuAccess) => (["administration", "operator_accounts"] as const).filter((key) => menuItemAllowed(key, access));
  assert.deepEqual(company({ ...admin, localStorageMode: true }), ["administration"]);
  assert.deepEqual(company({ ...admin, demo: true }), ["administration", "operator_accounts"]);
  assert.deepEqual(company({ ...admin, memberRole: "MEMBER" }), []);
  for (const key of ["project_planning", "project_summary", "tasks", "capacity"]) assert.ok(!(MENU_HIDEABLE as readonly string[]).includes(key), `${key} is no menu button`);
  assert.deepEqual(["planning", "purchases", "quotes", "projects", "work_orders", "rounds", "time", "customers"].map((key) => MENU_LABEL[key as keyof typeof MENU_LABEL]),
    ["Planering", "Inköp", "Offerter", "Projekt", "Arbetsordrar", "Driftronder", "Tid", "Kunder"], "the menu says nouns, never Ny …");
  assert.equal(VIEW_LABEL.tools, "Mer");
  assert.equal(TOOLS_LABEL, "Mer");
  assert.equal(VIEW_LABEL.customers, "Kunder");
  assert.deepEqual(MENU_ITEM_GROUPS.map((group) => group.title), ["Arbete", "Kunder", "Ekonomi", "Verktyg", "Assistent", "Företaget"]);
  assert.deepEqual(MENU_ITEM_GROUPS[3].items.map((item) => item.key), ["report_archive", "self_inspection", "instruments", "calculators", "forms", "import"]);
  assert.ok(!(MENU_ITEM_GROUPS[0].items as readonly { key: string }[]).some((item) => item.key === "forms"), "Skapa formulär is not under Arbetsordrar");
  // B4: Planering says what it is on the page Projekt; no menu button has a line under it since Kalender left the menu.
  assert.deepEqual(MENU_SUBTITLE, {});
  assert.equal(PROJECT_PAGE_SUBTITLE.project_planning, "Tidplaner och teamets kalender");
});

// Menyflyttarna (2026-11-02): Workflow AI is the floating button, Användare a tab of Inställningar, Operatörskonton a button on it.
test("the computer's menu: no Workflow AI, Användare or Operatörskonton, even with the page open; Mer's groups keep them", () => {
  const groups = resolveMenu(admin, { hidden: [], shortcuts: [] });
  const expected = [
    ["planning"],
    ["work_orders", "rounds", "deviations", "maintenance", "time"],
    ["customers", "projects"],
    ["quotes", "purchases"],
    ["tools(report_archive,self_inspection,instruments,calculators,forms,import)"],
  ];
  assert.deepEqual(flat(sidebarMenu(groups)), expected);
  assert.deepEqual(flat(groups).slice(-2), [["ai"], ["administration", "operator_accounts"]], "Mer's rows are unchanged");
  for (const open of ["administration", "operator_accounts"]) assert.deepEqual(flat(sidebarMenu(resolveMenu(admin, { hidden: [], shortcuts: [] }, open))), expected, `${open} open`);
  assert.deepEqual(flat(sidebarMenu(resolveMenu(admin, { hidden: ["administration", "ai"], shortcuts: [] }, "administration"))), expected, "a saved choice breaks nothing");
  // A yrkesprofil's lifted buttons never bring a row back.
  assert.deepEqual(flat(sidebarMenu(resolveMenu(admin, { hidden: [], shortcuts: [] }, null, ["administration", "time"])))[0], ["time"]);
});

test("the divider: Planering stands with Översikt, unless a yrkesprofil's buttons come between them", () => {
  const groups = sidebarMenu(resolveMenu(admin, { hidden: [], shortcuts: [] }));
  assert.equal(joinsOverview(groups, 0), true);
  assert.equal(joinsOverview(groups, 1), false);
  const lifted = sidebarMenu(resolveMenu(admin, { hidden: [], shortcuts: [] }, null, ["time", "rounds"]));
  assert.equal(joinsOverview(lifted, 0), false);
  assert.equal(joinsOverview(sidebarMenu(resolveMenu(admin, { hidden: ["planning"], shortcuts: [] })), 0), false, "no Planering: the first group draws its divider");
});

test("Workflow AI's button follows the row's rule and choice, and Local has none, on the phone either", () => {
  const choices = { hidden: [] as string[], shortcuts: [] as string[] };
  assert.equal(assistantIconAllowed(admin, choices), true);
  assert.equal(assistantIconAllowed({ ...admin, memberRole: "MEMBER" }, choices), true, "a member had the row");
  assert.equal(assistantIconAllowed({ ...admin, demo: true }, choices), true, "the demo had the row");
  assert.equal(assistantIconAllowed({ ...admin, ai: false }, choices), false, "an installation without it");
  assert.equal(assistantIconAllowed(admin, { ...choices, hidden: ["ai"] }), false, "hidden in Anpassa menyn");
  assert.equal(assistantIconAllowed({ ...admin, localStorageMode: true }, choices), false, "Local: only Kräver serverlagring");
  assert.equal(menuItemAllowed("ai", { ...admin, localStorageMode: true }), false, "no Mer row or Hem tile in Local (2026-11-02)");
});

test("Anpassa menyn: the computer offers the button but not Användare or Operatörskonton; the phone offers all", () => {
  for (const key of ["administration", "operator_accounts"] as const) {
    assert.equal(menuChoiceOffered(key, "desktop", admin), false, key);
    assert.equal(menuChoiceOffered(key, "phone", admin), true, key);
  }
  assert.equal(menuChoiceOffered("ai", "desktop", admin), true);
  assert.equal(menuChoiceOffered("ai", "desktop", { ...admin, localStorageMode: true }), false);
  assert.equal(menuChoiceOffered("ai", "phone", { ...admin, localStorageMode: true }), false);
  assert.equal(menuChoiceOffered("time", "desktop", admin), true);
  assert.equal(menuChoiceOffered("quotes", "desktop", { ...admin, memberRole: "MEMBER", workflowPermissions: { grants: [] } as never }), false, "only what the person may use");
});

test("Operatörskonton's button has the rule of the row: admin, not Local, the module Underhåll on", () => {
  assert.equal(menuItemAllowed("operator_accounts", admin), true);
  assert.equal(menuItemAllowed("operator_accounts", { ...admin, memberRole: "MEMBER" }), false);
  assert.equal(menuItemAllowed("operator_accounts", { ...admin, localStorageMode: true }), false);
  assert.equal(menuItemAllowed("operator_accounts", { ...admin, modules: ["planning"] }), false);
  assert.equal(menuItemAllowed("operator_accounts", { ...admin, modules: ["upkeep"] }), true);
});

test("menu: a button leads to its list, or to Ny … for whoever may only create", () => {
  assert.equal(menuItemHref("work_orders"), "/?view=work_orders");
  assert.equal(menuItemHref("work_orders", false), "/?view=workflow_task&taskType=WORK_ORDER");
  assert.equal(menuItemHref("projects", false), "/?view=new_project");
  assert.equal(menuItemHref("rounds"), "/?view=rounds");
  assert.equal(menuItemHref("customers", false), "/?view=customers", "a page without a create page keeps its own address");
  // Uppgifter is a tab of Arbetsordrar (2026-11-01): every job's page marks Arbetsordrar.
  for (const view of ["workflow_task", "tasks", "work_orders", "new_task", "new", "controls"]) assert.equal(menuKeyOfView(view), "work_orders", view);
  assert.equal(menuKeyOfView("purchase"), "purchases");
  assert.equal(menuKeyOfView("articles"), "purchases");
  assert.equal(menuKeyOfView("new_project"), "projects");
  assert.equal(menuKeyOfView("tools"), null);
});

// Sidrubrikerna heter som menyknappen (2026-10-23): the list's heading and the trail's last crumb.
test("menu: every button's list is called as the button", () => {
  const keys = ["planning", "purchases", "quotes", "projects", "work_orders", "rounds", "time", "customers"] as const;
  for (const key of keys) {
    assert.equal(VIEW_LABEL[key], MENU_LABEL[key], `${key}: the page's name`);
    assert.equal(labels(breadcrumbTrail({ view: key })).at(-1), MENU_LABEL[key], `${key}: the trail's last crumb`);
  }
  assert.equal(labels(breadcrumbTrail({ view: "tools" })).at(-1), TOOLS_LABEL);
  assert.equal(VIEW_LABEL.controls, "Uppgifter");
  // Planering's views (2026-11-01) lie directly under Översikt and mark Planering; the old addresses are kept.
  for (const view of ["planning", "project_planning", "capacity"]) {
    assert.deepEqual(labels(breadcrumbTrail({ view })), ["Översikt", "Planering"], view);
    assert.equal(menuKeyOfView(view), "planning", view);
  }
  assert.equal(VIEW_LABEL.tasks, "Uppgifter", "the tab's own name");
  assert.deepEqual(labels(breadcrumbTrail({ view: "tasks" })), ["Översikt", "Uppgifter"]);
  assert.equal(menuKeyOfView("project_summary"), "projects");
  assert.equal(menuKeyOfView("forms"), "forms");
});

test("menu: choices saved for the old menu are read with today's keys", () => {
  // Ny X / Mina X and Verktyg (before point 5) → the button that holds them now; unknown keys dropped, no doubles.
  // Uppgifter (`tasks`) is a tab of Arbetsordrar since 2026-11-01: a saved one is read silently as Arbetsordrar. `planning` is
  // a button again: the button Planering.
  assert.deepEqual(normalizeMenuHidden(["purchase", "articles", "quote", "new_project", "new_task", "controls", "tasks", "new", "credits", 7, "planning", "planning"]), ["purchases", "quotes", "projects", "planning"]);
  assert.deepEqual(normalizeMenuHidden(["tools"]), ["report_archive", "self_inspection", "instruments", "import"], "the whole Verktyg group hides the four Register pages, not Kunder");
  assert.deepEqual(preferencesSchema.parse({ hiddenMenuItems: ["new_task", "customers", "tools"] }).hiddenMenuItems, ["customers", "report_archive", "self_inspection", "instruments", "import"]);
  // A Kunder shortcut (from when Kunder was under Verktyg) is now the button Kunder itself.
  assert.deepEqual(preferencesSchema.parse({ menuShortcuts: ["customers", "instruments"] }).menuShortcuts, ["instruments"]);
  assert.deepEqual(menuChoicesOf({ hidden: ["quote"], shortcuts: ["customers", "import"] }), { hidden: ["quotes"], shortcuts: ["import"] });
  assert.deepEqual(flat(resolveMenu(admin, { hidden: [], shortcuts: ["customers"] }))[2], ["customers", "projects"], "shown once, as its own button");
  assert.ok(flat(resolveMenu(admin, { hidden: ["tasks", "new_task"], shortcuts: [] })).flat().includes("work_orders"), "having hidden Uppgifter never hides Arbetsordrar");
  assert.ok(!flat(resolveMenu(admin, { hidden: ["quote"], shortcuts: [] })).flat().includes("quotes"), "an old key hides its button");
  assert.ok(flat(resolveMenu(admin, { hidden: ["work_orders"], shortcuts: [] }, "work_orders")).flat().includes("work_orders"), "the open page is shown even when hidden");
  assert.ok(flat(resolveMenu(admin, { hidden: ["new_task"], shortcuts: [] })).flat().includes("tools(report_archive,self_inspection,instruments,calculators,forms,import)"), "Skapa formulär stays, under Verktyg");
  // The old Verktyg choice hid its four pages then; Skapa formulär was not among them and stays shown.
  assert.deepEqual(flat(resolveMenu(admin, { hidden: ["tools"], shortcuts: [] }))[4], ["tools(calculators,forms)"]);
  // Projektstatistik and the old Tidplan key are no buttons: a saved hidden one is dropped, the rest kept.
  assert.deepEqual(normalizeMenuHidden(["project_planning", "project_summary", "forms", "quotes"]), ["forms", "quotes"]);
  assert.deepEqual(preferencesSchema.parse({ hiddenMenuItems: ["project_summary", "time"] }).hiddenMenuItems, ["time"]);
  // Skapa formulär can be a shortcut like Verktyg's other pages.
  assert.deepEqual(preferencesSchema.parse({ menuShortcuts: ["forms", "project_planning"] }).menuShortcuts, ["forms"]);
  assert.deepEqual(flat(resolveMenu(admin, { hidden: [], shortcuts: ["forms"] }))[4], ["tools(report_archive,self_inspection,instruments,calculators,import)", "*forms"]);
});

test("menu: hiding and shortcuts are display only; an open page stays shown", () => {
  const groups = resolveMenu(admin, { hidden: ["project_planning", "instruments", "quotes"], shortcuts: ["report_archive"] });
  assert.deepEqual(flat(groups), [["planning"], ["work_orders", "rounds", "deviations", "maintenance", "time"], ["customers", "projects"], ["purchases"], ["tools(self_inspection,calculators,forms,import)", "*report_archive"], ["ai"], ["administration", "operator_accounts"]],
    "a shortcut is the same page, shown once – not also in the group; a saved hidden old key breaks nothing");
  assert.ok(flat(resolveMenu(admin, { hidden: ["time"], shortcuts: [] }, "time")).flat().includes("time"), "the open page is shown even when hidden");
  assert.ok(flat(resolveMenu(admin, { hidden: ["planning"], shortcuts: [] }, menuKeyOfView("capacity"))).flat().includes("planning"), "Planering's view shows a hidden Planering while open");
  // Without the right the button is not offered, shortcut or not; with the right, hiding it never removes the right.
  const member: MenuAccess = { memberRole: "MEMBER", workflowPermissions: noWorkflowPermissionProfile() };
  assert.deepEqual(flat(resolveMenu(member, { hidden: [], shortcuts: ["customers", "report_archive"] })), [["deviations"], ["tools(self_inspection,instruments,calculators)"]]);
  assert.equal(menuItemAllowed("customers", member), false);
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  assert.equal(menuItemAllowed("work_orders", { memberRole: "MEMBER", workflowPermissions: field }), true);
  // Local and the demo have no quotes, report archive or import.
  const local = flat(resolveMenu({ ...admin, localStorageMode: true }, { hidden: [], shortcuts: [] })).flat();
  for (const key of ["quotes", "report_archive", "import"]) assert.ok(!local.some((entry) => entry.includes(key)), key);
  assert.equal(menuKeyOfView("workflow_task"), "work_orders");
  assert.equal(menuKeyOfView("place"), "customers");
  // Projektsammanställning follows the server (/api/project-statistics): in Cloud for admins, or Teamet with the project
  // right (2026-10-28) – a tab of Projekt now.
  assert.equal(projectPageAllowed("project_summary", admin), true);
  assert.equal(projectPageAllowed("project_summary", { ...admin, memberRole: "MEMBER", workflowPermissions: { version: 1, grants: ["projects:read"] } }), false, "the project right alone is not Teamet");
  assert.equal(projectPageAllowed("project_summary", { ...admin, memberRole: "MEMBER", workflowPermissions: { version: 1, grants: ["team:read"] } }), false, "Teamet alone does not read projects");
  assert.equal(projectPageAllowed("project_summary", { ...admin, memberRole: "MEMBER", workflowPermissions: { version: 1, grants: ["team:read", "projects:read"] } }), true);
  assert.equal(projectPageAllowed("project_summary", { ...admin, localStorageMode: true }), false);
  assert.equal(projectPageAllowed("project_planning", { ...admin, localStorageMode: true }), false, "Local has no Tidplan");
  assert.equal(projectPageAllowed("project_planning", { memberRole: "MEMBER", workflowPermissions: noWorkflowPermissionProfile() }), false);
  assert.deepEqual(labels(breadcrumbTrail({ view: "project_summary" })), ["Översikt", "Projekt", "Projektstatistik"]);
  assert.deepEqual(menuChoicesOf(["time"]), { hidden: ["time"], shortcuts: [] }, "an older event with the hidden list alone");
  assert.deepEqual(menuChoicesOf(["project_planning"]), { hidden: [], shortcuts: [] }, "a key that is no button is dropped");
  assert.deepEqual(preferencesSchema.parse({ menuShortcuts: ["report_archive", "planning", "report_archive", "credits"] }).menuShortcuts, ["report_archive"], "only sub-pages can be shortcuts");
  assert.deepEqual(preferencesSchema.parse({}).menuShortcuts, []);
});

// Formulär som sidor (plan 1O, 2026-10-11): each form has an address and a trail under the page it belongs to.
test("forms as pages: breadcrumbs under their own list or record", () => {
  const labels = (trail: ReturnType<typeof breadcrumbTrail>) => trail.map((crumb) => crumb.label);
  assert.deepEqual(labels(breadcrumbTrail({ view: "new_project" })), ["Översikt", "Projekt", "Nytt projekt"]);
  const edit = breadcrumbTrail({ view: "project", params: { projectId: "p1", edit: "1" }, labels: { project: "Garaget" } });
  assert.deepEqual(labels(edit), ["Översikt", "Projekt", "Garaget", "Redigera projekt"]);
  assert.equal(edit[2].href, "/?view=project&projectId=p1", "the project crumb leads back to the project");
  assert.equal(edit[3].href, null);
  assert.equal(labels(breadcrumbTrail({ view: "project", params: { projectId: "p1", link: "1" }, labels: { project: "Garaget" } })).at(-1), "Koppla befintlig uppgift");
  assert.equal(labels(breadcrumbTrail({ view: "project", params: { projectId: "p1", new: "1" } })).at(-1), "Ny planering");
  assert.equal(labels(breadcrumbTrail({ view: "project", params: { projectId: "p1", activityId: "a1", edit: "1" } })).at(-1), "Redigera planering");
  assert.deepEqual(labels(breadcrumbTrail({ view: "planning", params: { new: "1" } })), ["Översikt", "Planering", "Ny planering"]);
  assert.equal(breadcrumbTrail({ view: "planning", params: { new: "1" } })[1].href, "/?view=planning", "back to Planering's Kalender");
  assert.deepEqual(labels(breadcrumbTrail({ view: "planning", params: { activityId: "a1", edit: "1" } })), ["Översikt", "Planering", "Redigera planering"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "rounds", params: { new: "1" } })), ["Översikt", "Driftronder", "Ny driftrond"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "rounds", params: { roundId: "r1", edit: "1" } })), ["Översikt", "Driftronder", "Ändra rond"]);
  assert.equal(labels(breadcrumbTrail({ view: "place", params: { placeId: "x", new: "1" }, labels: { place: "Garage" } })).at(-1), "Ny plats");
  assert.equal(labels(breadcrumbTrail({ view: "place", params: { placeId: "x", edit: "1" }, labels: { place: "Garage" } })).at(-1), "Redigera plats");
  assert.deepEqual(labels(breadcrumbTrail({ view: "rounds" })), ["Översikt", "Driftronder"], "the list itself, called as its menu button");
});

// Popup eller sida (2026-10-11, plan 1Q): the size decides, the display decides how.
test("formPresentation: a form is a popup only on display 3 in a wide window, a page on display 2, a screen on display 1", () => {
  const sizes = ["auto", "form", "page", "view"] as const;
  for (const size of sizes) assert.equal(formPresentation({ level: 1, width: 390, size }), "screen", `${size} at level 1 is a screen`);
  assert.equal(formPresentation({ level: 3, width: 1440, size: "form" }), "popup", "display 3, computer");
  assert.equal(formPresentation({ level: 3, width: 768, size: "form" }), "popup", "display 3 from 768 px");
  assert.equal(formPresentation({ level: 3, width: 767, size: "form" }), "page", "display 3 on a narrow phone is a page");
  assert.equal(formPresentation({ level: 3, width: 390, size: "form" }), "page");
  for (const width of [390, 768, 1024, 1440]) assert.equal(formPresentation({ level: 2, width, size: "form" }), "page", `display 2 at ${width} px is a page`);
  for (const level of [2, 3] as const) for (const width of [390, 1440]) for (const size of ["auto", "page", "view"] as const) {
    assert.equal(formPresentation({ level, width, size }), "page", `${size} is always a page at display ${level}`);
  }
  for (const level of [1, 2, 3] as const) assert.equal(formPresentation({ level, width: 1440, size: "compact" }), "popup", "a small dialog is always a small dialog");
  assert.equal(dialogPresentation({ size: "form", device: "phone", native: true }), "view", "a form is a screen at level 1");
  assert.equal(dialogPresentation({ size: "form", device: "desktop", contentHeight: 900 }), "box");
});

// B1 (point 5) replaces plan 1Q's Ny/Mina pairs: every work button is a plain noun with no fold arrow – Driftronder too.
test("menu: Driftronder is one button like Arbetsordrar, without Ny/Mina", () => {
  const entries = resolveMenu(admin, { hidden: [], shortcuts: [] }).flat();
  for (const key of ["planning", "purchases", "quotes", "projects", "work_orders", "rounds", "time", "customers"]) {
    assert.ok(entries.some((entry) => entry.type === "link" && entry.key === key), `${key} is a button`);
  }
  assert.ok(entries.every((entry) => entry.type !== "link" || Object.keys(entry).length === 2), "no rows folded under them");
  // Hiding the button hides it; the open page (the list or the form) is still shown.
  assert.ok(!resolveMenu(admin, { hidden: ["rounds"], shortcuts: [] }).flat().some((entry) => entry.key === "rounds"));
  assert.ok(resolveMenu(admin, { hidden: ["rounds"], shortcuts: [] }, "rounds").flat().some((entry) => entry.key === "rounds"));
  assert.equal(VIEW_LABEL.rounds, "Driftronder");
  assert.equal(menuKeyOfView("rounds"), "rounds");
});

// The menu group of a view (plan 1S; the names of B1/B2): the site map's colours. No page shows it as an eyebrow since
// 2026-10-30 (Fasta platser) – the PageHeader has none.
test("every view names its menu group (plan 1S; the names of B1/B2)", () => {
  assert.equal(viewGroupLabel("project_planning"), "Planering");
  assert.equal(viewGroupLabel("project_summary"), "Projekt");
  assert.equal(viewGroupLabel("planning"), "Planering");
  assert.equal(viewGroupLabel("capacity"), "Planering");
  assert.equal(viewGroupLabel("tasks"), "Arbetsordrar", "Uppgifter is a tab of Arbetsordrar");
  assert.equal(viewGroupLabel("time"), "Tid");
  assert.equal(viewGroupLabel("work_orders"), "Arbetsordrar");
  assert.equal(viewGroupLabel("instruments"), "Mer");
  assert.equal(viewGroupLabel("forms"), "Mer");
  assert.equal(viewGroupLabel("customers"), "Kunder");
  assert.equal(viewGroupLabel("place"), "Kunder");
  assert.equal(viewGroupLabel("company"), "Inställningar");
  assert.equal(viewGroupLabel("customer_companies"), "Installation");
  assert.equal(viewGroupLabel("nope"), null);
});

test("the company's own places have Företag in their trail, never Kunder (Eget företag, 2026-10-24)", () => {
  const trail = breadcrumbTrail({ view: "customers", params: { customerId: "c-own" }, labels: { customer: "QA AB", ownCompany: true } });
  assert.deepEqual(trail.map((crumb) => crumb.label).slice(1), ["Företag", "Företagets platser"]);
});

test("the company's own places mark Inställningar in the menu and Mer on the phone, not Kunder (2026-10-24)", () => {
  const view = menuViewOfPage("customers", { customer: "QA AB", ownCompany: true });
  assert.equal(view, "company");
  assert.ok((COMPANY_VIEWS as readonly string[]).includes(view), "a page under Inställningar");
  assert.equal(menuKeyOfView(view), null, "no main-menu button, so Kunder is not marked");
  assert.equal(nativeActiveTab(["home", "jobs", "customers"], view, false), "more");
  // A customer's own page, and a page whose names are not known yet, keep Kunder.
  assert.equal(menuViewOfPage("customers", { customer: "Kund AB" }), "customers");
  assert.equal(menuViewOfPage("customers", null), "customers");
  assert.equal(menuViewOfPage("place", { ownCompany: true }), "place");
  assert.equal(menuViewOfPage("workflow_task", {}, "c1"), "customers", "a job opened from a customer's page marks Kunder (N14)");
  assert.equal(menuViewOfPage("workflow_task", {}), "workflow_task");
  assert.deepEqual(breadcrumbTrail({ view: "workflow_task", params: { taskId: "t1", taskType: "FORM", projectId: "p1", fromCustomer: "c1" }, labels: { task: "Protokoll", customer: "Kund AB", project: "Bygget" } }).map((item) => item.label), ["Översikt", "Kunder", "Kund AB", "Protokoll"], "the way there, not the project's");
  // The shell keeps the page's trail and marks the menu and the tab row by it.
  const shell = readFileSync("components/app-shell.tsx", "utf8");
  assert.ok(shell.includes("const menuView = menuViewOfPage(view, shellTrail.labels, navParams.fromCustomer);"));
  assert.ok(shell.includes("const openMenuKey = menuKeyOfView(menuView, invoicesButton);"));
  assert.ok(shell.includes("(COMPANY_VIEWS as readonly string[]).includes(menuView)"));
  assert.ok(shell.includes("<NavigationProvider view={view} params={navParams} trail={shellTrail.trail}>"));
  assert.ok(shell.includes("<NativeTabBar view={view} menuView={menuView}"));
  assert.ok(readFileSync("components/native/tab-bar.tsx", "utf8").includes("activeTab(tabs, menuView, tabOfPage === \"jobs\", params.get(\"tab\"))"));
});

test("an opened offer names its breadcrumb by its title, as its heading (resor per yrkesprofil 2026-11-03)", () => {
  // The journey found Översikt › Offerter › Offert under the heading of the offer: the editor gave the trail no name.
  assert.deepEqual(breadcrumbTrail({ view: "quote", params: { quoteId: "q1" }, labels: { quote: "Byte av elcentral" } }).at(-1), { label: "Byte av elcentral", href: null });
  assert.match(readFileSync("features/quotes/quote-editor.tsx", "utf8"), /usePageTrail\(\{ quote: quote\?\.title/);
});

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { ALWAYS_ON_ROUTES, MODULE_KEYS, MODULE_ROUTES, type ModuleKey } from "../lib/workflow/modules";

/**
 * Företagets moduler (0.39.0): the guard. Read from the code, so a new route in a module, or a write that forgets the module, stops here
 * and not in production. A route of an optional module is either `write` (every change goes through requireModule, or the same rule by
 * another way in) or `read` (it only reads, so the history stays open). What the server does at run time is proved by
 * tests/modules.integration.ts.
 */
const API = "app/api";
const read = (file: string) => readFileSync(file, "utf8");

function routesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routesUnder(path);
    return name === "route.ts" ? [relative(API, dir).split(sep).join("/")] : [];
  });
}
const ALL_ROUTES = routesUnder(API);

/** Addresses that belong to an optional module: whatever is added under one must be classified. */
const MODULE_ADDRESS = /^(customer-card|records|projects?(\/|$)|project-|planned-activities|planning-capacity|form-schedules|maintenance|machine-sources|ingest|workflow-time|time-periods|payroll|absence|quotes|customer-quote|invoice-bases|purchases|catalogue|staff-register|self-inspection|boards|website|meta(\/|$)|linkedin|youtube|schedule$)/;

/** Where a route's handlers really are: some routes hand over to lib/. */
const HANDLER_FILE: Record<string, string> = {
  "machine-sources": "lib/api-handlers/machine-sources.ts",
  "ingest/v1/events": "lib/api-handlers/ingest-events.ts",
  "ingest/v1/raw": "lib/api-handlers/ingest-raw.ts",
  absence: "lib/absence/server.ts",
  "staff-register": "lib/staff-register/routes.ts",
  "ai/quote": "lib/api-handlers/ai-quote.ts",
  "customer-quote": "lib/quotes/customer-link-server.ts",
  // Webb och inlägg (2026-11-20): the core routes hand over to lib/api-handlers (lib/extensions/core-routes.ts).
  website: "lib/api-handlers/website.ts",
  "website/media": "lib/api-handlers/website-media.ts",
  "website/frame": "lib/api-handlers/website-frame.ts",
  meta: "lib/api-handlers/meta.ts",
  "meta/posts": "lib/api-handlers/meta-posts.ts",
  linkedin: "lib/api-handlers/linkedin.ts",
  "linkedin/callback": "lib/api-handlers/linkedin-callback.ts",
  schedule: "lib/api-handlers/schedule.ts",
  // YouTube (2026-11-20).
  youtube: "lib/api-handlers/youtube.ts",
  "youtube/callback": "lib/api-handlers/youtube-callback.ts",
  "youtube/videos": "lib/api-handlers/youtube-videos.ts",
};
const handlerFile = (route: string) => HANDLER_FILE[route] ?? `${API}/${route}/route.ts`;

/** The rule by another way in, where the ordinary call does not fit. */
const OTHER_WAY: Record<string, RegExp> = {
  "ingest/v1/events": /principal\.intakeOff\) return refuseMachineIntake\(/,
  "ingest/v1/raw": /principal\.intakeOff\) return refuseMachineIntake\(/,
  "customer-quote": /!organizationModuleOn\(found\.organization, "quotes"\)\) throw new ApiError\(409/,
  "customer-card": /requireCustomersOrOwn\(ctx, input\.customerId\)/,
  "staff-register": /requireModule\(ctx, "staff_register"\)/,
};

/** The body of one exported handler in a file: from its export to the next export of a handler, or the end. */
function handlerBody(source: string, method: string) {
  const start = source.search(new RegExp(`export (async function|const) ${method}\\b`));
  if (start < 0) return null;
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport (async function|const) (GET|POST|PUT|PATCH|DELETE)\b/);
  return next < 0 ? rest : rest.slice(0, next);
}

const writeRoutes = (MODULE_KEYS as readonly ModuleKey[]).flatMap((key) => MODULE_ROUTES[key].write.map((route) => ({ key, route })));
const readRoutes = (MODULE_KEYS as readonly ModuleKey[]).flatMap((key) => MODULE_ROUTES[key].read.map((route) => ({ key, route })));

test("every route listed for a module exists", () => {
  for (const { route } of [...writeRoutes, ...readRoutes]) assert.ok(ALL_ROUTES.includes(route), `${route} is a route`);
  for (const route of ALWAYS_ON_ROUTES) assert.ok(ALL_ROUTES.includes(route), `${route} is a route`);
  assert.ok(ALL_ROUTES.length > 100, "the walk found the routes");
});

test("every route at a module's address is classified: a new route cannot be forgotten", () => {
  const known = new Set([...writeRoutes, ...readRoutes].map((item) => item.route).concat(ALWAYS_ON_ROUTES));
  const missing = ALL_ROUTES.filter((route) => MODULE_ADDRESS.test(route) && !known.has(route));
  assert.deepEqual(missing, []);
});

test("every write route calls the module's check", () => {
  for (const { key, route } of writeRoutes) {
    const file = handlerFile(route);
    assert.ok(existsSync(file), file);
    const source = read(file);
    const rule = OTHER_WAY[route] ?? new RegExp(`requireModule\\(ctx, "${key}"\\)`);
    // A route shared by two modules is listed under both and must name both; a shared one is the workspace's customer actions.
    if (route === "customer-card" && key === "customers") assert.match(source, OTHER_WAY[route], route);
    else assert.match(source, rule, `${route} (${file}) must check ${key}`);
  }
});

test("the check is in the handler that changes something, and never in one that reads", () => {
  for (const { key, route } of writeRoutes) {
    const source = read(handlerFile(route));
    const rule = OTHER_WAY[route] ?? new RegExp(`requireModule\\(ctx, "${key}"\\)`);
    if (HANDLER_FILE[route] === "lib/quotes/customer-link-server.ts") continue;
    const reading = handlerBody(source, "GET");
    if (reading) assert.equal(/requireModule\(/.test(reading), false, `${route}: GET stays open, so the history can be read`);
    if (route === "workspace") continue; // its other actions are the settings, always on; the customer actions are checked below
    // The staff register's handlers are named functions the route calls.
    const writing = route === "staff-register" ? source.slice(source.indexOf("export async function staffRegisterPost"), source.indexOf("export async function staffRegisterExport")) : handlerBody(source, "POST") ?? handlerBody(source, "DELETE");
    assert.ok(writing, `${route} has a handler that writes`);
    assert.match(writing, rule, `${route}: the writing handler checks ${key}`);
  }
});

test("the workspace route: the customer actions are checked, and turning modules on goes before Cloud's own checks", () => {
  const source = read(`${API}/workspace/route.ts`);
  assert.match(source, /action === "customer_save"\) \{\s+requireModule\(ctx, "customers"\);/);
  assert.match(source, /customer_purge"\]\.includes\(action\)\s+\) \{\s+requireModule\(ctx, "customers"\);/);
  const modules = source.indexOf('action === "modules"');
  assert.ok(modules > 0);
  assert.ok(modules < source.indexOf('action === "own_company"'), "own_company stays open with Kunder off");
  assert.ok(modules < source.lastIndexOf("requireCloudStorage(ctx)"), "Local sets its modules too, as display");
  assert.match(source.slice(modules, modules + 200), /requireAdmin\(ctx\)/, "only the company's admin");
  assert.match(read("lib/workflow/modules-server.ts"), /administrationEvent\.create\(\{ data: \{ actorId: ctx\.user\.id, organizationId: ctx\.organizationId, action: "company_modules"/, "audited");
  assert.equal(/requireModule\(ctx, "customers"\);\s+return NextResponse\.json\(await ensureOwnCompany/.test(source), false);
});

test("a read route has no handler that changes anything", () => {
  // These two read by POST: a customer's PDF of an answered quote and an address lookup.
  const readByPost = new Set(["customer-quote/pdf", "places/address-lookup"]);
  for (const { route } of readRoutes) {
    if (readByPost.has(route)) continue;
    const source = read(handlerFile(route));
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(handlerBody(source, method), null, `${route} ${method}`);
  }
});

test("reads by POST stay open: the payroll file and the pay basis can always be exported", () => {
  const source = read(`${API}/payroll/route.ts`);
  assert.match(source, /if \(!READ_ACTIONS\.has\(input\.action\)\) requireModule\(ctx, "time"\)/);
  assert.match(read(`${API}/quotes/export/route.ts`), /if \(input\.action === "fortnox_send"\) requireModule\(ctx, "quotes"\)/);
  assert.match(read(`${API}/invoice-bases/export/route.ts`), /if \(input\.action === "fortnox_send"\) requireModule\(ctx, "invoicing"\)/);
});

test("the Kontrollvy and the export of Personalliggare never stop; a person checked in can check out", () => {
  const source = read("lib/staff-register/routes.ts");
  assert.equal(/requireModule/.test(source.slice(source.indexOf("export async function staffRegisterGet"), source.indexOf("export async function staffRegisterPost"))), false);
  assert.equal(/requireModule/.test(source.slice(source.indexOf("export async function staffRegisterExport"))), false);
  assert.match(source, /if \(!\(input\.action === "correct" \|\| \(input\.action === "check" && input\.kind === "OUT"\)\)\) requireModule\(ctx, "staff_register"\)/);
});

test("a running timer can always be stopped", () => {
  assert.match(read(`${API}/workflow-time/route.ts`), /if \(!\(input\.action === "project_timer" && input\.command === "PAUSE"\)\) requireModule\(ctx, "time"\)/);
  assert.match(read(`${API}/workflow-tasks/route.ts`), /if \(input\.command === "START"\) requireModule\(ctx, "time"\)/);
});

test("the deviation routes under self-inspection are not stopped", () => {
  for (const route of ALWAYS_ON_ROUTES) assert.equal(/requireModule\(/.test(read(`${API}/${route}/route.ts`)), false, route);
  const main = read(`${API}/self-inspection/route.ts`);
  assert.match(main, /if \(selfInspectionActionNeedsModule\(input\.action\)\) requireModule\(ctx, "self_inspection"\)/);
  // The two actions before the schema are a deviation's work order and an alarm's deviation: both always on.
  assert.ok(main.indexOf("createWorkOrderFromDeviation(ctx") < main.indexOf("selfInspectionActionNeedsModule(input.action)"));
  assert.ok(main.indexOf("createDeviationFromAlarmOrder(ctx") < main.indexOf("selfInspectionActionNeedsModule(input.action)"));
});

test("prices are set with Offerter off: the settings are checked before the module", () => {
  const source = read(`${API}/quotes/route.ts`);
  assert.ok(source.indexOf('input.action === "settings"') < source.indexOf('requireModule(ctx, "quotes")'));
});

test("API, MCP and AI tools go through the same routes: the registry never writes by itself", () => {
  const registry = read("lib/tools/registry.ts");
  assert.equal(/prisma\./.test(registry), false, "no database in the tools");
  assert.match(registry, /callRoute\(tasksRoute\.POST/);
  assert.match(read("lib/api-handlers/v1-tool.ts"), /dispatchTool\(principal, name, input\)/);
  assert.match(read("lib/tools/dispatch.ts"), /runTool\(/);
  assert.match(read("lib/api-handlers/mcp.ts"), /dispatchTool\(/);
  // The proposals the assistant applies, and the import's rows, come back through the same routes and tools.
  assert.match(read("lib/api-handlers/ai-proposals.ts"), /callRoute\(quotesRoute\.POST/);
  assert.match(read("lib/api-handlers/import.ts"), /runTool\(TOOL_OF\[item\.kind\]/);
});

test("the import's own writes check their modules", () => {
  const source = read("lib/api-handlers/import.ts");
  assert.match(source, /absence_apply"\) \{\s+requireModule\(ctx, "time"\)/);
  assert.match(source, /employee_numbers_apply"\) \{ requireModule\(ctx, "time"\)/);
  assert.match(source, /requireCloudWriteAccess\(ctx\);\s+requireModule\(ctx, "self_inspection"\);/);
});

test("every background job respects the module", () => {
  for (const [file, key] of [
    ["lib/workflow/round-reminder-worker.ts", "rounds"], ["lib/maintenance/plan-server.ts", "upkeep"], ["lib/machine/rule-engine.ts", "upkeep"],
    ["lib/machine/alarm-escalation-store.ts", "upkeep"], ["lib/operator/on-call-store.ts", "upkeep"],
    ["lib/schedule/server.ts", "web_posts"], ["lib/youtube/videos-server.ts", "web_posts"],
  ] as const) assert.match(read(file), new RegExp(`moduleOnWhere\\("${key}"\\)`), file);
  // The mail and push of notices, machine alarms among them, come from the same function as the bell.
  assert.match(read("lib/machine/alarm-delivery.ts"), /runNoticeDelivery\(/);
  assert.match(read("lib/workflow/notice-delivery.ts"), /loadCloudNotifications\(ctx, now\)/);
  const notices = read("lib/workflow/task-notifications-server.ts");
  for (const part of ['on("rounds")', 'on("upkeep")', 'on("quotes")', 'on("time")']) assert.ok(notices.includes(part), part);
  assert.match(read("lib/ai/daily-digest-server.ts"), /collectDigestFacts\(organizationId, day, disabledOf\.get\(organizationId\)\)/);
});

test("a plan's vilande work orders stay vilande while Underhåll is off, in every list that hides them", () => {
  for (const file of ["app/api/work-items/route.ts", "lib/workflow/my-day-server.ts", "lib/overview/team-server.ts", "lib/calendar/feed-server.ts"]) {
    const source = read(file);
    assert.match(source, /notDormantSql\("t", dormantDay\(/, file);
    assert.equal(/notDormantSql\("t", (swedishDayKey|today)/.test(source), false, `${file}: no list compares with the plain day`);
  }
  assert.match(read(`${API}/workflow-tasks/route.ts`), /maintenancePlanId && organizationModuleOn\(organization, "upkeep"\)/);
});

test("the summaries read the modules", () => {
  for (const [file, part] of [
    ["lib/overview/team-server.ts", 'on("time")'], ["lib/overview/team-server.ts", 'on("planning")'], ["lib/overview/me-server.ts", "timeOn"], ["lib/workflow/my-day-server.ts", 'organizationModuleOn(ctx.organization, "rounds")'],
    ["lib/overview/economy-server.ts", 'organizationModuleOn(ctx.organization, "invoicing")'], ["lib/overview/customers-server.ts", 'organizationModuleOn(ctx.organization, "quotes")'], ["app/api/overview-kpis/route.ts", 'organizationModuleOn(ctx.organization, "time")'],
    ["app/api/planning-capacity/route.ts", "activitiesInUse("], ["lib/overview/team-server.ts", "activitiesInUse("],
  ] as const) assert.ok(read(file).includes(part), `${file}: ${part}`);
});

test("the shell's new choices and the job's and project's panels read the modules", () => {
  const shell = read("components/app-shell.tsx");
  assert.match(shell, /project: canWorkflow\("projects", "create"\) && moduleIsOn\("projects"\), customer: canWorkflow\("customers", "create"\) && moduleIsOn\("customers"\), quote: canQuotes\("edit"\) && !user\?\.localStorageMode && moduleIsOn\("quotes"\)/);
  const editor = read("features/workflow/workflow-task-editor.tsx");
  for (const key of ["customers", "projects", "rounds", "planning", "staff_register", "time", "upkeep", "self_inspection", "invoicing", "purchasing", "quotes"]) assert.ok(editor.includes(`moduleIsOn("${key}")`), `the job's panels: ${key}`);
  const projects = read("features/kfid/workflow-projects.tsx");
  for (const key of ["planning", "time", "quotes", "invoicing", "staff_register", "projects", "rounds", "upkeep"]) assert.ok(projects.includes(`moduleIsOn("${key}")`), `the project's panels: ${key}`);
});

test("Webb och inlägg (2026-11-20): every way a company is made starts with it off, and the migration only adds to the list", () => {
  for (const file of ["lib/auth/registration.ts", `${API}/superadmin/customer-companies/route.ts`, `${API}/administration/route.ts`]) {
    assert.match(read(file), /disabledModules: \[\.\.\.NEW_COMPANY_DISABLED_MODULES\]/, file);
  }
  const sql = read("prisma/migrations/20261121120000_web_posts_module/migration.sql");
  assert.equal(/\b(DROP|DELETE|TRUNCATE|RENAME|ALTER)\b/i.test(sql.replace(/^--.*$/gm, "")), false, "data only");
  assert.match(sql, /array_append\(o\."disabledModules", 'web_posts'\)/);
  assert.match(sql, /o\."slug" LIKE 'company-%'/, "the installation's own and seeded companies keep it");
  for (const table of ["WebsiteConnection", "MetaConnection", "LinkedInConnection", "SocialPost", "ContentSeries", "ScheduledPublish", "PostingRhythm", "WebsitePageDraft"]) {
    assert.ok(sql.includes(`FROM "${table}"`), `a company with ${table} keeps it on`);
  }
  // What can always be done while it is off: remove a connection, stop a run, cancel a scheduled item.
  for (const file of ["lib/api-handlers/website.ts", "lib/api-handlers/meta.ts", "lib/api-handlers/linkedin.ts", "lib/api-handlers/youtube.ts"]) assert.match(read(file), /if \(!reads && input\.action !== "disconnect"\) requireModule\(ctx, "web_posts"\)/, file);
  assert.match(read("lib/api-handlers/meta-posts.ts"), /input\.action !== "cancel-publish"\) requireModule\(ctx, "web_posts"\)/);
  assert.match(read("lib/api-handlers/schedule.ts"), /if \(input\.action !== "cancel"\) requireModule\(ctx, "web_posts"\)/);
  assert.match(read("lib/api-handlers/youtube-videos.ts"), /input\.action !== "cancel-upload" && input\.action !== "delete"\) requireModule\(ctx, "web_posts"\)/);
});

test("the core works without ee/, and the migration only adds", () => {
  for (const file of ["lib/workflow/modules.ts", "lib/workflow/modules-server.ts", "features/workflow/use-modules.ts", "lib/machine/intake-off.ts"]) assert.equal(/from "@\/ee|from "\.\.?\/.*\bee\//.test(read(file)), false, file);
  const name = "20261101233000_company_modules";
  assert.ok(name > "20261101231000", "after the other track's room");
  const sql = read(`prisma/migrations/${name}/migration.sql`);
  assert.equal(/\b(DROP|DELETE|TRUNCATE|RENAME)\b/i.test(sql), false);
  assert.match(sql, /ADD COLUMN "disabledModules" TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\]/);
});

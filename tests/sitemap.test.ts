// Webbplatskartan (2026-10-24: "en del av avancerade inställningar för produktionsadmin. Man ska även kunna tända
// och släcka om jag är prodadmin, kundföretag eller användare."): the generator marks every box and line with the roles
// that reach it, the map is served to the superadmin alone, and its data never reaches public/ or the client bundle.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SITEMAP_FILE_PARTS, sitemapAccess } from "../lib/sitemap/access";
import { rolesFor, runsText, seenVisible, testedText } from "../lib/sitemap/observed";
import { SITEMAP_ROLES, type SitemapData } from "../lib/sitemap/types";
import { COMPANY_VIEWS, PRODUCT_VIEWS } from "../lib/workflow/settings-tabs";

const root = path.join(__dirname, "..");
const generator = createRequire(__filename)("../scripts/sitemap/generate.cjs") as {
  buildSitemap: (options?: { repo?: string; observed?: unknown }) => SitemapData;
  writeHtml: (data: SitemapData, file: string) => void;
  DEFAULT_OUT: (repo: string) => string;
};
let cached: SitemapData | null = null;
const map = () => (cached ??= generator.buildSitemap({ repo: root }));
const node = (id: string) => {
  const found = map().nodes.find((item) => item.id === id);
  assert.ok(found, `${id} is on the map`);
  return found;
};
const edge = (from: string, to: string, cat?: string) => {
  const found = map().edges.find((item) => item.from === from && item.to === to && (!cat || item.cat === cat));
  assert.ok(found, `${from} → ${to} is on the map`);
  return found;
};
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("every box and line carries the roles that reach it", () => {
  const data = map();
  assert.deepEqual(data.roles, [...SITEMAP_ROLES]);
  for (const item of [...data.nodes, ...data.edges]) {
    assert.ok(Array.isArray(item.roles), `${"id" in item ? item.id : `${item.from} → ${item.to}`} has roles`);
    for (const role of item.roles) assert.ok(SITEMAP_ROLES.includes(role), `known role ${role}`);
  }
  // The superadmin reaches every box; a member reaches fewer than an admin.
  assert.equal(data.stats.byRole.superadmin, data.nodes.length);
  assert.ok(data.stats.byRole.admin < data.stats.byRole.superadmin);
  assert.ok(data.stats.byRole.member < data.stats.byRole.admin);
});

test("Installation is the superadmin's, the company's pages the admins', Översikt everyone's", () => {
  for (const view of PRODUCT_VIEWS) {
    const found = map().nodes.find((item) => item.id === `v:${view}`);
    if (found) assert.deepEqual(found.roles, ["superadmin"], view);
  }
  for (const view of COMPANY_VIEWS) {
    const found = map().nodes.find((item) => item.id === `v:${view}`);
    if (found) assert.deepEqual(found.roles, ["superadmin", "admin"], view);
  }
  assert.deepEqual(node("g:produkt").roles, ["superadmin"]);
  assert.deepEqual(node("v:stats").roles, [...SITEMAP_ROLES]);
  assert.deepEqual(node("v:settings").roles, [...SITEMAP_ROLES], "Mina inställningar is everyone's");
  // A box under another is reached only by those who reach the box above (Drift och säkerhet's parts).
  for (const item of map().nodes.filter((n) => n.parent === "v:login_settings")) assert.deepEqual(item.roles, ["superadmin"], item.id);
});

test("the menu's own rules decide its pages: menuItemAllowed and projectPageAllowed", () => {
  // Skapa formulär: canBuildForms (the company's admins); Offerter: the right Offerter, which Utföra arbete lacks.
  assert.deepEqual(node("v:forms").roles, ["superadmin", "admin"]);
  assert.deepEqual(node("v:quotes").roles, ["superadmin", "admin"]);
  // Projektstatistik is the company admins'; Planering everyone's who reads projects; Uppgifter a member's too.
  assert.deepEqual(node("v:project_summary").roles, ["superadmin", "admin"]);
  assert.ok(node("v:project_planning").roles.includes("member"));
  assert.ok(node("v:tasks").roles.includes("member"));
});

test("lines: the menu button, the tab and Mer's row are offered only to those who see them", () => {
  assert.deepEqual(edge("e:dator", "v:customer_companies", "menu").roles, ["superadmin"]);
  assert.deepEqual(edge("e:dator", "v:quotes", "menu").roles, ["superadmin", "admin"]);
  assert.ok(edge("e:dator", "v:work_orders", "menu").roles.includes("member"));
  assert.deepEqual(edge("v:work_orders", "v:tasks", "inpage").device, "desktop", "Uppgifter is a tab of Arbetsordrar");
  assert.ok(edge("v:planning", "v:capacity", "inpage").roles.includes("member"), "Kapacitet is a tab of Planering");
  // Inställningar's tab Företag: settingsTabDefs gives it to admins only; Installation's tabs to the superadmin.
  assert.deepEqual(edge("v:settings", "v:company", "inpage").roles, ["superadmin", "admin"]);
  assert.deepEqual(edge("v:customer_companies", "v:login_settings", "inpage").roles, ["superadmin"]);
  // Mer on the phone: Installation only for the superadmin.
  const mer = map().edges.filter((item) => item.from === "e:mer" && item.to === "v:customer_companies");
  assert.ok(mer.length, "Mer has Installation");
  for (const item of mer) assert.deepEqual(item.roles, ["superadmin"]);
  // A line never reaches more roles than its two ends.
  const byId = new Map(map().nodes.map((item) => [item.id, item]));
  for (const item of map().edges) {
    const from = new Set([item.from, ...(item.also ?? [])].flatMap((id) => byId.get(id)?.roles ?? []));
    for (const role of item.roles) {
      assert.ok(from.has(role), `${item.from} → ${item.to}: ${role} reaches the start`);
      assert.ok(byId.get(item.to)?.roles.includes(role), `${item.from} → ${item.to}: ${role} reaches the end`);
    }
  }
});

test("only the superadmin may read the map", () => {
  assert.deepEqual(sitemapAccess(null), { ok: false, status: 401, message: "Logga in för att fortsätta." });
  for (const role of ["USER", "ADMIN", "OWNER", "MEMBER", undefined, null]) assert.equal(sitemapAccess({ role }).ok, false, String(role));
  assert.deepEqual(sitemapAccess({ role: "ADMIN" }), { ok: false, status: 403, message: "Systemadministratör krävs." });
  assert.deepEqual(sitemapAccess({ role: "SUPERADMIN" }), { ok: true });
});

test("the route checks the session (with the two-step check) and the superadmin before it reads the map", () => {
  const route = read("app/api/superadmin/sitemap/route.ts");
  assert.match(route, /signedInAuth\(\)/);
  assert.match(route, /sitemapAccess\(auth\?\.user \?\? null\)/);
  assert.doesNotMatch(route, /\bgetCurrentUser\b|\bgetCurrentAuth\b/);
  assert.ok(route.indexOf("sitemapAccess(") < route.indexOf("readSitemap()"), "the check comes before the read");
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/, "read only");
  assert.match(read("lib/sitemap/server.ts"), /^import "server-only";/);
});

test("the map's data never reaches public/ or the client bundle", () => {
  // Written by the build inside .next (not served), read on the server only.
  assert.deepEqual([...SITEMAP_FILE_PARTS], [".next", "workflow-sitemap.json"]);
  assert.equal(path.relative(root, generator.DEFAULT_OUT(root)).split(path.sep).join("/"), SITEMAP_FILE_PARTS.join("/"));
  assert.match(JSON.parse(read("package.json")).scripts.build, /^next build --webpack && node scripts\/sitemap\/generate\.cjs --build$/);
  const walk = (dir: string): string[] => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
  assert.deepEqual(walk("public").filter((file) => /sitemap|webbplatskarta/i.test(file)), []);
  // The page fetches the data from the superadmin's API; no client file imports the generator, its output or the server reader.
  const page = read("features/workflow/site-map.tsx");
  assert.match(page, /\/api\/superadmin\/sitemap/);
  for (const dir of ["features", "components", "app"]) for (const file of walk(dir).filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
    const source = read(file);
    if (!/^["']use client["']/.test(source.trimStart())) continue;
    assert.ok(!/(from\s+|import\(\s*)["'][^"']*(workflow-sitemap|scripts\/sitemap|lib\/sitemap\/server)/.test(source), file);
  }
});

test("the stand-alone page can still be written, with Visa som", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sitemap-"));
  try {
    const file = path.join(dir, "karta.html");
    generator.writeHtml(map(), file);
    assert.ok(existsSync(file));
    const html = readFileSync(file, "utf8");
    assert.match(html, /<title>Webbplatskarta Workflow<\/title>/);
    assert.match(html, /name="role" value="member"/);
    assert.doesNotMatch(html, /__MAP_DATA__/);
    assert.match(html, /"roles":\["superadmin","admin","member"\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Provat i appen (2026-10-24: "är testet gjort i webbplatskartan?"): the click robot's round in
// scripts/sitemap/observed.json marks the map – tried in the app or only in the code, what only the robot found, its
// findings, and Visa som after the roles the robot met.
test("the robot's round is read from scripts/sitemap/observed.json and marks every box and line", () => {
  const data = map();
  assert.ok(data.observed, "observed.json is read");
  assert.match(String(data.observed.date), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(data.observed.runs.length, 6, "three roles × two devices");
  // Externa tjänster (2026-10-25) are no pages: the robot never opens them, so they and their lines carry no mark.
  const outside = (id: string) => id === "e:extern" || id.startsWith("t:");
  for (const item of data.nodes) assert.equal(Array.isArray(item.tested), !outside(item.id), `${item.id}: marked unless an outside service`);
  for (const item of data.edges) assert.equal(Array.isArray(item.tested), !outside(item.to), `${item.from} → ${item.to}: marked unless it ends at an outside service`);
  assert.ok(node("v:stats").tested?.includes("member-phone"), "Översikt was reached on the phone as a member");
  assert.ok(data.observed.counts.boxesTested > 0 && data.observed.counts.boxesTested < data.observed.counts.boxes, "some boxes only in the code");
  assert.ok(data.cats.some((cat) => cat.key === "robot"), "the line kind for ways only the robot found");
  const rows = data.anomalies.observed ?? [];
  assert.ok(rows.some((row) => row.kind === "finding" && row.status === "rättat" && row.commit === "e56676ae"), "the customer trash finding, fixed");
  // A round can end with no open finding (2026-10-25): every finding has one of the three statuses, and the dismissed are listed too.
  assert.ok(rows.filter((row) => row.kind === "finding").every((row) => ["öppet", "rättat", "avfärdat"].includes(String(row.status))), "every finding has a status");
  assert.ok(rows.some((row) => row.kind === "finding" && row.status === "avfärdat"), "dismissed findings are listed");
  assert.ok(rows.some((row) => row.kind === "back"), "the Bakåt check is listed");
  // QA's member has no Kunder: the code's Användare has, Visa som follows the robot.
  assert.ok(node("v:customers").roles.includes("member"));
  assert.ok(!node("v:customers").appRoles?.includes("member"));
});

test("the map knows what the robot found missing: Egenkontroll's tabs, Företagets värden, Ändra rond, Nytt formulär", () => {
  // Avvikelser left Egenkontroll on 2026-10-30 and is a page of its own (v:deviations), so the tab is not looked for here.
  for (const id of ["v:self_inspection/tab:program", "v:self_inspection/tab:competence", "v:calculators#varden", "v:rounds/step:rond", "v:rounds/step:ny", "v:forms#ny"]) {
    assert.ok(node(id).refs.length, `${id} points at the code`);
    assert.ok(!node(id).robotOnly, `${id} is the code's own box`);
  }
  assert.equal(node("v:self_inspection/tab:levels").cond, "admin", "Krävd nivå is for the one who edits");
  edge("v:calculators", "v:calculators#varden", "inpage");
  assert.ok(map().edges.some((item) => item.to === "v:forms#ny" && item.cat === "inpage"), "a link to Nytt formulär");
  // The old tab Roller is a dead link (the page shows Program).
  const roles = node("v:self_inspection/tab:roles");
  assert.ok(roles.dead);
  assert.ok(map().edges.some((item) => item.to === roles.id && item.dead && /tab=roles/.test(item.reason ?? "")));
});

test("marking from a round: tried, only the robot's, denied roles and findings", () => {
  const data = generator.buildSitemap({ repo: root, observed: {
    date: "2026-01-01", commit: "abc1234", runs: [{ run: "member-desktop", role: "member", device: "desktop", pages: 3, links: 3, popups: 0 }],
    pages: [{ address: "/?view=tasks", runs: ["member-desktop"] }, { address: "/?view=rounds", runs: ["member-desktop"], denied: ["member-desktop"] }, { address: "/robot-only.txt", runs: ["member-desktop"] }],
    ways: [{ from: "/?view=tasks", to: "/robot-only.txt", how: "länk", runs: ["member-desktop"] }],
    popups: [], roleProbe: [], back: { checks: 2, ok: 2, notTried: 0, wrong: 0 },
    findings: [{ kind: "axe", title: "color-contrast", address: "/?view=tasks", runs: ["member-desktop"], status: "öppet" }],
  } });
  const find = (id: string) => data.nodes.find((item) => item.id === id)!;
  assert.deepEqual(find("v:tasks").tested, ["member-desktop"]);
  assert.deepEqual(find("v:planning").tested, [], "only in the code");
  assert.ok(find("p:/robot-only.txt").robotOnly, "a page only the robot reached");
  assert.ok(data.edges.some((item) => item.cat === "robot" && item.from === "v:tasks" && item.to === "p:/robot-only.txt" && item.robotOnly));
  // The code gives the member Driftronder; the robot got the permission box: Visa som follows the robot.
  assert.ok(find("v:rounds").roles.includes("member"));
  assert.ok(!find("v:rounds").appRoles?.includes("member"));
  assert.equal(find("v:rounds").probe?.member, "nekas");
  const rows = data.anomalies.observed ?? [];
  assert.ok(rows.some((row) => row.kind === "roleMap" && row.id === "v:rounds"));
  assert.ok(rows.some((row) => row.kind === "finding" && row.id === "v:tasks" && row.status === "öppet"));
  assert.ok(rows.some((row) => row.kind === "robotNode" && row.id === "p:/robot-only.txt"));
  // Without a round: no marks, no robot lines.
  const plain = generator.buildSitemap({ repo: root, observed: false });
  assert.equal(plain.observed, undefined);
  assert.ok(!plain.cats.some((cat) => cat.key === "robot"));
  assert.ok(plain.nodes.every((item) => item.tested === undefined));
});

test("the filter Visa: Allt · Provat i appen · Bara i koden and the roles Visa som uses", () => {
  const tried = { kind: "view", tested: ["admin-phone"] }, codeOnly = { kind: "view", tested: [] as string[] }, robot = { kind: "public", tested: [] as string[], robotOnly: true };
  assert.ok(seenVisible(tried, "all") && seenVisible(codeOnly, "all"));
  assert.ok(seenVisible(tried, "tested") && !seenVisible(codeOnly, "tested") && seenVisible(robot, "tested"));
  assert.ok(!seenVisible(tried, "code") && seenVisible(codeOnly, "code") && !seenVisible(robot, "code"));
  assert.ok(seenVisible({ kind: "group", tested: [] }, "tested"), "menu groups stay as the map's frame");
  assert.ok(seenVisible({ kind: "view" }, "code"), "without the robot's data everything shows");
  assert.deepEqual(rolesFor({ roles: ["admin", "member"], appRoles: ["admin"] }, true), ["admin"]);
  assert.deepEqual(rolesFor({ roles: ["admin", "member"], appRoles: ["admin"] }, false), ["admin", "member"]);
  assert.equal(runsText(["superadmin-desktop", "superadmin-phone", "member-phone"]), "Produktadmin (dator, telefon) · Användare (telefon)");
  assert.equal(testedText(codeOnly), "Bara i koden – aldrig nådd av roboten");
  assert.equal(testedText(tried), "Provad i appen: Kundföretagets admin (telefon)");
});

test("both maps show the robot's round: the stand-alone page and the app's part", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sitemap-"));
  try {
    const file = path.join(dir, "karta.html");
    generator.writeHtml(map(), file);
    const html = readFileSync(file, "utf8");
    assert.match(html, /<select id="seen"[^>]*>[^]*Visa: Allt[^]*Visa: Provat i appen[^]*Visa: Bara i koden/);
    assert.match(html, /Följ robotens rollprov/);
    assert.match(html, /"observed":\{"date":/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const page = read("features/workflow/site-map.tsx");
  assert.match(page, /testId="sitemap-seen"/);
  assert.match(page, /Provat i appen/);
  assert.match(page, /seenVisible\(n, seen\)/);
  assert.match(page, /roleHas\(role, n, robotRoles\)/);
});

test("observed.json holds address patterns only: no ids, names, page texts or secrets", () => {
  const text = read("scripts/sitemap/observed.json");
  const data = JSON.parse(text) as { pages: { address: string }[]; ways: { from: string; to: string }[] };
  assert.doesNotMatch(text, /@[a-z0-9-]+\.[a-z]{2,}/i, "no e-mail addresses");
  assert.doesNotMatch(text, /\bc[a-z0-9]{20,}\b/, "no record ids");
  assert.doesNotMatch(text, /roundTitle|workOrderTitle|occurrence=|password|secret|token=/i);
  for (const address of [...data.pages.map((p) => p.address), ...data.ways.flatMap((w) => [w.from, w.to])]) {
    if (address.startsWith("@")) continue;
    for (const [key, value] of new URL(address, "http://x").searchParams) assert.match(value, /^(…|[a-z0-9_-]{1,40})$/i, `${address}: ${key}`);
  }
});

test("every parameter breadcrumbTrail names a page by has a box of its own on the map", () => {
  // Resor och webbplatskartan (2026-11-03): a sub-page the trail knows (one deviation, a person's page, a job from the customer
  // card …) must not fold into its list on the map. Read from the source, so a new `case` with a parameter fails here first.
  const source = read("lib/workflow/navigation.ts");
  const body = source.slice(source.indexOf("export function breadcrumbTrail"), source.indexOf("export function parentCrumb"));
  // Parameters that only say whose page it is or which parents the trail shows, never another page.
  const sameBox: Record<string, string[]> = { project: ["projectId"], place: ["customerId", "placeId"], workflow_task: ["projectId", "workOrderId", "taskType"], invoice_bases: ["invoices"] };
  // A parameter that opens the same box as another (Redigera planering is the form of Ny planering).
  const alias: Record<string, string> = { "planning.edit": "v:planning#ny", "place.edit": "v:place#ny", "project.activityId": "v:project#planering" };
  const pairs: string[] = [];
  for (const part of body.split(/(?=case ")/)) {
    const views = [...part.matchAll(/case "([a-z_]+)"/g)].map((match) => match[1]);
    const params = [...new Set([...part.matchAll(/params\.([a-zA-Z]+)/g)].map((match) => match[1]))];
    for (const view of views) for (const param of params) if (!sameBox[view]?.includes(param)) pairs.push(`${view}.${param}`);
  }
  assert.ok(pairs.length >= 20, `the trail's parameters were read (${pairs.length})`);
  for (const pair of pairs) {
    const [view, param] = pair.split(".");
    const box = alias[pair] ? map().nodes.find((item) => item.id === alias[pair]) : map().nodes.find((item) => item.kind === "variant" && item.id.startsWith(`v:${view}#`) && new RegExp(`[?&]${param}=`).test(item.address ?? ""));
    assert.ok(box, `${pair}: a box on the map`);
  }
  // The tabs the pages give an address of their own, and Planering's three views under one button.
  for (const id of ["v:time/tab:team", "v:time/tab:payroll", "v:stats/tab:team", "v:stats/tab:me", "v:maintenance/tab:store"]) assert.ok(!node(id).dead, id);
  assert.deepEqual(node("v:time/tab:team").roles, ["superadmin", "admin"], "Teamet needs the right Teamet or admin");
  for (const view of ["planning", "project_planning", "capacity"]) assert.equal(node(`v:${view}`).parent, "g:planering", view);
  for (const view of ["administration", "operator_accounts"]) assert.equal(node(`v:${view}`).parent, "g:foretaget", view);
  assert.equal(node("p:/plc-simulator").label, "PLC-simulator (eget fönster)");
  assert.ok(!map().nodes.some((item) => /\bJobb ·/.test(item.label)), "the menu's names, not Jobb");
});

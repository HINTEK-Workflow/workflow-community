// Laddtid på mobil (U1/T2, 2026-10-23): the app's first page carries only the phone's app view (Hem, Jobb, Tid, Mer) and
// what every page shares; the heavy pages are loaded with next/dynamic when they open. The task list reads only its
// list fields from the server, never a task's whole `data`.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { test } from "node:test";

const text = (file: string) => readFileSync(file, "utf8");
// @ee/ resolves to ee/ and, in the core without ee/ (the community edition), to lib/extensions/none.
const HAS_EE = existsSync("ee/client.tsx");
const ALIASES: Record<string, string> = HAS_EE
  ? { "@ee/client": "ee/client.tsx", "@ee/server": "ee/server.ts", "@ee/present": "ee/present.ts" }
  : { "@ee/client": "lib/extensions/none/client.tsx", "@ee/server": "lib/extensions/none/server.ts", "@ee/present": "lib/extensions/none/present.ts" };

/** A repo file's static, non-type imports (an `import()` inside a function is not one: webpack makes a chunk of it). */
function staticImports(file: string) {
  const source = text(file);
  const found: string[] = [];
  const statement = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
  for (let match = statement.exec(source); match; match = statement.exec(source)) {
    if (match[1] || /^\{\s*type\s[^,}]*\}$/.test(match[2].trim())) continue;
    found.push(match[3]);
  }
  const bare = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (let match = bare.exec(source); match; match = bare.exec(source)) found.push(match[1]);
  return found;
}
function resolveRepo(from: string, specifier: string) {
  if (ALIASES[specifier]) return ALIASES[specifier];
  const base = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? path.posix.join(path.posix.dirname(from), specifier) : null;
  if (base === null) return null;
  for (const ending of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ending) && statSync(base + ending).isFile()) return base + ending;
  return null;
}
/** Every repo file and package the first page reaches through static imports, from the workspace and the shell. */
function firstPageGraph() {
  const files = new Set<string>(); const packages = new Set<string>();
  const queue = ["features/kfid/workspace.tsx", "components/app-shell.tsx", "components/workspace-actions.tsx"];
  for (const file of queue) files.add(file);
  while (queue.length) {
    const file = queue.shift()!;
    for (const specifier of staticImports(file)) {
      const resolved = resolveRepo(file, specifier);
      if (resolved) { if (!files.has(resolved)) { files.add(resolved); queue.push(resolved); } }
      else if (!specifier.startsWith(".") && !specifier.startsWith("@/")) packages.add(specifier);
    }
  }
  return { files, packages };
}

// The heavy pages (2026-10-23 measurement: together most of the first page's 1,25 MB packed JavaScript).
const HEAVY = [
  "features/workflow/workflow-task-editor.tsx", "features/kfid/workflow-projects.tsx", "features/workflow/project-planning.tsx",
  "features/workflow/project-summary.tsx", "features/quotes/quote-editor.tsx", "features/quotes/quotes-list.tsx",
  "features/purchases/purchase-editor.tsx", "features/purchases/purchases-list.tsx", "features/purchases/articles-page.tsx",
  "features/kfid/administration.tsx", "features/kfid/administration-users.tsx", "features/kfid/customer-companies.tsx", "features/kfid/setup-guide.tsx",
  "features/kfid/local-workspace.tsx", "features/kfid/analytics.tsx", "features/kfid/record-archive.tsx", "features/kfid/customer-card.tsx",
  "features/self-inspection/self-inspection-page.tsx", "features/self-inspection/instruments.tsx", "features/calculators/calculators-page.tsx",
  "features/workflow/task-type-picker.tsx", "features/workflow/form-rounds.tsx", "features/workflow/place-page.tsx",
  "features/workflow/behavior-analytics.tsx", "features/workflow/mailings.tsx", "features/workflow/form-builder/index.tsx",
  "ee/landing/ui/landing-editor.tsx", "ee/ui/pricing-administration.tsx", "ee/ui/billing-read.tsx",
  "features/import/import-page.tsx", "features/ai/assistant-panel.tsx", "features/integrations/integration-keys.tsx",
  "features/ai/provider-administration.tsx", "features/ai/usage-administration.tsx", "components/native/home-edit.tsx",
];

test("the first page reaches no heavy page through a static import – they load when they open", () => {
  const { files, packages } = firstPageGraph();
  for (const heavy of HEAVY) assert.ok(!files.has(heavy), `${heavy} is in the first page's bundle again (load it in features/kfid/workspace-views.tsx)`);
  // Charts and drag and drop belong to pages that are opened (Översikt on a computer, the form builder, Hem's edit mode).
  for (const name of packages) assert.ok(!/^(recharts|@dnd-kit\/|leaflet|exceljs|pdf-lib)/.test(name), `${name} is in the first page's bundle`);
});

test("the phone's app view stays in the first bundle: Hem, Jobb, Tid and Mer", () => {
  const { files } = firstPageGraph();
  for (const file of ["features/workflow/native-home.tsx", "features/kfid/tasks-page.tsx", "features/workflow/task-work-list.tsx", "features/workflow/time-report.tsx", "features/kfid/native-settings.tsx"])
    assert.ok(files.has(file), `${file} should come with the first page`);
  const workspace = text("features/kfid/workspace.tsx");
  assert.match(workspace, /view === "tasks" && overview\)\s*content = <TasksPage/, "Jobb draws the list without Projekt's code");
});

test("every page in workspace-views is a next/dynamic page with a grey loading shape, and the address's page is fetched at once", () => {
  const views = text("features/kfid/workspace-views.tsx");
  const exported = [...views.matchAll(/^export const (\w+) = (\w+)\(/gm)];
  assert.ok(exported.length >= 40, "the heavy pages are listed");
  for (const [, name, call] of exported) assert.equal(call, "dynamic", `${name} is loaded with next/dynamic`);
  for (const line of views.split("\n").filter((row) => row.startsWith("export const ") && row.includes("dynamic(")))
    assert.ok(!line.includes("loading:") || /loading: (ViewLoading|PartLoading)/.test(line), line);
  assert.doesNotMatch(views, /^import (?!type|dynamic|\{ PartLoading)/m, "workspace-views imports no page statically");
  // No spinner: the loading shape is the shared skeleton (the page template's PageSkeleton – ListSkeleton at level 1 –
  // and DelayedSkeleton's grey rows), not a second one of its own.
  const loading = text("features/kfid/view-loading.tsx");
  assert.match(loading, /<PageSkeleton /);
  assert.match(loading, /<DelayedSkeleton /);
  assert.match(loading, /RowsSkeleton/);
  assert.doesNotMatch(loading, /animate-spin|Loader2/);
  const workspace = text("features/kfid/workspace.tsx");
  assert.match(workspace, /useEffect\(\(\) => \{ preloadView\(view, \{ native \}\); \}, \[view, native\]\);/);
});

test("the extensions hand on their whole pages through next/dynamic; the small buttons stay", () => {
  if (HAS_EE) {
    const ee = text("ee/client.tsx");
    for (const name of ["BillingRead", "PricingAdministration", "LandingEditor"]) assert.match(ee, new RegExp(`const ${name} = dynamic<`));
  }
  const core = text("lib/extensions/core-client.tsx");
  for (const name of ["AssistantPanel", "AiSharingPolicyPanel", "ProviderAdministration", "AiUsageAdministration", "IntegrationKeys", "ServerKeysAdministration", "MyAppConnections", "ImportPage"])
    assert.match(core, new RegExp(`const ${name} = dynamic<`));
  for (const name of ["SummaryAssist", "PlanningProposal", "ProtocolReview", "DailyDigestCard"]) assert.match(core, new RegExp(`import \\{[^}]*\\b${name}\\b`));
});

test("the first page's packed JavaScript stays under its budget (when a fresh build is present)", (t) => {
  const manifestFile = ".next/server/app/page_client-reference-manifest.js";
  if (!existsSync(".next/build-manifest.json") || !existsSync(manifestFile)) return t.skip("no build in .next");
  if (statSync(manifestFile).mtimeMs < statSync("features/kfid/workspace.tsx").mtimeMs) return t.skip("the build is older than the workspace");
  const scope: { __RSC_MANIFEST?: Record<string, { clientModules: Record<string, { chunks?: string[] }> }> } = {};
  new Function("globalThis", text(manifestFile))(scope);
  const manifest = scope.__RSC_MANIFEST?.["/page"];
  if (!manifest) return t.skip("no client manifest for / (not a webpack build)");
  const own = new Set(["app/layout", "app/page"]);
  const files = new Set<string>((JSON.parse(text(".next/build-manifest.json")) as { rootMainFiles: string[] }).rootMainFiles);
  for (const entry of Object.values(manifest.clientModules)) {
    const chunks = (entry.chunks ?? []).filter((chunk) => chunk.endsWith(".js"));
    const app = chunks.filter((chunk) => chunk.includes("static/chunks/app/")).map((chunk) => chunk.replace(/^.*static\/chunks\//, "").replace(/-[0-9a-f]+\.js$/, ""));
    if (app.length && app.every((name) => own.has(name))) for (const chunk of chunks) files.add(chunk.replace(/^\/?_next\//, ""));
  }
  let packed = 0;
  for (const file of files) packed += gzipSync(readFileSync(path.join(".next", file)), { level: 9 }).length;
  // 2026-10-23: 1 249 kB before, about 560 kB after. The budget leaves room for growth but not for a heavy page.
  assert.ok(packed < 750 * 1024, `the first page is ${Math.round(packed / 1024)} kB packed JavaScript`);
});

test("the task list reads only its list fields – never a task's whole data", () => {
  const route = text("app/api/work-items/route.ts");
  // Every read of the task's JSON is one path into it (priority, waiting on, the temporary place), never the whole column.
  for (const match of route.matchAll(/\bt\.data\b(.{0,2})/g)) assert.equal(match[1], "->", "t.data is only read by a path");
  assert.doesNotMatch(route, /\bdata:\s/, "no data field in the answer");
  assert.match(route, /type Row = \{[^}]*\}/);
  assert.doesNotMatch(route.match(/type Row = \{[^}]*\}/)![0], /\bdata\b/);
  // The temporary place is turned into the place's name; the object itself is not sent.
  assert.match(route, /placeName: listPlaceLabel\(/);
  assert.doesNotMatch(route.slice(route.indexOf("const shared")).replaceAll("tempPlaceOf({ tempPlace: row.tempPlace })", ""), /tempPlace:/);
  // The workspace's overview carries no task list at all (2026-09-26).
  assert.doesNotMatch(text("app/api/workspace/route.ts"), /prisma\.workflowTask\./);
  // Hem and Jobb read the list, and one task only when it is opened.
  assert.match(text("features/workflow/task-work-list.tsx"), /\/api\/work-items\?/);
});

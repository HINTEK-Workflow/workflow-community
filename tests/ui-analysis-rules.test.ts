import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Rules found by the objective analysis of 2026-10-24 (klickroboten mot QA), checked in the source so they stay fixed:
 * text buttons carry no arrow (2026-10-24, "Driftrondens popup": "gillar inte pil … använd text i stället"), and
 * the line tables' rows hold cells for screen readers.
 */
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
});

// Where an arrow is not a text button's icon: the history's Framåt (an icon button), the steps of a diagram, the design
// lab's prototypes, the public landing page (its own design) and the start guide's link cards.
const ARROW_ALLOWED = new Set(["components/history-nav.tsx", "features/workflow/core-model-guide.tsx", "features/design-lab/task-list.tsx", "ee/landing/ui/landing-page.tsx", "features/kfid/setup-guide.tsx"]);

test("text buttons and text links have no arrow icon (2026-10-24)", () => {
  const offenders: string[] = [];
  // ee/ is left out of the community build (the core-without-ee gate): only the folders that exist are read.
  for (const file of ["components", "features", "ee"].filter((dir) => existsSync(dir)).flatMap((dir) => files(dir))) {
    const name = file.replaceAll("\\", "/");
    if (ARROW_ALLOWED.has(name)) continue;
    const source = readFileSync(file, "utf8");
    source.split(/\r?\n/).forEach((line, index) => { if (/<(ArrowRight|ArrowUpRight|MoveRight)\b/.test(line)) offenders.push(`${name}:${index + 1}`); });
  }
  assert.deepEqual(offenders, [], "an arrow on a text button: write the text only (Play stays on a start button)");
});

test("the rows of the quote's and the purchase's line tables are made of cells", () => {
  for (const [file, row] of [["features/quotes/quote-editor.tsx", "quote-line"], ["features/purchases/purchase-editor.tsx", "purchase-line"]]) {
    const source = readFileSync(file, "utf8");
    const start = source.indexOf(`data-testid="${row}" role="row"`);
    assert.ok(start > 0, `${row} is a row`);
    const line = source.slice(start, source.indexOf("\n", start));
    assert.ok(line.endsWith("><LineCells>"), `${row}: its parts are wrapped in LineCells`);
  }
  // An empty quote has no table: the line under it is a paragraph, not a table without rows.
  assert.match(readFileSync("features/quotes/quote-editor.tsx", "utf8"), /role=\{draft\.lines\.length \? "table" : undefined\}/);
});

test("a page that is only the no-permission box has an h1", () => {
  const workspace = readFileSync("features/kfid/workspace.tsx", "utf8");
  assert.equal((workspace.match(/<NoPermissionBox \/>/g) ?? []).length, 0, "the workspace's whole-page boxes pass page");
  assert.match(readFileSync("features/kfid/ui.tsx", "utf8"), /const Heading = page \? "h1" : "h2";/);
});

test("the legal pages lead the signed-in back to Workflow, and the app has no Priser link (2026-10-24)", () => {
  const legal = readFileSync("app/(public)/legal/[document]/page.tsx", "utf8");
  assert.match(legal, /signedIn \? "Tillbaka till Workflow" : "Till inloggningen"/);
  assert.doesNotMatch(legal, /←/, "text only, no arrow");
  assert.match(legal, /prices=\{features\.landingEditor && !\(signedIn && !publicSiteUrl\)\}/, "no /#priser into the app for the signed-in");
  const workspace = readFileSync("features/kfid/workspace.tsx", "utf8");
  assert.doesNotMatch(workspace, /<LegalLinks prices/, "Om Workflow has no Priser link");
});

test("Import shows and reads the price files only for the one who may import articles (2026-10-24)", () => {
  const workspace = readFileSync("features/kfid/workspace.tsx", "utf8");
  assert.match(workspace, /canImportArticles=\{Boolean\(overview\?\.admin\) \|\| hasWorkflowPermission\([^)]*\), "catalogue", "edit"\)\}/);
  const page = readFileSync("features/import/import-page.tsx", "utf8");
  assert.match(page, /\{canImportArticles \? <CataloguePanel/, "the catalogue panel (and its /api/catalogue call) only with the right");
  assert.match(page, /canImportArticles \|\| candidate !== "catalogue"/, "Artiklar och priser is no target without it");
  assert.match(page, /\.\.\.\(!canImportArticles \? \[\] : \[\{ title: "Artiklar och priser"/, "nor a template in the guide");
});

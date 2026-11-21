import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { formVisibleTo, promoteBlock, visibleFormVersionWhere, visibleFormsWhere } from "@/lib/kfid/form-scope";

// Strict separation of Workflow's global forms and each company's own (2026-10-06).

test("a stored form version is read only through Workflow's forms or the company's own", () => {
  assert.deepEqual(visibleFormsWhere("org-a"), { OR: [{ organizationId: null }, { organizationId: "org-a" }] });
  assert.deepEqual(visibleFormVersionWhere("org-a", "form-1", 3), { templateId: "form-1", version: 3, template: { OR: [{ organizationId: null }, { organizationId: "org-a" }] } });
  assert.equal(formVisibleTo("org-a", { organizationId: null }), true);
  assert.equal(formVisibleTo("org-a", { organizationId: "org-a" }), true);
  assert.equal(formVisibleTo("org-a", { organizationId: "org-b" }), false);
});

test("Publicera som Workflow-original: only Workflow's own published forms, never another company's", () => {
  const hintek = { id: "hintek-org", name: "Workflow AB" };
  const form = { organizationId: "hintek-org", status: "PUBLISHED", publishedVersion: 2, baseTemplateId: null, importedFrom: null };
  const imported = (publisherName: string, verified = true) => ({ publisherName, exportedBy: publisherName, verified, sourceTemplateId: "x", sourceVersion: 1, importedAt: "2026-10-06T00:00:00.000Z" });
  assert.equal(promoteBlock(form, hintek), null);
  assert.match(promoteBlock({ ...form, organizationId: null }, hintek) ?? "", /redan ett Workflow-original/);
  assert.match(promoteBlock({ ...form, organizationId: "other-org" }, hintek) ?? "", /hittades inte/);
  assert.match(promoteBlock({ ...form, status: "DRAFT", publishedVersion: null }, hintek) ?? "", /Publicera formuläret/);
  assert.match(promoteBlock({ ...form, baseTemplateId: "kfid" }, hintek) ?? "", /befintligt Workflow-original/);
  // An imported form never becomes an original, whatever name the file gives (a name can be copied).
  for (const name of ["HINTEK", "Workflow AB", "Elbolaget AB", "Workflow Bygg AB"])
    assert.match(promoteBlock({ ...form, importedFrom: imported(name) }, hintek) ?? "", /importerat från en fil/, name);
  assert.match(promoteBlock({ ...form, importedFrom: imported("HINTEK", false) }, hintek) ?? "", /importerat från en fil/, "an unverified file is never trusted");
  assert.match(promoteBlock({ ...form, importedFrom: { odd: true } }, hintek) ?? "", /importerat från en fil/);
});

test("the form builder gives the superadmin the active organization, never the global scope by default", () => {
  const source = readFileSync("lib/kfid/form-server.ts", "utf8");
  const body = source.slice(source.indexOf("export function requireFormAdmin"), source.indexOf("export function hintekFormsAllowed"));
  assert.ok(body.includes("organizationId: ctx.organizationId"));
  assert.ok(!body.includes("SUPERADMIN") && !body.includes("organizationId: null"), "requireFormAdmin has no superadmin shortcut to Workflow's global forms");
  assert.match(source, /viewAs \|\| ctx\.integration\) return false/, "never under Visa som or through an API key");
  const route = readFileSync("app/api/forms/admin/route.ts", "utf8");
  assert.match(route, /copyOf: id\.optional\(\)/, "Spara som kopia names its source");
  assert.match(route, /source\?\.importedFrom \? \{ importedFrom: json\(source\.importedFrom\) \}/, "the copy keeps where the source came from");
  assert.match(readFileSync("features/workflow/form-builder/use-form-draft.ts", "utf8"), /copyOf: source/);
});

/**
 * Every read of a form or form version in app/ and lib/ is limited to Workflow's forms and the company's own. A statement
 * passes when it names the organization (organizationId, visibleForm…, editableWhere, exportableWhere) or reads by the id of a row the
 * same handler has already limited (`template.id`, `original.id`). The few others are listed here with the reason.
 */
const ALREADY_LIMITED: { file: string; snippet: string; reason: string }[] = [
  { file: "app/api/forms/admin/route.ts", snippet: "templateId: { in: templateIds }", reason: "latestVersions() gets ids from rows already limited to the scope" },
  { file: "app/api/forms/admin/route.ts", snippet: "formTemplate.findMany({ where, orderBy", reason: "`where` is built from scope.organizationId just above" },
  { file: "app/api/forms/admin/route.ts", snippet: "formTemplate.count({ where })", reason: "`where` is built from scope.organizationId just above" },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("no form or form version is read without the organization check", () => {
  const used = new Set<number>();
  const offenders: string[] = [];
  for (const path of [...sources("app"), ...sources("lib")]) {
    const file = relative(".", path).replaceAll("\\", "/");
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/\.(formTemplate|formTemplateVersion)\.(find\w*|count|groupBy|aggregate)\(/g)) {
      const end = text.indexOf(";\n", match.index);
      const statement = text.slice(match.index, end < 0 ? undefined : end);
      if (/organizationId|visibleForm|editableWhere|exportableWhere|\btemplate\.id\b|\boriginal\.id\b/.test(statement)) continue;
      const allowed = ALREADY_LIMITED.findIndex((entry) => entry.file === file && statement.includes(entry.snippet));
      if (allowed >= 0) { used.add(allowed); continue; }
      offenders.push(`${file}: ${statement.slice(0, 140)}`);
    }
  }
  assert.deepEqual(offenders, [], "a form read without an organization check");
  assert.deepEqual(ALREADY_LIMITED.filter((_, index) => !used.has(index)).map((entry) => entry.snippet), [], "stale exceptions");
});

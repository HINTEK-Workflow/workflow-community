// Granskningen 2026-11-24 (G-18, data-ai F-04): eraseCompany removes the company's rows by every model with organizationId,
// but its files only from a fixed list. This test fails when a model that keeps a file path (storagePath or *Path) and
// belongs to a company is missing from that list, so a new file type cannot be left behind in the storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const erasure = readFileSync(path.join(root, "lib/auth/erasure.ts"), "utf8");

/** Every model as { name, fields } where fields are [name, type] pairs. */
function models() {
  const found: { name: string; fields: [string, string][] }[] = [];
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = match[2].split("\n").map((line) => line.trim().split(/\s+/)).filter((parts) => /^\w+$/.test(parts[0] ?? "") && parts[1]).map((parts) => [parts[0], parts[1]] as [string, string]);
    found.push({ name: match[1], fields });
  }
  return found;
}

test("every company model with a stored file path is in eraseCompany's file list", () => {
  const all = models();
  assert.ok(all.length > 100, "the schema was read");
  const missing: string[] = [];
  for (const model of all) {
    if (!model.fields.some(([name]) => name === "organizationId")) continue;
    for (const [field, type] of model.fields) {
      if (!/^String\??$/.test(type) || !/(^storagePath$|Path$)/.test(field)) continue;
      const listed = new RegExp(`SELECT "${field}"(?: AS path)? FROM "${model.name}" WHERE "organizationId"`).test(erasure);
      if (!listed) missing.push(`${model.name}.${field}`);
    }
  }
  assert.deepEqual(missing, [], "add these to the file list in eraseCompany (lib/auth/erasure.ts)");
});

test("the board pictures and files and the company's film folder are removed", () => {
  assert.match(erasure, /SELECT "storagePath" FROM "BoardImage" WHERE "organizationId"/);
  assert.match(erasure, /removeCompanyVideos\(organizationId\)/);
});

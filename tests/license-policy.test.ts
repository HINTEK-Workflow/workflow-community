import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { cycloneDx, pruneLock, pruneNotices, reachablePackages, resolveInLock } from "../scripts/licenses/lock-tools.mjs";
import { licenceReport, OPEN_QUESTIONS, REVIEWED } from "../scripts/licenses/policy.mjs";

// Licensregeln och SBOM (2026-11-02): the lock file against scripts/licenses/policy.mjs, and the inventory made from the lock.
type Lock = { name: string; version: string; lockfileVersion: number; packages: Record<string, { name?: string; version?: string; license?: string; dev?: boolean; link?: boolean; integrity?: string; dependencies?: Record<string, string> }> };
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as Lock;
const small = (packages: Lock["packages"]): Lock => ({ name: "x", version: "1.0.0", lockfileVersion: 3, packages: { "": {}, ...packages } });

test("no package in the lock has GPL, AGPL, SSPL or no licence, unless it is reviewed or a written open question", (t) => {
  const report = licenceReport(lock);
  assert.deepEqual(report.problems, [], "add a reviewed reason or replace the package");
  assert.deepEqual(report.reviewed.map((id: string) => id.split("@")[0]), Object.keys(REVIEWED));
  assert.deepEqual(report.open.map((id: string) => id.split("@")[0]), Object.keys(OPEN_QUESTIONS));
  if (report.open.length) t.diagnostic(`Öppen licensfråga: ${report.open.join(", ")}`);
  // An open question is written down where it will be answered, not only here (the document is not in the Community export).
  if (existsSync("docs/drift/LICENSER_OCH_CRA.md")) {
    const document = readFileSync("docs/drift/LICENSER_OCH_CRA.md", "utf8");
    for (const name of Object.keys(OPEN_QUESTIONS)) assert.match(document, new RegExp(`\`${name}\``), name);
  }
});

test("the policy stops what it should: copyleft, a missing licence, a changed version, a changed dual licence", () => {
  const stopped = (entry: Lock["packages"][string], name = "node_modules/a") => licenceReport(small({ [name]: { version: "1.0.0", ...entry } })).problems.length > 0;
  for (const license of ["GPL-3.0", "GPL-2.0-only", "AGPL-3.0-only", "SSPL-1.0", "(MIT OR GPL-3.0-or-later)", "AGPL-3.0-or-later"]) assert.equal(stopped({ license }), true, license);
  assert.equal(stopped({}), true, "no licence at all");
  for (const license of ["MIT", "Apache-2.0", "LGPL-3.0-or-later", "Apache-2.0 AND LGPL-3.0-or-later", "MPL-2.0", "EPL-2.0", "BSD-3-Clause", "ISC"]) assert.equal(stopped({ license }), false, license);
  assert.equal(stopped({ license: "(MIT OR GPL-3.0-or-later)" }, "node_modules/jszip"), false, "the reviewed dual licence");
  assert.equal(stopped({ license: "GPL-3.0-or-later" }, "node_modules/jszip"), true, "the choice of MIT is gone");
  assert.equal(stopped({ version: "9.9.9" }, "node_modules/buffers"), true, "an open question is about one version");
  assert.equal(licenceReport({ packages: { "": { license: "GPL-3.0" } } }).problems.length, 1, "the product's own licence is checked too");
  assert.equal(licenceReport({ packages: { "": { license: "AGPL-3.0-only" } } }).problems.length, 0, "the Community edition's licence");
});

test("a lock is resolved like Node resolves it, and taking a package out takes only what it alone needed", () => {
  const packages: Lock["packages"] & Record<string, unknown> = {
    "": { dependencies: { a: "1", gone: "1" } },
    "node_modules/a": { version: "1", dependencies: { shared: "1" } },
    "node_modules/gone": { version: "1", dependencies: { shared: "1", only: "1" } },
    "node_modules/gone/node_modules/nested": { version: "1" },
    "node_modules/shared": { version: "1" },
    "node_modules/only": { version: "2" },
  };
  assert.equal(resolveInLock(packages, "node_modules/gone", "nested"), "node_modules/gone/node_modules/nested");
  assert.equal(resolveInLock(packages, "node_modules/gone/node_modules/nested", "shared"), "node_modules/shared");
  assert.equal(reachablePackages(packages).size, 6 - 1, "the nested one is not asked for by anyone");
  const { lock: pruned, removed } = pruneLock({ name: "x", version: "1", lockfileVersion: 3, packages }, ["gone"], { name: "community", version: "2", license: "AGPL-3.0-only" });
  assert.deepEqual(Object.keys(pruned.packages), ["", "node_modules/a", "node_modules/shared"]);
  assert.deepEqual(removed.map((item: { name: string }) => item.name).sort(), ["gone", "nested", "only"].sort());
  assert.deepEqual(pruned.packages[""].dependencies, { a: "1" });
  assert.equal(pruned.name, "community");
  assert.equal(pruned.packages[""].license, "AGPL-3.0-only");
  assert.ok(packages["node_modules/gone"], "the original is left as it was");
});

test("this repository's lock: every entry is reachable, so pruning removes nothing it was not asked to", () => {
  assert.deepEqual(pruneLock(lock, []).removed, []);
  // The Community export takes the payment package out; in its own lock it is already gone.
  const { lock: pruned, removed } = pruneLock(lock, ["stripe"]);
  const expected = lock.packages["node_modules/stripe"] ? ["stripe"] : [];
  assert.deepEqual(removed.map((item: { name: string }) => item.name), expected);
  assert.equal(Object.keys(pruned.packages).length, Object.keys(lock.packages).length - expected.length);
});

test("the notices lose a removed package's line and its own licence text, keep a shared text, and say the right version", () => {
  const notices = "Paketen som följer med Workflow 0.22.0 i servern\n\n== Paket (3) ==\n\na@1.0.0 – MIT\nb@1.0.0 – MIT\nc@1.0.0 – MIT\n\n== Licenstexter ==\n\n--- a@1.0.0 ---\n\nOwn text of a.\n\n--- b@1.0.0, c@1.0.0 ---\n\nShared text.\n\n== Paket utan egen licensfil ==\n\nd@1 – x\n";
  const once = pruneNotices(notices, [{ name: "a", version: "1.0.0" }], "9.9.9");
  assert.match(once, /Workflow 9\.9\.9 i servern/);
  assert.match(once, /== Paket \(2\) ==/);
  assert.doesNotMatch(once, /a@1\.0\.0|Own text of a/);
  assert.match(once, /--- b@1\.0\.0, c@1\.0\.0 ---/);
  const twice = pruneNotices(once, [{ name: "b", version: "1.0.0" }]);
  assert.match(twice, /--- c@1\.0\.0 ---\n\nShared text\./, "the text stays for the one still using it");
  const last = pruneNotices(twice, [{ name: "c", version: "1.0.0" }]);
  assert.doesNotMatch(last, /Shared text/);
  assert.match(last, /== Paket utan egen licensfil ==\n\nd@1 – x/, "the section after the last text stays");
});

test("the SBOM lists every package of the lock once, with version, licence and hash, and marks dev packages as not shipped", () => {
  const bom = cycloneDx(lock, { name: "workflow", version: "1.2.3", licence: "AGPL-3.0-only" });
  assert.equal(bom.bomFormat, "CycloneDX");
  assert.equal(bom.specVersion, "1.5");
  assert.equal(bom.metadata.component.version, "1.2.3");
  const expected = new Set(Object.entries(lock.packages).filter(([path]) => path).map(([path, entry]) => `${entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length)}@${entry.version}`));
  assert.deepEqual(new Set(bom.components.map((item: { "bom-ref": string }) => item["bom-ref"])), expected);
  const of = (name: string) => bom.components.find((item: { name: string }) => item.name === name)!;
  assert.equal(of("next").scope, "required");
  assert.equal(of("eslint").scope, "excluded");
  assert.deepEqual(of("next").licenses, [{ license: { id: "MIT" } }]);
  assert.match(of("next").hashes![0].content, /^[0-9a-f]{128}$/);
  assert.match(of("next").purl, /^pkg:npm\/next@/);
  assert.match(of("@prisma/client").purl, /^pkg:npm\/%40prisma\/client@/);
  assert.deepEqual(of("jszip").licenses, [{ expression: "MIT OR GPL-3.0-or-later" }]);
  assert.deepEqual(of("buffers").licenses, [], "no licence is not turned into one");
  assert.ok(bom.dependencies[0].dependsOn.includes(`next@${of("next").version}`), "the product depends on its own packages");
  assert.deepEqual(cycloneDx(lock), cycloneDx(lock), "deterministic");
});

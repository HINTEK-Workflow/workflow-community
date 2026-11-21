import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * The third-party licence notices (copyright precaution, 2026-10-06) list every package the installation ships,
 * so a dependency change without `npm run licenses` is caught here.
 */
test("public/third-party-licenses.txt lists every production package in package-lock.json with its licence", () => {
  const notices = readFileSync("public/third-party-licenses.txt", "utf8");
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages: Record<string, { version?: string; dev?: boolean; link?: boolean; name?: string }> };
  const missing = Object.entries(lock.packages)
    .filter(([path, entry]) => path && !entry.dev && !entry.link)
    .map(([path, entry]) => `${entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length)}@${entry.version}`)
    .filter((item) => !notices.includes(`\n${item} – `));
  assert.deepEqual(missing, [], "run npm run licenses");
  for (const match of notices.matchAll(/licenstext: \/(\S+)/g)) assert.ok(existsSync(`public/${match[1]}`), match[1]);
  // The fonts in public/ and the map's attribution are named too.
  for (const text of ["DejaVu Sans", "Manrope", "/picture/fonts/manrope/OFL.txt", "Gugi", "Lantmäteriet"]) assert.ok(notices.includes(text), text);
});

test("the notices carry what the lock does not: the bundle's packages with licence text, shadcn/ui, libvips' source and the footer icons", () => {
  const notices = readFileSync("public/third-party-licenses.txt", "utf8");
  // Every package inside exceljs' browser file has a licence name and a text (2026-11-20; scripts/licenses/bundled-licences.json).
  assert.doesNotMatch(notices, /licens enligt paketet \(inte installerat separat\)|licens inte fastställd/);
  for (const name of ["crypto-browserify", "elliptic", "bn.js", "core-js", "sha.js", "events"]) {
    assert.match(notices, new RegExp(`^${name.replace(".", "\\.")} – (MIT|ISC|\\(MIT AND BSD-3-Clause\\)) \\(ingår i webbläsarbygget av exceljs; `, "m"), name);
    assert.match(notices, new RegExp(`^--- (.*, )?${name.replace(".", "\\.")}@\\S+ \\(inuti exceljs\\)`, "m"), `${name}: licence text`);
  }
  assert.match(notices, /^shadcn\/ui – MIT – © 2023 shadcn – components\/ui\//m);
  assert.match(notices, /^--- shadcn\/ui \(components\/ui\/\) ---\n\nMIT License\n\nCopyright \(c\) 2023 shadcn/m);
  assert.match(notices, /github\.com\/lovell\/sharp-libvips/, "LGPL: where libvips' source is");
  // The footer icons are the Cloud edition's (ee/landing); the Community export drops the section with their licence files
  // (community/export.mjs, withoutSection, checked in tests/community-export.test.ts). The core-without-ee gate copies the tree
  // without ee/ but keeps the notice as it is, so the section is only required here when ee/ is present.
  const cloud = existsSync("ee/landing/ui/footer-icons.tsx");
  if (cloud) {
    assert.match(notices, /^== Ikoner ==$/m);
    assert.match(notices, /^Material Symbols Outlined .* – Apache-2.0 – © Google – licenstext: \/landing\/ikoner\/LICENSE-material-symbols-Apache-2\.0\.txt$/m);
    assert.match(notices, /^Font Awesome Free 7\.3\.1.* – CC BY 4\.0 – © Fonticons, Inc\. – licenstext: \/landing\/ikoner\/LICENSE-font-awesome-free\.txt$/m);
  }
});

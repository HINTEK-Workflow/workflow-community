#!/usr/bin/env node
/**
 * Third-party licence notices (copyright precaution, 2026-10-06): MIT, ISC, BSD and Apache ask that the
 * copyright and licence notice follow every copy, and the code Workflow sends to the browser and runs on the server is
 * such a copy. This lists every package `npm ci --omit=dev` installs (from package-lock.json) with its version and
 * licence, the fonts in public/, and each licence text found in the package once (identical texts are grouped).
 *
 *   node scripts/licenses/collect.mjs          writes public/third-party-licenses.txt
 *   node scripts/licenses/collect.mjs --check  exits 1 when the file is out of date
 *
 * Platform builds and optional packages (`os`/`cpu`/`optional`, e.g. one sharp or swc binary per system) are listed by
 * name and licence only, so the file is the same whichever system it is generated on. Run after every dependency change;
 * tests/third-party-licenses.test.ts fails when a package in package-lock.json is missing from the file.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "public/third-party-licenses.txt";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
// The product's own version: package.json decides, as the lock's copy of it can lag behind.
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;
// A package without a licence field whose own licence file says which (checked by hand, 2026-10-06).
const FROM_FILE = { "seq-queue": "MIT (enligt paketets LICENSE-fil)" };
const licenceOf = (entry, dir, name = "") => {
  if (entry.license) return entry.license;
  if (FROM_FILE[name]) return FROM_FILE[name];
  try {
    const own = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (typeof own.license === "string") return own.license;
    if (own.license?.type) return own.license.type;
    if (Array.isArray(own.licenses)) return own.licenses.map((item) => item.type ?? item).join(" OR ");
  } catch { /* not installed on this system */ }
  return "ej angiven i paketet";
};

const packages = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev || entry.link) continue;
  const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  const platform = Boolean(entry.os || entry.cpu || entry.optional);
  const texts = [];
  if (!platform && existsSync(path)) {
    for (const file of readdirSync(path).filter((item) => LICENCE_FILE.test(item)).sort()) {
      const text = readFileSync(join(path, file), "utf8").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
      if (text) texts.push(text);
    }
  }
  packages.push({ name, version: entry.version ?? "", licence: licenceOf(entry, path, name), platform, texts });
}
packages.sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
// The same package can be installed twice in one version (nested); list it once.
const unique = packages.filter((item, index) => index === 0 || item.name !== packages[index - 1].name || item.version !== packages[index - 1].version);

// Packages that ship a ready-built browser file with other packages inside it (2026-10-06): ExcelJS runs in the browser in
// the Local mode, and its bundle carries about 70 packages that package-lock.json does not list. They are named from the
// bundle's source map, with the licence and licence text of the installed copy where there is one. The rest (the browser
// shims of Node's crypto, events, process and so on) are not installed separately; their licence field and licence file were
// fetched from the npm registry on 2026-11-20 into bundled-licences.json, since MIT asks that the text follow every copy. The
// version inside the bundle is not stated by exceljs, so the file names the registry version the text was taken from.
const BUNDLES = [["exceljs", "node_modules/exceljs/dist/exceljs.min.js.map"]];
const BUNDLED_FILE = "scripts/licenses/bundled-licences.json";
const knownBundled = JSON.parse(readFileSync(BUNDLED_FILE, "utf8")).packages;
const readLicenceFiles = (dir) => readdirSync(dir).filter((item) => LICENCE_FILE.test(item)).sort()
  .map((file) => readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim()).filter(Boolean);
const bundled = BUNDLES.flatMap(([owner, map]) => {
  if (!existsSync(map)) return [];
  const names = new Set();
  for (const source of JSON.parse(readFileSync(map, "utf8")).sources ?? []) {
    const at = source.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const parts = source.slice(at + "node_modules/".length).split("/");
    names.add(parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
  return [...names].sort().map((name) => {
    const dir = join("node_modules", name);
    if (existsSync(join(dir, "package.json"))) {
      const own = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const id = `${name}@${own.version ?? ""}`;
      // A production package is listed with its text above; a copy only the bundle brings along gets its text here.
      const listed = unique.some((item) => item.name === name && item.version === own.version);
      return { line: `${name} – ${licenceOf({}, dir)} (ingår i webbläsarbygget av ${owner}; installerad kopia ${id})`, owner: listed ? null : `${id} (inuti ${owner})`, texts: listed ? [] : readLicenceFiles(dir) };
    }
    const known = knownBundled[name];
    if (!known) return { line: `${name} – licens inte fastställd (inte installerat separat och saknas i ${BUNDLED_FILE}) (ingår i webbläsarbygget av ${owner})`, owner: null, texts: [] };
    return { line: `${name} – ${known.licence} (ingår i webbläsarbygget av ${owner}; licens och licenstext enligt ${name}@${known.version} i npm-registret)`, owner: `${name}@${known.version} (inuti ${owner})`, texts: [known.text] };
  });
});

// Code copied into the repository from another project (2026-11-20): the shadcn/ui primitives in components/ui (alert, badge,
// button, card, checkbox, input, label, separator and parts of switch) were generated by the shadcn tool and are MIT.
// shadcn is a development package, so it is not in the list above, but its code ships in the browser.
const COPIED = [{
  name: "shadcn/ui", licence: "MIT", holder: "© 2023 shadcn", where: "components/ui/ (alert, badge, button, card, checkbox, input, label, separator, switch)",
  text: ["MIT License", "", "Copyright (c) 2023 shadcn", "",
    "Permission is hereby granted, free of charge, to any person obtaining a copy",
    "of this software and associated documentation files (the \"Software\"), to deal",
    "in the Software without restriction, including without limitation the rights",
    "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
    "copies of the Software, and to permit persons to whom the Software is",
    "furnished to do so, subject to the following conditions:", "",
    "The above copyright notice and this permission notice shall be included in all",
    "copies or substantial portions of the Software.", "",
    "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
    "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
    "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
    "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
    "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
    "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
    "SOFTWARE."].join("\n"),
}];

// The public site's footer icons (2026-11-11; ee/landing/ui/footer-icons.tsx, source list public/landing/ikoner/LICENSES.md).
// Only in the Cloud edition: the Community export drops this section (community/export.mjs), as neither the icons nor the
// files are published there. CC BY 4.0 asks for an attribution the visitor can see, so the footer links to this file.
const ICONS_SECTION = "== Ikoner ==";
const ICONS = [
  ["Material Symbols Outlined (home_pin, emoji_people, policy, calculate, offline_bolt; @material-symbols/svg-400 0.40.0)", "Apache-2.0", "© Google", "public/landing/ikoner/LICENSE-material-symbols-Apache-2.0.txt"],
  ["Font Awesome Free 7.3.1, brands (square-facebook, linkedin, square-instagram) – https://fontawesome.com – License: https://fontawesome.com/license/free", "CC BY 4.0", "© Fonticons, Inc.", "public/landing/ikoner/LICENSE-font-awesome-free.txt"],
];

const FONTS = [
  ["DejaVu Sans", "Bitstream Vera-licensen och public domain", "public/fonts/DejaVu-LICENSE.txt"],
  ["Manrope", "SIL Open Font License 1.1", "public/picture/fonts/manrope/OFL.txt"],
  ["Gugi", "SIL Open Font License 1.1", "public/picture/fonts/gugi/OFL.txt"],
];

const lines = [
  "Tredjepartslicenser i Workflow",
  "",
  `Paketen som följer med Workflow ${version} i servern och webbläsaren, med version och licens, koden som kommer från`,
  "andra projekt, ikonerna, typsnitten och licenstexterna som paketen själva levererar. Skapad av",
  "scripts/licenses/collect.mjs från package-lock.json.",
  "Kartans källangivelse (Lantmäteriet, CC BY 4.0) står under Hjälp och verktyg › Om Workflow.",
  "",
  `== Paket (${unique.length}) ==`,
  "",
  ...unique.map((item) => `${item.name}@${item.version} – ${item.licence}${item.platform ? " (valfritt eller plattformsbygge)" : ""}`),
  "",
  ...(bundled.length ? ["== Ingår i färdigbyggda webbläsarfiler ==", "", ...bundled.map((item) => item.line), ""] : []),
  "== Kod från andra projekt ==",
  "",
  ...COPIED.map((item) => `${item.name} – ${item.licence} – ${item.holder} – ${item.where}`),
  "",
  "== Noteringar ==",
  "",
  "Plattformsbyggena av libvips (@img/sharp-libvips-*) och sharp (@img/sharp-*) är LGPL-3.0-or-later respektive",
  "Apache-2.0 med LGPL-delar. Workflow ändrar inte paketen; licenstexten följer med i varje installerat plattformspaket",
  "(node_modules/@img/…) och finns på https://www.gnu.org/licenses/lgpl-3.0.txt. Källkoden till libvips och",
  "plattformsbyggena finns på https://github.com/lovell/sharp-libvips (sharp: https://github.com/lovell/sharp).",
  "jszip anger MIT OR GPL-3.0-or-later; Workflow använder det under MIT.",
  "caniuse-lite är CC-BY-4.0 och kommer via Next.js. elkjs är EPL-2.0 och kommer via Prisma, som kör migreringarna.",
  "Ikonerna i appen är Lucide (lucide-react, ISC, i paketlistan ovan).",
  "",
  ICONS_SECTION,
  "",
  "Ikonerna i den publika webbplatsens sidfot (bara i molnutgåvan; ingår inte i Community). Filerna ligger på egen server.",
  ...ICONS.map(([name, licence, holder, file]) => `${name} – ${licence} – ${holder} – licenstext: /${file.replace(/^public\//, "")}`),
  "",
  "== Typsnitt ==",
  "",
  ...FONTS.map(([name, licence, file]) => `${name} – ${licence} – licenstext: /${file.replace(/^public\//, "")}`),
  "",
  "== Licenstexter ==",
];
const byText = new Map();
const addText = (text, owner) => {
  const owners = byText.get(text) ?? [];
  owners.push(owner);
  byText.set(text, owners);
};
for (const item of unique) for (const text of item.texts) addText(text, `${item.name}@${item.version}`);
for (const item of bundled) if (item.owner) for (const text of item.texts) addText(text, item.owner);
for (const item of COPIED) addText(item.text, `${item.name} (${item.where.split(" ")[0]})`);
for (const [text, owners] of [...byText.entries()].sort((a, b) => a[1][0].localeCompare(b[1][0], "en"))) {
  lines.push("", `--- ${owners.join(", ")} ---`, "", text);
}
const missing = unique.filter((item) => !item.platform && !item.texts.length);
if (missing.length) lines.push("", "== Paket utan egen licensfil ==", "", ...missing.map((item) => `${item.name}@${item.version} – ${item.licence}`));
const output = `${lines.join("\n")}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== output) { console.error(`${OUT} är inaktuell: kör node scripts/licenses/collect.mjs`); process.exit(1); }
  console.log(`${OUT} är aktuell (${unique.length} paket).`);
} else {
  writeFileSync(OUT, output);
  console.log(`${OUT}: ${unique.length} paket, ${byText.size} licenstexter, ${output.length} tecken.`);
}

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

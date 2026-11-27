import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { forgetRecentSearches, RECENT_SEARCH_PREFIX } from "../features/auth/sign-out";

// Senaste sökningar töms vid utloggning (2026-10-23, småfixar): every way out of the app goes through
// signOutAndForget, and the login page forgets them too (a session that expired or was ended from another device).
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

test("no part of the app calls next-auth's signOut past the helper", () => {
  // ee/ is missing in the core-without-ee copy (the community edition); its files are checked whenever it is there.
  const direct = ["app", "components", "features", "lib", "ee"].filter((dir) => existsSync(dir)).flatMap(sourceFiles)
    .filter((file) => !file.endsWith(path.join("features", "auth", "sign-out.ts")))
    // The client's signOut comes from next-auth/react; the server's signOut event (lib/auth/config.ts, N1) is not a way out.
    .filter((file) => { const source = readFileSync(file, "utf8"); return /["']next-auth\/react["']/.test(source) && /\bsignOut\b(?!AndForget)/.test(source); });
  assert.deepEqual(direct, []);
  // Every sign-out also ends the session row on the server (säkerhetsgranskning 2026-11-20, N1).
  assert.match(readFileSync("lib/auth/config.ts", "utf8"), /events:\s*\{[\s\S]*?async signOut\(\{ token \}\) \{\s*await endSignedOutSession\(/);
  assert.match(readFileSync("features/kfid/global-search.tsx", "utf8"), /`\$\{RECENT_SEARCH_PREFIX\}\$\{user\.id/);
  assert.match(readFileSync("features/auth/components/login-form.tsx", "utf8"), /useEffect\(\(\) => \{ forgetRecentSearches\(\); \}, \[\]\)/);
});

test("every person's recent searches on the device go, nothing else does", () => {
  const values = new Map<string, string>([[`${RECENT_SEARCH_PREFIX}u1`, "{}"], [`${RECENT_SEARCH_PREFIX}anna@example.test`, "{}"], ["workflow.theme", "dark"], ["kfid.offline.owner", "u1"]]);
  const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null, removeItem: (key: string) => { values.delete(key); } };
  forgetRecentSearches(storage);
  assert.deepEqual([...values.keys()], ["workflow.theme", "kfid.offline.owner"]);
  assert.doesNotThrow(() => forgetRecentSearches({ get length(): number { throw new Error("blocked"); }, key: () => null, removeItem: () => undefined }));
});

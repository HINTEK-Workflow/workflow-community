import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Kundisolering (2026-10-13): "Tvåstegsverifiering krävs för superadmin" is checked in context() and signedInUser()
// (lib/kfid/server.ts). A superadmin route that reads the session itself with getCurrentUser() would skip it.
function routes(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? routes(path) : name === "route.ts" ? [path] : [];
  });
}

test("every superadmin route goes through the two-step check", () => {
  const offenders = routes(join(process.cwd(), "app", "api", "superadmin")).filter((path) => /\bgetCurrentUser\b|\bgetCurrentAuth\b/.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, [], "use context() or signedInUser() from lib/kfid/server.ts");
});

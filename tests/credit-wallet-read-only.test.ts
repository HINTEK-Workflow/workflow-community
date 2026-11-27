import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Läs utan skrivning (security hardening 2026-10-08): the shared context and the sandbox read never create or change a
// credit wallet; only explicit credit actions do (ensureCreditWallet / lockedWallet). The database side is proven by
// tests/credit-wallet-read-only.integration.ts.
const source = (path: string) => readFileSync(path, "utf8");

test("context() reads the wallet without writing it", () => {
  const server = source("lib/kfid/server.ts");
  assert.doesNotMatch(server, /creditWallet\.(upsert|create|update)/);
  assert.match(server, /creditWallet\.findUnique\(/);
});

test("the explicit credit paths create a missing wallet", () => {
  assert.match(source("lib/kfid/purchased-credits.ts"), /ensureCreditWallet\(organizationId, tx\)/);
  assert.match(source("app/api/workspace/route.ts"), /ensureCreditWallet\(ctx\.organizationId, tx\)/);
  assert.match(source("app/api/superadmin/customer-companies/route.ts"), /ensureCreditWallet\(input\.organizationId, tx\)/);
});

test("AI quotes and chats read the balance without requiring a wallet", () => {
  for (const path of ["lib/api-handlers/ai-quote.ts", "lib/api-handlers/ai-chat.ts"]) {
    const handler = source(path);
    assert.doesNotMatch(handler, /creditWallet\.findUniqueOrThrow/, path);
    assert.match(handler, /\?\? \{ balance: 0 \}/, path);
  }
});

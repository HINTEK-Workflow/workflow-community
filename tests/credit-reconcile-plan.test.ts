import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { creditWalletHealthy, describeCreditReconciliation, planCreditReconciliation } from "../lib/credits/reconcile-plan";

// Kreditlotter (2026-10-27): which number is wrong is decided by the two that agree; with all three apart nothing is done.
const healthy = { balance: 40, lotBalance: 40, ledgerBalance: 40, purchasedBalance: 10, purchasedLotBalance: 10 };

test("a healthy wallet needs nothing", () => {
  assert.equal(creditWalletHealthy(healthy), true);
  assert.deepEqual(planCreditReconciliation(healthy), { action: "none" });
});

test("balance and ledger agree, lots hold too little: a lot for the difference, or --remove takes it from the balance", () => {
  const drift = { ...healthy, lotBalance: 25 };
  assert.equal(creditWalletHealthy(drift), false);
  assert.deepEqual(planCreditReconciliation(drift), { action: "add-lot", credits: 15 });
  assert.deepEqual(planCreditReconciliation(drift, "remove"), { action: "remove-credits", credits: 15 });
});

test("lots and ledger agree: the stored balance and its purchased part follow them", () => {
  assert.deepEqual(planCreditReconciliation({ ...healthy, balance: 0, purchasedBalance: 0 }),
    { action: "set-balance", balance: 40, purchasedBalance: 10 });
  assert.deepEqual(planCreditReconciliation({ ...healthy, balance: 55 }), { action: "set-balance", balance: 40, purchasedBalance: 10 });
});

test("balance and lots agree, the ledger does not: one adjustment entry", () => {
  assert.deepEqual(planCreditReconciliation({ ...healthy, ledgerBalance: 30 }), { action: "add-entry", amount: 10 });
  assert.deepEqual(planCreditReconciliation({ ...healthy, ledgerBalance: 47 }), { action: "add-entry", amount: -7 });
});

test("only the purchased part differs: it follows the purchase lots", () => {
  assert.deepEqual(planCreditReconciliation({ ...healthy, purchasedBalance: 3 }), { action: "set-purchased", purchasedBalance: 10 });
});

test("nothing is decided automatically when the evidence is missing", () => {
  assert.equal(planCreditReconciliation({ ...healthy, lotBalance: 20, ledgerBalance: 30 }).action, "manual");
  assert.equal(planCreditReconciliation({ ...healthy, lotBalance: 60 }).action, "manual", "more in the lots than balance and ledger");
  assert.equal(planCreditReconciliation({ ...healthy, lotBalance: 25, purchasedBalance: 4 }).action, "manual", "purchased differs as well");
  assert.equal(planCreditReconciliation({ ...healthy, balance: 0, purchasedLotBalance: 50 }).action, "manual", "purchased lots above the lots");
  assert.equal(planCreditReconciliation({ ...healthy, purchasedBalance: 1, purchasedLotBalance: 1_001, balance: 2_000, lotBalance: 2_000, ledgerBalance: 2_000 }).action, "manual", "above the purchased cap");
  assert.equal(planCreditReconciliation({ ...healthy, balance: 1.5 }).action, "manual");
});

test("every plan has a line for the log and the check output", () => {
  for (const plan of [planCreditReconciliation(healthy), planCreditReconciliation({ ...healthy, lotBalance: 25 }),
    planCreditReconciliation({ ...healthy, lotBalance: 25 }, "remove"), planCreditReconciliation({ ...healthy, balance: 0 }),
    planCreditReconciliation({ ...healthy, ledgerBalance: 30 }), planCreditReconciliation({ ...healthy, purchasedBalance: 3 }),
    planCreditReconciliation({ ...healthy, lotBalance: 20, ledgerBalance: 30 })])
    assert.ok(describeCreditReconciliation(plan).length > 5);
});

test("the credit writes keep the balance and the lots together", () => {
  const credits = readFileSync("lib/kfid/purchased-credits.ts", "utf8");
  assert.doesNotMatch(credits, /remaining: 0 \}/, "an expiry takes what it read from the lot, never sets it to zero");
  assert.match(credits, /expiryRequestKey\(tx, walletId, lot\.id\)/, "a lot that expires again gets a new ledger key");
  // The refund lives in ee/ (Cloud only); the core without ee/ has no refunds to check.
  if (existsSync("ee/billing/refund-reconciliation.ts")) {
    const refund = readFileSync("ee/billing/refund-reconciliation.ts", "utf8");
    assert.ok(refund.indexOf("await lockedWallet(") > 0 && refund.indexOf("await lockedWallet(") < refund.indexOf("include: { lot: true }"),
      "a refund locks the wallet before it reads the lot");
  }
  const ledger = readFileSync("lib/ai/run-ledger.ts", "utf8");
  assert.match(ledger, /if \(wallet\.expiryEnabled\) await expireDueLots\(tx, reservation\.walletId, now\)/, "a release expires only where expiry is on");
  const workspace = readFileSync("app/api/workspace/route.ts", "utf8");
  assert.doesNotMatch(workspace, /test-balance-backfill/, "test credits never even a drifted wallet out with a hidden lot");
});

test("the daily check is a scheduled job that only reads, and the repair needs an explicit order", () => {
  const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
  assert.equal(scripts["credits:check"], "tsx scripts/ops/job.ts credits:check scripts/credits/reconcile.ts --check --alert");
  assert.equal(scripts["credits:reconcile"], "tsx scripts/credits/reconcile.ts");
  const script = readFileSync("scripts/credits/reconcile.ts", "utf8");
  assert.match(script, /if \(flag\("--apply"\)\) await apply\(\);\s*else await check\(\);/);
  assert.match(script, /--apply kräver --org/);
  if (existsSync("ops/cron/hintek-workflow")) assert.match(readFileSync("ops/cron/hintek-workflow", "utf8"), /run-job\.sh credits:check$/m);
});

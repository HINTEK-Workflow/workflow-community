// Kreditlotter (2026-10-27): the credit wallets' balance against their lots and ledger.
//
//   npm run credits:reconcile -- --check
//       Reads only. Prints every wallet that disagrees (organisation id, wallet id and numbers – no names) and what
//       --apply would do. Exit 1 when something disagrees.
//   npm run credits:check            (= --check --alert; daily from ops/cron/hintek-workflow through run-job.sh)
//       The same, and the operations alarm to the address under Produktadministration → E-post (docs/drift/LARM.md),
//       every day while it lasts. The mail holds counts only. Without driftlarm switched on it is printed and exits 3.
//   npm run credits:reconcile -- --apply --org <organisationId> --reason "<varför>" [--actor <vem>] [--remove] [--expect <saldo−lotter>]
//       Evens out one wallet, under its row lock, with an audit trail (lib/credits/reconcile.ts). Never changes a balance
//       without this explicit order. --remove takes credits without a lot from the balance instead of giving them a lot.
//
// Run inside the app container on the server (docs/drift/LARM.md), locally against kfid_v3_test.
import "dotenv/config";
import { prisma } from "../../lib/db";
import { applyCreditReconciliation, CreditReconcileError, findCreditWalletDrift } from "../../lib/credits/reconcile";
import { describeCreditReconciliation } from "../../lib/credits/reconcile-plan";
import { sendSystemEmail } from "../../lib/mail/mailer";
import { mailConfig } from "../../lib/mail/settings-server";
import { publicInstance } from "../../lib/instance";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
function option(name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new CreditReconcileError(`${name} saknar värde.`);
  return value;
}

async function alarm(count: number, testMode: number) {
  const config = await mailConfig();
  const subject = `[${publicInstance().name}] Kreditplånböcker stämmer inte (${count})`;
  const text = [
    `${count} kreditplånböcker har ett saldo som inte stämmer med sina kreditlotter eller sin bokföring${testMode ? ` (varav ${testMode} i testläge)` : ""}.`,
    "AI-körningar i de företagen nekas tills plånboken är avstämd. Inget saldo ändras automatiskt.",
    "Se vad som skiljer och vad en avstämning skulle göra: npm run credits:reconcile -- --check i appens behållare.",
    "Stäm av en plånbok: npm run credits:reconcile -- --apply --org <id> --reason \"…\" (auditeras).",
  ].join("\n");
  if (!config.delivery.alerts || !config.alertEmail || config.blockedReason) {
    console.log(`ALERT (inte skickat – larm-e-post är avstängd): ${subject}\n${text}`);
    process.exitCode = 3;
    return;
  }
  try {
    const html = `<pre style="font-family:monospace">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
    await sendSystemEmail({ to: config.alertEmail, subject, text, html });
    console.log(`ALERT skickat till driftadressen: ${subject}`);
  } catch {
    console.log(`ALERT (kunde inte skickas med e-post): ${subject}\n${text}`);
    process.exitCode = 3;
  }
}

async function check() {
  const { checked, drifted } = await findCreditWalletDrift(prisma);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    wallets: checked,
    drifted: drifted.map((row) => ({
      organizationId: row.organizationId, walletId: row.walletId, testMode: row.testMode,
      balance: row.balance, lotBalance: row.lotBalance, ledgerBalance: row.ledgerBalance,
      purchasedBalance: row.purchasedBalance, purchasedLotBalance: row.purchasedLotBalance,
      difference: row.balance - row.lotBalance, apply: describeCreditReconciliation(row.plan),
    })),
  }, null, 2));
  if (!drifted.length) return;
  if (flag("--alert")) await alarm(drifted.length, drifted.filter((row) => row.testMode).length);
  else process.exitCode = 1;
}

async function apply() {
  const organizationId = option("--org");
  const reason = option("--reason");
  if (!organizationId || !reason) throw new CreditReconcileError("--apply kräver --org <organisationId> och --reason \"…\".");
  const expect = option("--expect");
  const expectDifference = expect === undefined ? undefined : Number(expect);
  if (expectDifference !== undefined && !Number.isSafeInteger(expectDifference)) throw new CreditReconcileError("--expect ska vara ett heltal.");
  const result = await applyCreditReconciliation(prisma, {
    organizationId, reason, actor: option("--actor") ?? "drift", prefer: flag("--remove") ? "remove" : "lot", expectDifference,
  });
  const numbers = (value: typeof result.before) => ({ balance: value.balance, lotBalance: value.lotBalance, ledgerBalance: value.ledgerBalance,
    purchasedBalance: value.purchasedBalance, purchasedLotBalance: value.purchasedLotBalance });
  console.log(JSON.stringify({ organizationId, changed: result.changed, apply: describeCreditReconciliation(result.plan),
    before: numbers(result.before), after: numbers(result.after) }, null, 2));
}

async function main() {
  if (flag("--apply") && flag("--check")) throw new CreditReconcileError("Välj --check eller --apply.");
  if (flag("--apply")) await apply();
  else await check();
}

main()
  .catch((error) => {
    console.error("credits:reconcile misslyckades:", error instanceof Error ? error.message : error);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());

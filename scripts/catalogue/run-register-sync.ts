// Det gemensamma artikelregistrets synk (2026-10-17, lib/catalogue/register-sync.ts). Scheduled every ten minutes:
// does nothing while Solar's API connection is off (Tjänster och nycklar → Solar) or until the product owner has asked for the
// first full import; then the night's changes (01–05) and a full check once a month. Every run checks the connection first
// and starts nothing without it. Prints counts only – never a key, a token or a price.
// Run: npm run register:sync            (what is due now, if anything)
//      npm run register:sync -- --full  (a full import now – still only with an active, working connection)
//      npm run register:sync -- --changes
//      npm run register:sync -- --full --max-pages 5   (a bounded trial: nothing removed, does not count as a sync)
import "dotenv/config";
import { prisma } from "../../lib/db";
import { nextRegisterRun, registerSyncState, runRegisterSync, type RegisterRunKind } from "../../lib/catalogue/register-sync";

async function main() {
  const args = process.argv.slice(2);
  const forced: RegisterRunKind | null = args.includes("--full") ? "full" : args.includes("--changes") ? "changes" : null;
  const maxIndex = args.indexOf("--max-pages");
  const maxPages = maxIndex >= 0 ? Math.max(1, Math.min(1000, Number(args[maxIndex + 1]) || 1)) : undefined;
  const state = await registerSyncState();
  const kind = forced ?? nextRegisterRun(state, new Date());
  if (!kind) { console.log(state.apiEnabled ? "register:sync – inget att göra nu." : "register:sync – Solars API-anslutning är inte aktiverad; inget körs."); return; }
  const run = await runRegisterSync(kind, { maxPages });
  console.log(`register:sync ${run.kind}${run.trial ? " (prov)" : ""}: ${run.ok ? "ok" : "fel"} – ${run.message} sidor=${run.pages} skrivna=${run.written} borttagna=${run.removed} oläsbara=${run.skipped}`);
  if (!run.ok) process.exitCode = 1;
}

main().catch((error) => { console.error("register:sync fel:", error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());

// Nightly: deletes each company's work history older than the retention time it chose (2026-09-30).
// Companies that keep history "tills vidare" are skipped. Every deletion leaves one counted line in the company's
// administration history. Also deletes the competence cards of people who left a company more than three months ago
// (2026-10-07), whatever retention time the company chose, and absence older than the company keeps it (
// 2026-10-30). Run: npm run history:retention (daily, like rounds:reminders).
//      npm run history:retention -- --dry-run   (T5, 2026-10-24: deletes and writes nothing; prints what a run would delete,
//                                               counts only; the nightly machine analysis is left out)
import "dotenv/config";
import { prisma } from "../../lib/db";
import { jobArguments, jobPrefix } from "../../lib/jobs/dry-run";
import { retentionCutoff } from "../../lib/workflow/history-retention";
import { applyRetention } from "../../lib/workflow/history-retention-server";
import { pruneSystemLogs } from "../../lib/workflow/system-cleanup";
import { purgeExpiredCredentials } from "../../lib/self-inspection/credentials-server";
import { analyseAllSources } from "../../lib/machine/analysis-store";
import { summariseMachineDays } from "../../lib/machine/day-summary-store";
import { purgeStaffRegister } from "../../lib/staff-register/server";
import { purgeRetainedInvoices } from "../../lib/customer-invoice/retention-server";
import { purgeExpiredAbsence } from "../../lib/absence/retention-server";
import { purgeExpiredDeviations } from "../../lib/self-inspection/retention-server";
import { purgeExpiredAgentHistory } from "../../lib/agents/retention-server";

async function main() {
  const { dryRun } = jobArguments(process.argv.slice(2), "history:retention");
  const job = jobPrefix("history:retention", dryRun);
  const results = await applyRetention(new Date(), retentionCutoff, { dryRun });
  for (const result of results) console.log(`${job} ${result.organizationId} ${JSON.stringify(dryRun ? { ...result.counts, importedFiles: result.importedFiles, reports: result.reports } : result.counts)}`);
  // Competence cards of people who left more than three months ago, with their files; counts only, never names.
  const cards = await purgeExpiredCredentials(new Date(), { dryRun });
  for (const result of cards) console.log(`${job} kompetenskort ${result.organizationId} ${JSON.stringify({ cards: result.cards, lines: result.lines, files: result.files })}`);
  // Personalliggare (steg 1): its own retention time, whatever the company chose for its history (lib/staff-register).
  const register = await purgeStaffRegister(new Date(), { dryRun });
  for (const result of register) console.log(`${job} personalliggare ${result.organizationId} ${JSON.stringify({ events: result.events, people: result.people })}`);
  // Fakturor (2026-11-04): what an erased company keeps, when its seven years are over; counts only.
  const invoices = await purgeRetainedInvoices(new Date(), { dryRun });
  for (const result of invoices) console.log(`${job} fakturor ${result.organizationId} ${JSON.stringify({ invoices: result.invoices })}`);
  // Frånvaro (2026-10-30): its own retention time per company (Organization.absenceRetentionMonths); counts only.
  const absence = await purgeExpiredAbsence(new Date(), { dryRun });
  for (const result of absence) console.log(`${job} frånvaro ${result.organizationId} ${JSON.stringify({ absences: result.absences, events: result.events })}`);
  // Avvikelser, tillbud och olycksfall (2026-11-04): fixed times counted from closing (lib/self-inspection/retention.ts); counts only.
  const deviations = await purgeExpiredDeviations(new Date(), { dryRun });
  for (const result of deviations) console.log(`${job} avvikelser ${result.organizationId} ${JSON.stringify({ removed: result.removed, personalData: result.personalData, files: result.files })}`);
  // Agentkörningar och AI-förslag (granskningen 2026-11-24): a fixed time for every company (lib/agents/retention.ts); counts only.
  const agents = await purgeExpiredAgentHistory(new Date(), { dryRun });
  for (const result of agents) console.log(`${job} agenter ${result.organizationId} ${JSON.stringify({ runs: result.runs, proposals: result.proposals })}`);
  // Integrationsmotorn E6: the objects' day summaries are counted before the machine events are pruned below. It writes, so a dry run leaves it out.
  if (dryRun) console.log(`${job} maskindygn hoppas över i provkörningen`);
  else console.log(`${job} maskindygn ${JSON.stringify(await summariseMachineDays(new Date()))}`);
  // System logs clear themselves whatever the companies choose (2026-10-03).
  console.log(`${job} systemloggar ${JSON.stringify(await pruneSystemLogs(new Date(), { dryRun }))}`);
  // Maskinanalys (0.19.0): the rules look at every source once a night; counts only. It writes, so a dry run leaves it out.
  if (dryRun) console.log(`${job} maskinanalys hoppas över i provkörningen`);
  else console.log(`${job} maskinanalys ${JSON.stringify(await analyseAllSources(new Date()))}`);
  console.log(dryRun
    ? `${job} klar – inget raderat; ${results.length} företag skulle rensas, kompetenskort i ${cards.length} företag, personalliggare i ${register.length} företag.`
    : `${job} klar – ${results.length} företag rensade, kompetenskort i ${cards.length} företag.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

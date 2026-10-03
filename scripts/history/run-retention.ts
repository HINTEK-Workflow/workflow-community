// Nightly: deletes each company's work history older than the retention time it chose (2026-09-30).
// Companies that keep history "tills vidare" are skipped. Every deletion leaves one counted line in the company's
// administration history. Run: npm run history:retention (daily, like rounds:reminders).
import "dotenv/config";
import { prisma } from "../../lib/db";
import { retentionCutoff } from "../../lib/workflow/history-retention";
import { applyRetention } from "../../lib/workflow/history-retention-server";
import { pruneSystemLogs } from "../../lib/workflow/system-cleanup";

async function main() {
  const results = await applyRetention(new Date(), retentionCutoff);
  for (const result of results) console.log(`history:retention ${result.organizationId} ${JSON.stringify(result.counts)}`);
  // System logs clear themselves whatever the companies choose (2026-10-03).
  console.log(`history:retention systemloggar ${JSON.stringify(await pruneSystemLogs(new Date()))}`);
  console.log(`history:retention klar – ${results.length} företag rensade.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

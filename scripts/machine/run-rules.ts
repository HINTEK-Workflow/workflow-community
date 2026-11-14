// Maskinregler (integrationsmotorn E3, 2026-10-24 svar 5): what time alone decides for the rules on machine signals
// – a duration that has been reached, a signal that has gone quiet ("har inte hörts av") – every 5 minutes. A transition
// becomes an event in the ordinary alarm chain. Prints counts only. Cron: every 5 minutes (ops/cron/hintek-workflow, installed on the server at release).
// Run: npm run machine:rules
import "dotenv/config";
import { prisma } from "../../lib/db";
import { runTimedRules } from "../../lib/machine/rule-engine";
import { storeBatch } from "../../lib/machine/store";

async function main() {
  const result = await runTimedRules(new Date(), storeBatch);
  console.log(`machine:rules – ${result.rules} regler prövade, ${result.events} händelser`);
}

main()
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

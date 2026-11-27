// Agenter (2026-11-21): starts the agent missions whose time has come and the runs that wait for a new attempt – each as its
// owner, with the owner's rights checked again (lib/agents/server.ts). A run that stopped half-way is marked "Kontrollera innan du kör
// igen" and never tried again by itself. Every five minutes; does nothing without missions. Prints counts only.
// Run: npm run agents:run
import "dotenv/config";
import { prisma } from "../../lib/db";
import { jobArguments, jobPrefix } from "../../lib/jobs/dry-run";
import { runDueAgents } from "../../lib/agents/server";

async function main() {
  const { dryRun } = jobArguments(process.argv.slice(2), "agents:run");
  const job = jobPrefix("agents:run", dryRun);
  if (dryRun) {
    const now = new Date();
    const [missions, runs] = await Promise.all([prisma.agentMission.count({ where: { status: "active", deletedAt: null, nextRunAt: { lte: now } } }), prisma.agentRun.count({ where: { status: "queued", nextAttemptAt: { lte: now } } })]);
    console.log(`${job} – ${missions} uppdrag och ${runs} körningar skulle starta; inget har körts`);
    return;
  }
  const result = await runDueAgents(new Date());
  console.log(`${job} – ${result.missions} uppdrag att starta, ${result.due} körningar: ${result.done} klara, ${result.nothing} utan något att rapportera, ${result.skipped} hoppades över, ${result.retried} försöks igen, ${result.failed} misslyckades, ${result.stale} avbrutna`);
}

main()
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

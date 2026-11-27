// Schemalägg (2026-11-11): publishes the posts (Inlägg) and pages (Min webbsida) an admin scheduled, when their time has
// come – as that admin, with exactly the approved content, and only while the company's switch, the token and the admin's role
// still allow it (lib/schedule/server.ts). Every five minutes; a failure shows as Misslyckades and is mailed to the company's
// admins once. Nothing is ever scheduled by the job itself. Prints counts only.
// Run: npm run schedule:publish
//      npm run schedule:publish -- --dry-run   (publishes nothing; counts what is due)
import "dotenv/config";
import { prisma } from "../../lib/db";
import { jobArguments, jobPrefix } from "../../lib/jobs/dry-run";
import { runDueScheduled } from "../../lib/schedule/server";

async function main() {
  const { dryRun } = jobArguments(process.argv.slice(2), "schedule:publish");
  const job = jobPrefix("schedule:publish", dryRun);
  const now = new Date();
  if (dryRun) {
    const [due, stale] = await Promise.all([
      prisma.scheduledPublish.count({ where: { status: "scheduled", nextAttemptAt: { lte: now } } }),
      prisma.scheduledPublish.count({ where: { status: "running", lockedUntil: { lt: now } } }),
    ]);
    console.log(`${job} – ${due} skulle publiceras, ${stale} avbrutna skulle markeras som misslyckade; inget har publicerats`);
    return;
  }
  const result = await runDueScheduled(now);
  console.log(`${job} – ${result.due} att publicera: ${result.published} publicerade, ${result.retried} försöks igen, ${result.failed} misslyckades, ${result.skipped} behövdes inte, ${result.stale} avbrutna`);
  // Filmer (2026-11-20): the films whose upload to YouTube is due (scheduled just now, or stopped half-way), within four minutes.
  const { runYouTubeUploads } = await import("../../lib/youtube/videos-server");
  const films = await runYouTubeUploads(new Date());
  if (films.due || films.steps) console.log(`${job} – YouTube: ${films.due} filmer att ladda upp: ${films.done} klara, ${films.paused} fortsätter, ${films.retried} försöks igen, ${films.failed} misslyckades`);
}

main()
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

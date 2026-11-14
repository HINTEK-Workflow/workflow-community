// Utskick (2026-10-03): sends what waits in the mailing queue, a batch at a time. Cron every five minutes.
// Since 2026-11-12 also deletes the landing page's unconfirmed newsletter addresses whose link has expired.
// Since 2026-10-06 also the scheduled mailings whose time has come and, at its slot, the weekly newsletter's DRAFT.
// The newsletter is never sent by itself (2026-10-07): the weekly slot only writes a draft and the superadmin
// approves it under Utskick; only an approved or deliberately scheduled mailing reaches the queue.
// Run: npm run mailings:send
//      npm run mailings:send -- --dry-run   (T5, 2026-10-24: queues, drafts and sends nothing; prints counts of what a run
//                                           would do, never an address)
import "dotenv/config";
import { prisma } from "../../lib/db";
import { jobArguments, jobPrefix } from "../../lib/jobs/dry-run";
import { previewMailings, processMailings } from "../../lib/mail/mailings";
import { runWeeklyDraft, weeklyDraftDue } from "../../lib/mail/release-newsletter-server";
import { purgeExpiredSubscriptions } from "../../lib/mail/newsletter-subscribers";

const BATCH = 500;

async function main() {
  const { dryRun } = jobArguments(process.argv.slice(2), "mailings:send");
  const job = jobPrefix("mailings:send", dryRun);
  if (dryRun) {
    const [due, preview] = await Promise.all([weeklyDraftDue(), previewMailings(BATCH)]);
    console.log(`${job} – veckobrevsutkast: ${due ? "tiden har kommit, ett utkast skulle göras om något är nytt" : "inte nu"}`);
    console.log(`${job} – ${preview.dueMailings} schemalagda utskick skulle köas (${preview.dueRecipients} mottagare), ${preview.waiting} mottagare väntar i kön`);
    console.log(`${job} – ${await purgeExpiredSubscriptions(new Date(), { dryRun: true })} obekräftade nyhetsbrevsadresser skulle tas bort`);
    console.log(`${job} – körningen skulle ${preview.blocked ? "hoppa över" : "skicka"} högst ${preview.thisRun} mejl${preview.blocked ? " (den här installationen skickar aldrig)" : ""}; inget har skickats`);
    return;
  }
  // Följ nyhetsbrevet (2026-11-12): an address whose confirmation link expired (48 hours) is deleted; counts only.
  const expired = await purgeExpiredSubscriptions();
  if (expired) console.log(`${job} – tog bort ${expired} obekräftade nyhetsbrevsadresser`);
  const weekly = await runWeeklyDraft();
  if (weekly.drafted) console.log(`${job} – veckobrevsutkast med version ${weekly.version} gjort, väntar på godkännande`);
  else if (weekly.reason !== "not-due") console.log(`${job} – inget veckobrevsutkast (${weekly.reason})`);
  const result = await processMailings(BATCH);
  console.log(`${job} – skickade ${result.sent}, misslyckades ${result.failed}, hoppade över ${result.skipped}`);
}

main()
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

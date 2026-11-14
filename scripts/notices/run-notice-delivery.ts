// Notiser per e-post och push (2026-10-07): sends the reminders that people have chosen to get as e-mail or web
// push – only to those who said yes under Mina inställningar, one message with what is new, never the same notice twice.
// Off until e-postnotiser are switched on under Produktadministration → E-post and/or webbpush has keys and is switched
// on; never from a loopback QA instance. Prints counts only, never addresses. Cron: every 15 minutes in the daytime.
// Run: npm run notices:send
//      npm run notices:send -- --dry-run   (T5, 2026-10-24: sends, marks and deletes nothing; counts what a run would send)
import "dotenv/config";
import { prisma } from "../../lib/db";
import { jobArguments, jobPrefix } from "../../lib/jobs/dry-run";
import { runNoticeDelivery } from "../../lib/workflow/notice-delivery";

async function main() {
  const { dryRun } = jobArguments(process.argv.slice(2), "notices:send");
  const result = await runNoticeDelivery({ dryRun });
  const would = dryRun ? "skulle skickas: " : "";
  console.log(`${jobPrefix("notices:send", dryRun)} – ${result.status === "disabled" ? "av (varken e-postnotiser eller webbpush är påslaget)" : `${would}${result.people} personer, ${result.emails} mejl, ${result.pushes} push, ${result.notices} notiser, ${result.failed} fel, ${result.skipped} överhoppade${dryRun ? "; inget har skickats" : ""}`}`);
}

main()
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

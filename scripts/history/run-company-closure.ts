// Nightly: Radering efter avslut (2026-10-10, villkoren punkt 11). Companies whose Cloud agreement has ended get
// a notice at once (bell and e-mail to owners and admins), a reminder 7 days and 1 day before the date, and are erased
// with eraseCompany (accounting and the staff register kept) once the 30 days of export have passed – but only while
// "Automatisk radering påslagen" is on under Produktadministration → Kundföretag (off by default: then the job only
// counts down and notifies). At most three companies per night. Prints company ids and counts, never names or addresses.
// Run: npm run companies:closure            (daily, after history:retention)
//      npm run companies:closure -- --dry-run   (writes, sends and erases nothing; prints what a run would do)
import "dotenv/config";
import { prisma } from "../../lib/db";
import { runCompanyClosures } from "../../lib/company-closure/server";
import { jobArguments } from "../../lib/jobs/dry-run";

async function main() {
  // An unknown argument (a misspelt --dry-run) stops the job before anything runs (T5, 2026-10-24).
  const { dryRun } = jobArguments(process.argv.slice(2), "companies:closure");
  const report = await runCompanyClosures({ dryRun });
  const ids = (label: string, list: string[]) => `${label} ${list.length}${list.length ? ` (${list.join(", ")})` : ""}`;
  console.log(`companies:closure${dryRun ? " (provkörning)" : ""} – automatisk radering ${report.autoErase ? "PÅ" : "AV"}; ${[
    ids("nya nedräkningar", report.started), ids("påminnelser", report.reminded), ids("avbrutna", report.cancelled),
    ids("förfallna", report.due), ids("raderade", report.erased), ids("misslyckade", report.failed), `väntar till nästa körning ${report.waiting}`,
  ].join(", ")}.`);
  if (report.failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

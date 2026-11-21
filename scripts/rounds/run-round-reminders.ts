import "dotenv/config";
import { runRoundReminderWorker } from "../../lib/workflow/round-reminder-worker";

// Once each morning (2026-09-30): e-mail today's rounds to their responsible person (off until
// ROUND_EMAIL_DELIVERY_ENABLED is set). Prints counts only, never addresses. Since 2026-10-27 (punkt 3) the job makes no
// work orders: a round is held by a work order a person made for a period.
async function main() {
  const result = await runRoundReminderWorker();
  console.log(JSON.stringify({ reminders: result }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.name : "RoundReminderWorkerError");
  process.exitCode = 1;
});

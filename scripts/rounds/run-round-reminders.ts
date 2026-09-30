import "dotenv/config";
import { runRoundReminderWorker } from "../../lib/workflow/round-reminder-worker";

// Once each morning (2026-09-30): e-mail today's rounds to their responsible person. Off until
// ROUND_EMAIL_DELIVERY_ENABLED is set; prints counts only, never addresses.
async function main() {
  const result = await runRoundReminderWorker();
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.name : "RoundReminderWorkerError");
  process.exitCode = 1;
});

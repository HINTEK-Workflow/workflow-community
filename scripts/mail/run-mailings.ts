// Utskick (2026-10-03): sends what waits in the mailing queue, a batch at a time. Cron every five minutes.
// Run: npm run mailings:send
import "dotenv/config";
import { prisma } from "../../lib/db";
import { processMailings } from "../../lib/mail/mailings";

processMailings(500)
  .then((result) => console.log(`mailings:send – skickade ${result.sent}, misslyckades ${result.failed}, hoppade över ${result.skipped}`))
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

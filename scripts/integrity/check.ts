// Read-only system integrity check. Suitable for a scheduled job; exits 1 when findings need attention.
// Usage: npm run integrity:check [-- --files]   (--files also verifies that stored attachment files exist)
import { prisma } from "../../lib/db";
import { checkSystemIntegrity } from "../../lib/integrity/system-integrity";

async function main() {
  const report = await checkSystemIntegrity(prisma, { checkFiles: process.argv.includes("--files") });
  const { warnings, ...summary } = report;
  console.log(JSON.stringify({ ...summary, warnings: warnings.length }, null, 2));
  if (warnings.length && process.argv.includes("--verbose")) console.log(JSON.stringify(warnings, null, 2));
  if (!report.healthy) process.exitCode = 1;
}

main()
  .catch((error) => { console.error("Integritetskontrollen misslyckades", error instanceof Error ? error.message : error); process.exitCode = 2; })
  .finally(() => prisma.$disconnect());

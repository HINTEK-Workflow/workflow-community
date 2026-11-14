// Återkommande underhåll (2026-10-30): varje underhållsplan fyller på sina vilande arbetsordrar ett år framåt (högst
// 12), flyttar dem när ett tillfälle stängts sent eller skjutits upp, och gör arbetsordern när en del nått sina drifttimmar
// (lib/maintenance/plan-server.ts fillAllPlans). Appen gör samma sak direkt när en plan eller dess arbetsorder ändras; jobbet
// fångar resten (en dag som kommit, en ändring som misslyckades). Skriver bara antal. Cron: 05:40 varje natt
// (ops/cron/hintek-workflow, installeras på servern vid släppet).
// Run: npm run maintenance:plans
import "dotenv/config";
import { prisma } from "../../lib/db";
import { fillAllPlans } from "../../lib/maintenance/plan-server";

async function main() {
  const result = await fillAllPlans(new Date());
  console.log(`maintenance:plans – ${result.plans} planer, ${result.created} nya arbetsordrar, ${result.updated} flyttade, ${result.removed} borttagna, ${result.failed} fel`);
  if (result.failed) process.exitCode = 1;
}

main()
  .catch((error: unknown) => { console.error(error instanceof Error ? error.name : "MaintenancePlansError"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

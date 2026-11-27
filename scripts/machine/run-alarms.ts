// Maskinlarm (integrationsmotorn E6, 2026-10-24 svar 5 och beslut 2026-10-18 punkt 4): eskaleringen – ett larm som
// ingen kvitterat går vidare från objektets ansvarige till ersättaren och sedan till alla som får maskinlarm – och larmen
// som e-post och push. Dygnet runt, men på natten skickas e-post och push bara när företaget valt dygnet runt och personen
// själv sagt ja; annars kommer nattens larm i morgonlistan efter kl. 06. Skriver bara antal. Cron: var 5:e minut
// (ops/cron/hintek-workflow, installeras på servern vid släppet).
// Run: npm run machine:alarms
import "dotenv/config";
import { prisma } from "../../lib/db";
import { runAlarmEscalation } from "../../lib/machine/alarm-escalation-store";
import { runMachineAlarmDelivery } from "../../lib/machine/alarm-delivery";
import { runFaultEscalation } from "../../lib/operator/on-call-store";

async function main() {
  const now = new Date();
  const escalation = await runAlarmEscalation(now);
  // Felanmälningar som gått till jouren (operatörssidan, 2026-10-30) eskaleras på samma sätt, före utskicket.
  const faults = await runFaultEscalation(now);
  const delivery = await runMachineAlarmDelivery({ now });
  console.log(`machine:alarms – ${escalation.rows} öppna larm, ${escalation.escalated} eskalerade, ${escalation.acknowledged} kvitterade, ${escalation.told} nya i klockan; felanmälningar till jouren: ${faults.rows} öppna, ${faults.escalated} eskalerade, ${faults.acknowledged} kvitterade; `
    + (delivery.status === "disabled" ? "e-post och push av" : `${delivery.people} personer, ${delivery.emails} mejl, ${delivery.pushes} push, ${delivery.failed} fel`));
}

main()
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

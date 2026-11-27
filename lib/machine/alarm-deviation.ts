import { z } from "zod";

/**
 * Integrationsmotorn E6, svar 2026-10-24: "Skapa avvikelse" på den automatiska arbetsordern. Ger en post i
 * egenkontrollens avvikelselogg (samma modell som de andra avvikelserna) som är länkad till ordern åt båda håll – ordern
 * visar "Avvikelse N i avvikelseloggen", loggen visar ordern, och när ordern färdigställs blir posten Åtgärdad (de
 * befintliga reglerna i lib/self-inspection/deviation-link.ts). Högst en post per order. Rent: åtgärden och texterna;
 * databasdelen finns i alarm-deviation-server.ts.
 */
export const alarmDeviationActionSchema = z.object({ action: z.literal("create_deviation_from_alarm"), taskId: z.string().min(1).max(120) });

const SEVERITY_WORD: Record<string, string> = { info: "info", warning: "varning", fault: "fel", critical: "kritiskt" };
const oneLine = (value: string, max: number) => value.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

/** Postens rubrik, text och klass: ett kritiskt larm är Omedelbar åtgärd, annars Rutinöversyn. Maskinens text är bara text. */
export function alarmDeviationText(input: { orderTitle: string; sourceName: string; code: string; severity: string; text: string; occurredAt: string }) {
  const what = oneLine(input.text, 160) || oneLine(input.code, 64);
  return {
    title: (oneLine(input.orderTitle, 200) || `Larm: ${what}`).slice(0, 200),
    description: [
      `Från ett maskinlarm: ${oneLine(input.sourceName, 80) || "maskinen"}, kod ${oneLine(input.code, 64)} (${SEVERITY_WORD[input.severity] ?? input.severity}), ${input.occurredAt}.`,
      what !== oneLine(input.code, 64) ? `Maskinens text: ${what}` : "",
      "Åtgärdas genom den automatiska arbetsordern.",
    ].filter(Boolean).join("\n").slice(0, 4000),
    category: input.severity === "critical" ? "IMMEDIATE" as const : "ROUTINE" as const,
  };
}

export const ALARM_DEVIATION_EXISTS = (number: number) => `Ordern har redan avvikelse ${number} i avvikelseloggen.`;
export const ALARM_DEVIATION_REFUSAL = "Avvikelse från ett maskinlarm kräver att du får läsa arbetsordrar.";

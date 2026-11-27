import { z } from "zod";
import { swedishParts } from "@/lib/swedish-time";

/**
 * Integrationsmotorn E6 (beslut 2026-10-18: "Ansvarig och ersättare per objekt får larm med kvittens och eskalering";
 * punkt 4: "larmnotis (MACHINE_ALARM) får skickas dygnet runt, bara den sorten och bara med uttryckligt ja per person").
 * Rena regler: vem som får ett maskinlarm i vilket steg, när nästa steg är dags, när e-post och push får gå ut, och vad
 * administratören får spara. Databasdelen finns i alarm-escalation-store.ts. Workflow är inget larm- eller säkerhetssystem
 * och lovar ingen leveranstid – det står där ansvar och dygnet runt väljs.
 *
 * Förval (går att ändra per företag): notiser dagtid 06–20 och nattens larm i morgonlistan kl. 06; 15 minuter per steg;
 * ansvarig → ersättare → alla som får larm i dag (administratörerna och de som valt Maskinlarm). Ett objekt utan ansvarig
 * och ersättare beter sig som före E6: alla får larmet direkt.
 */
export const ALARM_HOURS = ["day", "always"] as const;
export type AlarmHours = (typeof ALARM_HOURS)[number];
export const ALARM_HOURS_LABELS: Record<AlarmHours, string> = {
  day: "Dagtid 06–20 (förval). Nattens larm kommer i morgonlistan kl. 06.",
  always: "Dygnet runt, men på natten bara till den som själv sagt ja",
};
export const DEFAULT_ALARM_HOURS: AlarmHours = "day";
export const DEFAULT_ESCALATION_MINUTES = 15;
export const ESCALATION_MINUTES_MIN = 5;
export const ESCALATION_MINUTES_MAX = 240;
/** Dagtid i svensk tid: från kl. 06:00 till 19:59. Natt: 20:00–05:59 (samma timmar som notices:send inte går). */
export const DAY_START_HOUR = 6;
export const NIGHT_START_HOUR = 20;
/** En larmrad eskaleras inte längre än så här efter att ordern skapades (en order som ingen tar blir inte ett evigt larm). */
export const ESCALATION_MAX_AGE_MS = 7 * 24 * 3_600_000;
export const CONTACT_ROLES = ["responsible", "deputy"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = { responsible: "Ansvarig", deputy: "Ersättare" };

export const ALARM_SAFETY_TEXT = "Workflow är inget larm- eller säkerhetssystem och lovar ingen leveranstid. Notiser kan bli försenade eller utebli.";

/** Natt i svensk tid (sommar- och vintertid följer med). */
export function isNight(now: Date) {
  const { hour } = swedishParts(now);
  return hour < DAY_START_HOUR || hour >= NIGHT_START_HOUR;
}

export type EscalationStepKind = "responsible" | "deputy" | "everyone";
export type EscalationStep = { kind: EscalationStepKind; userIds: string[] };

/**
 * Stegen för ett larm. `contacts` är objektets ansvarig och ersättare, redan prövade (aktiva medlemmar som får läsa
 * arbetsordrar); `everyone` är de som får larmet i dag (alarmRecipients). Ett steg utan någon ny person tas bort. Utan
 * ansvarig och ersättare finns bara steget "alla", som före E6.
 */
export function escalationSteps(input: { responsible: string | null; deputy: string | null; everyone: readonly string[] }): EscalationStep[] {
  const steps: EscalationStep[] = [];
  const told = new Set<string>();
  const add = (kind: EscalationStepKind, ids: readonly (string | null)[]) => {
    const fresh = [...new Set(ids.filter((id): id is string => Boolean(id) && !told.has(id!)))].sort();
    if (!fresh.length) return;
    fresh.forEach((id) => told.add(id));
    steps.push({ kind, userIds: fresh });
  };
  add("responsible", [input.responsible]);
  add("deputy", [input.deputy]);
  add("everyone", input.everyone);
  return steps;
}

/**
 * Nästa steg som är dags, eller null. `step` är det senaste steget som fått larmet, `lastAt` när det fick det. Nästa steg
 * går när `minutes` minuter gått utan kvittens; ett steg i taget (ett jobb som varit borta tar inte alla steg på en gång).
 */
export function escalationDue(input: { step: number; lastAt: Date; now: Date; minutes: number; steps: number }): number | null {
  const next = input.step + 1;
  if (next >= input.steps) return null;
  return input.now.getTime() - input.lastAt.getTime() >= input.minutes * 60_000 ? next : null;
}

/**
 * Får en larmnotis gå ut som e-post eller push just nu? Dagtid alltid (som de andra notiserna, bara till dem som valt
 * typen). På natten bara när företaget valt dygnet runt och personen själv sagt ja; annars väntar den till morgonlistan.
 * Klockan i appen visar alltid larmet.
 */
export function alarmNoticeAllowed(input: { now: Date; hours: string; personNight: boolean }) {
  if (!isNight(input.now)) return true;
  return input.hours === "always" && input.personNight;
}

export const alarmSettingsInput = z.object({
  hours: z.enum(ALARM_HOURS),
  escalationMinutes: z.number().int().min(ESCALATION_MINUTES_MIN, `Minst ${ESCALATION_MINUTES_MIN} minuter.`).max(ESCALATION_MINUTES_MAX, `Högst ${ESCALATION_MINUTES_MAX} minuter.`),
});
export type AlarmSettingsInput = z.infer<typeof alarmSettingsInput>;

const userId = z.string().min(1).max(64).nullable();
export const alarmContactsInput = z.object({
  /** Underhåll (2026-10-30): the machine part (it was a place in the customer's place tree). */
  partId: z.string().min(1).max(100),
  responsibleUserId: userId,
  deputyUserId: userId,
}).refine((value) => !value.responsibleUserId || value.responsibleUserId !== value.deputyUserId, { message: "Ansvarig och ersättare ska vara två olika personer.", path: ["deputyUserId"] });
export type AlarmContactsInput = z.infer<typeof alarmContactsInput>;

export const alarmSettingsAudit = (before: { hours: string; minutes: number }, after: AlarmSettingsInput) =>
  `Ändrade maskinlarmens notiser från ${before.hours === "always" ? "dygnet runt" : "dagtid"} och ${before.minutes} minuter per steg till ${after.hours === "always" ? "dygnet runt" : "dagtid"} och ${after.escalationMinutes} minuter per steg.`;

export const alarmContactsAudit = (place: string, names: { responsible: string | null; deputy: string | null }) =>
  `Ändrade larmansvaret för maskindelen ”${place}”: ansvarig ${names.responsible ?? "ingen"}, ersättare ${names.deputy ?? "ingen"}.`;

/** Vad stegen betyder för ett objekt, i ord (sidan Larmansvar). */
export function escalationSummary(input: { responsible: string | null; deputy: string | null; minutes: number }) {
  if (!input.responsible && !input.deputy) return "Inget eget larmansvar: alla som får maskinlarm får larmet direkt.";
  const first = input.responsible ?? input.deputy!;
  const second = input.responsible && input.deputy ? input.deputy : null;
  return second
    ? `${first} först, ${second} efter ${input.minutes} minuter utan kvittens, alla som får maskinlarm efter ${input.minutes * 2} minuter.`
    : `${first} först, alla som får maskinlarm efter ${input.minutes} minuter utan kvittens.`;
}

// Larm blir arbetsorder (S3): de rena reglerna, utan databas. Servern (lib/machine/alarm-orders.ts) hämtar fakta och
// frågar här; allt som går att avgöra av fakta ensamma avgörs här så att det kan provas med enhetstester.

export const ALARM_MODES = ["off", "direct", "approval"] as const;
export type AlarmMode = (typeof ALARM_MODES)[number];
/** The PLC simulator marks its texts with this (lib/machine/simulator/events.ts). */
export const SIM_TEXT_PREFIX = "Simulerat: ";

export const ALARM_MODE_LABELS: Record<AlarmMode, string> = {
  off: "Av",
  direct: "Märkt arbetsorder direkt",
  approval: "Väntar på godkännande",
};

/** Skaparen av en automatisk order. Ingen användarrad: fältet är bara text, och namnet visas som "Maskinlarm". */
export const SYSTEM_CREATOR = "system:machine-alarm";
export const SYSTEM_CREATOR_NAME = "Maskinlarm";
/**
 * Skaparen av en arbetsorder från operatörssidans felanmälan (lib/operator/maintenance-adapter.ts har samma värde men kan inte
 * importeras på klienten). Kundresan 2026-11-07 (H1): en sådan order får samma ruta som ett maskinlarm (Jag tar den, Tilldela).
 */
export const OPERATOR_FAULT_CREATOR = "system:operator-fault";
/** De automatiska maskinordrarnas skapare: maskinlarm och felanmälan. */
export const MACHINE_ORDER_CREATORS: readonly string[] = [SYSTEM_CREATOR, OPERATOR_FAULT_CREATOR];

/** Högst så många förslag och ordrar per företag och dygn, så ett larmoväder aldrig fyller listan. */
export const DAILY_ALARM_ORDER_CAP = 20;

export type AlarmFacts = {
  mode: AlarmMode;
  now: Date;
  cooldownMinutes: number;
  /** När källans senaste rad (vilken status som helst) gjordes, eller null. */
  lastRowAt: Date | null;
  /** Antal rader företaget fått de senaste 24 timmarna (ett rullande dygn, inte sedan midnatt). */
  rowsToday: number;
  dailyCap?: number;
};

export type AlarmDecision =
  | { act: "create" | "queue" }
  | { act: "skip"; reason: "mode_off" | "cooldown" | "daily_cap" };

/** Bara ett nytt larm (raised, eller utan läge) med fel eller kritisk nivå kan ge en order; varningar och info gör det aldrig. */
export function triggersOrder(event: { type: string; severity: string; state: string | null }) {
  return event.type === "alarm" && (event.state === null || event.state === "raised") && (event.severity === "fault" || event.severity === "critical");
}

export function decideAlarm(facts: AlarmFacts): AlarmDecision {
  if (facts.mode === "off") return { act: "skip", reason: "mode_off" };
  if (facts.lastRowAt && facts.now.getTime() - facts.lastRowAt.getTime() < facts.cooldownMinutes * 60_000) return { act: "skip", reason: "cooldown" };
  if (facts.rowsToday >= (facts.dailyCap ?? DAILY_ALARM_ORDER_CAP)) return { act: "skip", reason: "daily_cap" };
  return { act: facts.mode === "direct" ? "create" : "queue" };
}

/** Arbetsordern: rubrik och beskrivning som visar att den är automatisk och varifrån den kom. Texten från maskinen är fri text och visas som text. */
export function alarmOrderText(input: { sourceName: string; code: string; severity: string; text: string; occurredAt: Date }) {
  const level = input.severity === "critical" ? "kritiskt" : "fel";
  // A simulated alarm says so once, at the end ("Larm: Fläkt F1, motorskydd (simulerat)"), not as a second label after "Larm:".
  const simulated = input.text.trim().startsWith(SIM_TEXT_PREFIX);
  const what = (simulated ? input.text.trim().slice(SIM_TEXT_PREFIX.length).trim() : input.text.trim()) || input.code;
  const mark = simulated ? " (simulerat)" : "";
  const title = `Larm: ${what.slice(0, 200 - 6 - mark.length)}${mark}`;
  const description = [
    `Skapad automatiskt av larm från ${input.sourceName}.`,
    `Larmkod: ${input.code} (${level}).`,
    input.text.trim() ? `Maskinens text: ${input.text.trim()}` : "",
    "Kontrollera maskinen. Ordern stängs aldrig automatiskt: ett larm som släcks betyder inte att maskinen är i drift igen.",
  ].filter(Boolean).join("\n\n");
  return { title, description: description.slice(0, 5000), fault: `${what} (${input.code})`.slice(0, 2000), priority: input.severity === "critical" ? ("URGENT" as const) : ("HIGH" as const) };
}

// Integrationsmotorn E1: statusraden för maskiner på en plats ("Plats och anläggningar" och platssidan) och fliken Händelser.
// Rena regler, så att sidorna och testerna delar dem. Inga löften om leveranstid: Workflow är inget larmsystem.

export type MachineStatusInput = {
  /** Källor som har platsen (eller något under den) som standardobjekt. */
  sources: number;
  /** Senaste driftläget som tagits emot för platsen (eller något under den), eller null. */
  state: "running" | "stopped" | null;
  stateAt: string | null;
  /** När något senast hördes från platsens maskiner. */
  lastHeardAt: string | null;
  /** Öppna automatiska arbetsordrar och larmförslag som väntar, för platsen och det som ligger under. */
  openOrders: number;
  pendingOrders: number;
};
export type MachineStatusTone = "danger" | "warning" | "success" | "neutral";
export type MachineStatus = MachineStatusInput & { label: string; tone: MachineStatusTone };

/** Ett öppet larm går före driftläget; utan källor och utan händelser visas ingen rad alls (null). */
export function machineStatus(input: MachineStatusInput): MachineStatus | null {
  if (!input.sources && !input.lastHeardAt && !input.openOrders && !input.pendingOrders) return null;
  const orders = input.openOrders + input.pendingOrders;
  if (orders) return { ...input, label: orders === 1 ? "Larm: 1 öppen automatisk arbetsorder" : `Larm: ${orders} öppna automatiska arbetsordrar`, tone: "danger" };
  if (input.state === "stopped") return { ...input, label: "Stoppad", tone: "warning" };
  if (input.state === "running") return { ...input, label: "I drift", tone: "success" };
  return { ...input, label: input.lastHeardAt ? "Inget driftläge" : "Har inte hörts av ännu", tone: "neutral" };
}

export const MACHINE_EVENTS_PAGE = 25;
export const MACHINE_EVENT_TYPE_LABELS: Record<string, string> = { alarm: "Larm", state: "Driftläge", diagnosis: "Diagnos" };
export const MACHINE_SEVERITY_LABELS: Record<string, string> = { info: "Info", warning: "Varning", fault: "Fel", critical: "Kritiskt" };
export const MACHINE_STATE_LABELS: Record<string, string> = { raised: "Utlöst", cleared: "Släckt", running: "I drift", stopped: "Stoppad" };
export const MACHINE_SEVERITY_TONE: Record<string, MachineStatusTone> = { info: "neutral", warning: "warning", fault: "danger", critical: "danger" };

/** Fliken Händelser och statusraden kräver att man får läsa arbetsordrar (larmen leder dit); administratören får alltid. */
export const MACHINE_EVENTS_REFUSAL = "Maskinhändelser kräver att du får läsa arbetsordrar.";

/** En händelses rad i fliken: typ och kod, läge och maskinens text som text (aldrig markup). */
export function machineEventLine(event: { type: string; code: string; state: string | null; text: string }) {
  return [`${MACHINE_EVENT_TYPE_LABELS[event.type] ?? event.type} ${event.code}`, event.state ? MACHINE_STATE_LABELS[event.state] ?? event.state : "", event.text.trim()].filter(Boolean).join(" · ");
}

/**
 * Förlopp och Avbryt för registerhämtningen (2026-10-18): pure rules, no database, so the card's status line and the
 * cancel decision are tested alone. The numbers come from registerStatus (lib/catalogue/register-sync.ts).
 */
export type RegisterProgressInput = {
  /** A full import is asked for but has not started. */
  requested: boolean;
  running: { kind: string | null; pages: number; written: number; cancelling: boolean } | null;
  /** What the latest complete full import wrote: the bar's total. */
  knownTotal: number | null;
  lastRun: { kind: string; ok: boolean; message: string; finishedAt: string; written?: number; trial?: boolean; cancelled?: boolean } | null;
};
export type RegisterPhase = "idle" | "waiting" | "running" | "cancelling" | "done" | "failed" | "cancelled";
export type RegisterProgress = {
  phase: RegisterPhase; text: string;
  /** 0–99 while a full run has a known total to measure against; otherwise null (a counter only). */
  percent: number | null;
  /** Whether Avbryt is offered. */
  canCancel: boolean;
  /** Whether the card should read the status again every few seconds. */
  polling: boolean;
};

export const REGISTER_POLL_MS = 3000;
const n = (value: number) => value.toLocaleString("sv-SE");
const defaultWhen = (iso: string) => new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Stockholm" }).format(new Date(iso));
const short = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function registerProgress(input: RegisterProgressInput, when: (iso: string) => string = defaultWhen): RegisterProgress {
  const { running, requested, lastRun, knownTotal } = input;
  if (running) {
    if (running.cancelling) return { phase: "cancelling", text: "Avbryter – stoppar efter aktuell sida", percent: null, canCancel: false, polling: true };
    const what = running.kind === "changes" ? "ändringar" : "artiklar";
    const text = running.pages > 0 ? `Hämtar nu – ${n(running.written)} ${what}, sida ${n(running.pages)}` : "Hämtar nu – första sidan";
    const percent = running.kind !== "changes" && knownTotal && knownTotal > 0 ? Math.max(0, Math.min(99, Math.floor((running.written / knownTotal) * 100))) : null;
    return { phase: "running", text, percent, canCancel: true, polling: true };
  }
  if (requested) return { phase: "waiting", text: "Väntar på jobbet (startar inom tio minuter)", percent: null, canCancel: true, polling: true };
  if (!lastRun) return { phase: "idle", text: "", percent: null, canCancel: false, polling: false };
  if (lastRun.cancelled) return { phase: "cancelled", text: `Avbruten ${when(lastRun.finishedAt)} – det som lades till är borttaget`, percent: null, canCancel: false, polling: false };
  if (!lastRun.ok) return { phase: "failed", text: `Misslyckades ${when(lastRun.finishedAt)} – ${short(lastRun.message)}`, percent: null, canCancel: false, polling: false };
  const what = lastRun.trial ? "artiklar (prov)" : lastRun.kind === "changes" ? "ändrade artiklar" : "artiklar";
  const text = typeof lastRun.written === "number" ? `Klart – ${n(lastRun.written)} ${what}, ${when(lastRun.finishedAt)}` : `Klart – ${when(lastRun.finishedAt)}`;
  return { phase: "done", text, percent: null, canCancel: false, polling: false };
}

/** What Avbryt does now: withdraw a request that has not started, ask a live run to stop, or nothing. */
export function cancelEffect(state: { requested: boolean; running: boolean; cancelling: boolean }): "withdraw" | "stop" | "none" {
  if (state.running) return state.cancelling ? "none" : "stop";
  return state.requested ? "withdraw" : "none";
}

/** The bar's total: the latest complete, untrial full import in the history (newest first). */
export function knownRegisterTotal(history: { kind: string; ok: boolean; written?: number; trial?: boolean; cancelled?: boolean }[]): number | null {
  const run = history.find((item) => item.kind === "full" && item.ok && !item.trial && !item.cancelled && typeof item.written === "number" && item.written > 0);
  return run?.written ?? null;
}

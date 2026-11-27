/**
 * The shapes of the board's newer cards (Tavlor, 2026-11-19: files, the calendar, the machines, Underhåll and Felanmälan).
 * They sit beside the five shared shapes in lib/boards/shapes.ts: a card knows only the shape it draws, never where the data came
 * from. The server counts everything and sends these finished values; a screen or a link never sees more. Pure.
 */
export type StateTone = "success" | "warning" | "danger" | "info" | "neutral";

/** A file the card shows as it is (a PDF); the browser fetches the bytes through Workflow's own route for the board's files. */
export type DocumentShape = { kind: "document"; fileId: string; name: string; mimeType: string };

/** Bookings of a day or a week. `from` and `to` are minutes after midnight of the booking's day (Swedish time). */
export type CalendarItem = { day: string; start: string; end: string; from: number; to: number; title: string; people: string[] };
export type CalendarShape = {
  kind: "calendar";
  range: "today" | "week";
  view: "list" | "schedule";
  days: { key: string; label: string }[];
  items: CalendarItem[];
  total: number;
};

/** One machine's state now: running, stopped, an open alarm, or nothing known. */
export type MachineState = "running" | "stopped" | "alarm" | "unknown";
export type MachinesShape = { kind: "machines"; items: { name: string; state: MachineState; label: string; at: string | null }[]; total: number };

/** A few counts and a short list (Underhåll and Felanmälan). */
export type SummaryShape = {
  kind: "summary";
  counts: { label: string; value: number; tone: StateTone }[];
  items: { title: string; detail: string; tone: StateTone }[];
  total: number;
};

export type CardShape = DocumentShape | CalendarShape | MachinesShape | SummaryShape;
export const CARD_SHAPE_KINDS = ["document", "calendar", "machines", "summary"] as const;

export const MACHINE_STATE_LABEL: Record<MachineState, string> = { running: "I drift", stopped: "Stoppad", alarm: "Larm", unknown: "Okänt läge" };
export const MACHINE_STATE_TONE: Record<MachineState, StateTone> = { running: "success", stopped: "warning", alarm: "danger", unknown: "neutral" };

import { addressText, type Address } from "./ast";

// PLC-simulatorn: the compact PLC's terminals and their addresses, the one table the ST program, the drawing
// surface and the mapping table beside the editor all read. Named generically (2026-11-02, docs/regler/upphovsratt.md):
// "Workflow PLC" (v3, 2026-11-03; before that "Kompakt-PLC 16/8"), 12 digital and 4 analog inputs, 8 digital and 2 analog outputs. Analog words are INT 0–10000 for 0–10 V,
// a round number chosen for the simulator (one unit is a millivolt); a real controller has its own raw range.

export const PLC_NAME = "Workflow PLC";
export const PLC_IO = { di: 12, ai: 4, do: 8, ao: 2 } as const;
export const ANALOG_RAW_MAX = 10_000;
export const ANALOG_VOLT_MAX = 10;

export type IoKind = "DI" | "AI" | "DO" | "AO";
export type IoPoint = { kind: IoKind; index: number };
export const IO_KINDS: readonly IoKind[] = ["DI", "AI", "DO", "AO"];
export const ioCount = (kind: IoKind) => PLC_IO[kind.toLowerCase() as keyof typeof PLC_IO];

/** DI3 → %IX0.3, DI8 → %IX1.0, AI1 → %IW1, DO5 → %QX0.5, AO0 → %QW0. */
export function ioAddress(point: IoPoint): Address {
  const bitwise = point.kind === "DI" || point.kind === "DO";
  return { dir: point.kind === "DI" || point.kind === "AI" ? "I" : "Q", size: bitwise ? "X" : "W", byte: bitwise ? Math.floor(point.index / 8) : point.index, bit: bitwise ? point.index % 8 : null };
}
export const ioAddressText = (point: IoPoint) => addressText(ioAddress(point));
export const ioName = (point: IoPoint) => `${point.kind}${point.index}`;

/** The terminal behind an address, or null when the PLC has none there. */
export function addressIo(address: Address): IoPoint | null {
  const kind: IoKind = address.dir === "I" ? (address.size === "X" ? "DI" : "AI") : address.size === "X" ? "DO" : "AO";
  const index = address.size === "X" ? address.byte * 8 + (address.bit ?? 0) : address.byte;
  return index < ioCount(kind) ? { kind, index } : null;
}

/** A variable named like a terminal (DI0, AO1) is that terminal, without AT. */
export function nameIo(name: string): IoPoint | null {
  const match = /^(DI|AI|DO|AO)(\d{1,2})$/i.exec(name);
  if (!match) return null;
  const point = { kind: match[1].toUpperCase() as IoKind, index: Number(match[2]) };
  return point.index < ioCount(point.kind) ? point : null;
}

export const allIo = (): IoPoint[] => IO_KINDS.flatMap((kind) => Array.from({ length: ioCount(kind) }, (_, index) => ({ kind, index })));

/** The clock the program reads without wiring: hour, minute and weekday (1 = måndag … 7 = söndag). */
export const CLOCK_VARS = { TID_H: "hour", TID_M: "minute", VECKODAG: "weekday" } as const;
export type ClockVar = keyof typeof CLOCK_VARS;
export type PlcClock = { hour: number; minute: number; weekday: number };

export type PlcInputs = { di: readonly boolean[]; ai: readonly number[]; clock: PlcClock };
export type PlcOutputs = { do: boolean[]; ao: number[] };
export const emptyOutputs = (): PlcOutputs => ({ do: Array.from({ length: PLC_IO.do }, () => false), ao: Array.from({ length: PLC_IO.ao }, () => 0) });
export const emptyInputs = (clock: PlcClock = { hour: 0, minute: 0, weekday: 1 }): PlcInputs => ({ di: Array.from({ length: PLC_IO.di }, () => false), ai: Array.from({ length: PLC_IO.ai }, () => 0), clock });

export const voltsToRaw = (volts: number) => Math.round(Math.min(ANALOG_VOLT_MAX, Math.max(0, volts)) * (ANALOG_RAW_MAX / ANALOG_VOLT_MAX));
export const rawToVolts = (raw: number) => Math.min(ANALOG_RAW_MAX, Math.max(0, raw)) * (ANALOG_VOLT_MAX / ANALOG_RAW_MAX);

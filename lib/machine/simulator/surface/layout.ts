import { z } from "zod";
import { holdsKeyForm } from "@/lib/machine/simulator/mask";
import { generateSt } from "@/lib/machine/simulator/ladder/generate";
import { ladderSchema, type LadderProgram } from "@/lib/machine/simulator/ladder/model";
import { DEVICE_DEFS, DEVICE_KINDS, isDeviceKind, isExtraTerminal, type DeviceKindId } from "./devices";
import { allIo, ioName } from "@/lib/machine/simulator/st/io";

// PLC-simulatorn: what the drawing surface holds and saves: devices with places and options, wires between
// terminals and junctions, the program (ST text, and the Ladder it was generated from when the person draws rather than writes)
// and the outdoor temperature. One schema for the browser's store and for an exported file, and
// an unreadable or oversized file is refused with a reason, a key form inside it too.
//
// Version 2 (2026-11-03) adds junctions (free wire ends and branches), explicit bends on a wire, a drawn wire type, the
// program language and the Ladder program. A version 1 drawing reads as it was: no junctions, every wire auto-routed, ST.
// Version 3 (2026-11-04) has a surface without edges: a place may be any number within MAX_COORD, also below zero. Everything an
// older drawing holds is valid in version 3, and it reads with the same places.

export const SURFACE_FILE_FORMAT = "hintek-plc-simulator-surface";
export const SURFACE_FILE_VERSION = 3;
export const SURFACE_FILE_VERSIONS: readonly number[] = [1, 2, 3];
/** The store's key is unchanged on purpose: the drawing a person saved before version 2 is still there after it. */
export const SURFACE_STORAGE_KEY = "workflow-plc-simulator-surface-v1";
export const MAX_SURFACE_FILE_BYTES = 384 * 1024;
export const MAX_DEVICES = 120;
export const MAX_WIRES = 400;
export const MAX_JUNCTIONS = 160;
export const MAX_BENDS = 24;
export const MAX_PROGRAM_CHARS = 20_000;
export const MAX_TREND_PENS = 8;
export const MAX_LABEL = 24;
/** The size of the area new devices are laid in when nothing says where. The surface itself has no edge. */
export const SURFACE_WIDTH = 1200;
export const SURFACE_HEIGHT = 680;
/** Only a guard against absurd numbers in a file: far beyond anything a person pans to. */
export const MAX_COORD = 10_000_000;
export const PLC_DEVICE_ID = "plc";

export type Point = { x: number; y: number };
export type TerminalRef = { device: string; terminal: string };
export type JunctionRef = { junction: string };
export type WireEnd = TerminalRef | JunctionRef;
/** How a wire is drawn. `auto` follows the net it is on (as before); the others are the person's own marking, never a potential. */
export type WireKind = "auto" | "plus" | "minus" | "signal" | "analog";
export const WIRE_KINDS: readonly WireKind[] = ["auto", "plus", "minus", "signal", "analog"];
export const WIRE_KIND_LABELS: Record<WireKind, string> = { auto: "Följer nätet", plus: "+24 V (röd)", minus: "0 V (vit)", signal: "Signal (svart)", analog: "Analog (tunn)" };
export type DeviceInst = { id: string; kind: DeviceKindId; x: number; y: number; label: string; options: Record<string, string> };
export type Wire = { id: string; from: WireEnd; to: WireEnd; points?: Point[]; kind?: WireKind };
export type Junction = { id: string; x: number; y: number };
export type ProgramLanguage = "st" | "ld";
export type Layout = { version: 3; devices: DeviceInst[]; wires: Wire[]; junctions: Junction[]; program: string; outdoorC: number; language: ProgramLanguage; ladder: LadderProgram | null; trendPens?: string[] };

export const isTerminalEnd = (end: WireEnd): end is TerminalRef => "device" in end;
export const terminalKey = (ref: TerminalRef) => `${ref.device}:${ref.terminal}`;
/** A junction's key in the net: `@j1`, which no device id can produce. */
export const junctionKey = (id: string) => `@${id}`;
export const endKey = (end: WireEnd) => (isTerminalEnd(end) ? terminalKey(end) : junctionKey(end.junction));
export const sameTerminal = (a: TerminalRef, b: TerminalRef) => a.device === b.device && a.terminal === b.terminal;
export const sameEnd = (a: WireEnd, b: WireEnd) => endKey(a) === endKey(b);
export const parseEndKey = (key: string): WireEnd => { if (key.startsWith("@")) return { junction: key.slice(1) }; const [device, terminal] = key.split(":"); return { device, terminal }; };

/** The PLC's own terminals: +24 V, 0 V and every I/O point by its name. */
export const PLC_TERMINALS = ["24V", "0V", ...allIo().map(ioName)] as const;

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const plainText = (max: number) => z.string().trim().max(max).refine((text) => !CONTROL.test(text), "Texten har styrtecken.");
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, "Ett id är små bokstäver, siffror, bindestreck och understreck.");
const finite = z.number().finite();
const coordinate = { x: finite.min(-MAX_COORD).max(MAX_COORD), y: finite.min(-MAX_COORD).max(MAX_COORD) };
const point = z.object(coordinate).strict();
const terminalRef = z.object({ device: id, terminal: z.string().min(1).max(8) }).strict();
const junctionRef = z.object({ junction: id }).strict();
const wireEnd = z.union([terminalRef, junctionRef]);

const deviceSchema = z.object({
  id, kind: z.enum(DEVICE_KINDS), ...coordinate, label: plainText(MAX_LABEL),
  options: z.record(z.string().max(16), z.string().max(16)),
}).strict().superRefine((device, ctx) => {
  if (device.id === PLC_DEVICE_ID) ctx.addIssue({ code: "custom", message: "plc är PLC:ns eget id.", path: [device.id] });
  const def = DEVICE_DEFS[device.kind];
  for (const [key, value] of Object.entries(device.options)) {
    const option = def.options.find((candidate) => candidate.key === key);
    if (!option || !option.choices.some((choice) => choice.value === value)) ctx.addIssue({ code: "custom", message: `${def.label} har inget val ${key}=${value}.`, path: [device.id] });
  }
});

const wireSchema = z.object({ id, from: wireEnd, to: wireEnd, points: z.array(point).max(MAX_BENDS).optional(), kind: z.enum(["auto", "plus", "minus", "signal", "analog"]).optional() }).strict();
const junctionSchema = z.object({ id, ...coordinate }).strict();
const programText = z.string().max(MAX_PROGRAM_CHARS).refine((text) => !CONTROL.test(text), "Programmet har styrtecken.");

/** What is read: version 1, 2 or 3, the later fields optional so an older drawing passes untouched. */
const readSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  devices: z.array(deviceSchema).max(MAX_DEVICES),
  wires: z.array(wireSchema).max(MAX_WIRES),
  junctions: z.array(junctionSchema).max(MAX_JUNCTIONS).optional(),
  program: programText,
  outdoorC: finite.min(-40).max(60),
  language: z.enum(["st", "ld"]).optional(),
  ladder: ladderSchema.nullable().optional(),
  trendPens: z.array(z.string().max(48)).max(MAX_TREND_PENS).optional(),
}).strict().superRefine((layout, ctx) => {
  const devices = new Map(layout.devices.map((device) => [device.id, device]));
  if (devices.size !== layout.devices.length) ctx.addIssue({ code: "custom", message: "Samma id finns två gånger." });
  const junctions = new Set((layout.junctions ?? []).map((junction) => junction.id));
  if (junctions.size !== (layout.junctions ?? []).length) ctx.addIssue({ code: "custom", message: "Samma knutpunkt finns två gånger." });
  const wireIds = new Set<string>();
  for (const wire of layout.wires) {
    if (wireIds.has(wire.id)) ctx.addIssue({ code: "custom", message: "Samma ledning finns två gånger.", path: [wire.id] });
    wireIds.add(wire.id);
    for (const end of [wire.from, wire.to]) {
      if (isTerminalEnd(end) ? !terminalExists(end, devices) : !junctions.has(end.junction)) ctx.addIssue({ code: "custom", message: isTerminalEnd(end) ? "En ledning går till en plint som inte finns." : "En ledning går till en knutpunkt som inte finns.", path: [wire.id] });
    }
    if (sameEnd(wire.from, wire.to)) ctx.addIssue({ code: "custom", message: "En ledning kan inte gå till sin egen plint.", path: [wire.id] });
  }
  if (layout.language === "ld" && !layout.ladder) ctx.addIssue({ code: "custom", message: "Programmet är Ladder men ritningen har inget Ladder-program." });
});

export function terminalExists(ref: TerminalRef, devices: ReadonlyMap<string, DeviceInst>) {
  if (ref.device === PLC_DEVICE_ID) return (PLC_TERMINALS as readonly string[]).includes(ref.terminal);
  const device = devices.get(ref.device);
  // An extra terminal (e1–e16) belongs to a device design that may be read after the drawing; a wire to one is kept, and drawn once it is there.
  return device !== undefined && isDeviceKind(device.kind) && (DEVICE_DEFS[device.kind].terminals.some((terminal) => terminal.id === ref.terminal) || isExtraTerminal(ref.terminal));
}

/** `supplyAdded`: the read drawing had no source, so a 24 V DC source was put in and wired to the PLC's L+ and M (2026-11-03). */
export type LayoutResult = { ok: true; layout: Layout; supplyAdded?: boolean } | { ok: false; reason: string };

/** A read drawing as the current shape: version 3 with every field, and no junction nothing goes to. */
function normalise(read: z.infer<typeof readSchema>): Layout {
  const used = new Set<string>();
  for (const wire of read.wires) for (const end of [wire.from, wire.to]) if (!isTerminalEnd(end)) used.add(end.junction);
  // A Ladder program from before version 3 is written out anew: its old text says "Steg 1" where the rungs now count from 0. The
  // statements are the same, so it runs the same (tests/plc-simulator-format.test.ts runs both).
  const fresh = read.version < 3 && read.language === "ld" && read.ladder ? generateSt(read.ladder).text : read.program;
  return {
    version: 3,
    devices: read.devices,
    wires: read.wires,
    junctions: (read.junctions ?? []).filter((junction) => used.has(junction.id)),
    program: fresh,
    outdoorC: read.outdoorC,
    language: read.language ?? "st",
    ladder: read.ladder ?? null,
    ...(read.trendPens ? { trendPens: read.trendPens } : {}),
  };
}

export function validateLayout(value: unknown): LayoutResult {
  const text = JSON.stringify(value) ?? "";
  if (holdsKeyForm(text)) return { ok: false, reason: "Ritningen innehåller något som ser ut som en nyckel. Den sparas inte." };
  if (/__proto__|constructor|prototype/.test(text)) return { ok: false, reason: "Ritningen innehåller ett namn som inte är tillåtet." };
  const parsed = readSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: first ? `${first.path.length ? `${first.path.join(".")}: ` : ""}${first.message}` : "Ritningen stämmer inte." };
  }
  return { ok: true, layout: normalise(parsed.data) };
}

export const emptyLayout = (): Layout => ({ version: 3, devices: [], wires: [], junctions: [], program: "", outdoorC: 5, language: "st", ladder: null });

/** The source's label on the start drawing and after a migration. */
export const SUPPLY_LABEL = "24 V DC";
/** Where a source goes when the drawing needs one: left of the PLC first, then right of it, then under the inputs. */
const SUPPLY_SPOTS: readonly Point[] = [{ x: 220, y: 300 }, { x: 220, y: 390 }, { x: 900, y: 300 }, { x: 900, y: 390 }, { x: 220, y: 160 }, { x: 900, y: 160 }];
const hasSupply = (layout: Pick<Layout, "devices">) => layout.devices.some((device) => DEVICE_DEFS[device.kind].elements.some((element) => element.kind === "supply"));

/** The drawing with a 24 V DC source wired to the PLC's L+ and M, at a free spot near the PLC. The drawing itself is left as it is. */
export function withSupply(layout: Layout): Layout {
  const def = DEVICE_DEFS.kalla24;
  const overlaps = (spot: Point) => layout.devices.some((device) => { const other = DEVICE_DEFS[device.kind]; return spot.x < device.x + other.width + 24 && spot.x + def.width + 24 > device.x && spot.y < device.y + other.height + 36 && spot.y + def.height + 36 > device.y; });
  const spot = SUPPLY_SPOTS.find((candidate) => !overlaps(candidate)) ?? { x: 40 + layout.devices.length * 12, y: 300 };
  const id = freeDeviceId("kalla24", layout.devices.map((device) => device.id));
  const taken = layout.wires.map((wire) => wire.id);
  const plusId = freeWireId(taken), minusId = freeWireId([...taken, plusId]);
  return {
    ...layout,
    devices: [...layout.devices, { id, kind: "kalla24", x: spot.x, y: spot.y, label: SUPPLY_LABEL, options: {} }],
    wires: [...layout.wires, { id: plusId, from: { device: id, terminal: "+" }, to: { device: PLC_DEVICE_ID, terminal: "24V" } }, { id: minusId, from: { device: id, terminal: "−" }, to: { device: PLC_DEVICE_ID, terminal: "0V" } }],
  };
}
/** The drawing a person starts from, and gets after Rensa: the PLC fed from a 24 V DC source, so RUN works at once and the power has a visible origin. */
export const startLayout = (): Layout => withSupply(emptyLayout());

/**
 * A drawing read from the store or a file, as the current model wants it: one drawn before the PLC was fed (wires, but no
 * source) gets a source wired to L+ and M, so its old wires from the PLC's supply terminals are on the source's nets and it
 * behaves as before. A drawing without wires is left alone; so is one that has a source already.
 */
function migrate(result: LayoutResult): LayoutResult {
  if (!result.ok) return result;
  if (!result.layout.wires.length || hasSupply(result.layout)) return result;
  return { ok: true, layout: withSupply(result.layout), supplyAdded: true };
}

export const saveLayoutText = (layout: Layout) => JSON.stringify(layout);
export function loadLayoutText(text: string): LayoutResult {
  try { return migrate(validateLayout(JSON.parse(text))); } catch { return { ok: false, reason: "Ritningen går inte att läsa." }; }
}
export const exportLayoutText = (layout: Layout) => JSON.stringify({ format: SURFACE_FILE_FORMAT, version: SURFACE_FILE_VERSION, layout }, null, 2);
export function importLayoutText(text: string): LayoutResult {
  if (new TextEncoder().encode(text).length > MAX_SURFACE_FILE_BYTES) return { ok: false, reason: "Filen är för stor." };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: "Filen är inte giltig JSON." }; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "Filen är inte en ritning." };
  const file = parsed as Record<string, unknown>;
  if (file.format !== SURFACE_FILE_FORMAT) return { ok: false, reason: "Filen är inte en ritning från simulatorn." };
  if (typeof file.version !== "number" || !SURFACE_FILE_VERSIONS.includes(file.version)) return { ok: false, reason: "Filens version stöds inte." };
  return migrate(validateLayout(file.layout));
}

/** A free id for a new device of a kind: `lampa-1`, `lampa-2` … */
export function freeDeviceId(kind: DeviceKindId, taken: readonly string[]) {
  for (let index = 1; ; index += 1) { const candidate = `${kind.replace(/_/g, "-")}-${index}`; if (!taken.includes(candidate)) return candidate; }
}
export function freeWireId(taken: readonly string[]) {
  for (let index = 1; ; index += 1) { const candidate = `w${index}`; if (!taken.includes(candidate)) return candidate; }
}
export function freeJunctionId(taken: readonly string[]) {
  for (let index = 1; ; index += 1) { const candidate = `j${index}`; if (!taken.includes(candidate)) return candidate; }
}
/** A label that tells devices of one kind apart: "Lampa 2". */
export function defaultLabel(kind: DeviceKindId, devices: readonly DeviceInst[]) {
  const count = devices.filter((device) => device.kind === kind).length + 1;
  return `${DEVICE_DEFS[kind].label} ${count}`.slice(0, MAX_LABEL);
}

/** The wires that touch a junction. */
export const wiresAtJunction = (layout: Pick<Layout, "wires">, junctionId: string) => layout.wires.filter((wire) => [wire.from, wire.to].some((end) => !isTerminalEnd(end) && end.junction === junctionId));
/** The wires that end on a terminal. */
export const wiresAtTerminal = (layout: Pick<Layout, "wires">, ref: TerminalRef) => layout.wires.filter((wire) => [wire.from, wire.to].some((end) => isTerminalEnd(end) && sameTerminal(end, ref)));

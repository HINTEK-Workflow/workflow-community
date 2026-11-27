// PLC-apparater (2026-11-06: "en funktion i prodadmin där jag som superadmin kan redigera dessa symboler och själv
// bestämma typ/anslutning/bild … inte överdrivet avancerad"): the product owner's design of a device in the simulator's palette –
// its name, group, picture, how its state shows and where its terminals sit. The electrical behaviour is never written here: a
// design picks one of the simulator's own device kinds as its function, and the terminals (their ids, which wires refer to) follow
// that function, so a saved drawing can never lose a wire to a design. Pure: shared by the editor, the server and the simulator.
//
// v2 (2026-11-07: "Alla delar samma botten platta … sedan väljer man vilka anslutningar det skall vara … bilden skall vara
// separerad"): every device is the one shared base plate, as wide as its terminals need (plateWidth); a design chooses which of the
// function's terminals it uses (those the function needs stay) and may add extra terminals e1–e16 with their own marking, kind and
// an inner link to another terminal; the picture is a layer over the plate – the simulator's own drawing until it is replaced.
import { z } from "zod";
import { animationProblems, animationSchema, checkAnimation, standardAnimation, type AnimationSpec } from "./animation";
import { STANDARD_SOUNDS, type SoundId } from "./sounds";
import { parseSafeSvg } from "./svg-safe";
import { readoutProblems, readoutSchema, standardReadout, type Readout } from "./readouts";
import { DEVICE_DEFS, DEVICE_GROUPS, DEVICE_KINDS, isDeviceKind, isExtraTerminal, TERMINAL_ROLES, type DeviceGroup, type DeviceKindDef, type DeviceKindId, type Element, type TerminalDef, type TerminalRole, optionValue } from "./devices";

/** The option on a placed device that names a copy ("egen-…"); a standard device has none and is designed under its kind. */
export const DESIGN_OPTION = "apparat";
export const CUSTOM_KEY = /^egen-[a-z0-9]{6,10}$/;
export const isCustomKey = (key: string) => CUSTOM_KEY.test(key);
export const isDesignKey = (key: string) => isDeviceKind(key) || isCustomKey(key);

export const STATE_VIEWS = ["none", "glow", "rotate", "swap"] as const;
export type StateView = (typeof STATE_VIEWS)[number];
export const STATE_VIEW_LABELS: Record<StateView, string> = { none: "Ingen ändring", glow: "Lyser", rotate: "Roterar", swap: "Byter bild" };

/** Pictures: an SVG drawn as an image (a browser never runs scripts or fetches anything from an SVG shown that way) or a PNG. */
export const MAX_SVG_BYTES = 200 * 1024;
export const MAX_PNG_BYTES = 400 * 1024;
/** An SVG with photo layers (svg-safe.ts: embedded PNG or WebP in named groups, 2026-11-09) may be this large as text; one of its own drawing stays within MAX_SVG_BYTES. */
export const MAX_LAYERED_SVG_BYTES = 1024 * 1024;
const imageSchema = z.object({ format: z.enum(["svg", "png"]), data: z.string().min(1).max(MAX_LAYERED_SVG_BYTES + 64) });
export type DesignImage = z.infer<typeof imageSchema>;

/** A device's own sound (2026-11-07): a short MP3, OGG or WAV as base64, played as a click or a loop by the function's sound sort. */
export const MAX_SOUND_BYTES = 300 * 1024;
export const SOUND_FORMATS = ["mp3", "ogg", "wav"] as const;
const soundSchema = z.object({ format: z.enum(SOUND_FORMATS), data: z.string().min(1).max(Math.ceil(MAX_SOUND_BYTES * 1.4) + 64) });
export type DesignSound = z.infer<typeof soundSchema>;

const terminalSchema = z.object({
  id: z.string().min(1).max(8),
  /** What is printed at the terminal ("13", "A1"); empty: the function's own designation. */
  name: z.string().trim().max(8).default(""),
  /** The tooltip; empty: the function's own. */
  title: z.string().trim().max(60).default(""),
  side: z.enum(["top", "bottom"]),
  /** Where along its side, 0–1 from the left; null: spread evenly as before. */
  at: z.number().min(0).max(1).nullable().default(null),
  /** A function's terminal the device does without (not drawn, nothing can be wired to it); only one the function does not need. */
  used: z.boolean().default(true),
  /** An extra terminal's kind (the wire colour it suggests); a function's terminal keeps the function's own (null). */
  role: z.enum(TERMINAL_ROLES).nullable().default(null),
  /** An extra terminal joined inside the device to another of its terminals (a second A2, a through PE); null: on its own. */
  joins: z.string().min(1).max(8).nullable().default(null),
});
export type DesignTerminal = z.infer<typeof terminalSchema>;

/** At most this many terminals on a device, and on one side of it. */
export const MAX_TERMINALS = 16;
export const MAX_TERMINALS_PER_SIDE = 10;
/** The base plate grows with its terminals: 16 px per terminal on the fuller side and 12 px of edge, never narrower than the function's own. */
export const TERMINAL_STEP = 16;
export const PLATE_EDGE = 12;
export function plateWidth(baseWidth: number, terminals: readonly Pick<TerminalDef, "side">[]): number {
  const most = Math.max(terminals.filter((terminal) => terminal.side === "top").length, terminals.filter((terminal) => terminal.side === "bottom").length);
  return Math.max(baseWidth, most * TERMINAL_STEP + PLATE_EDGE);
}

export const ROLE_LABELS: Record<TerminalRole, string> = { wire: "Ledare", supply: "Plus (+)", ground: "Minus (0 V)", analog: "Signal 0–10 V" };
/** The quick choices for an extra terminal: marking, side and kind. */
export const TERMINAL_PRESETS: readonly { name: string; side: "top" | "bottom"; role: TerminalRole }[] = [
  { name: "L", side: "top", role: "wire" }, { name: "N", side: "top", role: "wire" }, { name: "PE", side: "bottom", role: "wire" },
  { name: "+", side: "top", role: "supply" }, { name: "−", side: "top", role: "ground" },
  { name: "A1", side: "top", role: "wire" }, { name: "A2", side: "top", role: "wire" },
  { name: "11", side: "bottom", role: "wire" }, { name: "12", side: "bottom", role: "wire" }, { name: "14", side: "bottom", role: "wire" },
  { name: "13", side: "bottom", role: "wire" }, { name: "21", side: "bottom", role: "wire" }, { name: "22", side: "bottom", role: "wire" },
  { name: "X1", side: "top", role: "wire" }, { name: "X2", side: "top", role: "wire" },
];

/** What a function needs a terminal for, in words; a terminal not here is only part of a contact. */
const ELEMENT_NEEDS: Record<Exclude<Element["kind"], "contact">, string> = { load: "matningen av apparaten", supply: "källans + och −", source: "signalen och dess matning", sink: "styrsignalen", meter: "mätningen" };
const elementTerminals = (element: Element): string[] => {
  switch (element.kind) {
    case "contact": case "load": return [element.a, element.b];
    case "supply": case "meter": return [element.plus, element.minus];
    case "source": return [element.terminal, ...(element.plus ? [element.plus] : []), element.minus];
    case "sink": return [element.terminal];
  }
};
/** The function's terminals the device cannot do without, each with the reason in words. */
export function requiredTerminals(kind: DeviceKindId): Map<string, string> {
  const out = new Map<string, string>();
  for (const element of DEVICE_DEFS[kind].elements) {
    if (element.kind === "contact") continue;
    for (const id of elementTerminals(element)) if (!out.has(id)) out.set(id, `Krävs för ${ELEMENT_NEEDS[element.kind]}.`);
  }
  return out;
}
/** The function's contacts, as pairs of terminals: at least one of them must keep both. */
export const contactsOf = (kind: DeviceKindId) => DEVICE_DEFS[kind].elements.flatMap((element) => (element.kind === "contact" ? [[element.a, element.b] as const] : []));
/** The marking a terminal is shown with: its own, else the function's (as NO when it has two), else its id. */
export function terminalMarking(kind: DeviceKindId, terminal: Pick<DesignTerminal, "id" | "name">): string {
  if (terminal.name) return terminal.name;
  const own = DEVICE_DEFS[kind].terminals.find((candidate) => candidate.id === terminal.id)?.name;
  return !own ? terminal.id : typeof own === "string" ? own : own.no;
}

/**
 * What is wrong with a design's choice of terminals, in plain Swedish (empty: nothing): every function terminal listed once, the
 * ones the function needs in use, at least one whole contact, extra terminals named and linked to a terminal that is there, and room.
 */
export function terminalProblems(kind: DeviceKindId, terminals: readonly DesignTerminal[]): string[] {
  const problems: string[] = [];
  const own = DEVICE_DEFS[kind].terminals.map((terminal) => terminal.id);
  const ids = terminals.map((terminal) => terminal.id);
  const missing = own.filter((id) => !ids.includes(id));
  if (missing.length) problems.push(`Alla funktionens plintar ska finnas med (saknas: ${missing.join(", ")}). Välj funktionen igen för att få dem.`);
  if (new Set(ids).size !== ids.length) problems.push("Samma plint finns två gånger.");
  const strangers = ids.filter((id) => !own.includes(id) && !isExtraTerminal(id));
  if (strangers.length) problems.push(`Plint ${strangers.join(", ")} finns inte i funktionen. Extra plintar heter e1–e16.`);
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const inUse = (id: string) => byId.get(id)?.used !== false;
  for (const [id, reason] of requiredTerminals(kind)) if (byId.has(id) && !inUse(id)) problems.push(`Plint ${terminalMarking(kind, byId.get(id)!)} går inte att ta bort. ${reason}`);
  const contacts = contactsOf(kind);
  if (contacts.length && !contacts.some(([a, b]) => inUse(a) && inUse(b))) {
    const [a, b] = contacts[0]!;
    problems.push(`Minst en kontakt behöver båda sina plintar, till exempel ${terminalMarking(kind, byId.get(a) ?? { id: a, name: "" })} och ${terminalMarking(kind, byId.get(b) ?? { id: b, name: "" })}.`);
  }
  for (const terminal of terminals) {
    if (!isExtraTerminal(terminal.id)) continue;
    if (!terminal.used) problems.push("En extra plint tas bort i stället för att stängas av.");
    if (!terminal.name.trim()) problems.push("Varje extra plint behöver en märkning.");
    if (terminal.joins !== null && (terminal.joins === terminal.id || !byId.has(terminal.joins) || !inUse(terminal.joins))) problems.push(`Plint ${terminal.name || terminal.id} är kopplad till en plint som inte finns.`);
  }
  const used = terminals.filter((terminal) => terminal.used !== false);
  if (used.length > MAX_TERMINALS) problems.push(`Högst ${MAX_TERMINALS} plintar på en apparat.`);
  for (const side of ["top", "bottom"] as const) if (used.filter((terminal) => terminal.side === side).length > MAX_TERMINALS_PER_SIDE) problems.push(`Högst ${MAX_TERMINALS_PER_SIDE} plintar på ${side === "top" ? "översidan" : "undersidan"}.`);
  return [...new Set(problems)];
}

/** The next free extra terminal id, or null when all sixteen are taken. */
export function nextExtraId(terminals: readonly Pick<DesignTerminal, "id">[]): string | null {
  for (let index = 1; index <= MAX_TERMINALS; index += 1) if (!terminals.some((terminal) => terminal.id === `e${index}`)) return `e${index}`;
  return null;
}

export const deviceDesignSchema = z.object({
  name: z.string().trim().min(1, "Skriv ett kort namn.").max(24),
  label: z.string().trim().min(1, "Skriv namnet.").max(60),
  short: z.string().trim().max(200).default(""),
  group: z.enum(DEVICE_GROUPS as unknown as [DeviceGroup, ...DeviceGroup[]]),
  function: z.enum(DEVICE_KINDS),
  image: imageSchema.nullable().default(null),
  /** The picture when the device is on (with "Byter bild"). */
  imageOn: imageSchema.nullable().default(null),
  stateView: z.enum(STATE_VIEWS).default("none"),
  terminals: z.array(terminalSchema).max(MAX_TERMINALS + 8),
  /** Not offered in the palette; placed devices keep their look. */
  hidden: z.boolean().default(false),
  /** The device's own sound; null: the function's standard sound (sounds.ts). */
  sound: soundSchema.nullable().default(null),
  /** How the picture moves (animation.ts); null: the function's standard animation, which the simulator's own drawings follow. */
  animation: animationSchema.nullable().default(null),
  /** The value tag beside the plate (readouts.ts); null: the function's standard tag. */
  readout: readoutSchema.nullable().default(null),
  /** No sound at all, not even the standard one. */
  silent: z.boolean().default(false),
});
export type DeviceDesign = z.infer<typeof deviceDesignSchema>;

/** A design as the simulator's standard device is today: the starting point, and what "Återställ" goes back to. */
export function standardDesign(kind: DeviceKindId): DeviceDesign {
  const def = DEVICE_DEFS[kind];
  return { name: def.name, label: def.label, short: def.short, group: def.group, function: kind, image: null, imageOn: null, stateView: "none", hidden: false, sound: null, silent: false, animation: null, readout: null, terminals: def.terminals.map((terminal) => ({ id: terminal.id, name: "", title: "", side: terminal.side, at: null, used: true, role: null, joins: null })) };
}

/** The terminals of a function, as a design starts with them (used when a copy changes its function). */
export const functionTerminals = (kind: DeviceKindId): DesignTerminal[] => standardDesign(kind).terminals;

const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** What may never be in an uploaded SVG, even shown as an image: scripts, event handlers, embedded documents, outside addresses. */
const SVG_FORBIDDEN: readonly [RegExp, string][] = [
  [/<script\b/i, "skript"], [/\son[a-z]+\s*=/i, "händelser (on…)"], [/<foreignObject\b/i, "inbäddat HTML"], [/<iframe\b|<embed\b|<object\b/i, "inbäddade dokument"],
  [/javascript:/i, "javascript:"], [/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|file:)/i, "länkar till andra adresser"], [/@import|url\(\s*["']?\s*(?:https?:|\/\/)/i, "hämtning utifrån"],
  [/<!ENTITY|<!DOCTYPE/i, "DOCTYPE eller ENTITY"], [/<\?xml-stylesheet/i, "stilmallar utifrån"],
];

/**
 * Checks an uploaded picture and returns it cleaned, or the reason it is refused. An SVG keeps only its drawing: comments and an
 * XML declaration go, and anything that could run or fetch is refused outright rather than mended, so nothing is ever guessed.
 */
export function cleanImage(image: DesignImage): { ok: true; image: DesignImage } | { ok: false; reason: string } {
  if (image.format === "png") {
    const data = image.data.replace(/^data:image\/png;base64,/, "");
    if (!BASE64.test(data)) return { ok: false, reason: "Bilden går inte att läsa som PNG." };
    if (base64Bytes(data) > MAX_PNG_BYTES) return { ok: false, reason: `Bilden är större än ${MAX_PNG_BYTES / 1024} kB.` };
    if (!data.startsWith("iVBORw0KGgo")) return { ok: false, reason: "Filen är inte en PNG-bild." };
    return { ok: true, image: { format: "png", data } };
  }
  const text = image.data;
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_LAYERED_SVG_BYTES) return { ok: false, reason: `Bilden är större än ${MAX_LAYERED_SVG_BYTES / 1024} kB.` };
  for (const [pattern, what] of SVG_FORBIDDEN) if (pattern.test(text)) return { ok: false, reason: `SVG-bilden innehåller ${what}, som inte är tillåtet.` };
  const cleaned = text.replace(/<\?xml[^>]*\?>/gi, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!/^<svg[\s>]/i.test(cleaned) || !/<\/svg>\s*$/i.test(cleaned)) return { ok: false, reason: "Filen är inte en SVG-bild." };
  // Drawn inline (so its parts can move), it must also read as a drawing through the allowlist (svg-safe.ts).
  const tree = parseSafeSvg(cleaned);
  if (!tree.ok) return { ok: false, reason: tree.reason };
  // A drawing of its own stays small; only a picture with photo layers has the larger room, and each layer no more than a PNG would.
  if (!tree.layers && bytes > MAX_SVG_BYTES) return { ok: false, reason: `Bilden är större än ${MAX_SVG_BYTES / 1024} kB. Bara en SVG med fotolager (inbäddade PNG- eller WebP-bilder) får vara upp till ${MAX_LAYERED_SVG_BYTES / 1024} kB.` };
  return { ok: true, image: { format: "svg", data: cleaned } };
}

/** The address an <image> shows a picture from. */
export function imageHref(image: DesignImage): string {
  if (image.format === "png") return `data:image/png;base64,${image.data}`;
  const bytes = new TextEncoder().encode(image.data);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export const SOUND_TYPES: Record<DesignSound["format"], string> = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" };
/** How each format begins, as base64: ID3 or an MPEG frame, OggS, RIFF. */
const SOUND_MAGIC: Record<DesignSound["format"], RegExp> = { mp3: /^(?:SUQz|\/\/[1-9+/])/, ogg: /^T2dnUw/, wav: /^UklGR/ };
/**
 * Checks an uploaded sound and returns it as plain base64, or the reason it is refused: the data address's own type is dropped, the
 * size capped and the first bytes must be the format's – a sound is only ever played by the browser's audio decoder.
 */
export function cleanSound(sound: DesignSound): { ok: true; sound: DesignSound } | { ok: false; reason: string } {
  const data = sound.data.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "");
  if (!BASE64.test(data)) return { ok: false, reason: "Ljudet går inte att läsa." };
  if (base64Bytes(data) > MAX_SOUND_BYTES) return { ok: false, reason: `Ljudet är större än ${MAX_SOUND_BYTES / 1024} kB. Välj ett kort ljud.` };
  if (!SOUND_MAGIC[sound.format].test(data)) return { ok: false, reason: `Filen är inte ett ${sound.format.toUpperCase()}-ljud.` };
  return { ok: true, sound: { format: sound.format, data } };
}
export const soundHref = (sound: DesignSound) => `data:${SOUND_TYPES[sound.format]};base64,${sound.data}`;

/** What a placed device sounds like: its sort (click or loop, by the function) or null when silent, and its own file if it has one. */
export function designedSound(device: Placed, override?: DeviceDesign | null): { sound: SoundId | null; own: DesignSound | null } {
  const design = designFor(device, override);
  if (design?.silent) return { sound: null, own: null };
  const standard = STANDARD_SOUNDS[device.kind] ?? null;
  // A function without a sound of its own that is given a file clicks when it is energised, as a relay does.
  return { sound: standard ?? (design?.sound ? "relay" : null), own: design?.sound ?? null };
}

/**
 * Checks a design for its key and returns it ready to store: the terminals must be exactly the function's, a standard device keeps
 * its own function (its drawings already use it), and pictures are cleaned. Every refusal says what to change.
 */
export function validateDesign(key: string, raw: unknown): { ok: true; design: DeviceDesign } | { ok: false; reason: string } {
  if (!isDesignKey(key)) return { ok: false, reason: "Apparaten finns inte." };
  const parsed = deviceDesignSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Uppgifterna stämmer inte." };
  const design = parsed.data;
  if (isDeviceKind(key) && design.function !== key) return { ok: false, reason: "En standardapparat behåller sin funktion. Kopiera den som en ny apparat för att välja en annan funktion." };
  const problem = terminalProblems(design.function, design.terminals)[0];
  if (problem) return { ok: false, reason: problem };
  // A function's terminal keeps the function's kind and is never linked; only an extra one has its own.
  design.terminals = design.terminals.map((terminal) => (isExtraTerminal(terminal.id) ? { ...terminal, role: terminal.role ?? "wire" } : { ...terminal, role: null, joins: null }));
  const images: Partial<Pick<DeviceDesign, "image" | "imageOn">> = {};
  for (const field of ["image", "imageOn"] as const) {
    const image = design[field];
    if (!image) continue;
    const cleaned = cleanImage(image);
    if (!cleaned.ok) return cleaned;
    images[field] = cleaned.image;
  }
  if (design.stateView === "swap" && !(images.imageOn ?? design.imageOn)) return { ok: false, reason: "Välj bilden som visas när apparaten är på, eller ett annat sätt att visa läget." };
  let sound = design.sound;
  if (sound) { const cleaned = cleanSound(sound); if (!cleaned.ok) return cleaned; sound = cleaned.sound; }
  if (design.animation) { const problem = animationProblems(design.animation)[0]; if (problem) return { ok: false, reason: `Animeringen: ${problem}` }; }
  if (design.readout) { const problem = readoutProblems(design.function, design.readout)[0]; if (problem) return { ok: false, reason: problem }; }
  return { ok: true, design: { ...design, ...images, sound } };
}

/** The animation a device is drawn with: its own, else its function's standard one. */
export const animationFor = (kind: DeviceKindId, design: DeviceDesign | null | undefined): AnimationSpec => design?.animation ?? standardAnimation(kind);
/** The value tag a device is drawn with: its own, else its function's standard one. */
export const readoutFor = (kind: DeviceKindId, design: DeviceDesign | null | undefined): Readout => design?.readout ?? standardReadout(kind);

/** The part names a design's picture has, for the editor's warnings: the standard picture's, an SVG's ids, a PNG only as a whole. */
export function pictureParts(kind: DeviceKindId, design: Pick<DeviceDesign, "image"> | null | undefined): string[] {
  if (!design?.image) return standardAnimation(kind).rules.map((rule) => rule.part);
  if (design.image.format === "png") return [];
  const tree = parseSafeSvg(design.image.data);
  return tree.ok ? tree.ids : [];
}

// ---------- the published designs in the simulator ----------

export type PublishedDesign = { key: string; design: DeviceDesign };
let published = new Map<string, DeviceDesign>();
let version = 0;
const listeners = new Set<() => void>();

/** Sets what the simulator draws with; the drawing re-renders through `subscribeDesigns`. */
export function setPublishedDesigns(list: readonly PublishedDesign[]) {
  published = new Map(list.filter((item) => isDesignKey(item.key) && deviceDesignSchema.safeParse(item.design).success).map((item) => [item.key, item.design]));
  version += 1;
  for (const listener of listeners) listener();
}
export const subscribeDesigns = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const designsVersion = () => version;

type Placed = { kind: DeviceKindId; options: Readonly<Record<string, string>> };
/** The key a placed device is designed under: its copy, else its kind. */
export const designKeyOf = (device: Placed) => device.options[DESIGN_OPTION] ?? device.kind;

/**
 * The design a placed device is drawn with, or null for the simulator's own drawing. A copy whose function was changed after the
 * device was placed keeps the function it was placed with, so it falls back to that kind's drawing rather than mixing the two.
 */
export function designFor(device: Placed, override?: DeviceDesign | null): DeviceDesign | null {
  if (override !== undefined) return override && override.function === device.kind ? override : null;
  const design = published.get(designKeyOf(device)) ?? null;
  return design && design.function === device.kind ? design : null;
}

/** The kind's definition with the design's names, group and terminal layout; the behaviour is the kind's own. */
export function designedDef(device: Placed, override?: DeviceDesign | null): DeviceKindDef {
  const def = DEVICE_DEFS[device.kind];
  const design = designFor(device, override);
  if (!design) return def;
  const byId = new Map(design.terminals.map((terminal) => [terminal.id, terminal]));
  const terminals: TerminalDef[] = def.terminals.flatMap((terminal) => {
    const own = byId.get(terminal.id);
    if (!own) return [terminal];
    if (!own.used) return [];
    return [{ ...terminal, side: own.side, ...(own.name ? { name: own.name } : {}), ...(own.title ? { title: own.title } : {}) }];
  });
  for (const extra of design.terminals) {
    if (!isExtraTerminal(extra.id)) continue;
    const name = extra.name || extra.id;
    const linked = extra.joins ? byId.get(extra.joins) : undefined;
    terminals.push({ id: extra.id, role: extra.role ?? "wire", side: extra.side, name, title: extra.title || (linked ? `${name}, förbunden med ${terminalMarking(device.kind, linked)}` : `Plint ${name}`) });
  }
  return { ...def, label: design.label, name: design.name, short: design.short, group: design.group, terminals, width: plateWidth(def.width, terminals) };
}

/** The inner links of a placed device's extra terminals: pairs of terminal ids joined inside the device. */
export function designedJoins(device: Placed, override?: DeviceDesign | null): [string, string][] {
  const design = designFor(device, override);
  if (!design) return [];
  const used = new Set(designedDef(device, override).terminals.map((terminal) => terminal.id));
  return design.terminals.flatMap((terminal) => (isExtraTerminal(terminal.id) && terminal.joins && used.has(terminal.joins) ? [[terminal.id, terminal.joins] as [string, string]] : []));
}

/** How far the function's own drawing is moved right to stand in the middle of a plate that grew with its terminals. */
export const pictureOffset = (device: Placed, override?: DeviceDesign | null) => (designedDef(device, override).width - DEVICE_DEFS[device.kind].width) / 2;

/** Where a terminal sits along its side (0–1), when the design placed it; null spreads the side evenly. */
export function designedTerminalAt(device: Placed, terminalId: string, override?: DeviceDesign | null): number | null {
  return designFor(device, override)?.terminals.find((terminal) => terminal.id === terminalId)?.at ?? null;
}

/** One tile of the palette: the kind it places and, for a copy, the option that names it. */
export type PaletteEntry = { key: string; kind: DeviceKindId; def: DeviceKindDef; options: Record<string, string> };

/** The palette: the standard devices (renamed, regrouped or hidden by their designs) and then the copies, in the groups' order. */
export function paletteEntries(designs: ReadonlyMap<string, DeviceDesign> = published): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  for (const kind of DEVICE_KINDS) {
    const design = designs.get(kind);
    if (design?.hidden) continue;
    entries.push({ key: kind, kind, def: designedDef({ kind, options: {} }, design ?? null), options: {} });
  }
  for (const [key, design] of designs) {
    if (!isCustomKey(key) || design.hidden) continue;
    const options = { [DESIGN_OPTION]: key };
    entries.push({ key, kind: design.function, def: designedDef({ kind: design.function, options }, design), options });
  }
  return entries;
}

// ---------- export and import (2026-11-06: "importera och exportera koden, för att andra AI-system ska kunna skapa symboler") ----------

/**
 * The file format: `hintek-plc-device`, version 2 (2026-11-07: terminals can be left out of use or added, with a kind and an inner
 * link); version 1 files are still read. Written so that another system can produce it from a short instruction
 *. One file holds one device or all of them.
 */
export const DEVICE_FILE_FORMAT = "hintek-plc-device";
/** Version 4 (2026-11-09): photo layers in the SVG picture, the value "volts" and the rule "show" (a value written in the picture). */
export const DEVICE_FILE_VERSION = 4;
export const DEVICE_FILE_VERSIONS = [1, 2, 3, 4] as const;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_DEVICES = 200;
/** What one request to the server may carry: an import of many devices is sent in parts of at most this size. */
export const IMPORT_PART_BYTES = 1_500_000;

const fileSound = z.object({ format: z.enum(SOUND_FORMATS), dataUrl: z.string().regex(/^data:audio\/[a-z0-9.+-]+;base64,/, "Ett ljud ska vara en data-adress som börjar med data:audio/…;base64,") }).strict();
const fileImage = z.union([
  z.object({ format: z.literal("svg"), svg: z.string().min(1) }).strict(),
  z.object({ format: z.literal("png"), dataUrl: z.string().regex(/^data:image\/png;base64,/, "En PNG-bild ska vara en data-adress som börjar med data:image/png;base64,") }).strict(),
]);
const fileTerminal = z.object({
  id: z.string().min(1).max(8),
  name: z.string().max(8).optional(),
  title: z.string().max(60).optional(),
  side: z.enum(["top", "bottom"]),
  at: z.number().min(0).max(1).nullable().optional(),
  used: z.boolean().optional(),
  role: z.enum(TERMINAL_ROLES).optional(),
  joins: z.string().min(1).max(8).nullable().optional(),
}).strict();
const fileDevice = z.object({
  key: z.string().max(16).optional(),
  name: z.string().min(1).max(24),
  label: z.string().min(1).max(60),
  short: z.string().max(200).optional(),
  group: z.enum(DEVICE_GROUPS as unknown as [DeviceGroup, ...DeviceGroup[]]),
  function: z.enum(DEVICE_KINDS),
  stateView: z.enum(STATE_VIEWS).optional(),
  hidden: z.boolean().optional(),
  terminals: z.array(fileTerminal).max(MAX_TERMINALS + 8).optional(),
  image: fileImage.nullable().optional(),
  imageOn: fileImage.nullable().optional(),
  sound: fileSound.nullable().optional(),
  silent: z.boolean().optional(),
  animation: z.unknown().optional(),
  readout: readoutSchema.nullable().optional(),
}).strict();
/** "instruction": the format guide written into an exported library, so the file alone tells another AI how to answer; read past on import. */
const deviceFileSchema = z.object({ format: z.literal(DEVICE_FILE_FORMAT), version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), instruction: z.string().max(200_000).optional(), devices: z.array(fileDevice).min(1).max(MAX_IMPORT_DEVICES) }).strict();
export type DeviceFile = z.infer<typeof deviceFileSchema>;

const toFileImage = (image: DesignImage | null) => (!image ? null : image.format === "svg" ? { format: "svg" as const, svg: image.data } : { format: "png" as const, dataUrl: `data:image/png;base64,${image.data}` });
const fromFileImage = (image: z.infer<typeof fileImage> | null | undefined): DesignImage | null => (!image ? null : image.format === "svg" ? { format: "svg", data: image.svg } : { format: "png", data: image.dataUrl });

/** One or more devices as a readable file: everything a design holds, with the pictures as SVG text or a PNG data address. */
/** With `instruction`, the format guide goes first in the file (2026-11-07: the exported library alone is what another AI gets). */
export function exportDevices(devices: readonly PublishedDesign[], instruction?: string): DeviceFile {
  return {
    format: DEVICE_FILE_FORMAT, version: DEVICE_FILE_VERSION, ...(instruction ? { instruction } : {}),
    devices: devices.map(({ key, design }) => ({
      ...(key ? { key } : {}), name: design.name, label: design.label, short: design.short, group: design.group, function: design.function, stateView: design.stateView, hidden: design.hidden,
      terminals: design.terminals.map((terminal) => ({
        id: terminal.id, ...(terminal.name ? { name: terminal.name } : {}), ...(terminal.title ? { title: terminal.title } : {}), side: terminal.side, at: terminal.at,
        ...(terminal.used ? {} : { used: false }), ...(isExtraTerminal(terminal.id) ? { role: terminal.role ?? "wire", joins: terminal.joins } : {}),
      })),
      image: toFileImage(design.image), imageOn: toFileImage(design.imageOn), sound: design.sound ? { format: design.sound.format, dataUrl: `data:${SOUND_TYPES[design.sound.format]};base64,${design.sound.data}` } : null, ...(design.silent ? { silent: true } : {}), animation: design.animation, readout: design.readout,
    })),
  };
}

const zodPath = (path: readonly PropertyKey[]) => path.map((part) => (typeof part === "number" ? `[${part + 1}]` : `.${String(part)}`)).join("").replace(/^\./, "");
const FIELD_WORDS: Record<string, string> = { unrecognized_keys: "okänt fält", invalid_value: "värdet är inte tillåtet", invalid_type: "fel sorts värde", too_big: "för långt eller för stort", too_small: "för kort eller saknas", invalid_union: "bilden har fel form" };

export type ImportedDevice = { key: string | null; design: DeviceDesign };
/**
 * Reads a file another system or a person wrote: strict (unknown fields are refused, functions only from the fixed list, the size
 * capped), and every device checked as a design would be, pictures cleaned. Every problem in plain Swedish with where it is.
 */
export function parseDeviceFile(text: string): { ok: true; devices: ImportedDevice[] } | { ok: false; errors: string[] } {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return { ok: false, errors: [`Filen är större än ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`] };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, errors: ["Filen är inte giltig JSON."] }; }
  const parsed = deviceFileSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 12).map((issue) => {
      const where = zodPath(issue.path) || "filen";
      if (issue.code === "unrecognized_keys") return `${where}: okänt fält ${(issue as { keys?: string[] }).keys?.join(", ") ?? ""}`.trim();
      if (where === "format" || where === "version") return `Filen ska börja med "format": "${DEVICE_FILE_FORMAT}" och "version": ${DEVICE_FILE_VERSIONS.join(" eller ")}.`;
      return `${where}: ${FIELD_WORDS[issue.code] ?? issue.message}`;
    }) };
  }
  const devices: ImportedDevice[] = [];
  const errors: string[] = [];
  const v1 = parsed.data.version === 1, v2 = parsed.data.version === 2, v3 = parsed.data.version === 3;
  parsed.data.devices.forEach((item, index) => {
    const where = `Apparat ${index + 1} (${item.name})`;
    const key = item.key && isDesignKey(item.key) ? item.key : null;
    const standard = functionTerminals(item.function);
    const terminals = item.terminals ?? standard;
    // Version 1 had exactly the function's terminals; what came later is refused there rather than guessed.
    if (v1 && ("sound" in item || "silent" in item || (item.terminals ?? []).some((terminal) => "used" in terminal || "role" in terminal || "joins" in terminal || isExtraTerminal(terminal.id)))) {
      errors.push(`${where}: extra plintar, "used", "role", "joins", "sound" och "silent" finns först i version 2. Skriv "version": ${DEVICE_FILE_VERSION}.`);
      return;
    }
    if ((v1 || v2) && ("animation" in item || "readout" in item)) { errors.push(`${where}: "animation" och "readout" finns först i version 3. Skriv "version": ${DEVICE_FILE_VERSION}.`); return; }
    let animation: AnimationSpec | null = null;
    if (item.animation !== undefined && item.animation !== null) {
      const checked = checkAnimation(item.animation);
      if (!checked.ok) { errors.push(...checked.errors.map((line) => `${where}, animation: ${line}`)); return; }
      animation = checked.spec;
    }
    // Version 4: photo layers, "volts" and "show" are refused in an older file rather than silently dropped by an older product.
    const layered = [item.image, item.imageOn].some((image) => image?.format === "svg" && /<image[\s/>]/i.test(image.svg));
    const newer = animation?.rules.some((rule) => rule.show !== undefined || rule.scaleY !== undefined || rule.follow?.scaleY !== undefined || rule.follow?.value === "volts" || rule.spin === "volts") ?? false;
    if ((v1 || v2 || v3) && (layered || newer)) { errors.push(`${where}: fotolager (<image>) i bilden, värdet "volts", "scaleY" och regeln "show" finns först i version 4. Skriv "version": 4.`); return; }
    const design = {
      name: item.name, label: item.label, short: item.short ?? "", group: item.group, function: item.function, stateView: item.stateView ?? "none", hidden: item.hidden ?? false,
      terminals: terminals.map((terminal) => ({ id: terminal.id, name: terminal.name ?? "", title: terminal.title ?? "", side: terminal.side, at: terminal.at ?? null, used: "used" in terminal ? terminal.used ?? true : true, role: "role" in terminal ? terminal.role ?? null : null, joins: "joins" in terminal ? terminal.joins ?? null : null })),
      image: fromFileImage(item.image), imageOn: fromFileImage(item.imageOn), sound: item.sound ? { format: item.sound.format, data: item.sound.dataUrl } : null, silent: item.silent ?? false, animation: item.animation ?? null, readout: item.readout ?? null,
    };
    // A standard device's key keeps its function; with another function the device comes in as a new copy.
    const checkKey = key && isDeviceKind(key) && key !== item.function ? `egen-import${index}` : key ?? `egen-import${index}`;
    const checked = validateDesign(isDesignKey(checkKey) ? checkKey : "egen-import0", design);
    if (!checked.ok) { errors.push(`${where}: ${checked.reason}`); return; }
    devices.push({ key: key && !(isDeviceKind(key) && key !== item.function) ? key : null, design: checked.design });
  });
  return errors.length ? { ok: false, errors } : { ok: true, devices };
}

/**
 * An import of many devices in parts the server takes one request at a time (a request is capped at 2 MB): each part a file of its
 * own with at most `limit` bytes as sent, in the file's order; one device larger than that goes alone. `indexes` are the devices'
 * places in the whole file, so each part carries its own choices.
 */
export function splitForImport(devices: readonly ImportedDevice[], limit = IMPORT_PART_BYTES): { text: string; indexes: number[] }[] {
  const textOf = (indexes: readonly number[]) => JSON.stringify(exportDevices(indexes.map((index) => ({ key: devices[index]!.key ?? "", design: devices[index]!.design }))));
  const sent = (text: string) => new TextEncoder().encode(JSON.stringify(text)).length;
  const parts: { text: string; indexes: number[] }[] = [];
  let current: number[] = [];
  devices.forEach((_, index) => {
    const next = [...current, index];
    if (current.length && sent(textOf(next)) > limit) { parts.push({ text: textOf(current), indexes: current }); current = [index]; } else current = next;
  });
  if (current.length) parts.push({ text: textOf(current), indexes: current });
  return parts;
}

// ---------- the colour choice on a photo (2026-11-09: "Jag kan välja färg men ser inte någon skillnad på knappen") ----------

/** CSS filters that turn the green cap or lens of the standard photos into the chosen colour (from green, hue as sharp's modulate). */
const PHOTO_COLOURS: Record<string, string> = {
  red: "hue-rotate(240deg) saturate(1.15)", yellow: "hue-rotate(288deg) saturate(1.35) brightness(1.45)", blue: "hue-rotate(100deg) saturate(1.1)",
  white: "saturate(0) brightness(1.75)", black: "saturate(0) brightness(0.4)",
};
/**
 * The filter for a placed button or lamp drawn with its standard photo, from its Färg option ("Efter kontakt": green as NO, red as NC),
 * or null when green or not a photo. A copy ("Tryckknapp röd") has its own colour in its picture and is never turned.
 */
export function photoColourFilter(device: Placed, design: DeviceDesign | null | undefined): string | null {
  if (!design?.image || device.options[DESIGN_OPTION]) return null;
  const def = DEVICE_DEFS[device.kind];
  if (!def.options.some((option) => option.key === "color")) return null;
  const chosen = optionValue(def, device.options, "color");
  const colour = chosen === "auto" ? (optionValue(def, device.options, "nc") === "nc" ? "red" : "green") : chosen;
  return PHOTO_COLOURS[colour] ?? null;
}
/** The options a person sets on a placed device: a copy with its own coloured picture has no Färg (its colour is its own). */
export function settableOptions(device: Placed, design: DeviceDesign | null | undefined) {
  const def = DEVICE_DEFS[device.kind];
  return device.options[DESIGN_OPTION] && design?.image ? def.options.filter((option) => option.key !== "color") : def.options;
}

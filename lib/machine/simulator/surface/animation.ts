import { z } from "zod";
import type { DeviceKindId } from "./devices";
import type { DeviceState, Plant } from "./engine";
import { pictureValueText, SHOW_VALUES } from "./readouts";

// PLC-apparater, animering (2026-11-07: "Animering skall vara i redigerbar kod. Jag skall kunna be att annat AI-system ta fram
// knappar på det sättet"): how a device's picture moves, as DECLARATIVE text – never code. A spec is a list of rules on named parts of
// the picture (an SVG element's id, or `data-part` in the simulator's own drawings): when the device is in a state, move, turn, scale,
// fade, colour or hide the part; or turn it continuously, or let it follow a value. Every value is checked against a fixed form
// (numbers in ranges, colours as #hex, states and values from fixed lists, part names as plain words), unknown fields are refused, and
// what it becomes is CSS for the parts – so a spec can never run anything, fetch anything or reach outside its own device.

export const PART_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
/** The whole picture layer, whatever it is drawn with (a PNG too). */
export const WHOLE_PICTURE = "bild";
export const STATES = ["pressed", "on", "energised", "tripped", "running", "driven", "open", "always"] as const;
export type AnimState = (typeof STATES)[number];
export const STATE_TEXT: Record<AnimState, string> = {
  pressed: "knappen hålls in", on: "brytaren är till (eller utlöst)", energised: "spolen eller lasten har spänning", tripped: "vakten har löst ut",
  running: "motorn eller fläkten går (fart över 0)", driven: "styrsignalen är över 0", open: "spjället eller ventilen är mer än halvt öppen", always: "alltid",
};
export const VALUES = ["speed", "drive", "position", "value", "signal", "volts"] as const;
export type AnimValue = (typeof VALUES)[number];
export const VALUE_TEXT: Record<AnimValue, string> = {
  speed: "fart 0–1 (motor, fläkt, pump)", drive: "styrning 0–1 (spänning eller 0–10 V på styr)", position: "läge 0–1 (spjäll)", value: "vredets läge 0–1", signal: "utsignal 0–1 (0–10 V)", volts: "spänningen 0–30 V som 0–1 (voltmeter, matning)",
};
export const EASES = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;
const COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const WHEN = new RegExp(`^(?:not )?(?:${STATES.join("|")})$`);

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const pair = (min: number, max: number) => z.tuple([num(min, max), num(min, max)]);
const followSchema = z.object({
  value: z.enum(VALUES),
  rotate: pair(-720, 720).optional(),
  move: z.tuple([pair(-200, 200), pair(-200, 200)]).optional(),
  opacity: pair(0, 1).optional(),
  scale: pair(0, 5).optional(),
  /** Height only (a damper blade turning, seen from the front). */
  scaleY: pair(0, 5).optional(),
}).strict();
const ruleSchema = z.object({
  part: z.string().regex(PART_NAME, "en del heter med bokstäver, siffror, - och _ och börjar med en bokstav"),
  when: z.string().regex(WHEN, `"when" är ett av ${STATES.join(", ")}, eventuellt med "not " före`).optional(),
  move: pair(-200, 200).optional(),
  rotate: num(-720, 720).optional(),
  scale: num(0, 5).optional(),
  scaleY: num(0, 5).optional(),
  origin: pair(-1000, 1000).optional(),
  opacity: num(0, 1).optional(),
  fill: z.string().regex(COLOUR, "en färg skrivs #rgb eller #rrggbb").optional(),
  stroke: z.string().regex(COLOUR, "en färg skrivs #rgb eller #rrggbb").optional(),
  hidden: z.boolean().optional(),
  blink: num(0.2, 10).optional(),
  spin: z.enum([...VALUES, "one"]).optional(),
  rpm: num(1, 600).optional(),
  follow: followSchema.optional(),
  /** Writes a value of the device in the part (a <text> with that id): "12,5 V", "21,5 °C", "80 %". */
  show: z.enum(SHOW_VALUES).optional(),
  ms: z.number().int().min(0).max(3000).optional(),
  ease: z.enum(EASES).optional(),
}).strict();
export const animationSchema = z.object({ rules: z.array(ruleSchema).max(40) }).strict();
export type AnimationRule = z.infer<typeof ruleSchema>;
export type AnimationSpec = z.infer<typeof animationSchema>;

const EFFECTS = ["move", "rotate", "scale", "scaleY", "opacity", "fill", "stroke", "hidden", "blink", "spin", "follow", "show"] as const;
const moves = (rule: AnimationRule) => rule.move !== undefined || rule.rotate !== undefined || rule.scale !== undefined || rule.scaleY !== undefined || Boolean(rule.follow && (rule.follow.rotate || rule.follow.move || rule.follow.scale || rule.follow.scaleY));

/** What is wrong with a spec beyond its form, in plain Swedish with the rule's number. */
export function animationProblems(spec: AnimationSpec): string[] {
  const problems: string[] = [];
  spec.rules.forEach((rule, index) => {
    if (!EFFECTS.some((effect) => rule[effect] !== undefined)) problems.push(`Regel ${index + 1} (${rule.part}): säg vad som ska hända, till exempel "move", "rotate", "opacity" eller "spin".`);
    if (rule.rpm !== undefined && rule.spin === undefined) problems.push(`Regel ${index + 1} (${rule.part}): "rpm" hör ihop med "spin".`);
  });
  const spinning = new Set(spec.rules.filter((rule) => rule.spin).map((rule) => rule.part));
  for (const part of spinning) if (spec.rules.some((rule) => rule.part === part && moves(rule))) problems.push(`Delen ${part} snurrar ("spin") och kan därför inte också flyttas, vridas eller skalas. Lägg den i en egen grupp.`);
  return [...new Set(problems)];
}

const ZOD_WORDS: Record<string, string> = { unrecognized_keys: "okänt fält", invalid_value: "värdet är inte tillåtet", invalid_type: "fel sorts värde", too_big: "för stort", too_small: "för litet eller saknas" };
/**
 * Reads a spec written as text (JSON): its form strictly, then the rules' sense. The errors say where ("regel 2, fill") so a person or
 * an AI can mend them.
 */
export function parseAnimation(text: string): { ok: true; spec: AnimationSpec } | { ok: false; errors: string[] } {
  if (text.length > 20_000) return { ok: false, errors: ["Animeringen är längre än 20 000 tecken."] };
  let json: unknown;
  try { json = JSON.parse(text); } catch (error) { return { ok: false, errors: [`Texten är inte giltig JSON: ${(error as Error).message.replace(/^JSON\.parse: /, "")}`] }; }
  return checkAnimation(json);
}
export function checkAnimation(value: unknown): { ok: true; spec: AnimationSpec } | { ok: false; errors: string[] } {
  const parsed = animationSchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 10).map((issue) => {
    const [, index, field] = issue.path;
    const where = typeof index === "number" ? `Regel ${index + 1}${field !== undefined ? `, ${String(field)}` : ""}` : issue.path.length ? String(issue.path.join(".")) : "Animeringen";
    const what = issue.code === "unrecognized_keys" ? `okänt fält ${(issue as { keys?: string[] }).keys?.join(", ") ?? ""}` : issue.code === "invalid_format" || issue.code === "custom" ? issue.message : ZOD_WORDS[issue.code] ?? issue.message;
    return `${where}: ${what}`.trim();
  }) };
  const problems = animationProblems(parsed.data);
  return problems.length ? { ok: false, errors: problems } : { ok: true, spec: parsed.data };
}

export const animationText = (spec: AnimationSpec) => JSON.stringify(spec, null, 2).replace(/\[\n\s+(-?[\d.]+),\n\s+(-?[\d.]+)\n\s+\]/g, "[$1, $2]");

/** The parts a spec names, in order. */
export const partsOf = (spec: AnimationSpec) => [...new Set(spec.rules.map((rule) => rule.part))];
/** Parts the spec names that the picture does not have (null: not known, nothing said). */
export function missingParts(spec: AnimationSpec, available: readonly string[] | null): string[] {
  if (!available) return [];
  return partsOf(spec).filter((part) => part !== WHOLE_PICTURE && !available.includes(part));
}

// ---------- evaluation ----------

export function stateHolds(when: string | undefined, state: DeviceState): boolean {
  if (!when) return true;
  const negated = when.startsWith("not ");
  const name = (negated ? when.slice(4) : when) as AnimState;
  const holds = name === "always" ? true : name === "running" ? state.speed > 0.02 : name === "driven" ? state.drive > 0.01 : name === "open" ? state.position > 0.5 : Boolean(state[name]);
  return negated ? !holds : holds;
}
export function valueOf(name: AnimValue | "one", state: DeviceState): number {
  const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  switch (name) {
    case "one": return 1;
    case "speed": return clamp(state.speed);
    case "drive": return clamp(state.drive);
    case "position": return clamp(state.position);
    case "value": return clamp(state.value / 100);
    case "signal": return clamp((state.outV ?? 0) / 10);
    case "volts": return clamp(Math.abs(state.volts ?? 0) / 30);
  }
}

/** What the parts with a "show" rule read for a state: the part's id and the value's text, for the drawing to write in its <text>. */
export function animationTexts(spec: AnimationSpec, state: DeviceState, kind: DeviceKindId, plant?: Plant): Map<string, string> {
  const texts = new Map<string, string>();
  for (const rule of spec.rules) if (rule.show && stateHolds(rule.when, state)) texts.set(rule.part, pictureValueText(kind, rule.show, state, plant));
  return texts;
}

export type PartLook = {
  transform: string | null; origin: [number, number] | null; opacity: number | null; fill: string | null; stroke: string | null; hidden: boolean;
  /** Turns per second (0: still), and blinks per second (0: steady). */
  spin: number; blink: number;
  ms: number; ease: string; moves: boolean; fades: boolean;
};
const round = (value: number) => Math.round(value * 1000) / 1000;
const lerp = (range: readonly [number, number], share: number) => range[0] + (range[1] - range[0]) * share;

/** How every part looks for a state: the rules that hold, applied in order (later ones win; movements add up). */
export function evaluateAnimation(spec: AnimationSpec, state: DeviceState): Map<string, PartLook> {
  const looks = new Map<string, PartLook>();
  for (const rule of spec.rules) {
    let look = looks.get(rule.part);
    if (!look) { look = { transform: null, origin: null, opacity: null, fill: null, stroke: null, hidden: false, spin: 0, blink: 0, ms: 0, ease: "ease", moves: false, fades: false }; looks.set(rule.part, look); }
    look.ms = Math.max(look.ms, rule.ms ?? 0);
    if (rule.ease) look.ease = rule.ease;
    if (rule.origin && !look.origin) look.origin = rule.origin;
    if (moves(rule)) look.moves = true;
    if (rule.opacity !== undefined || rule.follow?.opacity || rule.blink !== undefined) look.fades = true;
    if (!stateHolds(rule.when, state)) continue;
    const steps: string[] = [];
    const translate = (x: number, y: number) => steps.push(`translate(${round(x)}px, ${round(y)}px)`);
    if (rule.move) translate(rule.move[0], rule.move[1]);
    if (rule.rotate !== undefined) steps.push(`rotate(${round(rule.rotate)}deg)`);
    if (rule.scale !== undefined) steps.push(`scale(${round(rule.scale)})`);
    if (rule.scaleY !== undefined) steps.push(`scale(1, ${round(rule.scaleY)})`);
    if (rule.follow) {
      const share = valueOf(rule.follow.value, state);
      if (rule.follow.move) translate(lerp([rule.follow.move[0][0], rule.follow.move[1][0]], share), lerp([rule.follow.move[0][1], rule.follow.move[1][1]], share));
      if (rule.follow.rotate) steps.push(`rotate(${round(lerp(rule.follow.rotate, share))}deg)`);
      if (rule.follow.scale) steps.push(`scale(${round(lerp(rule.follow.scale, share))})`);
      if (rule.follow.scaleY) steps.push(`scale(1, ${round(lerp(rule.follow.scaleY, share))})`);
      if (rule.follow.opacity) look.opacity = round(lerp(rule.follow.opacity, share));
    }
    if (steps.length) look.transform = [look.transform, ...steps].filter(Boolean).join(" ");
    if (rule.opacity !== undefined) look.opacity = rule.opacity;
    if (rule.fill) look.fill = rule.fill.toLowerCase();
    if (rule.stroke) look.stroke = rule.stroke.toLowerCase();
    if (rule.hidden !== undefined) look.hidden = rule.hidden;
    if (rule.blink !== undefined) look.blink = rule.blink;
    if (rule.spin) {
      // In steps of 5 %, so a fan running up does not restart its turn every tick.
      const share = Math.round(valueOf(rule.spin, state) * 20) / 20;
      look.spin = share > 0 ? round(((rule.rpm ?? 60) * share) / 60) : 0;
    }
  }
  return looks;
}

/**
 * The CSS for one device's parts, scoped to its own class: only numbers, #hex colours, fixed words and the part names (which are
 * plain words) are ever written, so nothing from a spec can close the rule or reach another element.
 */
export function animationCss(scope: string, spec: AnimationSpec, state: DeviceState): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(scope)) return "";
  const out: string[] = [`@keyframes plc-part-spin { to { transform: rotate(360deg); } } @keyframes plc-part-blink { 50% { opacity: 0.12; } }`];
  for (const [part, look] of evaluateAnimation(spec, state)) {
    if (!PART_NAME.test(part)) continue;
    const self = `.${scope} [data-part="${part}"]`;
    const rules: string[] = [];
    if (look.moves || look.spin) {
      rules.push(look.origin ? `transform-box: view-box; transform-origin: ${round(look.origin[0])}px ${round(look.origin[1])}px` : "transform-box: fill-box; transform-origin: center");
      if (!look.spin) rules.push(`transform: ${look.transform ?? "none"}`);
    }
    if (look.fades) rules.push(`opacity: ${look.opacity ?? 1}`);
    rules.push(`visibility: ${look.hidden ? "hidden" : "visible"}`);
    const props = [look.moves && !look.spin ? "transform" : null, look.fades ? "opacity" : null, "fill", "stroke"].filter(Boolean);
    if (look.ms) rules.push(`transition: ${props.map((prop) => `${prop} ${look.ms}ms ${look.ease}`).join(", ")}`);
    out.push(`${self} { ${rules.join("; ")}; }`);
    const paint = [look.fill ? `fill: ${look.fill}` : null, look.stroke ? `stroke: ${look.stroke}` : null].filter(Boolean);
    if (paint.length) out.push(`${self}, ${self} * { ${paint.join("; ")}; }`);
    const animations = [look.spin ? `plc-part-spin ${round(1 / look.spin)}s linear infinite` : null, look.blink ? `plc-part-blink ${round(1 / look.blink)}s ease-in-out infinite` : null].filter(Boolean);
    if (animations.length) out.push(`@media (prefers-reduced-motion: no-preference) { ${self} { animation: ${animations.join(", ")}; } }`);
  }
  return out.join("\n");
}

// ---------- the simulator's own animations, written in the same form ----------

const glow = (part: string, when: AnimState): AnimationRule => ({ part, when: `not ${when}`, opacity: 0, ms: 120 });
const spinWith = (part: string, value: AnimValue, rpm: number): AnimationRule => ({ part, spin: value, rpm });
const STANDARD: Partial<Record<DeviceKindId, AnimationRule[]>> = {
  knapp: [{ part: "cap", when: "pressed", move: [0, 1.4], scale: 0.95, ms: 60 }, glow("shade", "pressed")],
  knapp_lampa: [{ part: "cap", when: "pressed", move: [0, 1.4], scale: 0.95, ms: 60 }, glow("light", "energised"), glow("shade", "pressed")],
  nodstopp: [{ part: "cap", when: "on", move: [0, 1.8], scale: 0.9, ms: 70 }, glow("shade", "on")],
  vippa: [{ part: "lever", when: "on", rotate: 60, origin: [36, 49], ms: 120, ease: "ease-out" }],
  valjare: [{ part: "grip", when: "on", rotate: 90, origin: [36, 42], ms: 150, ease: "ease-out" }],
  gransbrytare: [{ part: "arm", when: "on", rotate: -22, origin: [42, 34], ms: 120 }, glow("led", "on")],
  vred: [{ part: "pointer", follow: { value: "value", rotate: [-135, 135] }, origin: [42, 40], ms: 60, ease: "linear" }],
  lampa: [glow("light", "energised")],
  summer: [glow("waves", "energised"), { part: "waves", when: "energised", blink: 3 }],
  motor: [spinWith("fan", "speed", 67), glow("led", "energised")],
  ventil: [glow("flow", "energised"), glow("led", "energised")],
  varmare: [{ part: "heat", follow: { value: "drive", opacity: [0, 1] }, ms: 400 }],
  nodstoppsrela: [glow("led-power", "energised"), glow("led-k", "on")],
  rela: [{ part: "armature", when: "energised", rotate: 8, origin: [44, 24], ms: 70, ease: "ease-in" }, { part: "contact", when: "energised", move: [0, 6], ms: 70, ease: "ease-in" }, glow("led", "energised")],
  kontaktor: [{ part: "carriage", when: "energised", move: [16, 0], ms: 150, ease: "linear" }, { part: "mark-on", when: "not energised", hidden: true }, { part: "mark-off", when: "energised", hidden: true }, glow("led", "energised")],
  larm: [glow("beacon", "energised"), { part: "beacon", when: "energised", blink: 1.6 }],
  tilluftsflakt: [spinWith("rotor", "speed", 67)],
  franluftsflakt: [spinWith("rotor", "speed", 67)],
  spjall: [{ part: "blade", follow: { value: "position", rotate: [-90, 0] }, ms: 200, ease: "linear" }, glow("led", "energised")],
  brandlarm: [glow("alarm", "on"), { part: "normal", when: "on", opacity: 0, ms: 80 }, { part: "alarm", when: "on", blink: 1.2 }],
  varmebatteri: [{ part: "heat", follow: { value: "drive", opacity: [0, 1] }, ms: 400 }],
  cirkpump: [spinWith("rotor", "speed", 67)],
  shunt: [{ part: "needle", follow: { value: "drive", rotate: [-60, 60] }, origin: [42, 29.5], ms: 200, ease: "linear" }],
  varmekalla: [spinWith("rotor", "drive", 67), glow("led", "driven"), { part: "flame", follow: { value: "drive", opacity: [0, 1] }, ms: 300 }],
  frysvakt: [glow("frost", "tripped"), { part: "frost", when: "tripped", blink: 1 }],
  kallajust: [{ part: "pointer", follow: { value: "value", rotate: [-135, 135] }, origin: [48, 50], ms: 60, ease: "linear" }],
  kalla010: [{ part: "pointer", follow: { value: "value", rotate: [-135, 135] }, origin: [42, 50], ms: 60, ease: "linear" }],
  kalla420: [{ part: "pointer", follow: { value: "value", rotate: [-135, 135] }, origin: [42, 50], ms: 60, ease: "linear" }],
  signalsim: [{ part: "pointer", follow: { value: "value", rotate: [-135, 135] }, origin: [42, 61], ms: 60, ease: "linear" }],
  // The needle from 0 at the left to 30 V at the right, smoothly (2026-11-09: "Förbättra denna display").
  voltmeter: [{ part: "needle", follow: { value: "volts", rotate: [-50, 50] }, origin: [36, 66], ms: 250, ease: "ease-out" }],
};
/** The simulator's own animation of a function; a function that only shows values (a sensor, a meter, a supply) has none. */
export const standardAnimation = (kind: DeviceKindId): AnimationSpec => ({ rules: STANDARD[kind] ?? [] });

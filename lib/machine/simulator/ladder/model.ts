import { z } from "zod";

// PLC-simulatorn, Ladder (2026-11-03): the ladder program as data. A program is rungs in order; a rung is a series of
// elements from the left rail (contacts, comparisons, timers, counters, and parallel groups of such series) that ends in one or
// more outputs (coils, set, reset). Every variable the rungs name is either a terminal (DI0, DO3, AI1, AO0 by name or through an
// address on a declared variable), the clock (TID_H, TID_M, VECKODAG), a block, or an internal variable. The same program is
// written as ST by generate.ts and run by the ST interpreter, so Ladder and ST always mean the same thing.
// Lossless (2026-11-03, "växla mellan ladder och ST kod utan att data förloras"): an ST-block is a rung element that
// holds ST statements with no ladder form (arithmetic, CASE, nested IF, PID …), written out verbatim where it stands and run
// when the flow into it is on. Declared variables may be of a block type too, and keep their comment, so VAR round-trips.

export type LdType = "BOOL" | "INT" | "REAL" | "TIME";
/** The block types a declared variable may have: the ladder's own blocks and the dialect's other blocks, used inside ST-blocks. */
export const LD_FB_TYPES = ["TON", "TOF", "TP", "CTU", "CTD", "R_TRIG", "F_TRIG", "PID"] as const;
export type LdFbType = (typeof LD_FB_TYPES)[number];
/** TIMER and COUNTER: a tag for a timer or counter, whichever kind the rung gives it; a TON or a CTU until a rung says else. */
export const LD_TAG_BLOCKS = ["TIMER", "COUNTER"] as const;
export type LdVarType = LdType | LdFbType | (typeof LD_TAG_BLOCKS)[number];
export const isLdFbType = (type: string): type is LdFbType => (LD_FB_TYPES as readonly string[]).includes(type);
export type LdOperand = { kind: "var"; name: string } | { kind: "member"; object: string; field: string } | { kind: "const"; value: number; type: "INT" | "REAL" | "TIME" };
export type LdCmpOp = "=" | "<>" | "<" | ">" | "<=" | ">=";
export type LdContact = { id: string; kind: "no" | "nc"; var: string };
/** R_TRIG, F_TRIG: the flow one cycle on a rising or falling flow in; `name` is the block. */
export type LdEdge = { id: string; kind: "r_trig" | "f_trig"; name: string };
export const LD_CALC_OPS = ["ADD", "SUB", "MUL", "DIV", "MOVE"] as const;
export type LdCalcOp = (typeof LD_CALC_OPS)[number];
/** A calculation when the flow is on: `dest` := a op b (MOVE: dest := a). The flow passes through. */
export type LdCalc = { id: string; kind: "calc"; op: LdCalcOp; a: LdOperand; b: LdOperand | null; dest: string };
/** Runs a routine of the program when the flow is on; the flow passes through. */
export type LdCall = { id: string; kind: "call"; routine: string };
/** Ends the routine when the flow is on. */
export type LdRet = { id: string; kind: "ret" };
export type LdCompare = { id: string; kind: "cmp"; op: LdCmpOp; left: LdOperand; right: LdOperand };
export type LdTimer = { id: string; kind: "ton" | "tof" | "tp"; name: string; ptMs: number };
/** CTU counts up on the flow in, `aux` is its reset; CTD counts down, `aux` is its load. */
export type LdCounter = { id: string; kind: "ctu" | "ctd"; name: string; pv: number; aux: string | null };
export type LdParallel = { id: string; kind: "parallel"; branches: LdNode[][] };
/** ST statements in the rung, verbatim: run when the flow in is on (`IF flow THEN … END_IF`), written plain when the rung is open; the flow passes through. */
export type LdStBlock = { id: string; kind: "st"; text: string };
export type LdNode = LdContact | LdCompare | LdTimer | LdCounter | LdParallel | LdStBlock | LdEdge | LdCalc | LdCall | LdRet;
export type LdOutputKind = "coil" | "ncoil" | "set" | "reset";
export type LdOutput = { id: string; kind: LdOutputKind; var: string };
export type LdRung = { id: string; comment: string; items: LdNode[]; outputs: LdOutput[] };
export type LdVar = { name: string; type: LdVarType; address: string | null; init: number | boolean | null; comment?: string };
/** A routine of its own: rungs that run where a CALL runs them, on the program's tags. */
export type LdRoutine = { id: string; name: string; rungs: LdRung[] };
/** `header`: comment lines between PROGRAM and VAR, kept as they were written. `rungs` is Huvudrutin. `seq`: the highest id number ever used, so an id once given is never given to another thing. */
export type LadderProgram = { name: string; vars: LdVar[]; rungs: LdRung[]; header?: string; routines?: LdRoutine[]; seq?: number };

export const MAX_RUNGS = 64;
export const MAX_SERIES = 24;
export const MAX_BRANCHES = 8;
export const MAX_OUTPUTS = 6;
export const MAX_LD_VARS = 96;
export const MAX_COMMENT = 80;
export const MAX_ST_TEXT = 4000;
export const MAX_HEADER = 2000;
export const MAX_VAR_COMMENT = 120;
export const LD_CMP_OPS: readonly LdCmpOp[] = ["=", "<>", "<", ">", "<=", ">="];
export const MAX_ROUTINES = 16;
export const LD_BLOCK_KINDS = ["ton", "tof", "tp", "ctu", "ctd", "r_trig", "f_trig"] as const;
export type LdBlockKind = (typeof LD_BLOCK_KINDS)[number];

/** The words of the ST dialect a variable can never be called, plus the blocks and functions. */
const RESERVED = new Set([
  "PROGRAM", "END_PROGRAM", "VAR", "END_VAR", "AT", "IF", "THEN", "ELSIF", "ELSE", "END_IF", "CASE", "OF", "END_CASE", "AND", "OR", "XOR", "NOT", "MOD", "TRUE", "FALSE",
  "BOOL", "INT", "REAL", "TIME", "TON", "TOF", "TP", "R_TRIG", "F_TRIG", "CTU", "CTD", "PID", "ABS", "SQRT", "MIN", "MAX", "LIMIT", "INT_TO_REAL", "REAL_TO_INT", "TRUNC", "TIME_TO_REAL",
]);
export const isLdName = (name: string) => /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name) && !RESERVED.has(name.toUpperCase());

const name = z.string().refine(isLdName, "Ett namn börjar med en bokstav, har bara bokstäver, siffror och understreck, och är inget reserverat ord.");
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const text = (max: number) => z.string().max(max).refine((value) => !CONTROL.test(value), "Texten har styrtecken.");
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
/** A contact on a variable, or on a bit of a block: T1.Q. */
const BIT_REF = /^([A-Za-z_][A-Za-z0-9_]{0,31})\.Q$/;
export const isLdBit = (text: string) => isLdName(text) || (BIT_REF.test(text) && isLdName(text.slice(0, -2)));
const bit = z.string().refine(isLdBit, "Ett namn, eller en blockutgång som T1.Q.");
const operand: z.ZodType<LdOperand> = z.union([
  z.object({ kind: z.literal("var"), name }).strict(),
  z.object({ kind: z.literal("member"), object: name, field: z.enum(["Q", "ET", "CV"]) }).strict(),
  z.object({ kind: z.literal("const"), value: z.number().finite(), type: z.enum(["INT", "REAL", "TIME"]) }).strict(),
]);
const node: z.ZodType<LdNode> = z.lazy(() => z.union([
  z.object({ id, kind: z.enum(["no", "nc"]), var: bit }).strict(),
  z.object({ id, kind: z.literal("cmp"), op: z.enum(["=", "<>", "<", ">", "<=", ">="]), left: operand, right: operand }).strict(),
  z.object({ id, kind: z.enum(["ton", "tof", "tp"]), name, ptMs: z.number().int().min(0).max(86_400_000) }).strict(),
  z.object({ id, kind: z.enum(["ctu", "ctd"]), name, pv: z.number().int().min(-32_768).max(32_767), aux: name.nullable() }).strict(),
  z.object({ id, kind: z.literal("parallel"), branches: z.array(z.array(node).max(MAX_SERIES)).min(2).max(MAX_BRANCHES) }).strict(),
  z.object({ id, kind: z.literal("st"), text: text(MAX_ST_TEXT) }).strict(),
  z.object({ id, kind: z.enum(["r_trig", "f_trig"]), name }).strict(),
  z.object({ id, kind: z.literal("calc"), op: z.enum(LD_CALC_OPS), a: operand, b: operand.nullable(), dest: name }).strict(),
  z.object({ id, kind: z.literal("call"), routine: name }).strict(),
  z.object({ id, kind: z.literal("ret") }).strict(),
]));
const output = z.object({ id, kind: z.enum(["coil", "ncoil", "set", "reset"]), var: name }).strict();
const rung = z.object({ id, comment: z.string().max(MAX_COMMENT), items: z.array(node).max(MAX_SERIES), outputs: z.array(output).max(MAX_OUTPUTS) }).strict();
const variable = z.object({ name, type: z.enum(["BOOL", "INT", "REAL", "TIME", ...LD_FB_TYPES, ...LD_TAG_BLOCKS]), address: z.string().regex(/^(DI|AI|DO|AO)\d{1,2}$/).nullable(), init: z.union([z.number().finite(), z.boolean()]).nullable(), comment: text(MAX_VAR_COMMENT).optional() }).strict();

const routine = z.object({ id, name, rungs: z.array(rung).max(MAX_RUNGS) }).strict();
export const ladderSchema: z.ZodType<LadderProgram> = z.object({ name, vars: z.array(variable).max(MAX_LD_VARS), rungs: z.array(rung).max(MAX_RUNGS), header: text(MAX_HEADER).optional(), routines: z.array(routine).max(MAX_ROUTINES).optional(), seq: z.number().int().min(0).optional() }).strict();

export const emptyLadder = (): LadderProgram => ({ name: "Ladder", vars: [], rungs: [] });

/** Every node of a rung, depth first, parallels included. */
export function* walkNodes(items: readonly LdNode[]): Generator<LdNode> {
  for (const item of items) {
    yield item;
    if (item.kind === "parallel") for (const branch of item.branches) yield* walkNodes(branch);
  }
}

export const isBlockNode = (node: LdNode): node is LdTimer | LdCounter | LdEdge => node.kind === "ton" || node.kind === "tof" || node.kind === "tp" || node.kind === "ctu" || node.kind === "ctd" || node.kind === "r_trig" || node.kind === "f_trig";
/** Every rung of the program, Huvudrutin first. */
export const allRungs = (program: Pick<LadderProgram, "rungs" | "routines">): LdRung[] => [...program.rungs, ...(program.routines ?? []).flatMap((item) => item.rungs)];
/** The lines of an ST-block as the editor shows them: the first is the box's face, the count its expander. */
export const stBlockLines = (text: string) => text.replace(/\r/g, "").split("\n");

/** The highest number in any id of the program, and in its `seq`. */
export function highestLdId(program: LadderProgram) {
  let highest = program.seq ?? 0;
  const take = (id: string) => { const number = Number(/\d+$/.exec(id)?.[0] ?? 0); if (number > highest) highest = number; };
  for (const item of program.routines ?? []) take(item.id);
  for (const rung of allRungs(program)) {
    take(rung.id);
    for (const node of walkNodes(rung.items)) take(node.id);
    for (const out of rung.outputs) take(out.id);
  }
  return highest;
}
/**
 * A free id for a new rung, element or output: `r3`, `e12`, `o4`. Always a number never used in this program: an id that came
 * back after a removal would make whatever still points at the old thing (a selection, an undo) point at the new one.
 */
export const freeLdId = (prefix: string, program: LadderProgram) => `${prefix}${highestLdId(program) + 1}`;
/** The program with `seq` up to date, so the numbers of what was just removed stay used. */
export const withSeq = (program: LadderProgram): LadderProgram => { const seq = highestLdId(program); return program.seq === seq ? program : { ...program, seq }; };

/** A free block name of a kind: T1, T2 … for timers, C1, C2 … for counters. */
export function freeBlockName(kind: LdBlockKind, program: LadderProgram) {
  const prefix = kind === "ctu" || kind === "ctd" ? "C" : kind === "r_trig" || kind === "f_trig" ? "Flank" : "T";
  const taken = new Set<string>(program.vars.map((variable) => variable.name.toUpperCase()));
  for (const rung of allRungs(program)) for (const node of walkNodes(rung.items)) if (isBlockNode(node)) taken.add(node.name.toUpperCase());
  for (let index = 1; ; index += 1) { const candidate = `${prefix}${index}`; if (!taken.has(candidate.toUpperCase())) return candidate; }
}

/** PT as a person writes it: 2s, 500ms, 1m30s. */
export function ptText(ms: number) {
  if (ms % 60_000 === 0 && ms >= 60_000) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  if (ms > 1000 && ms % 100 === 0) return `${(ms / 1000).toString().replace(".", ",")}s`;
  return `${ms}ms`;
}

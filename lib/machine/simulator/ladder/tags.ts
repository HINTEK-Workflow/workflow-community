import type { Compiled, RunState, Value } from "@/lib/machine/simulator/st/interpreter";
import { allIo, CLOCK_VARS, ioAddressText, ioName, nameIo } from "@/lib/machine/simulator/st/io";
import { allRungs, isLdFbType, type LadderProgram, type LdType, type LdVarType, walkNodes } from "./model";

// PLC-simulatorn, the tag editor (2026-11-04): every name the program has, in one list, each with its data type, its terminal, its
// description and its value now. Timers and counters read as TIMER and COUNTER whichever block a rung gives them. The values come from
// the run. A terminal without a name of its own stands in the list too, so everything the PLC has can be seen in one place.

export type TagScope = "global" | "program";
export type TagKind = "BOOL" | "INT" | "REAL" | "TIME" | "TIMER" | "COUNTER" | "EDGE" | "PID";
export type TagRow = {
  name: string; type: TagKind; alias: string | null; address: string | null; description: string; scope: TagScope;
  /** Declared in the program's table: name, type, alias and description can be changed. */
  declared: boolean;
  /** Not named by the program: a terminal only. */
  unnamed: boolean;
  /** A plain variable the run knows: it can be forced. */
  forceable: boolean;
  /** The value now, while running. */
  value: Value | null;
  /** A block's outputs now, while running. */
  outputs: Readonly<Record<string, Value>> | null;
  forced: Value | null;
};

const blockType = (kind: string): TagKind => (kind === "TON" || kind === "TOF" || kind === "TP" || kind === "TIMER" ? "TIMER" : kind === "CTU" || kind === "CTD" || kind === "COUNTER" ? "COUNTER" : kind === "PID" ? "PID" : "EDGE");

export function tagRows(program: LadderProgram | null, compiled: Compiled | null, run: RunState | null, inputs: { di: readonly boolean[]; ai: readonly number[] }, outputs: { do: readonly boolean[]; ao: readonly number[] }, forces: Readonly<Record<string, Value>>): TagRow[] {
  const rows = new Map<string, TagRow>();
  const live = run !== null;
  const add = (row: Omit<TagRow, "forced" | "value" | "outputs">) => {
    const info = compiled?.vars.get(row.name);
    rows.set(row.name, { ...row, forceable: row.forceable && Boolean(info) && !(row.name.toUpperCase() in CLOCK_VARS), value: live && row.name in run.vars ? run.vars[row.name] : null, outputs: live && run.fbs[row.name] ? run.fbs[row.name].outputs : null, forced: row.name in forces ? forces[row.name] : null });
  };
  for (const variable of program?.vars ?? []) {
    const block = isLdFbType(variable.type) || variable.type === "TIMER" || variable.type === "COUNTER";
    const io = variable.address ? nameIo(variable.address) : null;
    add({ name: variable.name, type: block ? blockType(variable.type) : (variable.type as LdType), alias: variable.address, address: io ? ioAddressText(io) : null, description: variable.comment ?? "", scope: io ? "global" : "program", declared: true, unnamed: false, forceable: !block });
  }
  for (const rung of program ? allRungs(program) : []) for (const node of walkNodes(rung.items)) {
    if ("name" in node && !rows.has(node.name)) add({ name: node.name, type: blockType(node.kind.toUpperCase()), alias: null, address: null, description: "", scope: "program", declared: false, unnamed: false, forceable: false });
  }
  for (const info of compiled?.vars.values() ?? []) {
    if (rows.has(info.name)) continue;
    add({ name: info.name, type: info.type, alias: info.io ? ioName(info.io) : null, address: info.io ? ioAddressText(info.io) : null, description: "", scope: info.io ? "global" : "program", declared: false, unnamed: false, forceable: true });
  }
  for (const [name, kind] of compiled?.fbs ?? []) if (!rows.has(name)) add({ name, type: blockType(kind), alias: null, address: null, description: "", scope: "program", declared: false, unnamed: false, forceable: false });
  const named = new Set([...rows.values()].map((row) => row.alias).filter(Boolean));
  for (const point of allIo()) {
    const name = ioName(point);
    if (rows.has(name) || named.has(name)) continue;
    const value: Value = point.kind === "DI" ? inputs.di[point.index] === true : point.kind === "DO" ? outputs.do[point.index] === true : point.kind === "AI" ? inputs.ai[point.index] ?? 0 : outputs.ao[point.index] ?? 0;
    rows.set(name, { name, type: point.kind === "DI" || point.kind === "DO" ? "BOOL" : "INT", alias: name, address: ioAddressText(point), description: "", scope: "global", declared: false, unnamed: true, forceable: false, value, outputs: null, forced: null });
  }
  return [...rows.values()];
}

/** A value typed in the force column, for a tag of a type: null when it is not one. */
export function typedForce(type: TagKind, text: string): Value | null {
  const trimmed = text.trim().replace(",", ".");
  if (type === "BOOL") return trimmed === "1" || /^true$/i.test(trimmed) ? true : trimmed === "0" || /^false$/i.test(trimmed) ? false : null;
  const value = Number(trimmed);
  if (!trimmed || !Number.isFinite(value)) return null;
  return type === "INT" ? Math.trunc(value) : value;
}

/** The types a tag can be given in the table; a variable of an older block type keeps its own. */
export const TAG_TYPES: readonly LdVarType[] = ["BOOL", "INT", "REAL", "TIME", "TIMER", "COUNTER"];

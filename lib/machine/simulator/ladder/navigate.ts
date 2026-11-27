import type { GeneratedSt, RungLines } from "./generate";
import { allRungs, highestLdId, type LadderProgram, type LdNode, type LdRoutine, type LdRung, walkNodes } from "./model";

// PLC-simulatorn, Ladder (2026-11-04): where the two views of the program meet. What a jump or a marking may trust:
//
// - The cursor names a rung by id, never by number, and an id is never given twice (freeLdId, adoptIds). The old bug: after a
//   removal or a reading back from ST an id came back on another rung, and whatever still held the old id then marked that one.
// - A cursor that has lost its rung becomes null (validCursor), instead of something silently going to the last rung.
// - An ST line finds its rung through the line map, and a rung its lines; the text may have been typed by a person.

export type LdCursor = { routine: string | null; rungId: string; nodeId?: string; outputId?: string } | null;

/** The rungs of the part a cursor stands in. */
const rungsOf = (program: LadderProgram, routine: string | null): readonly LdRung[] | null => (routine === null ? program.rungs : program.routines?.find((item) => item.id === routine)?.rungs ?? null);

/** The cursor if what it points at is still there, the rung alone if only the element went, else null. */
export function validCursor(program: LadderProgram | null, cursor: LdCursor): LdCursor {
  if (!program || !cursor) return null;
  const rung = rungsOf(program, cursor.routine)?.find((item) => item.id === cursor.rungId);
  if (!rung) return null;
  if (cursor.nodeId && ![...walkNodes(rung.items)].some((node) => node.id === cursor.nodeId)) return { routine: cursor.routine, rungId: cursor.rungId };
  if (cursor.outputId && !rung.outputs.some((output) => output.id === cursor.outputId)) return { routine: cursor.routine, rungId: cursor.rungId };
  return cursor;
}

/** The lines a rung has in the text. */
export const linesOfRung = (lines: readonly RungLines[], rungId: string) => lines.find((item) => item.rungId === rungId) ?? null;

/** Which rung a line of the text belongs to: the one holding it; between two rungs, the next one; before the first and in VAR, none. */
export function rungAtLine(lines: readonly RungLines[], line: number): RungLines | null {
  const holding = lines.find((item) => line >= item.from && line <= item.to);
  if (holding) return holding;
  const first = lines[0];
  if (!first || line < first.from) return null;
  return lines.find((item) => item.from > line) ?? null;
}

/** The cursor for a line of the text: the part's id for the routine's name. */
export function cursorAtLine(program: LadderProgram, lines: readonly RungLines[], line: number): LdCursor {
  const found = rungAtLine(lines, line);
  if (!found) return null;
  const routine = found.routine === null ? null : program.routines?.find((item) => item.name === found.routine)?.id ?? null;
  return validCursor(program, { routine, rungId: found.rungId });
}

/** A rung's number in its part, as the margin shows it: 0, 1, 2 … */
export function rungNumber(program: LadderProgram, cursor: LdCursor): number | null {
  if (!cursor) return null;
  const index = rungsOf(program, cursor.routine)?.findIndex((item) => item.id === cursor.rungId) ?? -1;
  return index < 0 ? null : index;
}

// ---------- ids that follow the rungs when the program is read back from ST ----------

/** What a rung says, without its ids: two rungs with the same signature are the same rung. */
export const rungSignature = (rung: LdRung) => JSON.stringify({ comment: rung.comment, items: rung.items, outputs: rung.outputs }, (key, value: unknown) => (key === "id" ? undefined : value));

function commonPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i += 1; j += 1; } else if (table[i + 1][j] >= table[i][j + 1]) i += 1; else j += 1;
  }
  return pairs;
}

const sameNodeIds = (from: readonly LdNode[], to: readonly LdNode[]): LdNode[] => to.map((node, index) => {
  const old = from[index];
  if (node.kind === "parallel" && old?.kind === "parallel") return { ...node, id: old.id, branches: node.branches.map((branch, inner) => sameNodeIds(old.branches[inner] ?? [], branch)) };
  return { ...node, id: old?.id ?? node.id } as LdNode;
});

/**
 * The program read from text carries new ids on every keystroke. This gives each rung that is still there the id it had, and a rung
 * that changed in place (same place between unchanged neighbours) its old id as well, so what the person has marked stays marked;
 * everything really new gets a number never used. Line map and rung order follow.
 */
export function adoptIds(previous: LadderProgram | null, read: LadderProgram, lines: readonly RungLines[]): { ladder: LadderProgram; lines: RungLines[] } {
  let next = previous ? highestLdId(previous) : 0;
  const freshId = (prefix: string) => { next += 1; return `${prefix}${next}`; };
  const renumber = (rung: LdRung, rungId: string | null): LdRung => {
    const nodes = (items: readonly LdNode[]): LdNode[] => items.map((node) => (node.kind === "parallel" ? { ...node, id: freshId("g"), branches: node.branches.map(nodes) } : { ...node, id: freshId("e") }));
    return { id: rungId ?? freshId("r"), comment: rung.comment, items: nodes(rung.items), outputs: rung.outputs.map((output) => ({ ...output, id: freshId("o") })) };
  };
  const renamed = new Map<string, string>();
  const part = (before: readonly LdRung[], after: readonly LdRung[]): LdRung[] => {
    const result: (LdRung | null)[] = after.map(() => null);
    const pairs = commonPairs(before.map(rungSignature), after.map(rungSignature));
    const taken = new Set<number>();
    for (const [i, j] of pairs) {
      const old = before[i];
      taken.add(i);
      result[j] = { ...after[j], id: old.id, items: sameNodeIds(old.items, after[j].items), outputs: after[j].outputs.map((output, index) => ({ ...output, id: old.outputs[index]?.id ?? output.id })) };
    }
    // Between two kept rungs, what is left stands in the same order: the same rung, changed.
    let oldAt = 0;
    after.forEach((rung, j) => {
      if (result[j]) { const keptAt = pairs.find((pair) => pair[1] === j)?.[0]; if (keptAt !== undefined) oldAt = keptAt + 1; return; }
      const nextKept = pairs.find((pair) => pair[1] > j)?.[0] ?? before.length;
      const free = oldAt < nextKept && !taken.has(oldAt) ? oldAt : -1;
      if (free >= 0) { taken.add(free); oldAt = free + 1; }
      result[j] = renumber(rung, free >= 0 ? before[free].id : null);
    });
    after.forEach((rung, j) => renamed.set(rung.id, result[j]!.id));
    return result as LdRung[];
  };
  const main = part(previous?.rungs ?? [], read.rungs);
  const routines: LdRoutine[] | undefined = read.routines?.map((routine) => {
    const old = previous?.routines?.find((item) => item.name === routine.name);
    return { id: old?.id ?? freshId("p"), name: routine.name, rungs: part(old?.rungs ?? [], routine.rungs) };
  });
  const ladder: LadderProgram = { ...read, rungs: main };
  if (routines) ladder.routines = routines; else delete ladder.routines;
  ladder.seq = Math.max(next, highestLdId(ladder));
  return { ladder, lines: lines.map((item) => ({ ...item, rungId: renamed.get(item.rungId) ?? item.rungId })) };
}

// ---------- the edit marks: e, i and r ----------

export type RungMark = "e" | "i";
export type RemovedRung = { routine: string | null; beforeRungId: string | null; comment: string; number: number };
export type EditMarks = { marks: Map<string, RungMark>; removed: RemovedRung[]; changed: boolean };

/** What differs from the accepted program, rung by rung: i a new rung, e a changed one, r one that is gone. Ids do not matter here: the content does. */
export function editMarks(accepted: LadderProgram | null, current: LadderProgram | null): EditMarks {
  const marks = new Map<string, RungMark>();
  const removed: RemovedRung[] = [];
  if (!current) return { marks, removed, changed: false };
  const part = (before: readonly LdRung[], after: readonly LdRung[], routine: string | null) => {
    const pairs = commonPairs(before.map(rungSignature), after.map(rungSignature));
    const gaps: [number, number, number, number][] = [];
    let i0 = 0, j0 = 0;
    for (const [i, j] of [...pairs, [before.length, after.length] as [number, number]]) { gaps.push([i0, i, j0, j]); i0 = i + 1; j0 = j + 1; }
    for (const [i1, i2, j1, j2] of gaps) {
      const both = Math.min(i2 - i1, j2 - j1);
      for (let index = 0; index < j2 - j1; index += 1) marks.set(after[j1 + index].id, index < both ? "e" : "i");
      for (let index = both; index < i2 - i1; index += 1) removed.push({ routine, beforeRungId: after[j2]?.id ?? null, comment: before[i1 + index].comment, number: i1 + index });
    }
  };
  part(accepted?.rungs ?? [], current.rungs, null);
  for (const routine of current.routines ?? []) part(accepted?.routines?.find((item) => item.name === routine.name)?.rungs ?? [], routine.rungs, routine.id);
  for (const routine of accepted?.routines ?? []) if (!current.routines?.some((item) => item.name === routine.name)) routine.rungs.forEach((rung, number) => removed.push({ routine: null, beforeRungId: null, comment: `${routine.name}: ${rung.comment}`, number }));
  return { marks, removed, changed: marks.size > 0 || removed.length > 0 };
}

// ---------- cross reference ----------

export type TagUse = { routine: string | null; rungId: string; number: number; where: string; nodeId?: string; outputId?: string };
const usesIn = (item: LdNode, tag: string): string | null => {
  const eq = (name: string | null | undefined) => name === tag || (name ?? "").startsWith(`${tag}.`);
  const operand = (value: { kind: string; name?: string; object?: string } | null) => value !== null && (value.name === tag || value.object === tag);
  switch (item.kind) {
    case "no": return eq(item.var) ? "Kontakt NO" : null;
    case "nc": return eq(item.var) ? "Kontakt NC" : null;
    case "cmp": return operand(item.left) || operand(item.right) ? "Jämförelse" : null;
    case "calc": return item.dest === tag ? `${item.op} OUT` : operand(item.a) || operand(item.b) ? item.op : null;
    case "ton": case "tof": case "tp": case "r_trig": case "f_trig": return item.name === tag ? item.kind.toUpperCase() : null;
    case "ctu": case "ctd": return item.name === tag ? item.kind.toUpperCase() : item.aux === tag ? `${item.kind.toUpperCase()} R` : null;
    case "st": return new RegExp(`(?<![A-Za-z0-9_])${tag}(?![A-Za-z0-9_])`).test(item.text) ? "ST-block" : null;
    default: return null;
  }
};
/** Every place a tag is used, in the order of the program. */
export function crossReference(program: LadderProgram, tag: string): TagUse[] {
  const uses: TagUse[] = [];
  const part = (rungs: readonly LdRung[], routine: string | null) => rungs.forEach((rung, number) => {
    for (const node of walkNodes(rung.items)) { const where = usesIn(node, tag); if (where) uses.push({ routine, rungId: rung.id, number, where, nodeId: node.id }); }
    for (const output of rung.outputs) if (output.var === tag) uses.push({ routine, rungId: rung.id, number, where: output.kind === "coil" ? "Spole" : output.kind === "ncoil" ? "Negerad spole" : output.kind === "set" ? "Set" : "Reset", outputId: output.id });
  });
  part(program.rungs, null);
  for (const routine of program.routines ?? []) part(routine.rungs, routine.id);
  return uses;
}

// ---------- Verifiera: what the compiler does not see ----------

export type LadderNote = { level: "warning"; text: string; routine: string | null; rungId: string };
export function ladderNotes(program: LadderProgram): LadderNote[] {
  const notes: LadderNote[] = [];
  const coils = new Map<string, number>();
  for (const rung of allRungs(program)) for (const output of rung.outputs) if (output.kind === "coil" || output.kind === "ncoil") coils.set(output.var, (coils.get(output.var) ?? 0) + 1);
  const part = (rungs: readonly LdRung[], routine: string | null) => rungs.forEach((rung, number) => {
    const name = `Rung ${number}`;
    if (!rung.items.length && !rung.outputs.length) notes.push({ level: "warning", text: `${name} är tom.`, routine, rungId: rung.id });
    for (const output of rung.outputs) if ((output.kind === "coil" || output.kind === "ncoil") && (coils.get(output.var) ?? 0) > 1) notes.push({ level: "warning", text: `${name}: spolen ${output.var} skrivs på flera ställen. Den sista gäller.`, routine, rungId: rung.id });
  });
  part(program.rungs, null);
  for (const routine of program.routines ?? []) part(routine.rungs, routine.id);
  return notes;
}

export type { GeneratedSt };

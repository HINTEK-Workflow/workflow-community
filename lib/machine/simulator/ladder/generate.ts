import { CLOCK_VARS, ioAddressText, nameIo } from "@/lib/machine/simulator/st/io";
import { tokenize } from "@/lib/machine/simulator/st/lexer";
import { allRungs, isBlockNode, isLdFbType, type LadderProgram, type LdCalcOp, type LdNode, type LdOperand, type LdRung, type LdVarType, stBlockLines, walkNodes } from "./model";

// PLC-simulatorn, Ladder (2026-11-03: "automatisk generering av ST-kod från Ladder"): the ladder program as readable
// ST in the simulator's own dialect. Deterministic: the same ladder always gives the same text, so the text is regenerated on
// every change. Every rung is one block of statements in the rung's order; a rung's flow is one boolean expression; a timer or
// counter in the flow is called with the flow so far as its IN and continues as its Q. The result is what the PLC runs, through
// the same compiler and interpreter as a hand-written program, so Ladder and ST cannot drift apart.
// An ST-block (2026-11-03, lossless switching) is written out verbatim where it stands in the rung: plain when the rung is open
// up to it, inside IF flow THEN … END_IF when contacts come before it. Its text is the person's, formatted as they wrote it.

export const GENERATED_MARK = "(* Genererad från Ladder. Ändras den här texten läses den tillbaka till Ladder. *)";
/** What the mark said before 2026-11-04, still in saved programs and files. */
export const OLD_GENERATED_MARK = "(* Genererad från Ladder. Ändra i Ladder-vyn; den här texten skrivs om vid varje ändring. *)";
export const isGeneratedSt = (source: string) => source.includes(GENERATED_MARK) || source.includes(OLD_GENERATED_MARK);
const CALC_SIGN: Record<Exclude<LdCalcOp, "MOVE">, string> = { ADD: "+", SUB: "-", MUL: "*", DIV: "/" };

/** A TIME literal's body: 2s, 500ms, 1m30s, 1.5s. */
export function ptLiteral(ms: number) {
  if (ms >= 60_000 && ms % 1000 === 0) { const minutes = Math.floor(ms / 60_000), seconds = (ms % 60_000) / 1000; return `${minutes}m${seconds ? `${seconds}s` : ""}`; }
  if (ms >= 1000 && ms % 100 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

type Expr = { text: string; prec: 0 | 1 | 2 | 3 };
const TRUE: Expr = { text: "TRUE", prec: 3 };
const atom = (text: string): Expr => ({ text, prec: 3 });
const paren = (expr: Expr, min: number): string => (expr.prec < min ? `(${expr.text})` : expr.text);
const and = (a: Expr, b: Expr): Expr => (a.text === "TRUE" ? b : b.text === "TRUE" ? a : { text: `${paren(a, 1)} AND ${paren(b, 1)}`, prec: 1 });
const or = (parts: Expr[]): Expr => (parts.some((part) => part.text === "TRUE") ? TRUE : parts.length === 1 ? parts[0] : { text: parts.map((part) => paren(part, 0)).join(" OR "), prec: 0 });
const not = (expr: Expr): Expr => ({ text: `NOT ${paren(expr, 3)}`, prec: 2 });

export const operandText = (operand: LdOperand) => {
  if (operand.kind === "var") return operand.name;
  if (operand.kind === "member") return `${operand.object}.${operand.field}`;
  if (operand.type === "TIME") return `T#${ptLiteral(operand.value)}`;
  if (operand.type === "REAL") return Number.isInteger(operand.value) ? `${operand.value}.0` : String(operand.value);
  return String(Math.trunc(operand.value));
};

/** A statement that runs when the flow is on. */
const whenOn = (flow: Expr, statement: string) => (flow.text === "TRUE" ? statement : `IF ${flow.text} THEN ${statement} END_IF;`);

function series(items: readonly LdNode[], flowIn: Expr, statements: string[]): Expr {
  let flow = flowIn;
  for (const item of items) {
    switch (item.kind) {
      case "r_trig": case "f_trig":
        statements.push(`${item.name}(CLK := ${flow.text});`);
        flow = atom(`${item.name}.Q`);
        break;
      case "calc":
        statements.push(whenOn(flow, `${item.dest} := ${item.op === "MOVE" || !item.b ? operandText(item.a) : `${operandText(item.a)} ${CALC_SIGN[item.op]} ${operandText(item.b)}`};`));
        break;
      case "call": statements.push(whenOn(flow, `CALL ${item.routine};`)); break;
      case "ret": statements.push(whenOn(flow, "RETURN;")); break;
      case "no": flow = and(flow, atom(item.var)); break;
      case "nc": flow = and(flow, not(atom(item.var))); break;
      case "cmp": flow = and(flow, { text: `${operandText(item.left)} ${item.op} ${operandText(item.right)}`, prec: 2 }); break;
      case "ton": case "tof": case "tp":
        statements.push(`${item.name}(IN := ${flow.text}, PT := T#${ptLiteral(item.ptMs)});`);
        flow = atom(`${item.name}.Q`);
        break;
      case "ctu":
        statements.push(`${item.name}(CU := ${flow.text}, R := ${item.aux ?? "FALSE"}, PV := ${item.pv});`);
        flow = atom(`${item.name}.Q`);
        break;
      case "ctd":
        statements.push(`${item.name}(CD := ${flow.text}, LD := ${item.aux ?? "FALSE"}, PV := ${item.pv});`);
        flow = atom(`${item.name}.Q`);
        break;
      case "st": {
        const text = item.text.replace(/\r/g, "").replace(/\s+$/, "");
        if (!text.trim()) break;
        if (flow.text === "TRUE") statements.push(text);
        else statements.push(`IF ${flow.text} THEN`, ...stBlockLines(text).map((line) => (line.trim() ? `  ${line}` : line)), "END_IF;");
        break;
      }
      case "parallel": {
        const hasBlock = item.branches.some((branch) => [...walkNodes(branch)].some(isBlockNode));
        // Plain contacts: A AND (B OR C). With a block in a branch the block needs the real flow as its IN, so each branch gets it.
        flow = hasBlock ? or(item.branches.map((branch) => series(branch, flow, statements))) : and(flow, or(item.branches.map((branch) => series(branch, TRUE, statements))));
        break;
      }
    }
  }
  return flow;
}

/** The terminal and clock names an ST-block uses, so they are declared like a contact's would be; the person declares the rest. */
function stBlockIoNames(text: string): string[] {
  try {
    return tokenize(text).filter((token) => token.kind === "ident" && (nameIo(token.text) !== null || token.text.toUpperCase() in CLOCK_VARS)).map((token) => token.text);
  } catch { return []; }
}

/** The names a program uses that are terminals by name, the clock, declared variables, blocks, or internal variables. */
export function ladderNames(program: LadderProgram) {
  const bools = new Set<string>(), numbers = new Set<string>(), reals = new Set<string>(), blocks = new Map<string, "TON" | "TOF" | "TP" | "CTU" | "CTD" | "R_TRIG" | "F_TRIG">();
  const takeOperand = (operand: LdOperand) => { if (operand.kind === "var") numbers.add(operand.name); };
  for (const rung of allRungs(program)) {
    for (const node of walkNodes(rung.items)) {
      if (node.kind === "no" || node.kind === "nc") { if (!node.var.includes(".")) bools.add(node.var); }
      else if (node.kind === "calc") {
        takeOperand(node.a);
        if (node.b) takeOperand(node.b);
        numbers.add(node.dest);
        // A sum with a decimal in it, or a division's result the person has not declared, needs room for its decimals.
        if ((node.a.kind === "const" && node.a.type === "REAL") || (node.b?.kind === "const" && node.b.type === "REAL")) reals.add(node.dest);
      }
      else if (node.kind === "cmp") { takeOperand(node.left); takeOperand(node.right); }
      else if (node.kind === "st") { for (const name of stBlockIoNames(node.text)) { const io = nameIo(name); if (io && (io.kind === "DI" || io.kind === "DO")) bools.add(name); else numbers.add(name); } }
      else if (isBlockNode(node)) { blocks.set(node.name, node.kind.toUpperCase() as "TON" | "TOF" | "TP" | "CTU" | "CTD" | "R_TRIG" | "F_TRIG"); if ((node.kind === "ctu" || node.kind === "ctd") && node.aux) bools.add(node.aux); }
    }
    for (const out of rung.outputs) bools.add(out.var);
  }
  return { bools, numbers, reals, blocks };
}

/** A rung's lines in the generated or read text, 1-based, comment included; `routine` null is Huvudrutin. The order is the rungs' order. */
export type RungLines = { routine: string | null; rungId: string; from: number; to: number };
export type GeneratedSt = { text: string; lines: RungLines[] };

export const ladderToSt = (program: LadderProgram): string => generateSt(program).text;

export function generateSt(program: LadderProgram): GeneratedSt {
  const { bools, numbers, reals, blocks } = ladderNames(program);
  const declared = new Map(program.vars.map((variable) => [variable.name, variable]));
  const lines: string[] = [`PROGRAM ${program.name || "Ladder"}`, GENERATED_MARK];
  if (program.header?.trim()) lines.push(...stBlockLines(program.header.replace(/\s+$/, "")));
  lines.push("VAR");
  const typeOfImplicit = (name: string): LdVarType => {
    const io = nameIo(name);
    if (io) return io.kind === "DI" || io.kind === "DO" ? "BOOL" : "INT";
    if (name.toUpperCase() in CLOCK_VARS) return "INT";
    return bools.has(name) ? "BOOL" : reals.has(name) ? "REAL" : "INT";
  };
  const initText = (init: number | boolean | null, type: LdVarType) => (init === null ? "" : typeof init === "boolean" ? ` := ${init ? "TRUE" : "FALSE"}` : ` := ${type === "REAL" && Number.isInteger(init) ? `${init}.0` : type === "TIME" ? `T#${ptLiteral(init)}` : String(init)}`);
  const commentText = (comment: string | undefined) => { const trimmed = comment?.replace(/\s+$/, "").trim(); return trimmed ? `  // ${trimmed.replace(/\r?\n/g, " ")}` : ""; };
  for (const variable of program.vars) {
    // A block drawn in a rung decides its own kind; a declaration of the same name only repeats it.
    if (blocks.has(variable.name)) continue;
    const io = variable.address ? nameIo(variable.address) : null;
    const declaredType = variable.type === "TIMER" ? "TON" : variable.type === "COUNTER" ? "CTU" : variable.type;
    lines.push(`  ${variable.name}${io ? ` AT ${ioAddressText(io)}` : ""} : ${declaredType}${isLdFbType(declaredType) ? "" : initText(variable.init, declaredType)};${commentText(variable.comment)}`);
  }
  const implicit = [...new Set([...bools, ...numbers])].filter((name) => !declared.has(name) && !blocks.has(name));
  const ioFirst = (name: string) => { const io = nameIo(name); return io ? ["DI", "AI", "DO", "AO"].indexOf(io.kind) * 100 + io.index : name.toUpperCase() in CLOCK_VARS ? 500 : 1000; };
  implicit.sort((a, b) => ioFirst(a) - ioFirst(b) || a.localeCompare(b, "sv"));
  for (const name of implicit) lines.push(`  ${name} : ${typeOfImplicit(name)};`);
  for (const [name, kind] of blocks) lines.push(`  ${name} : ${kind};`);
  lines.push("END_VAR");
  const map: RungLines[] = [];
  const writeRung = (rung: LdRung, index: number, routine: string | null) => {
    lines.push("");
    const from = lines.length + 1;
    lines.push(`(* Rung ${index}${rung.comment ? `: ${rung.comment.replace(/\*\)/g, "* )")}` : ""} *)`);
    const statements: string[] = [];
    const flow = series(rung.items, TRUE, statements);
    for (const out of rung.outputs) {
      if (out.kind === "coil") statements.push(`${out.var} := ${flow.text};`);
      else if (out.kind === "ncoil") statements.push(`${out.var} := ${not(flow).text};`);
      else if (flow.text === "TRUE") statements.push(`${out.var} := ${out.kind === "set" ? "TRUE" : "FALSE"};`);
      else statements.push(`IF ${flow.text} THEN ${out.var} := ${out.kind === "set" ? "TRUE" : "FALSE"}; END_IF;`);
    }
    if (!statements.length) statements.push("(* Rungen har ingen utgång. *)");
    lines.push(...statements.flatMap((statement) => statement.split("\n")));
    map.push({ routine, rungId: rung.id, from, to: lines.length });
  };
  program.rungs.forEach((rung, index) => writeRung(rung, index, null));
  for (const routine of program.routines ?? []) {
    lines.push("", `ROUTINE ${routine.name}`);
    routine.rungs.forEach((rung, index) => writeRung(rung, index, routine.name));
    lines.push("END_ROUTINE");
  }
  lines.push("END_PROGRAM");
  return { text: lines.join("\n"), lines: map };
}

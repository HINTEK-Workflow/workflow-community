import type { Expr, Program, Stmt, VarDecl } from "@/lib/machine/simulator/st/ast";
import { ioName, nameIo } from "@/lib/machine/simulator/st/io";
import { StError, type Token, tokenize } from "@/lib/machine/simulator/st/lexer";
import { parseProgram } from "@/lib/machine/simulator/st/parser";
import { GENERATED_MARK, OLD_GENERATED_MARK, type RungLines } from "./generate";
import { isBlockNode, isLdFbType, isLdName, type LadderProgram, type LdBlockKind, type LdCalcOp, type LdFbType, type LdNode, type LdOperand, type LdOutput, type LdRoutine, type LdRung, type LdVar, MAX_COMMENT, MAX_HEADER, MAX_ST_TEXT, MAX_VAR_COMMENT, walkNodes } from "./model";

// PLC-simulatorn, Ladder: an ST program read as rungs without losing a line (2026-11-03: "växla mellan ladder och ST kod
// utan att data förloras"). What has an exact ladder shape is drawn as before – boolean assignments of AND, OR, NOT and
// comparisons, IF … THEN x := TRUE/FALSE as set and reset, and timer or counter calls whose Q the next statement reads – and
// every other statement becomes an ST-block at the same place, verbatim, with its comments. Statements that follow each other
// without a ladder shape share one block. Declarations round-trip with their types and comments; comments between PROGRAM and
// VAR become the program's header. Only a program that does not parse is refused, with the parser's reason.

/** `lines`: where each rung stands in the text, in the rungs' order. */
export type ConvertResult = { ok: true; ladder: LadderProgram; lines: RungLines[] } | { ok: false; reason: string };

type LineSpan = { from: number; to: number };
type Pending = { name: string; node: LdNode; before: LdNode[]; used: boolean; lead: string; trailing: string; step: string; span: LineSpan };
/** A top-level statement's place in the text: its first and last token. */
type Span = { start: Token; end: Token };
/** The text around a statement: comments on the lines before it, the generator's own "Steg N: …" word, the statement itself, and a comment on its own last line. */
type Pieces = { lead: string; step: string; text: string; trailing: string };

class Refused extends Error {}
const refuse = (reason: string): never => { throw new Refused(reason); };
export const NO_OUTPUT_MARK = "(* Rungen har ingen utgång. *)";
const OLD_NO_OUTPUT_MARK = "(* Steget har ingen utgång. *)";
const STEP_MARK = /^\(\*\s*(?:Steg|Rung) \d+(?::\s*(.*?))?\s*\*\)$/;

export function stToLadder(source: string): ConvertResult {
  let program: Program, tokens: Token[];
  try { tokens = tokenize(source); program = parseProgram(source); } catch (error) {
    if (error instanceof StError) return { ok: false, reason: `Programmet går inte att läsa (rad ${error.line}): ${error.message}` };
    throw error;
  }
  try { return { ok: true, ...convert(source, tokens, program) }; } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}

// ---------- the text: where each statement stands, and the comments between them ----------

const isWord = (token: Token, word: string) => token.kind === "keyword" && token.text === word;
const isOp = (token: Token, op: string) => token.kind === "op" && token.text === op;

const isEndRoutine = (token: Token) => token.kind === "ident" && token.text.toUpperCase() === "END_ROUTINE";
const isRoutineWord = (tokens: readonly Token[], at: number) => tokens[at].kind === "ident" && tokens[at].text.toUpperCase() === "ROUTINE" && tokens[at + 1]?.kind === "ident";
/** The top-level statements as token spans, in the order the parser gives them (an empty `;` is no statement there either). */
function statementSpans(tokens: Token[], from: number): { spans: Span[]; end: number } {
  let i = from;
  const spans: Span[] = [];
  while (tokens[i].kind !== "end" && !isWord(tokens[i], "END_PROGRAM") && !isRoutineWord(tokens, i) && !isEndRoutine(tokens[i])) {
    if (isOp(tokens[i], ";")) { i += 1; continue; }
    const start = i;
    if (isWord(tokens[i], "IF") || isWord(tokens[i], "CASE")) {
      const open = tokens[i].text, close = open === "IF" ? "END_IF" : "END_CASE";
      let depth = 0;
      for (; tokens[i].kind !== "end"; i += 1) {
        if (isWord(tokens[i], open)) depth += 1;
        else if (isWord(tokens[i], close)) { depth -= 1; if (depth === 0) { i += 1; break; } }
      }
      if (isOp(tokens[i], ";")) i += 1;
    } else {
      while (tokens[i].kind !== "end" && !isOp(tokens[i], ";")) i += 1;
      if (tokens[i].kind !== "end") i += 1;
    }
    spans.push({ start: tokens[start], end: tokens[i - 1] });
  }
  return { spans, end: i };
}

/** Comment text without its markers: `(* x *)` and `// x` give `x`; several lines are joined with a space. */
export function stripComment(text: string) {
  return text.split("\n").map((line) => line.trim().replace(/^\(\*\s*([\s\S]*?)\s*\*\)$/, "$1").replace(/^\/\/\s?/, "").trim()).filter(Boolean).join(" ");
}
/** True when the text is only comments and blank space. */
export function isCommentOnly(text: string) {
  try { return tokenize(text).length === 1; } catch { return false; }
}
const isGeneratedLine = (line: string) => { const trimmed = line.trim(); return trimmed === GENERATED_MARK || trimmed === OLD_GENERATED_MARK || trimmed === NO_OUTPUT_MARK || trimmed === OLD_NO_OUTPUT_MARK || STEP_MARK.test(trimmed); };
/** The generator's own markers are left out – they are written again on the way back – and so are blank lines at the ends. */
const cleanGap = (text: string) => text.replace(/\r/g, "").split("\n").filter((line) => !isGeneratedLine(line)).join("\n").replace(/^(\s*\n)+/, "").replace(/\s+$/, "");

// ---------- the program ----------

function convert(source: string, tokens: Token[], program: Program): { ladder: LadderProgram; lines: RungLines[] } {
  let nextId = 1;
  const id = (prefix: string) => `${prefix}${nextId++}`;
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === "\n") lineStarts.push(index + 1);
  const offsetOf = (token: Token) => Math.min(source.length, (lineStarts[token.line - 1] ?? source.length) + token.col - 1);
  const endOf = (token: Token) => Math.min(source.length, offsetOf(token) + token.text.length);

  // The header: comments between PROGRAM and the declarations (or the body).
  let i = 0;
  if (isWord(tokens[0], "PROGRAM")) i = 2;
  const headerFrom = i === 0 ? 0 : endOf(tokens[1]);
  const varsFrom = i;
  while (isWord(tokens[i], "VAR")) { while (!isWord(tokens[i], "END_VAR")) i += 1; i += 1; }
  const bodyStart = i;
  const header = cleanGap(source.slice(headerFrom, offsetOf(tokens[varsFrom])));

  // Declarations, each with the comment on its own line.
  const vars: LdVar[] = [];
  const blocks = new Map<string, LdBlockKind>();
  const boolNames = new Set<string>();
  const declComment = (decl: VarDecl) => {
    const at = tokens.findIndex((token) => token.line === decl.line && token.col === decl.col && token.kind === "ident");
    let semicolon = at;
    while (semicolon >= 0 && semicolon < tokens.length && !isOp(tokens[semicolon], ";")) semicolon += 1;
    if (at < 0 || semicolon >= tokens.length) return "";
    const rest = source.slice(endOf(tokens[semicolon])).split("\n")[0] ?? "";
    return rest.trim() && isCommentOnly(rest) ? stripComment(rest).slice(0, MAX_VAR_COMMENT) : "";
  };
  for (const decl of program.vars) takeDecl(decl, declComment(decl), vars, blocks, boolNames);

  const isBool = (name: string) => boolNames.has(name) || nameIo(name)?.kind === "DI" || nameIo(name)?.kind === "DO";

  // One part of the program, Huvudrutin or a routine, statement by statement. Returns where the part's statements end among the tokens.
  const convertPart = (body: Stmt[], partStart: number, routine: string | null): { rungs: LdRung[]; lines: RungLines[]; end: number } => {
  const { spans, end: bodyEnd } = statementSpans(tokens, partStart);
  if (spans.length !== body.length || spans.some((span, index) => span.start.line !== body[index].line || span.start.col !== body[index].col)) refuse("Programmet gick inte att dela upp i satser.");
  const afterDeclarations = partStart === 0 ? 0 : endOf(tokens[partStart - 1]);
  const piecesOf = (index: number): Pieces => {
    const previousEnd = index === 0 ? afterDeclarations : endOf(spans[index - 1].end);
    const gap = source.slice(previousEnd, offsetOf(spans[index].start));
    // A comment on the line the previous statement ended on belongs to that statement; the lines after are this one's.
    const newline = gap.indexOf("\n");
    const lead = index === 0 ? gap : newline < 0 ? "" : gap.slice(newline + 1);
    const text = source.slice(offsetOf(spans[index].start), endOf(spans[index].end)).replace(/\r/g, "");
    const after = source.slice(endOf(spans[index].end), index + 1 < spans.length ? offsetOf(spans[index + 1].start) : offsetOf(tokens[bodyEnd]));
    const sameLine = (after.split("\n")[0] ?? "").replace(/\r/g, "");
    // The generator's "(* Steg 3: Självhållning *)" is the rung's own comment coming back.
    const step = lead.split("\n").map((line) => STEP_MARK.exec(line.trim())).find(Boolean)?.[1] ?? "";
    return { lead: cleanGap(lead), step, text, trailing: sameLine.trim() && isCommentOnly(sameLine) ? sameLine.replace(/\s+$/, "") : "" };
  };

  const rungs: LdRung[] = [];
  const lines: RungLines[] = [];
  // Declared through a cast: the closures below assign it, which the narrowing of a plain \`= null\` would not see.
  let block = null as string[] | null;
  let blockComment = "";
  let blockSpan = null as LineSpan | null;
  let pending: Pending | null = null;

  const closeBlock = () => {
    if (!block) return;
    const text = block.join("\n").replace(/\s+$/, "");
    const comment = blockComment.slice(0, MAX_COMMENT);
    const span = blockSpan;
    block = null; blockComment = ""; blockSpan = null;
    if (text.trim()) {
      const rung: LdRung = { id: id("r"), comment, items: [{ id: id("e"), kind: "st", text: text.slice(0, MAX_ST_TEXT) }], outputs: [] };
      rungs.push(rung);
      lines.push({ routine, rungId: rung.id, from: span?.from ?? 1, to: span?.to ?? 1 });
    }
  };
  /** A rung's one-line comment from the comments around its statement; a lead that does not fit stays verbatim in a block before it. */
  const pushRung = (items: LdNode[], outputs: LdOutput[], lead: string, trailing: string, step: string, span: LineSpan) => {
    const joined = [step, stripComment(lead), stripComment(trailing)].filter(Boolean).join(" – ");
    let comment = joined;
    if (joined.length > MAX_COMMENT) {
      if (lead) { if (block) block.push(lead); else block = [lead]; }
      comment = stripComment(trailing);
    }
    closeBlock();
    const rung: LdRung = { id: id("r"), comment: comment.slice(0, MAX_COMMENT), items, outputs };
    rungs.push(rung);
    lines.push({ routine, rungId: rung.id, from: span.from, to: span.to });
  };
  const flushPending = () => {
    if (!pending) return;
    const { before, node, lead, trailing, step, span } = pending;
    pending = null;
    pushRung([...before, node], [], lead, trailing, step, span);
  };
  const appendBlock = ({ lead, step, text, trailing }: Pieces, span: LineSpan) => {
    const piece = `${lead ? `${lead}\n` : ""}${text}${trailing}`;
    if (block) block.push(piece); else { block = [piece]; blockComment = step; }
    blockSpan = { from: blockSpan?.from ?? span.from, to: span.to };
  };

  const operand = (expr: Expr): LdOperand => {
    if (expr.kind === "var") return { kind: "var", name: expr.name };
    if (expr.kind === "member" && (expr.field === "Q" || expr.field === "ET" || expr.field === "CV")) return { kind: "member", object: expr.object, field: expr.field };
    if (expr.kind === "lit" && typeof expr.value === "number") return { kind: "const", value: expr.value, type: expr.type === "TIME" ? "TIME" : expr.type === "REAL" ? "REAL" : "INT" };
    return refuse("bara variabler, blockutgångar och tal går att jämföra i Ladder");
  };
  /** An expression as a series of nodes: OR a parallel group, AND a series, NOT a breaking contact, the pending block's Q the block itself. */
  const seriesOf = (expr: Expr): LdNode[] => {
    switch (expr.kind) {
      case "lit": return expr.value === true ? [] : refuse("FALSE i ett villkor går inte att rita");
      case "var": return [{ id: id("e"), kind: "no", var: expr.name }];
      case "member": {
        if (expr.field !== "Q") return refuse("bara blockets Q går att rita som kontakt");
        // The block's Q right after its call is the block itself in the rung; read later, it is a contact on that output.
        if (!pending || pending.name !== expr.object || pending.used) return [{ id: id("e"), kind: "no", var: `${expr.object}.Q` }];
        pending.used = true;
        return [...pending.before, pending.node];
      }
      case "unary":
        if (expr.op === "NOT" && expr.expr.kind === "var") return [{ id: id("e"), kind: "nc", var: expr.expr.name }];
        if (expr.op === "NOT" && expr.expr.kind === "member" && expr.expr.field === "Q" && !(pending && pending.name === expr.expr.object && !pending.used)) return [{ id: id("e"), kind: "nc", var: `${expr.expr.object}.Q` }];
        if (expr.op === "NOT" && expr.expr.kind === "binary" && isComparison(expr.expr.op)) return [{ id: id("e"), kind: "cmp", op: negate(expr.expr.op), left: operand(expr.expr.left), right: operand(expr.expr.right) }];
        return refuse("NOT framför ett helt uttryck går inte att rita");
      case "binary":
        if (expr.op === "AND") return [...seriesOf(expr.left), ...seriesOf(expr.right)];
        if (expr.op === "OR") return [{ id: id("e"), kind: "parallel", branches: branchesOf(expr) }];
        if (isComparison(expr.op)) return [{ id: id("e"), kind: "cmp", op: expr.op, left: operand(expr.left), right: operand(expr.right) }];
        return refuse(`${expr.op} går inte att rita i Ladder`);
      case "fn": return refuse(`funktionen ${expr.name} går inte att rita i Ladder`);
    }
  };
  const branchesOf = (expr: Expr): LdNode[][] => (expr.kind === "binary" && expr.op === "OR" ? [...branchesOf(expr.left), ...branchesOf(expr.right)] : [seriesOf(expr)]);
  /** target := a, or a op b, with plain operands: a calculation box. */
  const calcOf = (target: string, expr: Expr): LdNode | null => {
    const op: LdCalcOp | null = expr.kind === "binary" ? ({ "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV" } as const)[expr.op as "+" | "-" | "*" | "/"] ?? null : "MOVE";
    if (!op) return null;
    const plain = (item: Expr) => item.kind === "var" || (item.kind === "member" && (item.field === "ET" || item.field === "CV")) || (item.kind === "lit" && typeof item.value === "number");
    if (expr.kind === "binary") return plain(expr.left) && plain(expr.right) ? { id: id("e"), kind: "calc", op, a: operand(expr.left), b: operand(expr.right), dest: target } : null;
    return plain(expr) ? { id: id("e"), kind: "calc", op: "MOVE", a: operand(expr), b: null, dest: target } : null;
  };
  /** The rung a statement has, or a refusal. The pending block is consumed when the statement reads its Q. */
  const rungOf = (stmt: Stmt): { items: LdNode[]; outputs: LdOutput[] } => {
    if (stmt.kind === "callRoutine") return { items: [{ id: id("e"), kind: "call", routine: stmt.name }], outputs: [] };
    if (stmt.kind === "return") return { items: [{ id: id("e"), kind: "ret" }], outputs: [] };
    if (stmt.kind === "assign") {
      if (!isBool(stmt.target)) { const calc = calcOf(stmt.target, stmt.expr); return calc ? { items: [calc], outputs: [] } : refuse(`${stmt.target} är inte BOOL`); }
      if (stmt.expr.kind === "lit" && stmt.expr.value === false) return { items: [], outputs: [{ id: id("o"), kind: "reset", var: stmt.target }] };
      const negated = stmt.expr.kind === "unary" && stmt.expr.op === "NOT" && stmt.expr.expr.kind !== "var";
      const items = seriesOf(negated && stmt.expr.kind === "unary" ? stmt.expr.expr : stmt.expr);
      return { items, outputs: [{ id: id("o"), kind: negated ? "ncoil" : "coil", var: stmt.target }] };
    }
    if (stmt.kind === "if") {
      if (stmt.branches.length !== 1 || stmt.elseBody || stmt.branches[0].body.length !== 1) return refuse("bara IF villkor THEN x := TRUE/FALSE; END_IF går att rita");
      const inner = stmt.branches[0].body[0];
      if (inner.kind === "callRoutine") return { items: [...seriesOf(stmt.branches[0].cond), { id: id("e"), kind: "call", routine: inner.name }], outputs: [] };
      if (inner.kind === "return") return { items: [...seriesOf(stmt.branches[0].cond), { id: id("e"), kind: "ret" }], outputs: [] };
      if (inner.kind === "assign" && !isBool(inner.target)) {
        const items = seriesOf(stmt.branches[0].cond);
        const calc = calcOf(inner.target, inner.expr);
        return calc ? { items: [...items, calc], outputs: [] } : refuse("bara IF villkor THEN x := a + b; END_IF går att rita");
      }
      if (inner.kind !== "assign" || inner.expr.kind !== "lit" || typeof inner.expr.value !== "boolean" || !isBool(inner.target)) return refuse("bara IF villkor THEN x := TRUE/FALSE; END_IF går att rita");
      return { items: seriesOf(stmt.branches[0].cond), outputs: [{ id: id("o"), kind: inner.expr.value ? "set" : "reset", var: inner.target }] };
    }
    return refuse("satsen har ingen Ladder-form");
  };
  /** A timer or counter call as a block waiting for the statement that reads its Q. */
  const pendingOf = (stmt: Extract<Stmt, { kind: "call" }>, pieces: Pieces, span: LineSpan): Pending => {
    const kind = blocks.get(stmt.name);
    if (!kind) return refuse(`${stmt.name} är inte TON, TOF, TP, CTU, CTD, R_TRIG eller F_TRIG`);
    const arg = (name: string) => stmt.args.find((candidate) => candidate.param === name)?.expr;
    const flowArg = arg(kind === "ctu" ? "CU" : kind === "ctd" ? "CD" : kind === "r_trig" || kind === "f_trig" ? "CLK" : "IN");
    if (!flowArg) return refuse(`${stmt.name} saknar sin ingång`);
    let node: LdNode;
    if (kind === "r_trig" || kind === "f_trig") {
      if (stmt.args.length !== 1) return refuse("bara CLK går att rita");
      node = { id: id("e"), kind, name: stmt.name };
    } else if (kind === "ton" || kind === "tof" || kind === "tp") {
      const pt = arg("PT");
      if (!pt || pt.kind !== "lit" || pt.type !== "TIME" || typeof pt.value !== "number") return refuse("PT måste vara en tid som T#2s");
      if (stmt.args.length !== 2) return refuse("bara IN och PT går att rita");
      node = { id: id("e"), kind, name: stmt.name, ptMs: pt.value };
    } else {
      const pv = arg("PV"), aux = arg(kind === "ctu" ? "R" : "LD");
      if (pv && (pv.kind !== "lit" || typeof pv.value !== "number")) return refuse("PV måste vara ett tal");
      if (aux && !(aux.kind === "var" || (aux.kind === "lit" && aux.value === false))) return refuse("R/LD måste vara en variabel eller FALSE");
      if (stmt.args.some((candidate) => !["CU", "CD", "R", "LD", "PV"].includes(candidate.param))) return refuse("bara CU/CD, R/LD och PV går att rita");
      node = { id: id("e"), kind, name: stmt.name, pv: pv && pv.kind === "lit" ? Math.trunc(pv.value as number) : 0, aux: aux?.kind === "var" ? aux.name : null };
    }
    const before = seriesOf(flowArg);
    const chained = pending?.used ? pending : null;
    return { name: stmt.name, node, before, used: false, lead: [chained?.lead, pieces.lead].filter(Boolean).join("\n"), trailing: chained?.trailing || pieces.trailing, step: chained?.step || pieces.step, span: { from: chained?.span.from ?? span.from, to: span.to } };
  };

  body.forEach((stmt, index) => {
    const pieces = piecesOf(index);
    const span: LineSpan = { from: spans[index].start.line, to: spans[index].end.line };
    // A block nobody reads next runs where it stands, as a rung without an output.
    if (pending && !readsQ(stmt, pending.name)) flushPending();
    const idsBefore = nextId;
    try {
      if (stmt.kind === "call") { pending = pendingOf(stmt, pieces, span); return; }
      const rung = rungOf(stmt);
      const consumed = pending?.used ? pending : null;
      // The Q was read some other way (inside a comparison): the call still has to run first.
      if (pending && !consumed) flushPending();
      pending = null;
      pushRung(rung.items, rung.outputs, [consumed?.lead, pieces.lead].filter(Boolean).join("\n"), consumed?.trailing || pieces.trailing, consumed?.step || pieces.step, { from: consumed?.span.from ?? span.from, to: span.to });
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      // Not ladder: the ids given on the way are taken back, a pending block runs before this statement, the text stays as it is.
      nextId = idsBefore;
      if (pending) { pending.used = false; flushPending(); }
      appendBlock(pieces, span);
    }
  });
  flushPending();
  // Comments after the last statement stay too.
  const lastEnd = spans.length ? endOf(spans[spans.length - 1].end) : afterDeclarations;
  const tailAll = source.slice(lastEnd, offsetOf(tokens[bodyEnd])).replace(/\r/g, "");
  const tailNewline = tailAll.indexOf("\n");
  const tail = cleanGap(spans.length && tailNewline >= 0 ? tailAll.slice(tailNewline + 1) : spans.length ? "" : tailAll);
  if (tail && isCommentOnly(tail)) { if (block) block.push(tail); else block = [tail]; blockSpan ??= { from: tokens[bodyEnd].line, to: tokens[bodyEnd].line }; }
  closeBlock();
  return { rungs, lines, end: bodyEnd };
  };

  const main = convertPart(program.body, bodyStart, null);
  const routines: LdRoutine[] = [];
  const lines = [...main.lines];
  let at = main.end;
  for (const routine of program.routines) {
    // ROUTINE name … END_ROUTINE [;]
    if (!isRoutineWord(tokens, at)) refuse("Programmet gick inte att dela upp i rutiner.");
    const part = convertPart(routine.body, at + 2, routine.name);
    at = part.end + 1;
    if (isOp(tokens[at], ";")) at += 1;
    routines.push({ id: id("p"), name: routine.name, rungs: part.rungs });
    lines.push(...part.lines);
  }

  // A block drawn as a node needs no declaration of its own.
  const drawn = new Set<string>();
  for (const rung of [...main.rungs, ...routines.flatMap((item) => item.rungs)]) for (const node of walkNodes(rung.items)) if (isBlockNode(node)) drawn.add(node.name);
  const kept = vars.filter((variable) => !(isLdFbType(variable.type) && drawn.has(variable.name)));
  const ladder: LadderProgram = { name: program.name && isLdName(program.name) ? program.name : "Ladder", vars: kept, rungs: main.rungs };
  if (routines.length) ladder.routines = routines;
  if (header) ladder.header = header.slice(0, MAX_HEADER);
  return { ladder, lines };
}

/** Whether a statement reads `name.Q` anywhere. */
function readsQ(stmt: Stmt, name: string): boolean {
  const inExpr = (expr: Expr): boolean => {
    switch (expr.kind) {
      case "member": return expr.object === name && expr.field === "Q";
      case "unary": return inExpr(expr.expr);
      case "binary": return inExpr(expr.left) || inExpr(expr.right);
      case "fn": return expr.args.some(inExpr);
      default: return false;
    }
  };
  switch (stmt.kind) {
    case "assign": return inExpr(stmt.expr);
    case "if": return stmt.branches.some((branch) => inExpr(branch.cond) || branch.body.some((inner) => readsQ(inner, name))) || (stmt.elseBody ?? []).some((inner) => readsQ(inner, name));
    case "case": return inExpr(stmt.expr) || stmt.cases.some((item) => item.body.some((inner) => readsQ(inner, name))) || (stmt.elseBody ?? []).some((inner) => readsQ(inner, name));
    case "call": return stmt.args.some((arg) => inExpr(arg.expr));
    default: return false;
  }
}

const isComparison = (op: string): op is "=" | "<>" | "<" | ">" | "<=" | ">=" => ["=", "<>", "<", ">", "<=", ">="].includes(op);
const negate = (op: "=" | "<>" | "<" | ">" | "<=" | ">="): "=" | "<>" | "<" | ">" | "<=" | ">=" => ({ "=": "<>", "<>": "=", "<": ">=", ">": "<=", "<=": ">", ">=": "<" } as const)[op];

function takeDecl(decl: VarDecl, comment: string, vars: LdVar[], blocks: Map<string, LdBlockKind>, boolNames: Set<string>) {
  const upper = decl.type.toUpperCase();
  if (!isLdName(decl.name)) refuse(`Rad ${decl.line}: namnet ${decl.name} går inte att använda i Ladder.`);
  if (isLdFbType(upper)) {
    if (upper === "TON" || upper === "TOF" || upper === "TP" || upper === "CTU" || upper === "CTD" || upper === "R_TRIG" || upper === "F_TRIG") blocks.set(decl.name, upper.toLowerCase() as LdBlockKind);
    vars.push({ name: decl.name, type: upper as LdFbType, address: null, init: null, ...(comment ? { comment } : {}) });
    return;
  }
  const type = decl.type as LdVar["type"];
  if (type === "BOOL") boolNames.add(decl.name);
  const address = decl.address ? nameIoOfAddress(decl.address.dir, decl.address.size, decl.address.byte, decl.address.bit) : null;
  const init = decl.init ? decl.init.value : null;
  // A variable named like its terminal, of the terminal's own type and without a word of its own, needs no row: the generator declares it by itself.
  const terminalType = address ? (nameIo(address)?.kind === "DI" || nameIo(address)?.kind === "DO" ? "BOOL" : "INT") : null;
  if (address && decl.name === address && init === null && !comment && type === terminalType) return;
  vars.push({ name: decl.name, type, address: address && decl.name === address ? null : address, init, ...(comment ? { comment } : {}) });
}

function nameIoOfAddress(dir: "I" | "Q", size: "X" | "W", byte: number, bit: number | null): string | null {
  const kind = dir === "I" ? (size === "X" ? "DI" : "AI") : size === "X" ? "DO" : "AO";
  const index = size === "X" ? byte * 8 + (bit ?? 0) : byte;
  const io = nameIo(ioName({ kind, index }));
  return io ? ioName(io) : null;
}

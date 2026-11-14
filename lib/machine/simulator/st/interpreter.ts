import { type Expr, type FbKind, isFbKind, type Program, type Routine, type Stmt, type StType } from "./ast";
import { createFbState, FB_SIGNATURES, stepFb, type FbState, type FbValue } from "./blocks";
import { addressIo, CLOCK_VARS, emptyOutputs, ioName, nameIo, type IoPoint, type PlcInputs, type PlcOutputs } from "./io";
import { StError } from "./lexer";
import { parseProgram } from "./parser";

// PLC-simulatorn: the compiler (type check and address binding) and the cycle interpreter of the ST dialect. Own
// implementation. A program that does not compile never runs; a runtime fault (division by zero) stops the run with its line.
// Types: INT widens to REAL on its own; REAL to INT needs REAL_TO_INT or TRUNC, so a truncation is always visible in the code.

export type Value = number | boolean;
export type VarInfo = { name: string; type: StType; io: IoPoint | null; init: Value };
export type Compiled = { program: Program; vars: Map<string, VarInfo>; fbs: Map<string, FbKind>; routines: Map<string, Routine>; usedInputs: IoPoint[]; usedOutputs: IoPoint[] };
export type CompileProblem = { message: string; line: number; col: number };
export type CompileResult = { ok: true; compiled: Compiled } | { ok: false; problem: CompileProblem };

export type RunState = { vars: Record<string, Value>; fbs: Record<string, FbState> };
export type RunResult = { state: RunState; outputs: PlcOutputs; problem: CompileProblem | null };

const FUNCTIONS: Record<string, { arity: [number, number]; result: (args: StType[]) => StType | null }> = {
  ABS: { arity: [1, 1], result: ([a]) => (a === "INT" || a === "REAL" ? a : null) },
  SQRT: { arity: [1, 1], result: ([a]) => (a === "INT" || a === "REAL" ? "REAL" : null) },
  MIN: { arity: [2, 8], result: (args) => (args.every((a) => a === "INT" || a === "REAL") ? (args.includes("REAL") ? "REAL" : "INT") : null) },
  MAX: { arity: [2, 8], result: (args) => (args.every((a) => a === "INT" || a === "REAL") ? (args.includes("REAL") ? "REAL" : "INT") : null) },
  LIMIT: { arity: [3, 3], result: (args) => (args.every((a) => a === "INT" || a === "REAL") ? (args.includes("REAL") ? "REAL" : "INT") : null) },
  INT_TO_REAL: { arity: [1, 1], result: ([a]) => (a === "INT" ? "REAL" : null) },
  REAL_TO_INT: { arity: [1, 1], result: ([a]) => (a === "REAL" ? "INT" : null) },
  TRUNC: { arity: [1, 1], result: ([a]) => (a === "REAL" ? "INT" : null) },
  TIME_TO_REAL: { arity: [1, 1], result: ([a]) => (a === "TIME" ? "REAL" : null) },
};
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

const numeric = (type: StType) => type === "INT" || type === "REAL";
const defaultValue = (type: StType): Value => (type === "BOOL" ? false : 0);
const fail = (message: string, at: { line: number; col: number }): never => { throw new StError(message, at.line, at.col); };

function assignable(target: StType, source: StType) {
  return target === source || (target === "REAL" && source === "INT");
}

/** Remembered per node once checked, so a cycle never type-checks again. */
const TYPES = new WeakMap<Expr, StType>();

function typeOf(expr: Expr, vars: Map<string, VarInfo>, fbs: Map<string, FbKind>): StType {
  const known = TYPES.get(expr);
  if (known) return known;
  const type = typeOfUncached(expr, vars, fbs);
  TYPES.set(expr, type);
  return type;
}

function typeOfUncached(expr: Expr, vars: Map<string, VarInfo>, fbs: Map<string, FbKind>): StType {
  switch (expr.kind) {
    case "lit": return expr.type;
    case "var": {
      const info = vars.get(expr.name);
      if (info) return info.type;
      if (fbs.has(expr.name)) return fail(`${expr.name} är ett block. Läs dess utgång, till exempel ${expr.name}.Q.`, expr);
      return fail(`${expr.name} är inte deklarerad i VAR.`, expr);
    }
    case "member": {
      const kind = fbs.get(expr.object);
      if (!kind) return fail(vars.has(expr.object) ? `${expr.object} är en variabel och har inga fält.` : `${expr.object} är inte deklarerad i VAR.`, expr);
      const type = FB_SIGNATURES[kind].outputs[expr.field];
      if (!type) return fail(`${kind} har ingen utgång ${expr.field}. Utgångar: ${Object.keys(FB_SIGNATURES[kind].outputs).join(", ")}.`, expr);
      return type;
    }
    case "unary": {
      const inner = typeOf(expr.expr, vars, fbs);
      if (expr.op === "NOT") return inner === "BOOL" ? "BOOL" : fail("NOT behöver ett BOOL-värde.", expr);
      return numeric(inner) ? inner : fail("Minus behöver ett tal.", expr);
    }
    case "binary": {
      const left = typeOf(expr.left, vars, fbs);
      const right = typeOf(expr.right, vars, fbs);
      const { op } = expr;
      if (op === "AND" || op === "OR" || op === "XOR") return left === "BOOL" && right === "BOOL" ? "BOOL" : fail(`${op} behöver två BOOL-värden.`, expr);
      if (op === "=" || op === "<>") {
        if ((numeric(left) && numeric(right)) || left === right) return "BOOL";
        return fail(`Jämförelsen blandar ${left} och ${right}.`, expr);
      }
      if (op === "<" || op === ">" || op === "<=" || op === ">=") {
        if ((numeric(left) && numeric(right)) || (left === "TIME" && right === "TIME")) return "BOOL";
        return fail(`${op} jämför tal eller tider, inte ${left} och ${right}.`, expr);
      }
      if (op === "MOD") return left === "INT" && right === "INT" ? "INT" : fail("MOD behöver två INT.", expr);
      if ((op === "+" || op === "-") && left === "TIME" && right === "TIME") return "TIME";
      if (numeric(left) && numeric(right)) return left === "REAL" || right === "REAL" ? "REAL" : "INT";
      return fail(`${op} räknar med tal, inte ${left} och ${right}.`, expr);
    }
    case "fn": {
      const definition = FUNCTIONS[expr.name];
      if (!definition) return fail(`Okänd funktion: ${expr.name}. Funktioner: ${FUNCTION_NAMES.join(", ")}.`, expr);
      const [min, max] = definition.arity;
      if (expr.args.length < min || expr.args.length > max) return fail(`${expr.name} tar ${min === max ? min : `${min}–${max}`} argument.`, expr);
      const result = definition.result(expr.args.map((arg) => typeOf(arg, vars, fbs)));
      return result ?? fail(`${expr.name} kan inte ta de här typerna.`, expr);
    }
  }
}

function checkStmts(stmts: Stmt[], vars: Map<string, VarInfo>, fbs: Map<string, FbKind>, routines: ReadonlyMap<string, Routine>) {
  for (const stmt of stmts) {
    if (stmt.kind === "return") continue;
    if (stmt.kind === "callRoutine") {
      if (!routines.has(stmt.name)) fail(`Rutinen ${stmt.name} finns inte.`, stmt);
      continue;
    }
    if (stmt.kind === "assign") {
      const info = vars.get(stmt.target);
      if (!info) return fail(fbs.has(stmt.target) ? `${stmt.target} är ett block och anropas med parenteser.` : `${stmt.target} är inte deklarerad i VAR.`, stmt);
      if (info.io && (info.io.kind === "DI" || info.io.kind === "AI")) fail(`${stmt.target} är en ingång (${ioName(info.io)}) och kan inte tilldelas.`, stmt);
      if (stmt.target.toUpperCase() in CLOCK_VARS) fail(`${stmt.target} är klockan och kan inte tilldelas.`, stmt);
      const source = typeOf(stmt.expr, vars, fbs);
      if (!assignable(info.type, source)) fail(source === "REAL" && info.type === "INT" ? `${stmt.target} är INT och får ett REAL. Använd REAL_TO_INT eller TRUNC.` : `${stmt.target} är ${info.type} och får ett ${source}.`, stmt);
    } else if (stmt.kind === "if") {
      for (const branch of stmt.branches) {
        if (typeOf(branch.cond, vars, fbs) !== "BOOL") fail("Villkoret efter IF måste vara BOOL.", branch.cond);
        checkStmts(branch.body, vars, fbs, routines);
      }
      if (stmt.elseBody) checkStmts(stmt.elseBody, vars, fbs, routines);
    } else if (stmt.kind === "case") {
      const type = typeOf(stmt.expr, vars, fbs);
      if (type !== "INT" && type !== "BOOL") fail("CASE väljer på ett INT eller BOOL.", stmt.expr);
      for (const branch of stmt.cases) {
        for (const value of branch.values) {
          const valueType = typeof value === "boolean" ? "BOOL" : "INT";
          if (valueType !== type) fail(`CASE-värdet passar inte: uttrycket är ${type}.`, stmt);
        }
        checkStmts(branch.body, vars, fbs, routines);
      }
      if (stmt.elseBody) checkStmts(stmt.elseBody, vars, fbs, routines);
    } else {
      const kind = fbs.get(stmt.name);
      if (!kind) return fail(vars.has(stmt.name) ? `${stmt.name} är en variabel, inte ett block.` : `${stmt.name} är inte deklarerad i VAR.`, stmt);
      const signature = FB_SIGNATURES[kind];
      const given = new Set<string>();
      for (const arg of stmt.args) {
        const expected = signature.inputs[arg.param];
        if (!expected) fail(`${kind} har ingen ingång ${arg.param}. Ingångar: ${Object.keys(signature.inputs).join(", ")}.`, arg.expr);
        if (given.has(arg.param)) fail(`${arg.param} anges två gånger.`, arg.expr);
        given.add(arg.param);
        const actual = typeOf(arg.expr, vars, fbs);
        if (!assignable(expected, actual)) fail(`${arg.param} på ${kind} är ${expected}, inte ${actual}.`, arg.expr);
      }
      for (const name of signature.required) if (!given.has(name)) fail(`${kind} behöver ${name}.`, stmt);
    }
  }
}

/** A routine that reaches itself would never end a cycle: it does not compile. */
function checkRecursion(program: Program, routines: ReadonlyMap<string, Routine>) {
  const callsIn = (stmts: readonly Stmt[]): { name: string; at: Stmt }[] => stmts.flatMap((stmt) => {
    if (stmt.kind === "callRoutine") return [{ name: stmt.name, at: stmt }];
    if (stmt.kind === "if") return [...stmt.branches.flatMap((branch) => callsIn(branch.body)), ...callsIn(stmt.elseBody ?? [])];
    if (stmt.kind === "case") return [...stmt.cases.flatMap((branch) => callsIn(branch.body)), ...callsIn(stmt.elseBody ?? [])];
    return [];
  });
  const visit = (name: string, path: readonly string[]) => {
    for (const call of callsIn(routines.get(name)?.body ?? [])) {
      if (path.includes(call.name) || call.name === name) fail(`Rutinen ${name} anropar sig själv genom ${call.name}. Det går inte.`, call.at);
      visit(call.name, [...path, name]);
    }
  };
  for (const routine of program.routines) visit(routine.name, []);
}

/** Parses, binds every variable to a type and a terminal, and checks every statement. Nothing runs before this says ok. */
export function compileProgram(source: string): CompileResult {
  try {
    const program = parseProgram(source);
    const vars = new Map<string, VarInfo>();
    const fbs = new Map<string, FbKind>();
    const taken = new Map<string, string>();
    for (const decl of program.vars) {
      const upper = decl.name.toUpperCase();
      if (vars.has(decl.name) || fbs.has(decl.name)) fail(`${decl.name} är deklarerad två gånger.`, decl);
      if (isFbKind(upper) || upper in FUNCTIONS) fail(`${decl.name} är ett reserverat namn.`, decl);
      if (isFbKind(decl.type)) {
        if (decl.address) fail("Ett block har ingen adress.", decl);
        if (decl.init) fail("Ett block har inget startvärde.", decl);
        fbs.set(decl.name, decl.type);
        continue;
      }
      const type = decl.type;
      let io: IoPoint | null = null;
      if (upper in CLOCK_VARS) {
        if (type !== "INT" || decl.address) fail(`${decl.name} är klockan: deklarera den som INT utan adress.`, decl);
      } else if (decl.address) {
        io = addressIo(decl.address);
        if (!io) fail("Den adressen finns inte på den här PLC:n.", decl);
      } else io = nameIo(decl.name);
      if (io) {
        const expected: StType = io.kind === "DI" || io.kind === "DO" ? "BOOL" : "INT";
        if (type !== expected) fail(`${ioName(io)} är ${expected === "BOOL" ? "digital och BOOL" : "analog och INT (0–10000 för 0–10 V)"}.`, decl);
        const key = ioName(io);
        const other = taken.get(key);
        if (other) fail(`${key} används redan av ${other}.`, decl);
        taken.set(key, decl.name);
      }
      let init: Value = defaultValue(type);
      if (decl.init) {
        if (!assignable(type, decl.init.type)) fail(`Startvärdet är ${decl.init.type}, variabeln ${type}.`, decl.init);
        init = decl.init.value;
      }
      vars.set(decl.name, { name: decl.name, type, io, init });
    }
    for (const [name] of fbs) if (vars.has(name)) fail(`${name} är deklarerad två gånger.`, program.vars.find((decl) => decl.name === name)!);
    const routines = new Map<string, Routine>();
    for (const routine of program.routines) {
      if (routines.has(routine.name)) fail(`Rutinen ${routine.name} finns två gånger.`, routine);
      routines.set(routine.name, routine);
    }
    checkStmts(program.body, vars, fbs, routines);
    for (const routine of program.routines) checkStmts(routine.body, vars, fbs, routines);
    checkRecursion(program, routines);
    const points = [...vars.values()].map((info) => info.io).filter((io): io is IoPoint => io !== null);
    return { ok: true, compiled: { program, vars, fbs, routines, usedInputs: points.filter((io) => io.kind === "DI" || io.kind === "AI"), usedOutputs: points.filter((io) => io.kind === "DO" || io.kind === "AO") } };
  } catch (error) {
    if (error instanceof StError) return { ok: false, problem: { message: error.message, line: error.line, col: error.col } };
    throw error;
  }
}

/** The run going on with a new program (Verifiera in RUN): what has the same name and kind keeps its value, the rest starts fresh. */
export function carryRunState(compiled: Compiled, previous: RunState, before: Compiled): RunState {
  const next = createRunState(compiled);
  for (const name of Object.keys(next.vars)) if (compiled.vars.get(name)?.type === before.vars.get(name)?.type && name in previous.vars) next.vars[name] = previous.vars[name];
  for (const name of Object.keys(next.fbs)) if (compiled.fbs.get(name) === before.fbs.get(name) && previous.fbs[name]) next.fbs[name] = previous.fbs[name];
  return next;
}

export function createRunState(compiled: Compiled): RunState {
  const vars: Record<string, Value> = {};
  for (const info of compiled.vars.values()) vars[info.name] = info.init;
  const fbs: Record<string, FbState> = {};
  for (const [name, kind] of compiled.fbs) fbs[name] = createFbState(kind);
  return { vars, fbs };
}

const trunc = (value: number) => (value < 0 ? Math.ceil(value) : Math.floor(value));
const asNumber = (value: Value) => (typeof value === "number" ? value : value ? 1 : 0);

function evaluate(expr: Expr, state: RunState, compiled: Compiled): Value {
  switch (expr.kind) {
    case "lit": return expr.value;
    case "var": return state.vars[expr.name];
    case "member": return state.fbs[expr.object].outputs[expr.field];
    case "unary": {
      const inner = evaluate(expr.expr, state, compiled);
      return expr.op === "NOT" ? !inner : -asNumber(inner);
    }
    case "binary": {
      const { op } = expr;
      // AND and OR stop early, as every programmer expects of them.
      if (op === "AND") return evaluate(expr.left, state, compiled) === true && evaluate(expr.right, state, compiled) === true;
      if (op === "OR") return evaluate(expr.left, state, compiled) === true || evaluate(expr.right, state, compiled) === true;
      const left = evaluate(expr.left, state, compiled);
      const right = evaluate(expr.right, state, compiled);
      if (op === "XOR") return left !== right;
      if (op === "=") return left === right;
      if (op === "<>") return left !== right;
      const a = asNumber(left), b = asNumber(right);
      const integer = typeOfValue(expr.left, compiled) === "INT" && typeOfValue(expr.right, compiled) === "INT";
      switch (op) {
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        case ">=": return a >= b;
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": if (b === 0) fail("Division med noll.", expr); return integer ? trunc(a / b) : a / b;
        case "MOD": if (b === 0) fail("MOD med noll.", expr); return a % b;
      }
      return fail("Okänd operator.", expr);
    }
    case "fn": {
      const args = expr.args.map((arg) => asNumber(evaluate(arg, state, compiled)));
      switch (expr.name) {
        case "ABS": return Math.abs(args[0]);
        case "SQRT": if (args[0] < 0) fail("SQRT av ett negativt tal.", expr); return Math.sqrt(args[0]);
        case "MIN": return Math.min(...args);
        case "MAX": return Math.max(...args);
        case "LIMIT": return Math.min(args[2], Math.max(args[0], args[1]));
        case "INT_TO_REAL": return args[0];
        case "REAL_TO_INT": return Math.round(args[0]);
        case "TRUNC": return trunc(args[0]);
        case "TIME_TO_REAL": return args[0] / 1000;
      }
      return fail(`Okänd funktion: ${expr.name}`, expr);
    }
  }
}

/** The static type of an expression once compiled: a lookup, since the check already saw every node. */
const typeOfValue = (expr: Expr, compiled: Compiled): StType => TYPES.get(expr) ?? typeOf(expr, compiled.vars, compiled.fbs);

function matches(value: Value, candidates: readonly (number | boolean | { from: number; to: number })[]) {
  return candidates.some((candidate) => (typeof candidate === "object" ? typeof value === "number" && value >= candidate.from && value <= candidate.to : candidate === value));
}

/** True when a RETURN ended the part it runs in. A forced variable is never written by the program. */
function execute(stmts: Stmt[], state: RunState, compiled: Compiled, dtMs: number, forces: Readonly<Record<string, Value>> | undefined): boolean {
  for (const stmt of stmts) {
    if (stmt.kind === "return") return true;
    if (stmt.kind === "callRoutine") {
      execute(compiled.routines.get(stmt.name)!.body, state, compiled, dtMs, forces);
    } else if (stmt.kind === "assign") {
      const value = evaluate(stmt.expr, state, compiled);
      const type = compiled.vars.get(stmt.target)!.type;
      if (!forces || !(stmt.target in forces)) state.vars[stmt.target] = type === "INT" && typeof value === "number" ? trunc(value) : value;
    } else if (stmt.kind === "if") {
      const branch = stmt.branches.find((candidate) => evaluate(candidate.cond, state, compiled) === true);
      const body = branch ? branch.body : stmt.elseBody;
      if (body && execute(body, state, compiled, dtMs, forces)) return true;
    } else if (stmt.kind === "case") {
      const value = evaluate(stmt.expr, state, compiled);
      const branch = stmt.cases.find((candidate) => matches(value, candidate.values));
      const body = branch ? branch.body : stmt.elseBody;
      if (body && execute(body, state, compiled, dtMs, forces)) return true;
    } else {
      const inputs: Record<string, FbValue> = {};
      for (const arg of stmt.args) inputs[arg.param] = evaluate(arg.expr, state, compiled);
      state.fbs[stmt.name] = stepFb(compiled.fbs.get(stmt.name)!, state.fbs[stmt.name], inputs, dtMs);
    }
  }
  return false;
}

/**
 * One cycle: the inputs are read into their variables, the body runs once, the output variables are written out. `forces` (2026-11-04,
 * the tag editor in RUN): a forced variable holds its value through the whole cycle, an input over what the terminal reads and an
 * output over what the program says, and goes out on its terminal as such.
 */
export function runCycle(compiled: Compiled, stateIn: RunState, inputs: PlcInputs, dtMs: number, forces?: Readonly<Record<string, Value>>): RunResult {
  const state: RunState = { vars: { ...stateIn.vars }, fbs: { ...stateIn.fbs } };
  for (const info of compiled.vars.values()) {
    const clockField = CLOCK_VARS[info.name.toUpperCase() as keyof typeof CLOCK_VARS];
    if (clockField) state.vars[info.name] = inputs.clock[clockField];
    else if (info.io?.kind === "DI") state.vars[info.name] = inputs.di[info.io.index] === true;
    else if (info.io?.kind === "AI") state.vars[info.name] = Math.round(inputs.ai[info.io.index] ?? 0);
  }
  if (forces) for (const [name, value] of Object.entries(forces)) if (compiled.vars.has(name)) state.vars[name] = value;
  const outputs = emptyOutputs();
  try {
    execute(compiled.program.body, state, compiled, dtMs, forces);
  } catch (error) {
    if (error instanceof StError) return { state: stateIn, outputs, problem: { message: error.message, line: error.line, col: error.col } };
    throw error;
  }
  for (const info of compiled.vars.values()) {
    if (info.io?.kind === "DO") outputs.do[info.io.index] = state.vars[info.name] === true;
    else if (info.io?.kind === "AO") outputs.ao[info.io.index] = Math.min(10_000, Math.max(0, Math.round(asNumber(state.vars[info.name]))));
  }
  return { state, outputs, problem: null };
}

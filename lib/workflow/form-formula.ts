/**
 * The form builder's formula language (2026-09-26, design v2): simple Excel-like formulas with Swedish function
 * names and semicolons, evaluated by this restricted engine only – never `eval`, never arbitrary code. Formulas refer
 * to fields by short name (`uppmatt`), to a table column as a list (`matning.uppmatt`) and, inside a table row, to the
 * same row's cell with brackets (`[uppmatt]`). The same engine runs in the browser, on the server and in the PDF.
 */

export const FORMULA_MAX_LENGTH = 500;
export const FORMULA_MAX_DEPTH = 32;

export type FormulaValue = number | string | boolean | null | FormulaValue[];

export type FormulaNode =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "ref"; name: string }
  | { type: "cell"; name: string }
  | { type: "unary"; op: "-" | "+"; arg: FormulaNode }
  | { type: "binary"; op: BinaryOp; left: FormulaNode; right: FormulaNode }
  | { type: "call"; name: FormulaFunction; args: FormulaNode[] };

type BinaryOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

export const FORMULA_FUNCTIONS = ["SUMMA", "MEDEL", "MIN", "MAX", "ANTAL", "ANTAL.OM", "OM", "OCH", "ELLER", "INTE", "AVRUNDA", "ABS", "SAMMANFOGA", "ÄRTOM", "EDATUM", "VÄXLA"] as const;
export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];
// English aliases so a formula copied from an English Excel also works.
const ALIASES: Record<string, FormulaFunction> = { SUM: "SUMMA", AVERAGE: "MEDEL", COUNT: "ANTAL", COUNTIF: "ANTAL.OM", IF: "OM", AND: "OCH", OR: "ELLER", NOT: "INTE", ROUND: "AVRUNDA", CONCAT: "SAMMANFOGA", ISBLANK: "ÄRTOM", EDATE: "EDATUM", SWITCH: "VÄXLA" };
const ARITY: Record<FormulaFunction, [number, number]> = {
  SUMMA: [1, 30], MEDEL: [1, 30], MIN: [1, 30], MAX: [1, 30], ANTAL: [1, 30], "ANTAL.OM": [2, 2], OM: [2, 3], OCH: [1, 30], ELLER: [1, 30], INTE: [1, 1], AVRUNDA: [1, 2], ABS: [1, 1], SAMMANFOGA: [1, 30], ÄRTOM: [1, 1], EDATUM: [2, 2], VÄXLA: [3, 31],
};

export class FormulaError extends Error {
  constructor(message: string, readonly position = 0) { super(message); }
}

/** A circular reference, with the names involved so the editor can point at every block in the cycle. */
export class FormulaCycleError extends FormulaError {
  constructor(readonly names: string[]) { super(`Cirkelreferens: ${names.join(" → ")}.`); }
}

type Token = { kind: "number" | "string" | "name" | "cell" | "op" | "open" | "close" | "sep"; text: string; value?: number; position: number };

const NAME_START = /[A-Za-zÅÄÖåäöÉé_]/;
const NAME_PART = /[A-Za-zÅÄÖåäöÉé0-9_.]/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) { i++; continue; }
    if (/[0-9]/.test(char) || ((char === "," || char === ".") && /[0-9]/.test(source[i + 1] ?? ""))) {
      let text = "";
      while (i < source.length && /[0-9.,]/.test(source[i])) text += source[i++];
      const value = Number(text.replace(",", "."));
      if (!Number.isFinite(value) || (text.match(/[.,]/g)?.length ?? 0) > 1) throw new FormulaError(`Ogiltigt tal "${text}".`, i - text.length);
      tokens.push({ kind: "number", text, value, position: i - text.length });
      continue;
    }
    if (char === "\"") {
      const start = i++;
      let text = "";
      while (i < source.length && source[i] !== "\"") text += source[i++];
      if (source[i] !== "\"") throw new FormulaError("En text saknar avslutande citattecken.", start);
      i++;
      tokens.push({ kind: "string", text, position: start });
      continue;
    }
    if (char === "[") {
      const start = i++;
      let text = "";
      while (i < source.length && source[i] !== "]") text += source[i++];
      if (source[i] !== "]" || !text.trim()) throw new FormulaError("En radreferens ska skrivas som [kortnamn].", start);
      i++;
      tokens.push({ kind: "cell", text: text.trim(), position: start });
      continue;
    }
    if (NAME_START.test(char)) {
      const start = i;
      let text = "";
      while (i < source.length && NAME_PART.test(source[i])) text += source[i++];
      tokens.push({ kind: "name", text, position: start });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (["<>", "<=", ">="].includes(two)) { tokens.push({ kind: "op", text: two, position: i }); i += 2; continue; }
    if ("+-*/^&=<>".includes(char)) { tokens.push({ kind: "op", text: char, position: i++ }); continue; }
    if (char === "(") { tokens.push({ kind: "open", text: char, position: i++ }); continue; }
    if (char === ")") { tokens.push({ kind: "close", text: char, position: i++ }); continue; }
    if (char === ";") { tokens.push({ kind: "sep", text: char, position: i++ }); continue; }
    throw new FormulaError(`Tecknet "${char}" kan inte användas i en formel.`, i);
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

/** Parses a formula; a leading "=" is optional. Throws FormulaError with a Swedish message and a position. */
export function parseFormula(input: string): FormulaNode {
  const source = input.trim().replace(/^=/, "");
  if (!source.trim()) throw new FormulaError("Formeln är tom.");
  if (input.length > FORMULA_MAX_LENGTH) throw new FormulaError(`En formel får vara högst ${FORMULA_MAX_LENGTH} tecken.`);
  const tokens = tokenize(source);
  let index = 0;
  const peek = () => tokens[index];
  const expect = (kind: Token["kind"], message: string) => { const token = tokens[index]; if (!token || token.kind !== kind) throw new FormulaError(message, token?.position ?? source.length); index++; return token; };
  const depthCheck = (depth: number) => { if (depth > FORMULA_MAX_DEPTH) throw new FormulaError(`Formeln har för många nivåer (högst ${FORMULA_MAX_DEPTH}).`); };

  function expression(minPrecedence: number, depth: number): FormulaNode {
    depthCheck(depth);
    let left = unary(depth + 1);
    for (;;) {
      const token = peek();
      if (!token || token.kind !== "op" || PRECEDENCE[token.text] === undefined || PRECEDENCE[token.text] < minPrecedence) return left;
      index++;
      const precedence = PRECEDENCE[token.text];
      // "^" is right-associative, the others left-associative.
      const right = expression(token.text === "^" ? precedence : precedence + 1, depth + 1);
      left = { type: "binary", op: token.text as BinaryOp, left, right };
    }
  }
  function unary(depth: number): FormulaNode {
    depthCheck(depth);
    const token = peek();
    if (token?.kind === "op" && (token.text === "-" || token.text === "+")) { index++; return { type: "unary", op: token.text, arg: unary(depth + 1) }; }
    return primary(depth + 1);
  }
  function primary(depth: number): FormulaNode {
    depthCheck(depth);
    const token = tokens[index++];
    if (!token) throw new FormulaError("Formeln slutar för tidigt.", source.length);
    if (token.kind === "number") return { type: "number", value: token.value! };
    if (token.kind === "string") return { type: "string", value: token.text };
    if (token.kind === "cell") return { type: "cell", name: token.text.toLowerCase() };
    if (token.kind === "open") { const inner = expression(0, depth + 1); expect("close", "En parentes saknar avslutning."); return inner; }
    if (token.kind === "name") {
      const upper = token.text.toUpperCase();
      if (peek()?.kind === "open") {
        const name = (ALIASES[upper] ?? upper) as FormulaFunction;
        if (!FORMULA_FUNCTIONS.includes(name)) throw new FormulaError(`Funktionen ${token.text} finns inte. Tillgängliga: ${FORMULA_FUNCTIONS.join(", ")}.`, token.position);
        index++;
        const args: FormulaNode[] = [];
        if (peek()?.kind !== "close") {
          for (;;) {
            args.push(expression(0, depth + 1));
            if (peek()?.kind === "sep") { index++; continue; }
            break;
          }
        }
        expect("close", `${name} saknar avslutande parentes. Skilj argument åt med semikolon.`);
        const [min, max] = ARITY[name];
        if (args.length < min || args.length > max) throw new FormulaError(`${name} ska ha ${min === max ? min : `${min}–${max}`} argument.`, token.position);
        return { type: "call", name, args };
      }
      if (upper === "SANT" || upper === "TRUE") return { type: "boolean", value: true };
      if (upper === "FALSKT" || upper === "FALSE") return { type: "boolean", value: false };
      return { type: "ref", name: token.text.toLowerCase() };
    }
    throw new FormulaError(`Oväntat "${token.text}".`, token.position);
  }

  const node = expression(0, 0);
  if (index < tokens.length) throw new FormulaError(`Oväntat "${tokens[index].text}".`, tokens[index].position);
  return node;
}

/** Every name (`ref`) and row cell (`cell`) a formula depends on. */
export function formulaReferences(node: FormulaNode) {
  const refs = new Set<string>();
  const cells = new Set<string>();
  const walk = (current: FormulaNode) => {
    if (current.type === "ref") refs.add(current.name);
    else if (current.type === "cell") cells.add(current.name);
    else if (current.type === "unary") walk(current.arg);
    else if (current.type === "binary") { walk(current.left); walk(current.right); }
    else if (current.type === "call") current.args.forEach(walk);
  };
  walk(node);
  return { refs: [...refs], cells: [...cells] };
}

export type FormulaScope = { ref: (name: string) => FormulaValue | undefined; cell?: (name: string) => FormulaValue | undefined; warn?: (message: string) => void };

const isEmpty = (value: FormulaValue) => value === null || value === "" || (Array.isArray(value) && value.length === 0);
const flat = (values: FormulaValue[]): FormulaValue[] => values.flatMap((value) => Array.isArray(value) ? flat(value) : [value]);
function toNumber(value: FormulaValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value.replace(",", ".")))) return Number(value.replace(",", "."));
  return null;
}
function toBoolean(value: FormulaValue): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") { const upper = value.trim().toUpperCase(); if (["SANT", "JA", "TRUE", "YES"].includes(upper)) return true; if (["FALSKT", "NEJ", "FALSE", "NO"].includes(upper)) return false; }
  return null;
}
const text = (value: FormulaValue): string => value === null ? "" : typeof value === "boolean" ? (value ? "SANT" : "FALSKT") : Array.isArray(value) ? flat(value).map(text).join(", ") : typeof value === "number" ? String(value).replace(".", ",") : value;
const equal = (a: FormulaValue, b: FormulaValue) => {
  const an = toNumber(a), bn = toNumber(b);
  if (typeof a !== "string" && typeof b !== "string" && an !== null && bn !== null) return an === bn;
  if (typeof a === "boolean" || typeof b === "boolean") return toBoolean(a) === toBoolean(b);
  return text(a).trim().toLowerCase() === text(b).trim().toLowerCase();
};

/** Evaluates a parsed formula. Empty inputs give an empty result; division by zero gives an empty result and a warning. */
export function evaluateFormula(node: FormulaNode, scope: FormulaScope): FormulaValue {
  const value = (current: FormulaNode): FormulaValue => {
    switch (current.type) {
      case "number": case "string": case "boolean": return current.value;
      case "ref": { const found = scope.ref(current.name); if (found === undefined) throw new FormulaError(`Okänt kortnamn "${current.name}".`); return found; }
      case "cell": { const found = scope.cell?.(current.name); if (found === undefined) throw new FormulaError(`[${current.name}] finns inte i tabellraden.`); return found; }
      case "unary": { const arg = toNumber(value(current.arg)); return arg === null ? null : current.op === "-" ? -arg : arg; }
      case "binary": {
        const left = value(current.left), right = value(current.right);
        if (current.op === "&") return text(left) + text(right);
        if (current.op === "=" || current.op === "<>") { if (isEmpty(left) || isEmpty(right)) return null; const same = equal(left, right); return current.op === "=" ? same : !same; }
        const a = toNumber(left), b = toNumber(right);
        if (a === null || b === null) return null;
        switch (current.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": if (b === 0) { scope.warn?.("Division med noll gav ett tomt värde."); return null; } return a / b;
          case "^": { const result = a ** b; return Number.isFinite(result) ? result : null; }
          case "<": return a < b;
          case ">": return a > b;
          case "<=": return a <= b;
          case ">=": return a >= b;
        }
        return null;
      }
      case "call": return call(current);
    }
  };
  const numbers = (args: FormulaNode[]) => flat(args.map(value)).map(toNumber).filter((item): item is number => item !== null);
  const call = (current: Extract<FormulaNode, { type: "call" }>): FormulaValue => {
    const args = current.args;
    switch (current.name) {
      case "SUMMA": return numbers(args).reduce((sum, item) => sum + item, 0);
      case "MEDEL": { const list = numbers(args); return list.length ? list.reduce((sum, item) => sum + item, 0) / list.length : null; }
      case "MIN": { const list = numbers(args); return list.length ? Math.min(...list) : null; }
      case "MAX": { const list = numbers(args); return list.length ? Math.max(...list) : null; }
      case "ANTAL": return flat(args.map(value)).filter((item) => !isEmpty(item)).length;
      case "ANTAL.OM": { const [range, criterion] = [value(args[0]), value(args[1])]; return flat([range]).filter((item) => !isEmpty(item) && equal(item, criterion)).length; }
      case "OM": { const condition = toBoolean(value(args[0])); if (condition === null) return null; return condition ? value(args[1]) : args[2] ? value(args[2]) : false; }
      case "OCH": { const list = flat(args.map(value)).map(toBoolean); return list.some((item) => item === false) ? false : list.some((item) => item === null) ? null : true; }
      case "ELLER": { const list = flat(args.map(value)).map(toBoolean); return list.some((item) => item === true) ? true : list.some((item) => item === null) ? null : false; }
      case "INTE": { const item = toBoolean(value(args[0])); return item === null ? null : !item; }
      case "AVRUNDA": { const item = toNumber(value(args[0])); const digits = args[1] ? toNumber(value(args[1])) ?? 0 : 0; if (item === null) return null; const factor = 10 ** Math.max(0, Math.min(10, Math.round(digits))); return Math.round(item * factor) / factor; }
      case "ABS": { const item = toNumber(value(args[0])); return item === null ? null : Math.abs(item); }
      case "SAMMANFOGA": return args.map((arg) => text(value(arg))).join("");
      case "ÄRTOM": return isEmpty(value(args[0]));
      // VÄXLA(värde; fall1; resultat1; …; [annars]) like Excel SWITCH: a lookup such as the RCD time limit per profile.
      case "VÄXLA": {
        const target = value(args[0]);
        if (isEmpty(target)) return null;
        for (let index = 1; index + 1 < args.length; index += 2) if (equal(target, value(args[index]))) return value(args[index + 1]);
        return args.length % 2 === 0 ? value(args[args.length - 1]) : null;
      }
      // EDATUM(datum; månader): the same calendar day a number of months later, as a date (e.g. the next inspection).
      // The day is clamped to the month's last day, like Excel's EDATE.
      case "EDATUM": {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value(args[0])).trim());
        const months = toNumber(value(args[1]));
        if (!match || months === null) return null;
        const total = Number(match[1]) * 12 + Number(match[2]) - 1 + Math.trunc(months);
        const year = Math.floor(total / 12), month = total - year * 12 + 1;
        const day = Math.min(Number(match[3]), new Date(Date.UTC(year, month, 0)).getUTCDate());
        return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  };
  return value(node);
}

/** Orders keys so that every formula is computed after what it depends on; a cycle is reported by name. */
export function orderByDependencies(dependencies: Map<string, string[]>) {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (key: string, path: string[]) => {
    if (state.get(key) === "done") return;
    if (state.get(key) === "visiting") throw new FormulaCycleError([...path.slice(path.indexOf(key)), key]);
    state.set(key, "visiting");
    for (const next of dependencies.get(key) ?? []) if (dependencies.has(next)) visit(next, [...path, key]);
    state.set(key, "done");
    order.push(key);
  };
  for (const key of dependencies.keys()) visit(key, []);
  return order;
}

/** A value for display: Swedish decimal comma, "Ja"/"Nej" for truth values and at most six decimals. */
export function formatFormulaValue(value: FormulaValue, unit = ""): string {
  if (value === null || (Array.isArray(value) && !value.length)) return "";
  if (typeof value === "boolean") return value ? "Ja" : "Nej";
  if (typeof value === "number") return `${Number(value.toFixed(6)).toLocaleString("sv-SE", { maximumFractionDigits: 6 })}${unit ? ` ${unit}` : ""}`;
  return text(value);
}

/**
 * A result that decides whether something is approved (a formula with `passCondition`): an assessment, so it reads
 * Godkänd / Ej godkänd rather than the fact Ja / Nej (docs/rapportprinciper.md). Other values as `formatFormulaValue`.
 */
export function formatResultValue(value: FormulaValue, unit = "", passCondition = false): string {
  if (passCondition && typeof value === "boolean") return value ? "Godkänd" : "Ej godkänd";
  return formatFormulaValue(value, unit);
}

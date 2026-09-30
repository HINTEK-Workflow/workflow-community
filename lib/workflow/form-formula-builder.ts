import { parseFormula, type FormulaNode } from "./form-formula";

/**
 * The visual formula builder (2026-09-26, the approved editor): pick a field, an operator and a value or another
 * field. The builder writes an ordinary formula in the existing language, so the engine, the server and the PDF are
 * unchanged, and a formula that does not fit the simple shape stays editable as advanced text.
 */

export type AggregateFunction = "SUMMA" | "MEDEL" | "MIN" | "MAX" | "ANTAL";
export type Operand =
  | { kind: "ref"; name: string }
  | { kind: "cell"; name: string }
  | { kind: "number"; value: string }
  | { kind: "aggregate"; fn: AggregateFunction; name: string };
export type ArithmeticOp = "+" | "-" | "*" | "/";
export type CompareOp = "=" | "<>" | "<" | ">" | "<=" | ">=";
export type SimpleFormula = {
  terms: Operand[];
  ops: ArithmeticOp[];
  compare: { op: CompareOp; right: Operand } | null;
  /** OM(jämförelse; "då"; "annars") – a text result instead of Ja/Nej. */
  result: { then: string; otherwise: string } | null;
};

export const AGGREGATES: { fn: AggregateFunction; label: string }[] = [
  { fn: "SUMMA", label: "Summa av" }, { fn: "MEDEL", label: "Medelvärde av" }, { fn: "MIN", label: "Lägsta av" }, { fn: "MAX", label: "Högsta av" }, { fn: "ANTAL", label: "Antal ifyllda i" },
];
export const ARITHMETIC: { op: ArithmeticOp; label: string }[] = [{ op: "+", label: "+" }, { op: "-", label: "−" }, { op: "*", label: "×" }, { op: "/", label: "÷" }];
export const COMPARISONS: { op: CompareOp; label: string }[] = [
  { op: ">=", label: "är minst" }, { op: "<=", label: "är högst" }, { op: ">", label: "är större än" }, { op: "<", label: "är mindre än" }, { op: "=", label: "är lika med" }, { op: "<>", label: "är inte lika med" },
];

const quote = (text: string) => `"${text.replace(/"/g, "'")}"`;
const operandText = (operand: Operand) => operand.kind === "ref" ? operand.name : operand.kind === "cell" ? `[${operand.name}]` : operand.kind === "number" ? (operand.value.trim() || "0") : `${operand.fn}(${operand.name})`;

/** The formula text for a simple formula, in the ordinary formula language. */
export function simpleFormulaText(formula: SimpleFormula): string {
  const left = formula.terms.map((term, index) => `${index ? ` ${formula.ops[index - 1] ?? "+"} ` : ""}${operandText(term)}`).join("");
  const condition = formula.compare ? `${left} ${formula.compare.op} ${operandText(formula.compare.right)}` : left;
  return formula.compare && formula.result ? `OM(${condition}; ${quote(formula.result.then)}; ${quote(formula.result.otherwise)})` : condition;
}

function operandOf(node: FormulaNode): Operand | null {
  if (node.type === "ref") return { kind: "ref", name: node.name };
  if (node.type === "cell") return { kind: "cell", name: node.name };
  if (node.type === "number") return { kind: "number", value: String(node.value).replace(".", ",") };
  if (node.type === "unary" && node.op === "-" && node.arg.type === "number") return { kind: "number", value: `-${String(node.arg.value).replace(".", ",")}` };
  if (node.type === "call" && ["SUMMA", "MEDEL", "MIN", "MAX", "ANTAL"].includes(node.name) && node.args.length === 1 && node.args[0].type === "ref")
    return { kind: "aggregate", fn: node.name as AggregateFunction, name: node.args[0].name };
  return null;
}

function chainOf(node: FormulaNode): { terms: Operand[]; ops: ArithmeticOp[] } | null {
  if (node.type === "binary" && ["+", "-", "*", "/"].includes(node.op)) {
    const left = chainOf(node.left);
    const right = operandOf(node.right);
    if (!left || !right) return null;
    return { terms: [...left.terms, right], ops: [...left.ops, node.op as ArithmeticOp] };
  }
  const operand = operandOf(node);
  return operand ? { terms: [operand], ops: [] } : null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Reads a formula into the simple shape, or null when it does not fit (functions, parentheses that change the order,
 * nested conditions …). The result must write back to exactly the same formula, so nothing changes by opening it.
 */
export function parseSimpleFormula(source: string): SimpleFormula | null {
  let node: FormulaNode;
  try { node = parseFormula(source); } catch { return null; }
  let result: SimpleFormula["result"] = null;
  let condition = node;
  if (node.type === "call" && node.name === "OM" && node.args.length === 3 && node.args[1].type === "string" && node.args[2].type === "string") {
    result = { then: node.args[1].value, otherwise: node.args[2].value };
    condition = node.args[0];
  }
  let simple: SimpleFormula | null = null;
  if (condition.type === "binary" && ["=", "<>", "<", ">", "<=", ">="].includes(condition.op)) {
    const left = chainOf(condition.left);
    const right = operandOf(condition.right);
    if (left && right) simple = { ...left, compare: { op: condition.op as CompareOp, right }, result };
  } else if (!result) {
    const chain = chainOf(condition);
    if (chain) simple = { ...chain, compare: null, result: null };
  }
  if (!simple) return null;
  try { return same(parseFormula(simpleFormulaText(simple)), node) ? simple : null; } catch { return null; }
}

export const emptySimpleFormula = (first?: Operand): SimpleFormula => ({ terms: [first ?? { kind: "number", value: "0" }], ops: [], compare: null, result: null });

// ---------- readable text ----------
const OPERATOR_TEXT: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷", "^": "upphöjt till", "&": "och", "=": "=", "<>": "≠", "<": "<", ">": ">", "<=": "≤", ">=": "≥" };
const PRECEDENCE: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

/**
 * A formula in plain Swedish with the fields' labels, e.g. "Spänning × Ström" or "om Uppmätt ≥ Gräns: Godkänd,
 * annars Avvikelse". `labelOf` returns the label for a short name, or undefined for an unknown name.
 */
export function describeFormula(source: string, labelOf: (name: string, cell: boolean) => string | undefined): string {
  let root: FormulaNode;
  try { root = parseFormula(source); } catch { return source; }
  const text = (node: FormulaNode, parent = 0): string => {
    switch (node.type) {
      case "number": return String(node.value).replace(".", ",");
      case "string": return `”${node.value}”`;
      case "boolean": return node.value ? "Ja" : "Nej";
      case "ref": return labelOf(node.name, false) ?? node.name;
      case "cell": return labelOf(node.name, true) ?? node.name;
      case "unary": return `${node.op === "-" ? "−" : ""}${text(node.arg, 6)}`;
      case "binary": {
        const own = PRECEDENCE[node.op];
        const body = `${text(node.left, own)} ${OPERATOR_TEXT[node.op]} ${text(node.right, own + 1)}`;
        return own < parent ? `(${body})` : body;
      }
      case "call": {
        const args = node.args.map((arg) => text(arg));
        switch (node.name) {
          case "SUMMA": return `summan av ${args.join(", ")}`;
          case "MEDEL": return `medelvärdet av ${args.join(", ")}`;
          case "MIN": return `lägsta av ${args.join(", ")}`;
          case "MAX": return `högsta av ${args.join(", ")}`;
          case "ANTAL": return `antal ifyllda i ${args.join(", ")}`;
          case "ANTAL.OM": return `antal i ${args[0]} som är ${args[1]}`;
          case "OM": return `om ${args[0]}: ${args[1]}${args[2] ? `, annars ${args[2]}` : ""}`;
          case "OCH": return args.join(" och ");
          case "ELLER": return args.join(" eller ");
          case "INTE": return `inte ${args[0]}`;
          case "AVRUNDA": return `${args[0]} avrundat${args[1] ? ` till ${args[1]} decimaler` : ""}`;
          case "ABS": return `absolutbeloppet av ${args[0]}`;
          case "SAMMANFOGA": return args.join(" + ");
          case "ÄRTOM": return `${args[0]} är tomt`;
          case "EDATUM": return `${args[0]} plus ${args[1]} månader`;
          case "VÄXLA": {
            const pairs: string[] = [];
            for (let index = 1; index + 1 < args.length; index += 2) pairs.push(`${args[index]} → ${args[index + 1]}`);
            return `${args[0]}: ${pairs.join(", ")}${args.length % 2 === 0 ? `, annars ${args.at(-1)}` : ""}`;
          }
        }
      }
    }
  };
  return text(root);
}

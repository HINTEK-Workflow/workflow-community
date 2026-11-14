import { formatNumber, parseDecimal } from "./number";
import type { CalcContext, CalcInput, CalcModule, ChoiceInput, ChoiceOption, Choices, InputEcho, NumberInput, Note, Origin, Outcome } from "./types";
import { defaultUnit, formatQuantity, toBase, type Dimension } from "./units";

/**
 * What a calculator page holds for one module (Räkneverktyg, 2026-10-07) and how it becomes a result: the
 * text and unit of every number field, the choices, and a runner that reads the fields, checks the units and the
 * ranges, fills an empty field from its fallback (the company's value, a material suggestion, a neutral default) and
 * hands base-unit numbers to the module's calculation. Pure, so it is tested without a browser.
 */
export type FieldState = { text: string; unit: string; /** Typed in by the person: a starting text that follows a choice is then left alone. */ touched: boolean };
export type ModuleState = { choices: Choices; numbers: Record<string, FieldState>; /** Text inputs (a pasted table), by input id. */ texts: Record<string, string> };

const numberInputs = (tool: CalcModule) => tool.inputs.filter((input): input is NumberInput => input.kind === "number");
const choiceInputs = (tool: CalcModule) => tool.inputs.filter((input): input is ChoiceInput => input.kind === "choice");
export const choiceOptions = (input: ChoiceInput, ctx: CalcContext): readonly ChoiceOption[] => (typeof input.options === "function" ? input.options(ctx) : input.options);
const startingText = (input: NumberInput, choices: Choices) => (typeof input.initial === "function" ? input.initial(choices) : input.initial ?? "");

/** A choice outside its options (a company table that is gone) falls back to the first option. */
export function resolveChoices(tool: CalcModule, choices: Choices, ctx: CalcContext): Choices {
  const resolved: Choices = {};
  for (const input of choiceInputs(tool)) {
    const options = choiceOptions(input, ctx);
    const wanted = choices[input.id] ?? input.initial;
    // A choice with a placeholder may stay unmade (""): the result waits for it.
    const unmade = wanted === "" && input.placeholder !== undefined;
    resolved[input.id] = unmade || options.some((option) => option.value === wanted) ? wanted : options[0]?.value ?? input.initial;
  }
  return resolved;
}

export function initialState(tool: CalcModule, ctx: CalcContext): ModuleState {
  const choices = resolveChoices(tool, {}, ctx);
  const numbers: Record<string, FieldState> = {};
  for (const input of numberInputs(tool)) numbers[input.id] = { text: startingText(input, choices), unit: input.defaultUnit ?? defaultUnit(input.dimension), touched: false };
  return { choices, numbers, texts: {} };
}

const fieldOf = (state: ModuleState, input: NumberInput): FieldState => state.numbers[input.id] ?? { text: "", unit: input.defaultUnit ?? defaultUnit(input.dimension), touched: false };

/** A choice changed: the starting text of every field that follows the choices and was not typed in follows it too. */
export function withChoice(tool: CalcModule, state: ModuleState, id: string, value: string): ModuleState {
  const choices = { ...state.choices, [id]: value };
  const numbers = { ...state.numbers };
  for (const input of numberInputs(tool)) {
    const field = fieldOf(state, input);
    if (typeof input.initial === "function" && !field.touched) numbers[input.id] = { ...field, text: startingText(input, choices) };
  }
  return { ...state, choices, numbers };
}
export function withTextInput(state: ModuleState, id: string, text: string): ModuleState {
  return { ...state, texts: { ...(state.texts ?? {}), [id]: text } };
}
/** The module's worked example in the fields (choices first, so a field that follows a choice starts from it). */
export function withExample(tool: CalcModule, state: ModuleState, ctx: CalcContext): ModuleState {
  const example = tool.example;
  if (!example) return state;
  let next: ModuleState = { ...initialState(tool, ctx), texts: state.texts };
  for (const [id, value] of Object.entries(example.choices ?? {})) next = withChoice(tool, next, id, value);
  for (const [id, field] of Object.entries(example.numbers)) {
    next = withText(tool, next, id, field.text);
    if (field.unit) next = withUnit(tool, next, id, field.unit);
  }
  return next;
}
export function withText(tool: CalcModule, state: ModuleState, id: string, text: string): ModuleState {
  const input = numberInputs(tool).find((item) => item.id === id);
  if (!input) return state;
  return { ...state, numbers: { ...state.numbers, [id]: { ...fieldOf(state, input), text, touched: true } } };
}
export function withUnit(tool: CalcModule, state: ModuleState, id: string, unit: string): ModuleState {
  const input = numberInputs(tool).find((item) => item.id === id);
  if (!input) return state;
  return { ...state, numbers: { ...state.numbers, [id]: { ...fieldOf(state, input), unit } } };
}

const lowerFirst = (text: string) => (/^\p{Lu}\p{Ll}/u.test(text) ? text[0].toLowerCase() + text.slice(1) : text);
const listWords = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} och ${words[words.length - 1]}`);
const amount = (value: number, dimension: Dimension) => (dimension === "ratio" ? formatNumber(value) : formatQuantity(value, dimension));

/** What is wrong with a number outside its limits, or null. Limits are in the base unit of the dimension. */
function rangeIssue(input: NumberInput, value: number): string | null {
  if (input.min !== undefined && (input.minExclusive ? value <= input.min : value < input.min)) {
    if (input.min === 0) return input.minExclusive ? `${input.label}: ange ett värde större än noll.` : `${input.label}: värdet får inte vara negativt.`;
    return `${input.label}: värdet måste vara ${input.minExclusive ? "större än" : "minst"} ${amount(input.min, input.dimension)}.`;
  }
  if (input.max !== undefined && (input.maxExclusive ? value >= input.max : value > input.max)) return `${input.label}: värdet får ${input.maxExclusive ? "vara mindre än" : "vara högst"} ${amount(input.max, input.dimension)}.`;
  return null;
}

/** Reads the state of a module and calculates: the unit check, the fields, the fallbacks, then the module's own calculation. */
export function runModule(tool: CalcModule, state: ModuleState, ctx: CalcContext): Outcome {
  const choices = resolveChoices(tool, state.choices, ctx);
  const visible: CalcInput[] = tool.inputs.filter((input) => !input.showIf || input.showIf(choices));
  const units: Record<string, string> = {};
  for (const input of visible) if (input.kind === "number") units[input.id] = fieldOf(state, input).unit;
  const unitIssues = tool.unitCheck(units);
  if (unitIssues.length) return { status: "invalid", errors: unitIssues };

  const errors: { field?: string; message: string }[] = [];
  const numbers: Record<string, number | undefined> = {};
  const origins: Record<string, Origin> = {};
  const fallbackNotes: Record<string, string | undefined> = {};
  const echoes: InputEcho[] = [];
  const hints: Note[] = [];
  const missing: string[] = [];
  const texts: Record<string, string> = {};
  for (const input of visible) {
    if (input.kind === "choice") {
      if (input.placeholder !== undefined && choices[input.id] === "") { missing.push(lowerFirst(input.label)); continue; }
      const options = choiceOptions(input, ctx);
      // A choice that is not drawn (no real choice) is not a choice the person made.
      if (input.hideWhenSingle && options.length < 2) continue;
      const label = options.find((option) => option.value === choices[input.id])?.label;
      if (label) echoes.push({ id: input.id, label: input.label, text: label, origin: "user" });
      continue;
    }
    if (input.kind === "text") {
      const text = state.texts?.[input.id] ?? "";
      texts[input.id] = text;
      if (text.trim()) echoes.push({ id: input.id, label: input.label, text: text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("; "), origin: "user" });
      continue;
    }
    const field = fieldOf(state, input);
    const parsed = parseDecimal(field.text);
    if (parsed.state === "invalid") { errors.push({ field: input.id, message: `${input.label}: skriv värdet som ett tal, till exempel 2,5.` }); continue; }
    if (parsed.state === "empty") {
      const fallback = input.fallback?.(choices, ctx, numbers);
      if (fallback) {
        numbers[input.id] = fallback.value;
        origins[input.id] = fallback.origin;
        fallbackNotes[input.id] = fallback.note;
        echoes.push({ id: input.id, label: input.label, text: amount(fallback.value, input.dimension), origin: fallback.origin, note: fallback.note });
      } else if (input.required) missing.push(lowerFirst(input.label));
      continue;
    }
    const value = toBase(parsed.value, input.dimension, field.unit);
    const issue = rangeIssue(input, value);
    if (issue) { errors.push({ field: input.id, message: issue }); continue; }
    numbers[input.id] = value;
    origins[input.id] = "user";
    echoes.push({ id: input.id, label: input.label, text: amount(value, input.dimension), origin: "user" });
    if (input.usual && (value < input.usual[0] || value > input.usual[1])) {
      hints.push({ tone: "warn", text: `${input.label}: ${amount(value, input.dimension)} ligger utanför det vanliga (${amount(input.usual[0], input.dimension)} till ${amount(input.usual[1], input.dimension)}). Kontrollera enheten.` });
    }
  }
  if (errors.length) return { status: "invalid", errors };
  if (missing.length) return { status: "incomplete", message: `Ange ${listWords(missing)} så visas resultatet här.` };
  const outcome = tool.compute({ numbers, origins, choices, texts, company: ctx.company, fallbackNotes });
  if (outcome.status !== "ok") return outcome;
  return { ...outcome, notes: [...outcome.notes, ...hints], inputs: echoes };
}

/** What an empty number field stands for – the company's value, a suggestion or a default – for the page to show in it. */
export function fieldFallback(tool: CalcModule, state: ModuleState, id: string, ctx: CalcContext) {
  const input = numberInputs(tool).find((item) => item.id === id);
  if (!input?.fallback) return undefined;
  const choices = resolveChoices(tool, state.choices, ctx);
  // The fields above this one that hold a typed, valid value: a fallback may follow them (a device's Ia follows type, In and time).
  const numbers: Record<string, number | undefined> = {};
  for (const other of numberInputs(tool)) {
    if (other.id === id) break;
    if (other.showIf && !other.showIf(choices)) continue;
    const field = fieldOf(state, other);
    const parsed = parseDecimal(field.text);
    if (parsed.state === "ok") numbers[other.id] = toBase(parsed.value, other.dimension, field.unit);
  }
  return input.fallback(choices, ctx, numbers);
}

export { listWords, lowerFirst };

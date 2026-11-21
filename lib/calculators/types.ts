import type { CompanyCalcData } from "./company-data";
import type { Dimension } from "./units";

/**
 * The shape of a calculator module (Räkneverktyg, 2026-10-07). A module declares its inputs and outputs and a
 * pure calculation; the page draws any module from that, so a new tool is a new file in lib/calculators and a line in
 * registry.ts – the page is not touched. Everything here is plain data and functions, with no database and no React,
 * so Cloud, Local and the demo calculate the same and the tools can be tested against worked examples.
 */

/** Where a number the calculation uses came from: typed, the company's own value, a suggestion, or a neutral default. */
export type Origin = "user" | "company" | "suggestion" | "default";
export type Tone = "ok" | "warn" | "alarm" | "neutral";
export type Choices = Record<string, string>;
/** What a calculation may need besides the person's own inputs: the company's values. */
export type CalcContext = { company: CompanyCalcData };

/** The number used when an input is left empty, and what it is (the company's value, a material suggestion, a default). */
export type Fallback = { value: number; origin: Exclude<Origin, "user">; note?: string };

type InputBase = {
  id: string;
  label: string;
  /** One short line under the field. */
  help?: string;
  /** The id of a group in the module's `groups`: inputs of one group are drawn together under its heading. */
  group?: string;
  /** The input is only drawn (and used) while this holds for the module's choices. */
  showIf?: (choices: Choices) => boolean;
};

export type NumberInput = InputBase & {
  kind: "number";
  /** Decides the units the person may pick and the base unit the calculation receives. */
  dimension: Dimension;
  /** The text the field starts with; a function follows the module's choices for as long as the field is untouched. */
  initial?: string | ((choices: Choices) => string);
  /** The unit the field starts with, when it is not the first of the dimension (kW for a power, kA for a short-circuit current). */
  defaultUnit?: string;
  /** An empty required field (without a fallback) leaves the tool waiting for it. */
  required?: boolean;
  /** Limits in base units; the field names its own error. */
  min?: number;
  minExclusive?: boolean;
  max?: number;
  maxExclusive?: boolean;
  /**
   * Used when the field is empty. Never a limit or a table from a standard: only the company's values, constants of nature and neutral defaults.
   * `numbers` are the number fields above this one that hold a value (base units): a protective device's Ia follows its type, rated current and time.
   */
  fallback?: (choices: Choices, ctx: CalcContext, numbers?: Readonly<Record<string, number | undefined>>) => Fallback | undefined;
  /** A grey example in the empty field ("t.ex. 800"), shown when there is no fallback to show instead. In the field's own unit. */
  example?: string;
  /** Grey words in the empty field instead of an example ("Tillverkarens tabell"), when a number would mislead. */
  placeholder?: string;
  /** The usual range in base units: outside it the result is still given, with a hint to check the unit. */
  usual?: readonly [number, number];
};

export type ChoiceOption = { value: string; label: string };
export type ChoiceInput = InputBase & {
  kind: "choice";
  options: readonly ChoiceOption[] | ((ctx: CalcContext) => readonly ChoiceOption[]);
  initial: string;
  /**
   * A choice the person must make (2026-10-12, the protective device): `initial` is "" and the field shows these
   * words ("Välj skyddsapparat") until something is chosen; the result waits for it like for an empty required number.
   */
  placeholder?: string;
  display?: "segmented" | "select";
  /** Not drawn while there is no real choice (fewer than two options), as with a company that has one table. */
  hideWhenSingle?: boolean;
};
/** Free text on several lines (a table the person pastes: area and current on each line). Kept in `ModuleState.texts`. */
export type TextInput = InputBase & { kind: "text"; /** The grey format hint in the empty field. */ placeholder?: string; rows?: number };
export type CalcInput = NumberInput | ChoiceInput | TextInput;

export type GroupInfo = { title: string; hint?: string; /** Drawn folded, for what rarely needs changing. */ collapsed?: boolean };

/** A result the module can give: what the page and the tests may rely on. */
export type OutputDef = { id: string; label: string; dimension?: Dimension };

export type OutputQuantity = {
  kind: "quantity";
  id: string;
  label: string;
  /** In the base unit of the dimension. */
  value: number;
  dimension: Dimension;
  /** Forces the unit it is shown in; otherwise the value is scaled (W, kW, MW). */
  unit?: string;
  /** Calculated from the inputs, as opposed to a value the person gave. */
  derived?: boolean;
  /** The result the person came for: drawn larger. */
  primary?: boolean;
  /** A short label for the phone's result bar ("Ik1", "Zs max", "Max längd"); the long one stays in the result list. */
  short?: string;
  /** `false` keeps a primary row out of the phone's result bar (room for a figure that matters more right now). */
  dock?: boolean;
  tone?: Tone;
  note?: string;
};
export type OutputVerdict = { kind: "verdict"; id: string; label: string; text: string; tone: Tone };
export type OutputRow = OutputQuantity | OutputVerdict;

/** Something to tell beside the result. `missing` is a value the company has not entered (with a way to enter it). */
export type Note = { tone: "info" | "warn" | "missing"; text: string; link?: { label: string; view: string }; detail?: string };
/** An input as it was used, for "Så räknades det" and the copied result. */
export type InputEcho = { id: string; label: string; text: string; origin: Origin; /** What a fallback was: "Förslag för koppar", "Företagets värde (källa)". */ note?: string };

export type ComputeOk = { status: "ok"; rows: OutputRow[]; steps: string[]; notes: Note[] };
export type ComputeOutcome = ComputeOk | { status: "incomplete"; message: string } | { status: "invalid"; errors: { field?: string; message: string }[] };
export type Outcome = (ComputeOk & { inputs: InputEcho[] }) | Exclude<ComputeOutcome, ComputeOk>;

export type ComputeArgs = {
  /** Visible inputs, in base units; an empty input without a fallback is missing. */
  numbers: Readonly<Record<string, number | undefined>>;
  origins: Readonly<Record<string, Origin>>;
  choices: Readonly<Choices>;
  /** Visible text inputs, as typed. */
  texts: Readonly<Record<string, string>>;
  company: CompanyCalcData;
  /** The note of a fallback that was used, by input id. */
  fallbackNotes: Readonly<Record<string, string | undefined>>;
};

export type UnitIssue = { field: string; message: string };

/** What "Fyll i exempel" puts in the fields: a worked example the person can change (never a table or a limit). */
export type ModuleExample = { numbers: Readonly<Record<string, { text: string; unit?: string }>>; choices?: Readonly<Choices> };

export type CalcModule = {
  id: string;
  name: string;
  /** One line for the picker. */
  summary: string;
  inputs: readonly CalcInput[];
  groups?: Readonly<Record<string, GroupInfo>>;
  outputs: readonly OutputDef[];
  /** The unit check: every unit chosen for an input must belong to its dimension. */
  unitCheck: (units: Readonly<Record<string, string>>) => UnitIssue[];
  /** The calculation: pure, from base-unit numbers to rows, the way it was calculated and notes. */
  compute: (args: ComputeArgs) => ComputeOutcome;
  /** Short paragraphs for the page's help, in plain words. */
  help: readonly string[];
  /** A worked example for the button "Fyll i exempel". */
  example?: ModuleExample;
};

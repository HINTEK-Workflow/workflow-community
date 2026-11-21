"use client";

import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/features/workflow/work-list";
import { formatNumber } from "@/lib/calculators/number";
import { choiceOptions, fieldFallback, resolveChoices, type ModuleState } from "@/lib/calculators/run";
import type { CalcContext, CalcInput, CalcModule, ChoiceInput, GroupInfo, NumberInput, Origin, TextInput } from "@/lib/calculators/types";
import { fromBase, unitsOf } from "@/lib/calculators/units";

/**
 * Draws any calculator module from its declaration (Räkneverktyg, 2026-10-07): the choices as segments or a
 * list, every number as a field with its unit, grouped under the module's headings. Numbers are typed as text with a
 * decimal comma or point; a phone gets the numeric keyboard. An empty field that stands for something – the company's
 * value, a suggestion – shows it in the field and says what it is, so nothing is used without being seen.
 */
export type FieldErrors = Record<string, string>;
const ORIGIN_BADGE: Record<Origin, string> = { user: "", company: "Företagets värde", suggestion: "Förslag", default: "" };

type Section = { id: string; info?: GroupInfo; inputs: CalcInput[] };
function sectionsOf(tool: CalcModule, choices: Record<string, string>, ctx: CalcContext): Section[] {
  const visible = tool.inputs.filter((input) => (!input.showIf || input.showIf(choices)) && !(input.kind === "choice" && input.hideWhenSingle && choiceOptions(input, ctx).length < 2));
  const ids = ["", ...Object.keys(tool.groups ?? {})];
  return ids.map((id) => ({ id, info: id ? tool.groups?.[id] : undefined, inputs: visible.filter((input) => (input.group ?? "") === id) })).filter((section) => section.inputs.length);
}

export function CalculatorForm({ tool, state, ctx, errors, onChoice, onText, onUnit, onTextInput }: {
  tool: CalcModule;
  state: ModuleState;
  ctx: CalcContext;
  errors: FieldErrors;
  onChoice: (id: string, value: string) => void;
  onText: (id: string, text: string) => void;
  onUnit: (id: string, unit: string) => void;
  onTextInput?: (id: string, text: string) => void;
}) {
  const choices = resolveChoices(tool, state.choices, ctx);
  const sections = sectionsOf(tool, choices, ctx);
  return <form className="space-y-6" noValidate onSubmit={(event) => event.preventDefault()} data-testid="calculator-form" aria-label={tool.name}>
    {sections.map((section) => {
      const fields = <div className="grid gap-4 sm:grid-cols-2">
        {section.inputs.map((input) => input.kind === "choice"
          ? <ChoiceField key={input.id} tool={tool} input={input} value={choices[input.id]} ctx={ctx} onChoice={onChoice} />
          : input.kind === "text"
            ? <TextField key={input.id} tool={tool} input={input} value={state.texts?.[input.id] ?? ""} onText={onTextInput} />
            : <NumberField key={input.id} tool={tool} input={input} state={state} ctx={ctx} error={errors[input.id]} onText={onText} onUnit={onUnit} />)}
      </div>;
      if (section.info?.collapsed) {
        const open = section.inputs.some((input) => errors[input.id]);
        return <details key={section.id} className="field-group group rounded-lg border" open={open || undefined} data-testid={`calc-group-${section.id}`}>
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />{section.info.title}
          </summary>
          <div className="space-y-3 border-t px-3 py-3">
            {section.info.hint ? <p className="text-xs leading-5 text-muted-foreground">{section.info.hint}</p> : null}
            {fields}
          </div>
        </details>;
      }
      return <section key={section.id || "plain"} className="space-y-3" data-testid={section.id ? `calc-group-${section.id}` : undefined}>
        {section.info ? <div>
          <h3 className="text-sm font-semibold">{section.info.title}</h3>
          {section.info.hint ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{section.info.hint}</p> : null}
        </div> : null}
        {fields}
      </section>;
    })}
  </form>;
}

function ChoiceField({ tool, input, value, ctx, onChoice }: { tool: CalcModule; input: ChoiceInput; value: string; ctx: CalcContext; onChoice: (id: string, value: string) => void }) {
  const options = choiceOptions(input, ctx);
  const id = `calc-${tool.id}-${input.id}`;
  const long = options.reduce((sum, option) => sum + option.label.length + 4, 0) > 34;
  return <div className="grid min-w-0 content-start gap-1.5 sm:col-span-2" data-testid={`calc-field-${input.id}`}>
    <span id={`${id}-label`} className="field-label text-xs font-medium">{input.label}</span>
    {input.display === "select"
      ? <select id={id} className="form-select" aria-labelledby={`${id}-label`} value={value} onChange={(event) => onChoice(input.id, event.target.value)} data-testid={`calc-choice-${input.id}`}>
        {/* A choice the person must make: the first line says so and stays until something is chosen (nothing is picked for them). */}
        {input.placeholder !== undefined ? <option value="">{input.placeholder}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      : <>
        {/* Long alternatives do not fit side by side on a phone (no sideways scrolling): there they are a picker. */}
        <div className={long ? "max-sm:hidden" : undefined}><Segmented label={input.label} value={value} options={options.map((option) => ({ value: option.value, label: option.label }))} onChange={(next) => onChoice(input.id, next)} testId={`calc-choice-${input.id}`} /></div>
        {long ? <select id={id} className="form-select sm:hidden" aria-labelledby={`${id}-label`} value={value} onChange={(event) => onChoice(input.id, event.target.value)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : null}
      </>}
    {input.help ? <p className="text-xs leading-5 text-muted-foreground">{input.help}</p> : null}
  </div>;
}

function NumberField({ tool, input, state, ctx, error, onText, onUnit }: { tool: CalcModule; input: NumberInput; state: ModuleState; ctx: CalcContext; error?: string; onText: (id: string, text: string) => void; onUnit: (id: string, unit: string) => void }) {
  const field = state.numbers[input.id] ?? { text: "", unit: input.defaultUnit ?? unitsOf(input.dimension)[0], touched: false };
  const units = unitsOf(input.dimension);
  const id = `calc-${tool.id}-${input.id}`;
  const empty = field.text.trim() === "";
  const fallback = empty ? fieldFallback(tool, state, input.id, ctx) : undefined;
  const placeholder = fallback ? formatNumber(fromBase(fallback.value, input.dimension, field.unit)) : input.placeholder ?? (input.example ? `t.ex. ${input.example}` : undefined);
  const badge = fallback ? ORIGIN_BADGE[fallback.origin] : "";
  return <div className="grid min-w-0 content-start gap-1.5" data-testid={`calc-field-${input.id}`}>
    <Label htmlFor={id} className="field-label flex-wrap text-xs font-medium">{input.label}{input.required ? <span className="sr-only"> (krävs)</span> : null}</Label>
    <div className="flex items-center gap-2">
      <Input id={id} type="text" inputMode="decimal" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="next"
        className="min-w-0 flex-1 bg-card" value={field.text} placeholder={placeholder}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onText(input.id, event.target.value)} data-testid={`calc-input-${input.id}`} />
      {units.length > 1
        ? <select className="form-select w-auto shrink-0" aria-label={`Enhet för ${input.label}`} value={field.unit} onChange={(event) => onUnit(input.id, event.target.value)} data-testid={`calc-unit-${input.id}`}>
          {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
        : units[0] ? <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground" data-testid={`calc-unit-${input.id}`}>{units[0]}</span> : null}
    </div>
    {error ? <p id={`${id}-error`} className="text-xs leading-5 text-destructive" data-testid={`calc-error-${input.id}`}>{error}</p> : null}
    {fallback ? <p className="text-xs leading-5 text-muted-foreground" data-testid={`calc-fallback-${input.id}`}>
      {badge
        ? <span className="mr-1 font-medium text-foreground">{fallback.note || badge}.</span>
        : <span>{fallback.note ? `${fallback.note}. ` : ""}</span>}
      <span>Tomt fält används.</span>
    </p> : input.help ? <p className="text-xs leading-5 text-muted-foreground">{input.help}</p> : null}
  </div>;
}

/** A text field of several lines (a pasted table): the same label above and help under as every other field. */
function TextField({ tool, input, value, onText }: { tool: CalcModule; input: TextInput; value: string; onText?: (id: string, text: string) => void }) {
  const id = `calc-${tool.id}-${input.id}`;
  return <div className="grid min-w-0 content-start gap-1.5 sm:col-span-2" data-testid={`calc-field-${input.id}`}>
    <Label htmlFor={id} className="field-label flex-wrap text-xs font-medium">{input.label}</Label>
    <textarea id={id} className="form-textarea" rows={input.rows ?? 4} value={value} placeholder={input.placeholder} spellCheck={false} autoComplete="off" autoCapitalize="off"
      onChange={(event) => onText?.(input.id, event.target.value)} data-testid={`calc-input-${input.id}`} />
    {input.help ? <p className="text-xs leading-5 text-muted-foreground">{input.help}</p> : null}
  </div>;
}

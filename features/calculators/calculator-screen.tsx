"use client";

import { useMemo } from "react";
import { RotateCcw, Sparkles, Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSegmented } from "@/components/native";
import { Panel } from "@/features/kfid/ui";
import { indicatorText } from "@/features/workflow/indicator-tone";
import { Segmented } from "@/features/workflow/work-list";
import { initialState, runModule, withChoice, withExample, withText, withTextInput, withUnit, type ModuleState } from "@/lib/calculators/run";
import { dockSummary } from "@/lib/calculators/kalkylator/navigation";
import type { CalcEntry, CalcPart } from "@/lib/calculators/kalkylator/list";
import type { CalcContext, CalcModule, Outcome } from "@/lib/calculators/types";
import { cn } from "@/lib/utils";
import { CalculatorForm, type FieldErrors } from "./calculator-form";
import { CalculatorResult } from "./calculator-result";
import { ThreePhaseBody } from "./three-phase-calculator";

/**
 * One calculator of the Kalkylator (2026-10-12): its parts as segments, the fields, the result that follows what is
 * typed, and the buttons "Fyll i exempel" and "Nollställ". The same components draw it in every display level: on a phone at
 * level 1 the fields and the result are lists of the app's own look and a bar with the main figures stays under the fields
 * (the full result is below them); at level 2–3 and on a computer it is the two panels side by side, the result following
 * the page on a wide screen. Nothing is stored: every figure is calculated in the browser from what is typed.
 */
export type ModuleStates = Record<string, ModuleState>;

export function CalculatorScreen({ entry, part, onPart, ctx, admin, notify, native, states, setStates, compact }: {
  entry: CalcEntry;
  part: CalcPart;
  onPart: (partId: string) => void;
  ctx: CalcContext;
  admin: boolean;
  notify: (text: string, error?: boolean) => void;
  native: boolean;
  states: ModuleStates;
  setStates: (change: (current: ModuleStates) => ModuleStates) => void;
  /** Display level 2: the explanatory texts of the panels are left out. */
  compact: boolean;
}) {
  const parts = entry.parts.length > 1
    ? native
      ? <NativeSegmented label="Del" value={part.id} onChange={onPart} options={entry.parts.map((item) => [item.id, item.label] as const)} testId="calc-parts" />
      : <div className="flex"><Segmented label="Del" value={part.id} onChange={onPart} options={entry.parts.map((item) => ({ value: item.id, label: item.label }))} testId="calc-parts" /></div>
    : null;
  if (!part.module) {
    // The compact three-phase calculator of the top bar, moved here unchanged.
    return <div className="space-y-4" data-testid="calc-screen">
      {parts}
      {native
        ? <div className="native-group px-4 pb-4" data-testid="calc-quick"><ThreePhaseBody /></div>
        : <Panel icon={Zap} title="Trefaseffekt" className="max-w-2xl" description={compact ? undefined : "P = √3 × U × I × cos φ. Fyll i två av P, U och I."}><div className="max-w-md" data-testid="calc-quick"><ThreePhaseBody /></div></Panel>}
    </div>;
  }
  return <ModuleScreen key={part.module.id} tool={part.module} entryName={entry.name} parts={parts} ctx={ctx} admin={admin} notify={notify} native={native} states={states} setStates={setStates} compact={compact} />;
}

function ModuleScreen({ tool, entryName, parts, ctx, admin, notify, native, states, setStates, compact }: {
  tool: CalcModule; entryName: string; parts: React.ReactNode; ctx: CalcContext; admin: boolean; notify: (text: string, error?: boolean) => void; native: boolean;
  states: ModuleStates; setStates: (change: (current: ModuleStates) => ModuleStates) => void; compact: boolean;
}) {
  const fresh = useMemo(() => initialState(tool, ctx), [tool, ctx]);
  const state = states[tool.id] ?? fresh;
  const update = (change: (current: ModuleState) => ModuleState) => setStates((current) => ({ ...current, [tool.id]: change(current[tool.id] ?? fresh) }));
  const outcome = useMemo<Outcome>(() => runModule(tool, state, ctx), [tool, state, ctx]);
  const errors: FieldErrors = outcome.status === "invalid" ? Object.fromEntries(outcome.errors.filter((error) => error.field).map((error) => [error.field!, error.message])) : {};

  const buttons = <div className="flex flex-wrap items-center gap-2">
    {tool.example ? <Button type="button" variant="outline" onClick={() => update((current) => withExample(tool, current, ctx))} data-testid="calc-example"><Sparkles />Fyll i exempel</Button> : null}
    <Button type="button" variant="outline" onClick={() => update(() => fresh)} data-testid="calc-reset"><RotateCcw />Nollställ</Button>
  </div>;
  const form = <CalculatorForm tool={tool} state={state} ctx={ctx} errors={errors}
    onChoice={(id, value) => update((current) => withChoice(tool, current, id, value))}
    onText={(id, text) => update((current) => withText(tool, current, id, text))}
    onUnit={(id, unit) => update((current) => withUnit(tool, current, id, unit))}
    onTextInput={(id, text) => update((current) => withTextInput(current, id, text))} />;
  const result = <CalculatorResult tool={tool} outcome={outcome} admin={admin} notify={notify} />;

  if (native) {
    return <div className="space-y-3" data-testid="calc-screen" data-calculator={tool.id}>
      {parts}
      <section>
        <h2 className="native-group-title">Uppgifter</h2>
        <div className="native-group space-y-4 p-4">
          {form}
          {buttons}
        </div>
      </section>
      <section>
        <h2 className="native-group-title">Resultat</h2>
        <div className="native-group p-4" data-testid="calc-native-result">{result}</div>
      </section>
      <ResultDock outcome={outcome} />
    </div>;
  }
  return <div className="space-y-4" data-testid="calc-screen" data-calculator={tool.id}>
    {parts}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
      <Panel title={entryName === tool.name ? tool.name : `${entryName}: ${tool.name}`} description={compact ? undefined : tool.summary} actions={buttons}>{form}</Panel>
      <Panel icon={CheckCircle2} title="Resultat" className="xl:sticky xl:top-20">{result}</Panel>
    </div>
    {compact ? null : <Panel title={`Hjälp: ${tool.name}`} collapsible defaultCollapsed>
      <div className="space-y-2 text-sm leading-6" data-testid="calc-help">{tool.help.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
    </Panel>}
  </div>;
}

/**
 * The result bar of level 1 on a phone: the main figures stay in sight under the fields while the person types, above the tab bar.
 * It shows why there is no result yet, or what is wrong, in the same place. The full result, with the way it was calculated, is
 * in the list under the fields.
 */
function ResultDock({ outcome }: { outcome: Outcome }) {
  const summary = dockSummary(outcome);
  return <div className="native-calc-dock" role="status" aria-live="polite" data-testid="calc-dock" data-state={summary.state}>
    {summary.state === "ok"
      ? <dl className="grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: summary.items.map((item) => item.label === "Bedömning" ? "minmax(0, 1.6fr)" : "minmax(0, 1fr)").join(" ") || "minmax(0, 1fr)" }}>
        {summary.items.map((item) => <div key={item.label} className="min-w-0">
          <dt className="line-clamp-2 break-words text-xs leading-4 text-muted-foreground">{item.label}</dt>
          {/* The same colours as the result: green fine, amber "baserat på förslag" (never green on a suggestion), red over the limit. */}
          {/* The verdict is a short sentence ("Klarar kravet · baserat på förslag"): a wider column and two lines, never cut; a figure stays on one line. */}
          <dd className={cn("font-semibold tabular-nums", item.label === "Bedömning" ? "line-clamp-2 break-words text-sm leading-5" : "truncate text-base", item.tone === "alarm" && "text-destructive", item.tone === "ok" && "text-primary", item.tone === "warn" && indicatorText("warning"))} data-tone={item.tone}>{item.text}</dd>
        </div>)}
      </dl>
      : <p className={cn("text-sm leading-5", summary.state === "invalid" ? "text-destructive" : "text-muted-foreground")}>{summary.message}</p>}
  </div>;
}

"use client";

import { useMemo, useState } from "react";
import { Code2, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formLeafBlocks, type FormColumn, type FormDocument } from "@/lib/workflow/form-document";
import { FormulaError, formulaReferences, parseFormula } from "@/lib/workflow/form-formula";
import { AGGREGATES, ARITHMETIC, COMPARISONS, describeFormula, emptySimpleFormula, parseSimpleFormula, simpleFormulaText, type AggregateFunction, type Operand, type SimpleFormula } from "@/lib/workflow/form-formula-builder";

type Names = { refs: { name: string; label: string }[]; columns: { name: string; label: string }[]; cells: { name: string; label: string }[] };

/** The names a formula can use: fields and results, table columns (as lists) and, in a row formula, the row's cells. */
export function formulaNames(document: FormDocument, rowColumns?: FormColumn[], ownKey?: string): Names {
  const leaves = formLeafBlocks(document);
  return {
    refs: leaves.flatMap((block) => (block.type === "field" || block.type === "computed") && block.key !== ownKey ? [{ name: block.key, label: block.label }] : []),
    columns: leaves.flatMap((block) => block.type === "table" ? block.columns.map((column) => ({ name: `${block.key}.${column.key}`, label: `${block.label} · ${column.label}` })) : []),
    cells: (rowColumns ?? []).map((column) => ({ name: column.key, label: column.label })),
  };
}

const operandKinds = (names: Names) => [
  ...(names.cells.length ? [["cell", "Kolumn i raden"]] : []),
  ["ref", "Fält"],
  ["number", "Värde"],
  ...(names.columns.length ? AGGREGATES.map((item) => [item.fn, item.label]) : []),
] as [string, string][];

function OperandPicker({ operand, names, onChange, label }: { operand: Operand; names: Names; onChange: (operand: Operand) => void; label: string }) {
  const kind = operand.kind === "aggregate" ? operand.fn : operand.kind;
  const setKind = (next: string) => {
    if (next === "number") onChange({ kind: "number", value: "0" });
    else if (next === "ref") onChange({ kind: "ref", name: names.refs[0]?.name ?? "" });
    else if (next === "cell") onChange({ kind: "cell", name: names.cells[0]?.name ?? "" });
    else onChange({ kind: "aggregate", fn: next as AggregateFunction, name: operand.kind === "aggregate" ? operand.name : names.columns[0]?.name ?? "" });
  };
  const list = operand.kind === "ref" ? names.refs : operand.kind === "cell" ? names.cells : operand.kind === "aggregate" ? names.columns : [];
  return <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-1.5" role="group" aria-label={label}>
    <select aria-label={`${label}: typ`} className="form-select h-9 text-xs" value={kind} onChange={(event) => setKind(event.target.value)}>
      {operandKinds(names).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>
    {operand.kind === "number"
      ? <Input aria-label={`${label}: värde`} className="h-9 text-xs" inputMode="decimal" value={operand.value} onChange={(event) => onChange({ ...operand, value: event.target.value })} />
      : <select aria-label={`${label}: fält`} className="form-select h-9 text-xs" value={"name" in operand ? operand.name : ""} onChange={(event) => onChange({ ...operand, name: event.target.value } as Operand)}>
        {list.length ? null : <option value="">Inga fält ännu</option>}
        {"name" in operand && operand.name && !list.some((item) => item.name === operand.name) ? <option value={operand.name}>{operand.name} (finns inte)</option> : null}
        {list.map((item) => <option key={item.name} value={item.name}>{item.label}</option>)}
      </select>}
  </div>;
}

/**
 * A formula made visually (Daniel 2026-09-26): field, operator, value or another field, with the formula shown as
 * readable text. "Skriv formel" is the advanced mode with the full language; a formula that does not fit the simple
 * shape opens there.
 */
export function FormulaEditor({ id, value, onChange, document, rowColumns, ownKey }: { id: string; value: string; onChange: (value: string) => void; document: FormDocument; rowColumns?: FormColumn[]; ownKey?: string }) {
  const names = useMemo(() => formulaNames(document, rowColumns, ownKey), [document, rowColumns, ownKey]);
  const simple = useMemo(() => parseSimpleFormula(value), [value]);
  const [advanced, setAdvanced] = useState(() => Boolean(value.trim()) && !simple);
  const labelOf = (name: string, cell: boolean) => (cell ? names.cells : [...names.refs, ...names.columns]).find((item) => item.name === name)?.label;
  let message = "";
  try {
    const references = formulaReferences(parseFormula(value));
    const known = new Set([...names.refs, ...names.columns].map((item) => item.name));
    const unknown = references.refs.find((name) => !known.has(name));
    if (unknown) message = `Okänt fält "${unknown}".`;
    else if (references.cells.length && !rowColumns) message = "Kolumner i raden fungerar bara i en tabellkolumn.";
  } catch (issue) { message = issue instanceof FormulaError ? issue.message : "Ogiltig formel."; }
  const model: SimpleFormula = simple ?? emptySimpleFormula(names.cells[0] ? { kind: "cell", name: names.cells[0].name } : names.refs[0] ? { kind: "ref", name: names.refs[0].name } : undefined);
  const update = (next: SimpleFormula) => onChange(simpleFormulaText(next));
  const visual = !advanced && (simple || !value.trim());

  return <div className="grid gap-2">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">Formel</span>
      {visual
        ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAdvanced(true)}><Code2 />Skriv formel</Button>
        : <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={Boolean(value.trim()) && !simple} onClick={() => setAdvanced(false)}
            title={value.trim() && !simple ? "Formeln är för avancerad för att byggas visuellt." : undefined}><Wand2 />Bygg visuellt</Button>}
    </div>
    {visual ? <div className="grid gap-2 rounded-lg border bg-muted/30 p-2.5">
      {model.terms.map((term, index) => <div key={index} className="flex items-center gap-1.5">
        {index ? <select aria-label={`Räknesätt ${index}`} className="form-select h-9 w-14 shrink-0 text-xs" value={model.ops[index - 1] ?? "+"} onChange={(event) => update({ ...model, ops: model.ops.map((op, opIndex) => opIndex === index - 1 ? event.target.value as SimpleFormula["ops"][number] : op) })}>
          {ARITHMETIC.map((item) => <option key={item.op} value={item.op}>{item.label}</option>)}
        </select> : <span className="w-14 shrink-0 text-center text-xs text-muted-foreground">=</span>}
        <OperandPicker label={`Led ${index + 1}`} operand={term} names={names} onChange={(operand) => update({ ...model, terms: model.terms.map((item, termIndex) => termIndex === index ? operand : item) })} />
        {index ? <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Ta bort led ${index + 1}`} onClick={() => update({ ...model, terms: model.terms.filter((_, termIndex) => termIndex !== index), ops: model.ops.filter((_, opIndex) => opIndex !== index - 1) })}><Trash2 /></Button> : null}
      </div>)}
      <div className="flex flex-wrap gap-1.5">
        {model.terms.length < 8 ? <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => update({ ...model, terms: [...model.terms, model.terms[0].kind === "cell" && names.cells[1] ? { kind: "cell", name: names.cells[1].name } : { kind: "number", value: "1" }], ops: [...model.ops, "*"] })}><Plus />Räkna med mer</Button> : null}
        <Button type="button" size="sm" variant={model.compare ? "secondary" : "outline"} className="h-8 text-xs" aria-pressed={Boolean(model.compare)}
          onClick={() => update({ ...model, compare: model.compare ? null : { op: ">=", right: { kind: "number", value: "1" } }, result: model.compare ? null : model.result })}>Jämför</Button>
      </div>
      {model.compare ? <div className="grid gap-1.5 border-t pt-2">
        <div className="flex items-center gap-1.5">
          <select aria-label="Jämförelse" className="form-select h-9 w-32 shrink-0 text-xs" value={model.compare.op} onChange={(event) => update({ ...model, compare: { ...model.compare!, op: event.target.value as NonNullable<SimpleFormula["compare"]>["op"] } })}>
            {COMPARISONS.map((item) => <option key={item.op} value={item.op}>{item.label}</option>)}
          </select>
          <OperandPicker label="Jämför med" operand={model.compare.right} names={names} onChange={(right) => update({ ...model, compare: { ...model.compare!, right } })} />
        </div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(model.result)} onChange={(event) => update({ ...model, result: event.target.checked ? { then: "Godkänd", otherwise: "Avvikelse" } : null })} />Visa text i stället för Ja/Nej</label>
        {model.result ? <div className="grid grid-cols-2 gap-1.5">
          <Input aria-label="Text när villkoret stämmer" className="h-9 text-xs" value={model.result.then} onChange={(event) => update({ ...model, result: { ...model.result!, then: event.target.value } })} />
          <Input aria-label="Text annars" className="h-9 text-xs" value={model.result.otherwise} onChange={(event) => update({ ...model, result: { ...model.result!, otherwise: event.target.value } })} />
        </div> : null}
      </div> : null}
    </div> : <>
      <textarea id={id} spellCheck={false} className="form-textarea min-h-16 font-mono text-xs" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={message ? true : undefined} aria-describedby={`${id}-status`} />
      <span className="text-[11px] text-muted-foreground">Svenska funktioner och semikolon: SUMMA, MEDEL, MIN, MAX, ANTAL, ANTAL.OM, OM, OCH, ELLER, INTE, AVRUNDA, ABS. Fält: {[...names.refs, ...names.columns].map((item) => item.name).join(", ") || "inga ännu"}.{names.cells.length ? ` Kolumner i raden: ${names.cells.map((cell) => `[${cell.name}]`).join(" ")}.` : ""}</span>
    </>}
    {value.trim() ? <p className="rounded-md bg-card px-2 py-1.5 text-xs" data-testid="formula-text">= {describeFormula(value, labelOf)}</p> : null}
    <span id={`${id}-status`} role="status" className={cn("text-xs", message ? "text-destructive" : "text-emerald-700 dark:text-emerald-300")}>{message || "Formeln är giltig."}</span>
  </div>;
}

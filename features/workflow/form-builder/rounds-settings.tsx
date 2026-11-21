"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONDITION_OPS, formLeafBlocks, type FormCondition, type FormFieldBlock, type FormLimit } from "@/lib/workflow/form-document";
import type { EditorDocument } from "@/lib/workflow/form-editor";
import { RemoveButton } from "@/components/ui/remove-button";

const OP_LABEL: Record<FormCondition["op"], string> = { eq: "är", neq: "är inte", filled: "är ifyllt", empty: "är tomt", gt: "är större än", gte: "är minst", lt: "är mindre än", lte: "är högst" };
const label = "grid gap-1.5 text-xs font-medium text-muted-foreground";
const numberOrNull = (value: string) => value.trim() === "" || !Number.isFinite(Number(value.replace(",", "."))) ? null : Number(value.replace(",", "."));
const numberText = (value: number | null) => value === null ? "" : String(value).replace(".", ",");

/**
 * Villkorad visning (2026-09-28): "Visa bara när [fält] [är] [värde]". The value picker follows the field – Ja/Nej, the
 * field's options or free text – so the author never types an internal code.
 */
export function ConditionSetting({ document, ownKey, condition, onChange }: { document: EditorDocument; ownKey?: string; condition: FormCondition; onChange: (condition: FormCondition) => void }) {
  const fields = formLeafBlocks(document).filter((block): block is FormFieldBlock => block.type === "field" && block.key !== ownKey);
  const field = fields.find((item) => item.key === condition.key);
  const needsValue = !["filled", "empty"].includes(condition.op);
  const numeric = field?.input === "number";
  const ops = CONDITION_OPS.filter((op) => numeric || !["gt", "gte", "lt", "lte"].includes(op));
  return <div className="grid gap-2" data-testid="condition-setting">
    <label className={label}>Visa bara när<select className="form-select" value={condition.key} onChange={(event) => onChange({ key: event.target.value, op: "eq", value: "" })}>
      <option value="">Alltid (inget villkor)</option>{fields.map((item) => <option key={item.id} value={item.key}>{item.label}</option>)}</select></label>
    {condition.key ? <div className="grid grid-cols-2 gap-2">
      <select aria-label="Villkor" className="form-select" value={condition.op} onChange={(event) => onChange({ ...condition, op: event.target.value as FormCondition["op"] })}>{ops.map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}</select>
      {!needsValue ? <span /> : field?.input === "yesno"
        ? <select aria-label="Värde" className="form-select" value={condition.value} onChange={(event) => onChange({ ...condition, value: event.target.value })}><option value="">Välj</option><option value="YES">Ja</option><option value="NO">Nej</option><option value="NA">Ej aktuellt</option></select>
        : field?.input === "choice" ? <select aria-label="Värde" className="form-select" value={condition.value} onChange={(event) => onChange({ ...condition, value: event.target.value })}><option value="">Välj</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
        : <Input aria-label="Värde" inputMode={numeric ? "decimal" : undefined} value={condition.value} maxLength={200} onChange={(event) => onChange({ ...condition, value: event.target.value })} />}
    </div> : null}
    <p className="text-[11px] text-muted-foreground">Dolda delar kräver inget, räknas som tomma och skrivs inte ut.</p>
  </div>;
}

/** Choosing one of the form's limits for a number, and whether its history is drawn as a trend. */
export function LimitChoice({ document, limitKey, trend, onChange }: { document: EditorDocument; limitKey: string; trend: boolean; onChange: (patch: { limitKey?: string; trend?: boolean }) => void }) {
  return <div className="grid gap-2">
    <label className={label}>Bedöm mot gränsvärde<select className="form-select" value={limitKey} onChange={(event) => onChange({ limitKey: event.target.value })}>
      <option value="">Inget</option>{document.limits.map((limit) => <option key={limit.key} value={limit.key}>{limit.label}{limit.unit ? ` (${limit.unit})` : ""}</option>)}</select></label>
    {!document.limits.length ? <p className="text-[11px] text-muted-foreground">Lägg till gränsvärden under Formulärets inställningar (klicka på arket utanför blocken).</p> : null}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={trend} onChange={(event) => onChange({ trend: event.target.checked })} />Följ som trend över tidigare protokoll</label>
  </div>;
}

/**
 * A limit field (2026-10-06): the number is itself a limit – the row's Gräns, the highest permitted value – filled in
 * on a new row or protocol from the company's value for the chosen form limit (Inställningar → Arbetssätt → Värden och referenser),
 * and changeable per row. A Godkänd condition that reads it waits for it ("Ej bedömd – ange gräns").
 */
export function LimitDefaultChoice({ document, limitDefault, onChange }: { document: EditorDocument; limitDefault: string | undefined; onChange: (limitDefault: string | undefined) => void }) {
  if (!document.limits.length) return null;
  return <label className={label}>Fältet är självt en gräns (inget mätvärde) – fylls i från<select className="form-select" data-testid="limit-default" value={limitDefault ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
    <option value="">Inget (vanligt mätvärde)</option>{document.limits.map((limit) => <option key={limit.key} value={limit.key}>{limit.label}{limit.unit ? ` (${limit.unit})` : ""}</option>)}</select></label>;
}

const slug = (text: string) => text.toLowerCase().normalize("NFC").replace(/[^a-zåäö0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-zåäö]+/, "").slice(0, 30) || "grans";

/**
 * The form's limits (2026-09-28): what each limit is, its unit, where its value comes from and – only when the value
 * is general – default alarm and warning levels. Each facility sets its own values in the protocol's Gränsvärden panel.
 */
export function LimitsEditor({ document, onChange }: { document: EditorDocument; onChange: (patch: Pick<EditorDocument, "limits" | "limitObjectKey">) => void }) {
  const limits = document.limits;
  const set = (next: FormLimit[]) => onChange({ limits: next, limitObjectKey: document.limitObjectKey });
  const update = (index: number, patch: Partial<FormLimit>) => set(limits.map((limit, position) => position === index ? { ...limit, ...patch } : limit));
  const list = useRef<HTMLDivElement>(null);
  // A new limit lands under the button, last in the list, and gets the focus (2026-10-07: "under, inte ovanför").
  const add = () => {
    const taken = new Set(limits.map((limit) => limit.key));
    let key = "grans";
    for (let index = 2; taken.has(key); index++) key = `grans_${index}`;
    set([...limits, { key, label: "Nytt gränsvärde", unit: "", low: null, high: null, warnLow: null, warnHigh: null, source: "Anläggningens tillverkaranvisning", help: "" }]);
    requestAnimationFrame(() => {
      const field = list.current?.querySelector<HTMLInputElement>("[data-testid=limit-row]:last-child input[aria-label=Namn]");
      field?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      field?.focus({ preventScroll: true });
      field?.select();
    });
  };
  const textFields = formLeafBlocks(document).filter((block): block is FormFieldBlock => block.type === "field" && (block.input === "text" || block.input === "choice"));
  return <div className="grid gap-3" data-testid="limits-editor">
    {/* The button stays at the top, where it was clicked; the new limit appears below it (2026-10-07). */}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="min-w-0 flex-1 basis-64 text-[11px] leading-4 text-muted-foreground">Ange vad som mäts. Lämna nivåerna tomma: värdet anges under Inställningar → Arbetssätt → Värden och referenser eller i protokollet.</p>
      <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={add} data-testid="limit-add"><Plus />Gränsvärde</Button>
    </div>
    {/* Two columns from 768 px (2026-10-07), so a form with many limits takes half as many rows. */}
    <div ref={list} className="grid items-start gap-3 md:grid-cols-2 empty:hidden" data-testid="limits-list">{limits.map((limit, index) => <fieldset key={index} className="field-group grid gap-2 rounded-lg border p-2.5" data-testid="limit-row">
      <legend className="px-1 text-xs font-medium">{limit.label || `Gränsvärde ${index + 1}`}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
        <Input aria-label="Namn" value={limit.label} maxLength={200} onChange={(event) => update(index, { label: event.target.value, ...(limit.key.startsWith("grans") ? { key: slug(event.target.value) } : {}) })} />
        <Input aria-label="Enhet" placeholder="Enhet" value={limit.unit} maxLength={20} onChange={(event) => update(index, { unit: event.target.value })} />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {([["low", "Larm lägst"], ["warnLow", "Varn. lägst"], ["warnHigh", "Varn. högst"], ["high", "Larm högst"]] as const).map(([field, text]) =>
          <label key={field} className="grid gap-1 text-[11px] text-muted-foreground">{text}<Input className="h-9 px-2" inputMode="decimal" aria-label={`${text}: ${limit.label}`} value={numberText(limit[field])} onChange={(event) => update(index, { [field]: numberOrNull(event.target.value) })} /></label>)}
      </div>
      <Input aria-label="Källa" placeholder="Var värdet hämtas, t.ex. Vattendom, Tillverkarens anvisning" value={limit.source} maxLength={300} onChange={(event) => update(index, { source: event.target.value })} />
      <div className="flex items-center justify-between gap-2"><Input aria-label="Intern kod" className="h-8 font-mono text-xs" value={limit.key} maxLength={40} onChange={(event) => update(index, { key: event.target.value.toLowerCase() })} />
        <RemoveButton label={`Ta bort ${limit.label}`} onClick={() => set(limits.filter((_, position) => position !== index))} /></div>
    </fieldset>)}</div>
    {limits.length ? <label className={label}>Gränsvärden per objekt (t.ex. aggregat)<select className="form-select" value={document.limitObjectKey} onChange={(event) => onChange({ limits, limitObjectKey: event.target.value })}>
      <option value="">Nej – samma för hela anläggningen</option>{textFields.map((field) => <option key={field.id} value={field.key}>Per värde i {field.label}</option>)}</select></label> : null}
  </div>;
}

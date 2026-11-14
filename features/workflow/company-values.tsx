"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Lightbulb, Save, Scale, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Field, Panel } from "@/features/kfid/ui";
import { formatSwedish } from "@/lib/swedish-time";
import { companyValueFilled, suggestionInputs, type CompanyValue, type CompanyValueGroup, type CompanyValueInput, type CompanyValueRow } from "@/lib/workflow/company-values";
import { catalogForms, emptyValueFilter, isValueSort, valueFilterNarrowed, viewCompanyValues, VALUE_SORTS, type ValueFilter } from "@/lib/workflow/company-values-view";
import { SUGGESTION_NOTE } from "@/lib/workflow/limit-suggestions";
import { PageHeader } from "@/components/page-shell";

export type CompanyValuesData = { canEdit: boolean; catalog: CompanyValueGroup[]; values: CompanyValue[] };
/** Cloud reads and writes /api/company-values; Local reads the catalog there and keeps the values in its file. */
export type CompanyValuesBackend = { load: () => Promise<CompanyValuesData>; save: (inputs: CompanyValueInput[]) => Promise<CompanyValue[]> };

export const cloudCompanyValues: CompanyValuesBackend = {
  load: () => api<CompanyValuesData>("/api/company-values", { cache: "no-store" }),
  save: async (inputs) => (await api<{ values: CompanyValue[] }>("/api/company-values", { method: "POST", body: JSON.stringify({ values: inputs }) })).values,
};

type Draft = { low: string; high: string; warnLow: string; warnHigh: string; source: string; reference: string };
const NUMBERS = [["low", "Lägst"], ["high", "Högst"], ["warnLow", "Varning under"], ["warnHigh", "Varning över"]] as const;
const numberText = (value: number | null | undefined) => value === null || value === undefined ? "" : String(value).replace(".", ",");
const parseNumber = (text: string) => { const trimmed = text.trim().replace(",", "."); return trimmed === "" ? null : Number(trimmed); };
const draftOf = (value: CompanyValue | undefined): Draft => ({ low: numberText(value?.low), high: numberText(value?.high), warnLow: numberText(value?.warnLow), warnHigh: numberText(value?.warnHigh), source: value?.source ?? "", reference: value?.reference ?? "" });
const sameDraft = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every((key) => a[key].trim() === b[key].trim());

/**
 * Inställningar → Värden och referenser (2026-10-06): the limits the company's forms declare, once per key, where
 * the administrator enters the company's own value and its source. Every protocol of every form with the same key is
 * filled in from it; a row left empty makes the protocols say "Ej bedömd – ange gräns". Workflow's suggestions are only
 * applied when the administrator presses "Använd förslagen", and only to rows that are still empty.
 *
 * Polished 2026-10-07: narrow fields, a muted legend for Lägst, Högst and Varning, filter and order (form, search,
 * "Saknar värde"), and the address ?form=<id>, which opens the page on one form – the cards under Ny uppgift link to it.
 */
export function CompanyValues({ backend, notify }: { backend: CompanyValuesBackend; notify: (text: string, error?: boolean) => void }) {
  const [data, setData] = useState<CompanyValuesData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The form comes from the address, so a link opens the page on it and the select keeps the address in step.
  const urlForm = useSearchParams().get("form") ?? "";
  const [filter, setFilter] = useState<ValueFilter>({ ...emptyValueFilter, formId: urlForm });
  // A new address moves the filter while rendering (React's "adjust state when a value changes").
  const [addressForm, setAddressForm] = useState(urlForm);
  if (addressForm !== urlForm) { setAddressForm(urlForm); setFilter((current) => current.formId === urlForm ? current : { ...current, formId: urlForm }); }
  const choose = (patch: Partial<ValueFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
    if (patch.formId !== undefined) {
      const url = new URL(window.location.href);
      if (patch.formId) url.searchParams.set("form", patch.formId); else url.searchParams.delete("form");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
  };
  // Ett formulär i taget (UX-granskningen C5, 2026-10-22): without a form in the address the page starts on the first form
  // that still lacks a value (or the first form); Saknar värde and Alla formulär stay one choice away.
  const start = useCallback((next: CompanyValuesData): ValueFilter => {
    const forms = catalogForms(next.catalog);
    const lacking = forms.find((form) => viewCompanyValues(next.catalog, next.values, { ...emptyValueFilter, formId: form.id }).missing > 0);
    return { ...emptyValueFilter, formId: (lacking ?? forms[0])?.id ?? "" };
  }, []);
  const load = useCallback(async () => {
    try {
      const next = await backend.load(); setData(next); setDrafts({}); setError("");
      if (!new URL(window.location.href).searchParams.get("form")) setFilter((current) => valueFilterNarrowed(current) ? current : start(next));
    }
    catch (cause) { setError((cause as Error).message); }
  }, [backend, start]);
  // Read once when the page opens: Local hands a new backend on every render of the open file.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(() => void load()); }, []);
  const valueOf = useCallback((key: string) => data?.values.find((value) => value.key === key), [data]);
  const changed = useMemo(() => Object.entries(drafts).filter(([key, draft]) => !sameDraft(draft, draftOf(valueOf(key)))), [drafts, valueOf]);
  const shown = useMemo(() => data ? viewCompanyValues(data.catalog, data.values, filter) : null, [data, filter]);
  const forms = useMemo(() => data ? catalogForms(data.catalog) : [], [data]);
  // The suggestions fill what is listed: with a form chosen, only that form's empty rows.
  const suggestions = useMemo(() => data && shown ? suggestionInputs(shown.groups, data.values) : [], [data, shown]);

  const write = async (inputs: CompanyValueInput[], done: string) => {
    setBusy(true);
    try {
      const values = await backend.save(inputs);
      setData((current) => current ? { ...current, values } : current);
      setDrafts({});
      notify(done);
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const save = () => {
    const inputs: CompanyValueInput[] = [];
    for (const [key, draft] of changed) {
      const numbers = Object.fromEntries(NUMBERS.map(([field]) => [field, parseNumber(draft[field])])) as Record<(typeof NUMBERS)[number][0], number | null>;
      const label = data?.catalog.flatMap((group) => group.rows).find((row) => row.key === key)?.label ?? key;
      if (Object.values(numbers).some((value) => value !== null && !Number.isFinite(value))) { notify(`${label}: skriv värdena som tal, t.ex. 0,5.`, true); return; }
      inputs.push({ key, ...numbers, source: draft.source.trim(), reference: draft.reference.trim(), version: valueOf(key)?.version });
    }
    if (inputs.length) void write(inputs, inputs.length === 1 ? "Värdet är sparat." : `${inputs.length} värden är sparade.`);
  };
  const useSuggestions = () => void write(suggestions, `${suggestions.length} förslag är ifyllda. Kontrollera dem mot er standard.`);

  const heading = <PageHeader title="Värden och referenser" description="Företagets egna gränsvärden för mätningar, och var de kommer ifrån. Ett värde anges en gång och fylls i alla protokoll med samma nyckel." />;
  if (error) return <div className="space-y-6">{heading}<p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!data || !shown) return <div className="space-y-6">{heading}<p className="page-description">Hämtar värdena…</p></div>;
  const narrowed = valueFilterNarrowed(filter);
  const flat = filter.sort !== "form";
  return <div className="space-y-5" data-testid="company-values">
    {heading}
    {data.canEdit && suggestions.length ? <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 shadow-xs" data-testid="company-values-suggestions">
      <Lightbulb className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1 basis-64 text-sm">{SUGGESTION_NOTE}. Fyller bara i de {suggestions.length} tomma rader{narrowed ? " som visas och" : ""} som Workflow har ett förslag för.</p>
      <Button type="button" variant="outline" disabled={busy} onClick={useSuggestions} data-testid="company-values-use-suggestions">Använd förslagen</Button>
    </div> : null}

    {/* Filter and order: the form (also from the address), a search, and the limits that still have no value. */}
    <div className="space-y-2 rounded-xl border bg-card p-2.5 shadow-xs" data-testid="company-values-filters">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 basis-full sm:basis-64 sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" aria-label="Sök värde" placeholder="Sök namn, nyckel eller källa" value={filter.query} onChange={(event) => choose({ query: event.target.value })} className="pl-9" data-testid="company-values-search" />
        </div>
        <select aria-label="Formulär" className="form-select min-w-0 flex-1 sm:w-60 sm:flex-none" value={shown.form?.id ?? ""} onChange={(event) => choose({ formId: event.target.value })} data-testid="company-values-form">
          <option value="">Alla formulär</option>
          {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
        </select>
        <select aria-label="Sortera" className="form-select min-w-0 flex-1 sm:w-48 sm:flex-none" value={filter.sort} onChange={(event) => { if (isValueSort(event.target.value)) choose({ sort: event.target.value }); }} data-testid="company-values-sort">
          {VALUE_SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <Button type="button" variant={filter.missingOnly ? "secondary" : "outline"} aria-pressed={filter.missingOnly} onClick={() => choose({ missingOnly: !filter.missingOnly })} data-testid="company-values-missing">Saknar värde ({shown.missing})</Button>
        {narrowed ? <Button type="button" variant="ghost" onClick={() => choose({ ...emptyValueFilter, sort: filter.sort, formId: "" })} data-testid="company-values-clear"><X />Rensa</Button> : null}
      </div>
    </div>
    {shown.form ? <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="company-values-form-filter">
      <Scale className="size-4 text-primary" aria-hidden="true" />
      <span>Värden för <strong className="font-semibold">{shown.form.name}</strong></span>
      <button type="button" className="text-primary underline underline-offset-4" onClick={() => choose({ formId: "" })}>Visa alla</button>
    </p> : filter.formId ? <p className="notice" role="status" data-testid="company-values-form-unknown">Det formuläret har inga gränsvärden att ange. <button type="button" className="text-primary underline underline-offset-4" onClick={() => choose({ formId: "" })}>Visa alla</button></p> : null}

    {/* What the four fields mean, once, in muted text. */}
    <dl className="grid gap-x-6 gap-y-1 text-xs leading-5 text-muted-foreground sm:grid-cols-[auto_1fr]" data-testid="company-values-legend">
      <dt className="font-medium">Lägst och Högst</dt><dd>Gränsen för vad som godkänns. Utanför den är värdet en avvikelse.</dd>
      <dt className="font-medium">Varning under och över</dt><dd>Gränsen för en varning. Utanför den, men inom Lägst och Högst, är värdet bara en varning.</dd>
      <dt className="font-medium">Källa och version</dt><dd>Var värdet kommer från, till exempel en standard, ett dokument eller en egen rutin. Syns i protokollet.</dd>
    </dl>

    {!shown.total ? <p className="text-sm text-muted-foreground">Inga av företagets formulär har gränsvärden ännu.</p>
      : !shown.shown ? <p className="notice" role="status" data-testid="company-values-none">Inga värden matchar. Ändra sökningen eller filtret.</p>
      : narrowed ? <p className="text-xs text-muted-foreground" role="status">Visar {shown.shown} av {shown.total} värden.</p> : null}
    {shown.groups.map((group) => <Panel key={group.title} title={group.title} description={flat ? VALUE_SORTS.find((item) => item.value === filter.sort)?.label : undefined}>
      <ul className="divide-y">{group.rows.map((row) => <ValueRow key={row.key} row={row} value={valueOf(row.key)} draft={drafts[row.key] ?? draftOf(valueOf(row.key))} canEdit={data.canEdit && !busy}
        onChange={(draft) => setDrafts((current) => ({ ...current, [row.key]: draft }))} />)}</ul>
    </Panel>)}
    {/* Kalkylatorns values (2026-10-12) live inside Kalkylatorn since UX-granskningen C5 (2026-10-22). */}
    <p className="text-xs text-muted-foreground" data-testid="company-values-calc-link">Kalkylatorns värden – kabel, belastbarhet och Mina skyddsapparater – finns i <Link href="/?view=calculators&tool=company-values" className="text-primary underline underline-offset-4">Kalkylatorn → Företagets värden</Link>.</p>
    {/* One save for every changed row, kept in sight while the page is scrolled (above the phone's bottom menu). */}
    {data.canEdit && changed.length ? <div className="sticky bottom-24 z-10 flex justify-end lg:bottom-4"><Button type="button" className="shadow-md" disabled={busy} onClick={save} data-testid="company-values-save"><Save />Spara {changed.length === 1 ? "ändringen" : `${changed.length} ändringar`}</Button></div> : null}
  </div>;
}

function ValueRow({ row, value, draft, canEdit, onChange }: { row: CompanyValueRow; value: CompanyValue | undefined; draft: Draft; canEdit: boolean; onChange: (draft: Draft) => void }) {
  const id = `company-value-${row.key}`;
  const set = (field: keyof Draft) => (text: string) => onChange({ ...draft, [field]: text });
  return <li className="grid gap-3 py-4 first:pt-0 last:pb-0" data-testid={id}>
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{row.label}{row.unit ? <span className="font-normal text-muted-foreground"> ({row.unit})</span> : null}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Används i: {row.usedIn.join(", ")} · nyckel <code className="font-mono">{row.key}</code></p>
        {row.help ? <p className="mt-0.5 text-xs text-muted-foreground">{row.help}</p> : null}
      </div>
      {companyValueFilled(value)
        ? <span className="text-xs text-muted-foreground">{value?.updatedByName ? `Ändrat av ${value.updatedByName}` : "Angivet"}{value?.updatedAt ? ` · ${formatSwedish(value.updatedAt, { dateStyle: "short" })}` : ""}</span>
        : <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100" title="Protokollen visar Ej bedömd – ange gräns" data-testid={`${id}-empty`}>Saknar värde</span>}
    </div>
    {/* Narrow number fields; the source takes the room that is left, the version or date a fixed width. */}
    <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
      {NUMBERS.map(([field, label]) => <Field key={field} id={`${id}-${field}`} label={`${label}${row.unit ? ` (${row.unit})` : ""}`} value={draft[field]} onChange={set(field)} disabled={!canEdit} className="sm:w-32" />)}
      <Field id={`${id}-source`} label="Källa" value={draft.source} onChange={(text) => set("source")(text.slice(0, 300))} disabled={!canEdit} className="col-span-2 sm:min-w-40 sm:flex-1" />
      <Field id={`${id}-reference`} label="Version eller datum" value={draft.reference} onChange={(text) => set("reference")(text.slice(0, 120))} disabled={!canEdit} className="col-span-2 sm:w-40" />
    </div>
  </li>;
}

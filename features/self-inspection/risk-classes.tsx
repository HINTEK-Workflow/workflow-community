"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Layers } from "lucide-react";
import { Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { FORM_CATEGORIES, formCategory } from "@/lib/workflow/form-publish";
import { formRiskKey, proposedRiskClass, RISK_CLASS_TEXTS, RISK_CLASSES, WORK_ORDER_RISK_KEY, type RiskClass } from "@/lib/self-inspection/levels";
import type { SelfInspectionView } from "@/lib/self-inspection/model";
import { Tag, type Run } from "./shared";

/**
 * Riskklasser (2026-10-07): the company's admin sets a risk class 1–3 for every task type – the work order and each
 * form (Workflow's originals, the company's versions and its own). Workflow only proposes: a type without a class of its own
 * shows the proposal, marked as one. The class decides, together with the levels of the roles, who may be assigned, start,
 * fill in, complete and sign a task; the server enforces it for the app, the API and MCP.
 */
type FormCard = { id: string; name: string; category: string; baseId?: string | null; publisher?: string; hintek?: boolean };
type Row = { key: string; name: string; note: string; proposal: RiskClass };

export function RiskClassesTab({ view, busy, run }: { view: SelfInspectionView; busy: boolean; run: Run }) {
  const [forms, setForms] = useState<FormCard[] | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let active = true;
    // The same list as Ny uppgift: Workflow's published forms and the company's own, one row per form family.
    api<{ forms: FormCard[] }>("/api/forms").then((result) => { if (active) setForms(result.forms); }).catch((issue) => { if (active) setProblem((issue as Error).message); });
    return () => { active = false; };
  }, []);
  const levels = view.levels;
  const groups = useMemo(() => {
    const byCategory = new Map<string, Row[]>();
    for (const form of forms ?? []) {
      const category = formCategory(form.category);
      const formId = form.baseId ?? form.id;
      const rows = byCategory.get(category) ?? [];
      rows.push({ key: formRiskKey(formId), name: form.name, note: form.baseId ? "Er version av ett Workflow-original" : form.hintek ? `${form.publisher || "HINTEK"} Original` : form.publisher ? `Utgivare: ${form.publisher}` : "", proposal: proposedRiskClass({ kind: "FORM", formId, category }) });
      byCategory.set(category, rows);
    }
    return [
      { label: "Inbyggd", rows: [{ key: WORK_ORDER_RISK_KEY, name: "Arbetsorder", note: "Inbyggd uppgiftstyp", proposal: proposedRiskClass({ kind: "WORK_ORDER" }) }] },
      ...FORM_CATEGORIES.flatMap(([value, label]) => byCategory.has(value) ? [{ label, rows: byCategory.get(value)!.sort((a, b) => a.name.localeCompare(b.name, "sv")) }] : []),
    ];
  }, [forms]);
  const placed = levels.people.filter((person) => person.level > 0).length;
  const unplaced = levels.enforced ? view.people.filter((person) => !levels.people.some((item) => item.personId === person.id && item.level > 0)) : [];
  const set = (key: string, value: string) => void run({ action: "set_risk_class", key, riskClass: value ? Number(value) : null }, value ? "Krävd nivå är sparad." : "Krävd nivå återgick till Workflows förslag.");
  return <div className="space-y-5" data-testid="self-inspection-risk-classes">
    <Panel icon={Layers} title="Krävd nivå per uppgiftstyp" description="Så avgör nivåerna vem som får arbeta i en uppgift.">
      <div className="space-y-3">
        <p className="text-sm">Varje uppgiftstyp kräver en nivå (1–3). Ingen får arbeta i en uppgift över sin egen nivå.</p>
        <details className="text-sm" data-testid="self-inspection-levels-more"><summary className="cursor-pointer text-primary">Så fungerar nivåerna</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>Varje roll har en nivå (1–3). Personens nivå är den högsta bland rollerna.</li>
          <li>Nivåer märkta ”förslag” är Workflows förslag tills företaget väljer en egen.</li>
          <li>Ingen får arbeta i en uppgift som kräver högre nivå än den egna.</li>
          <li>Under handledning får man göra uppgifter över sin nivå när en handledare med rätt nivå är ansvarig.</li>
          <li>Inget spärras förrän minst en person har en roll.</li>
        </ul></details>
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="self-inspection-levels-state">
          {levels.enforced ? <Tag tone="primary">Spärren är på</Tag> : <Tag>Spärren är av</Tag>}
          <span className="text-muted-foreground">{levels.enforced ? `${placed} ${placed === 1 ? "person har" : "personer har"} en roll.` : "Ingen i företaget har fått en roll ännu, så nivåerna spärrar ingenting."}</span>
        </p>
        {unplaced.length > 0 && <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200" data-testid="self-inspection-levels-unplaced" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Utan roll kan man inte tilldelas, starta, fylla i, slutföra eller signera uppgifter som kräver en nivå: {unplaced.map((person) => person.name).join(", ")}. Ge dem en roll under Program.</span>
        </p>}
      </div>
    </Panel>
    {problem ? <p role="alert" className="notice text-destructive">Uppgiftstyperna kunde inte hämtas: {problem}</p> : null}
    {groups.map((group) => <Panel key={group.label} title={group.label} collapsible defaultCollapsed={false}>
      <ul className="divide-y" data-testid="self-inspection-risk-rows">{group.rows.map((row) => {
        const own = levels.riskClasses[row.key];
        const value = RISK_CLASSES.includes(own as RiskClass) ? String(own) : "";
        return <li key={row.key} className="flex flex-wrap items-center justify-between gap-3 py-3" data-risk-key={row.key}>
          <div className="min-w-0">
            <p className="text-sm font-medium">{row.name}</p>
            {row.note ? <p className="text-xs text-muted-foreground">{row.note}</p> : null}
          </div>
          <select className="form-select w-full sm:w-72" value={value} disabled={busy} aria-label={`Krävd nivå för ${row.name}`} onChange={(event) => set(row.key, event.target.value)}>
            <option value="">{`Förslag från Workflow: nivå ${row.proposal}`}</option>
            {RISK_CLASSES.map((item) => <option key={item} value={item}>{RISK_CLASS_TEXTS[item]}</option>)}
          </select>
        </li>;
      })}</ul>
    </Panel>)}
    {forms === null && !problem ? <p role="status" className="text-sm text-muted-foreground">Hämtar uppgiftstyperna…</p> : null}
  </div>;
}

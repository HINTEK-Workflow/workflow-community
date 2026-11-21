"use client";
import { useId, useState } from "react";
import { Pause, Pencil, Play, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { OUTCOME_TYPE_LABELS, OUTCOME_TYPES, RULE_OPERATOR_LABELS, RULE_OPERATORS, RULE_SAFETY_TEXT, type RuleOperator } from "@/lib/machine/signal-rules";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";

/**
 * Integrationsmotorn E3 (2026-10-24, beslut 1 och 6): a signal's rules on its row on the signal page. A rule is a
 * fixed comparison (with hysteresis and duration) whose outcome – an alarm, a run state or a diagnosis – goes through the
 * ordinary chain. Changing a rule asks for a confirmation when the sign-in is older than 15 minutes (the server decides; the
 * shared reauth dialog asks and the change is tried again). Edited in the row, never in a window over the page.
 */
export type RuleRow = {
  id: string; signalId: string; operator: RuleOperator; value: unknown; hysteresis: number | null; forSeconds: number; outcomeType: "alarm" | "state" | "diagnosis";
  outcomeCode: string; outcomeSeverity: string; outcomeState: string | null; outcomeText: string; isActive: boolean; active: boolean; summary: string;
};
type Draft = { operator: RuleOperator; value: string; hysteresis: string; forSeconds: string; outcomeType: RuleRow["outcomeType"]; outcomeCode: string; outcomeSeverity: string; outcomeState: string; outcomeText: string; isActive: boolean };
const SEVERITIES: [string, string][] = [["info", "Info"], ["warning", "Varning"], ["fault", "Fel"], ["critical", "Kritiskt"]];

const draftOf = (rule: RuleRow | null, kind: string): Draft => rule ? {
  operator: rule.operator, value: rule.value === null || rule.value === undefined ? "" : String(rule.value), hysteresis: rule.hysteresis === null ? "" : String(rule.hysteresis), forSeconds: String(rule.forSeconds),
  outcomeType: rule.outcomeType, outcomeCode: rule.outcomeCode, outcomeSeverity: rule.outcomeSeverity, outcomeState: rule.outcomeState ?? "stopped", outcomeText: rule.outcomeText, isActive: rule.isActive,
} : { operator: kind === "code" ? "stale" : kind === "number" ? "gt" : "eq", value: kind === "boolean" ? "true" : kind === "code" ? "900" : "", hysteresis: "", forSeconds: "0", outcomeType: "alarm", outcomeCode: "", outcomeSeverity: "fault", outcomeState: "stopped", outcomeText: "", isActive: true };

/** The draft as the server wants it: numbers as numbers, a boolean signal's value as true/false. */
function payload(draft: Draft, kind: string) {
  const number = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));
  const value = draft.operator === "changed" ? null : draft.operator === "stale" || kind === "number" ? number(draft.value) : kind === "boolean" ? draft.value === "true" : draft.value.trim();
  return {
    operator: draft.operator, value, hysteresis: ["gt", "gte", "lt", "lte"].includes(draft.operator) ? number(draft.hysteresis) : null, forSeconds: Math.round(number(draft.forSeconds) ?? 0),
    outcomeType: draft.outcomeType, outcomeCode: draft.outcomeCode.trim(), outcomeSeverity: draft.outcomeSeverity, outcomeState: draft.outcomeType === "state" ? draft.outcomeState : null, outcomeText: draft.outcomeText, isActive: draft.isActive,
  };
}
const operatorsFor = (kind: string): RuleOperator[] => kind === "code" ? ["stale"] : kind === "number" ? [...RULE_OPERATORS] : RULE_OPERATORS.filter((operator) => !["gt", "gte", "lt", "lte"].includes(operator));

export function SignalRules({ signal, rules, onChanged, notify }: { signal: { id: string; kind: string }; rules: RuleRow[]; onChanged: () => Promise<void>; notify: (text: string, error?: boolean) => void }) {
  const [editing, setEditing] = useState<{ rule: RuleRow | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const send = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await api("/api/machine-sources", { method: "POST", body: JSON.stringify(body) }); notify(done); setEditing(null); await onChanged(); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const remove = async (rule: RuleRow) => {
    if (!(await confirm({ title: "Ta bort regeln?", message: rule.summary, confirmLabel: "Ta bort", tone: "danger" }))) return;
    await send({ action: "delete_rule", ruleId: rule.id }, "Regeln är borttagen.");
  };
  const toggle = (rule: RuleRow) => send({ action: "update_rule", ruleId: rule.id, rule: { ...payload(draftOf(rule, signal.kind), signal.kind), isActive: !rule.isActive } }, rule.isActive ? "Regeln är pausad." : "Regeln är på.");
  return <div className="mt-2 space-y-2 border-t pt-2" data-testid="machine-rules">
    {confirmElement}
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-semibold text-muted-foreground">Regler</h4>
      {!editing ? <Button type="button" variant="ghost" size="sm" className="-my-1 text-primary touch:h-11" onClick={() => setEditing({ rule: null })} data-testid="machine-rule-new"><Plus />Ny regel</Button> : null}</div>
    {rules.length ? <ul className="space-y-1.5">{rules.map((rule) => <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid="machine-rule">
      <span className="min-w-0 [overflow-wrap:anywhere]">{rule.summary}{" "}
        {!rule.isActive ? <Badge variant="outline" className={indicatorBadge("neutral")}>Pausad</Badge> : rule.active ? <Badge variant="outline" className={indicatorBadge("danger")} data-testid="machine-rule-struck">Har slagit till</Badge> : null}</span>
      <span className="flex gap-1">
        <IconButton label="Ändra regeln" title="Ändra" disabled={busy} onClick={() => setEditing({ rule })} data-testid="machine-rule-edit"><Pencil /></IconButton>
        <IconButton label={rule.isActive ? "Pausa regeln" : "Slå på regeln"} title={rule.isActive ? "Pausa" : "Slå på"} disabled={busy} onClick={() => void toggle(rule)} data-testid="machine-rule-toggle">{rule.isActive ? <Pause /> : <Play />}</IconButton>
        <RemoveButton label="Ta bort regeln" title="Ta bort" disabled={busy} onClick={() => void remove(rule)} data-testid="machine-rule-remove" />
      </span>
    </li>)}</ul> : !editing ? <p className="text-xs text-muted-foreground">Signalen har inga regler än. Utan en regel blir det ingen händelse av den.</p> : null}
    {editing ? <RuleEditor kind={signal.kind} initial={draftOf(editing.rule, signal.kind)} busy={busy} onCancel={() => setEditing(null)}
      onSave={(draft) => void send(editing.rule ? { action: "update_rule", ruleId: editing.rule.id, rule: payload(draft, signal.kind) } : { action: "create_rule", signalId: signal.id, rule: payload(draft, signal.kind) }, "Regeln är sparad.")} /> : null}
  </div>;
}

function RuleEditor({ kind, initial, busy, onCancel, onSave }: { kind: string; initial: Draft; busy: boolean; onCancel: () => void; onSave: (draft: Draft) => void }) {
  const [draft, setDraft] = useState(initial);
  const prefix = useId();
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const label = "field-label text-xs font-medium";
  const ordered = ["gt", "gte", "lt", "lte"].includes(draft.operator);
  return <form className="space-y-3 rounded-lg border p-3" onSubmit={(event) => { event.preventDefault(); onSave(draft); }} data-testid="machine-rule-editor">
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="grid gap-1.5"><label htmlFor={`${prefix}-operator`} className={label}>Villkor</label>
        <select id={`${prefix}-operator`} className="form-select" value={draft.operator} onChange={(event) => set({ operator: event.target.value as RuleOperator })} data-testid="machine-rule-operator">
          {operatorsFor(kind).map((operator) => <option key={operator} value={operator}>{RULE_OPERATOR_LABELS[operator]}</option>)}
        </select></div>
      {draft.operator !== "changed" ? <div className="grid gap-1.5"><label htmlFor={`${prefix}-value`} className={label}>{draft.operator === "stale" ? "Sekunder" : "Värde"}</label>
        {kind === "boolean" && draft.operator !== "stale" ? <select id={`${prefix}-value`} className="form-select" value={draft.value} onChange={(event) => set({ value: event.target.value })} data-testid="machine-rule-value"><option value="true">Sant</option><option value="false">Falskt</option></select>
          : <Input id={`${prefix}-value`} inputMode={kind === "number" || draft.operator === "stale" ? "decimal" : "text"} value={draft.value} onChange={(event) => set({ value: event.target.value })} data-testid="machine-rule-value" />}</div> : null}
      {ordered ? <div className="grid gap-1.5"><label htmlFor={`${prefix}-hysteresis`} className={label}>Hysteres (valfritt)</label>
        <Input id={`${prefix}-hysteresis`} inputMode="decimal" value={draft.hysteresis} onChange={(event) => set({ hysteresis: event.target.value })} /></div> : null}
      {draft.operator !== "changed" && draft.operator !== "stale" ? <div className="grid gap-1.5"><label htmlFor={`${prefix}-for`} className={label}>I minst (sekunder)</label>
        <Input id={`${prefix}-for`} inputMode="numeric" value={draft.forSeconds} onChange={(event) => set({ forSeconds: event.target.value })} /></div> : null}
      <div className="grid gap-1.5"><label htmlFor={`${prefix}-outcome`} className={label}>Ger</label>
        <select id={`${prefix}-outcome`} className="form-select" value={draft.outcomeType} onChange={(event) => set({ outcomeType: event.target.value as Draft["outcomeType"] })} data-testid="machine-rule-outcome">
          {OUTCOME_TYPES.map((type) => <option key={type} value={type}>{OUTCOME_TYPE_LABELS[type]}</option>)}
        </select></div>
      {draft.outcomeType === "state" ? <div className="grid gap-1.5"><label htmlFor={`${prefix}-state`} className={label}>Driftläge</label>
        <select id={`${prefix}-state`} className="form-select" value={draft.outcomeState} onChange={(event) => set({ outcomeState: event.target.value })}><option value="stopped">Stoppad</option><option value="running">I drift</option></select></div> : null}
      <div className="grid gap-1.5"><label htmlFor={`${prefix}-code`} className={label}>Kod</label>
        <Input id={`${prefix}-code`} maxLength={64} value={draft.outcomeCode} placeholder="Till exempel TEMP_HIGH" onChange={(event) => set({ outcomeCode: event.target.value })} data-testid="machine-rule-code" /></div>
      <div className="grid gap-1.5"><label htmlFor={`${prefix}-severity`} className={label}>Nivå</label>
        <select id={`${prefix}-severity`} className="form-select" value={draft.outcomeSeverity} onChange={(event) => set({ outcomeSeverity: event.target.value })} data-testid="machine-rule-severity">
          {SEVERITIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select></div>
      <div className="grid gap-1.5 sm:col-span-3"><label htmlFor={`${prefix}-text`} className={label}>Text (valfritt)</label>
        <Input id={`${prefix}-text`} maxLength={200} value={draft.outcomeText} onChange={(event) => set({ outcomeText: event.target.value })} data-testid="machine-rule-text" /></div>
    </div>
    <p className="text-xs text-muted-foreground" data-testid="machine-rule-safety">{RULE_SAFETY_TEXT} Larm med nivån Fel eller Kritiskt kan bli arbetsordrar enligt källans val.</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>Avbryt</Button>
      <Button type="submit" size="sm" disabled={busy || !draft.outcomeCode.trim()} data-testid="machine-rule-save" busy={busy} busyLabel="Sparar…">Spara regeln</Button>
    </div>
  </form>;
}

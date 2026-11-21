"use client";

import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogActions, Field, Modal } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import { announce } from "@/lib/workflow/toast";
import { defaultTimeTypePolicy, orderedTimeTypes, TIME_TYPE_BILLING_LABELS, TIME_TYPE_BILLINGS, TIME_TYPE_CODE_MAX, TIME_TYPE_NAME_MAX, timeTypePolicyText, type TimeTypeBilling, type TimeTypePolicy, type TimeTypeView } from "@/lib/workflow/time-types";

/**
 * Tidstyper (2026-10-29) under Tid → Lön och export: the company's own list of kinds of time with an optional payroll
 * code for the export. Admins add, rename, switch off, order and remove (unused) types; others with access read the list. The
 * standard type is used for time without a chosen type and is always on. No agreement rules: the payroll system computes pay.
 */
type Draft = { id?: string; name: string; payrollCode: string; active: boolean; isDefault?: boolean; policy: TimeTypePolicy };
const draftPolicy = (type: Pick<TimeTypeView, "name" | "policy">) => type.policy ?? defaultTimeTypePolicy(type.name);

/** `onChanged`: the page around it reads its own data again (Tid offers the new list at once). */
export function TimeTypesSection({ onChanged, framed = true }: { onChanged?: () => void; /** false inside a card that already names it (Lön och export): no frame and no heading of its own. */ framed?: boolean } = {}) {
  const [types, setTypes] = useState<TimeTypeView[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { const answer = await api<{ timeTypes: TimeTypeView[]; canEdit: boolean }>("/api/workflow-time?types=1", { cache: "no-store" }); setTypes(answer.timeTypes); setCanEdit(answer.canEdit); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Tidstyperna kunde inte läsas."); }
  }, []);
  useLoadEffect(load);
  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true); setError("");
    try {
      const answer = await api<{ timeTypes: TimeTypeView[] }>("/api/workflow-time", { method: "POST", body: JSON.stringify(body) });
      setTypes(answer.timeTypes); announce(done); onChanged?.(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Det gick inte att spara."); return false; }
    finally { setBusy(false); }
  }
  const list = types ? orderedTimeTypes(types) : [];
  const remove = async (type: TimeTypeView) => {
    if (await confirm({ title: "Ta bort tidstypen?", message: `${type.name} tas bort ur listan. Har tid rapporterats med typen stänger du av den i stället.`, confirmLabel: "Ta bort", tone: "danger" }))
      await post({ action: "time_type_remove", id: type.id }, "Tidstypen är borttagen.");
  };
  return <section className={cn("space-y-2", framed && "rounded-lg border p-3")} data-testid="time-types" aria-labelledby={framed ? "time-types-heading" : undefined} aria-label={framed ? undefined : "Tidstyper"}>
    <div className={cn("flex flex-wrap items-center gap-2", framed ? "justify-between" : "justify-end")}>
      {framed ? <div className="min-w-0">
        <h3 id="time-types-heading" className="text-sm font-semibold">Tidstyper</h3>
        <p className="text-xs text-muted-foreground">Företagets egna typer av tid. Varje typs kod följer med i exporten till lönesystemet.</p>
      </div> : null}
      {canEdit ? <Button type="button" size="sm" variant="outline" disabled={busy || !types} onClick={() => setEditing({ name: "", payrollCode: "", active: true, policy: defaultTimeTypePolicy("") })} data-testid="time-type-new"><Plus />Ny tidstyp</Button> : null}
    </div>
    {error ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
    {!types ? <p className="text-sm text-muted-foreground">Läser…</p> : <ul className="divide-y rounded-lg border text-sm">
      {list.map((type, index) => <li key={type.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2" data-testid="time-type-row">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("font-medium [overflow-wrap:anywhere]", !type.active && "text-muted-foreground")}>{type.name}</span>
          <span className="text-xs text-muted-foreground">{type.payrollCode ? `Kod ${type.payrollCode}` : "Ingen kod"}</span>
          {type.policy ? <span className="text-xs text-muted-foreground" data-testid="time-type-policy">{timeTypePolicyText(type.policy)}</span> : null}
          {type.isDefault ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", indicatorBadge("success"))}>Standard</span> : null}
          {!type.active ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", indicatorBadge("warning"))}>Avstängd</span> : null}
        </span>
        {canEdit ? <span className="flex shrink-0">
          <IconButton label={`Flytta upp ${type.name}`} disabled={busy || index === 0} onClick={() => void post({ action: "time_type_move", id: type.id, step: -1 }, "Ordningen är sparad.")}><ArrowUp /></IconButton>
          <IconButton label={`Flytta ned ${type.name}`} disabled={busy || index === list.length - 1} onClick={() => void post({ action: "time_type_move", id: type.id, step: 1 }, "Ordningen är sparad.")}><ArrowDown /></IconButton>
          <IconButton label={`Ändra ${type.name}`} disabled={busy} onClick={() => setEditing({ ...type, policy: draftPolicy(type) })}><Pencil /></IconButton>
          <RemoveButton label={`Ta bort ${type.name}`} disabled={busy || type.isDefault} disabledReason={type.isDefault ? "Standardtypen kan inte tas bort." : undefined} onClick={() => void remove(type)} />
        </span> : null}
      </li>)}
    </ul>}
    {editing ? <TimeTypeEditor value={editing} busy={busy} error={error} onClose={() => { setEditing(null); setError(""); }}
      onSave={async (draft) => { if (await post({ action: "time_type_save", type: { id: draft.id, name: draft.name, payrollCode: draft.payrollCode, active: draft.active, policy: draft.policy } }, "Tidstypen är sparad.")) setEditing(null); }} /> : null}
    {confirmElement}
  </section>;
}

function TimeTypeEditor({ value, busy, error, onClose, onSave }: { value: Draft; busy: boolean; error: string; onClose: () => void; onSave: (draft: Draft) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={value.id ? "Ändra tidstyp" : "Ny tidstyp"} size="compact" nativeScreen>
    <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void onSave(draft); }} data-testid="time-type-editor">
      <Field id="time-type-name" label="Namn" value={draft.name} onChange={(name) => setDraft({ ...draft, name: name.slice(0, TIME_TYPE_NAME_MAX) })} required placeholder="Till exempel Övertid" />
      <Field id="time-type-code" label="Lönekod" hint="Typens kod i lönesystemet, till exempel en löneart eller tidkod. Du kan lämna den tom." value={draft.payrollCode} onChange={(payrollCode) => setDraft({ ...draft, payrollCode: payrollCode.slice(0, TIME_TYPE_CODE_MAX) })} />
      <Field id="time-type-billing" label="Fakturering" value={draft.policy.billing} options={[...TIME_TYPE_BILLINGS]} optionLabels={TIME_TYPE_BILLING_LABELS} onChange={(billing) => setDraft({ ...draft, policy: { ...draft.policy, billing: billing as TimeTypeBilling } })} />
      {draft.policy.billing === "own" ? <Field id="time-type-price" label="Pris, kr/h" hint="Tiden blir en egen rad i fakturaunderlaget. Utan pris står det på raden att pris saknas." value={draft.policy.price} onChange={(price) => setDraft({ ...draft, policy: { ...draft.policy, price: price.slice(0, 20) } })} /> : null}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.policy.workingTime} onChange={(event) => setDraft({ ...draft, policy: { ...draft.policy, workingTime: event.target.checked } })} data-testid="time-type-working" />Räknas som arbetstid</label>
      {value.isDefault ? <p className="text-xs text-muted-foreground">Standardtypen används för tid där ingen typ är vald. Den är alltid på.</p>
        : <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} data-testid="time-type-active" />Kan väljas när man rapporterar tid</label>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", testId: "time-type-save" }} />
    </form>
  </Modal>;
}

"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ClipboardList, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/disabled-reason";
import type { MaintenancePriority } from "@/lib/workflow/maintenance";
import type { FormActions } from "./form-renderer";
import { deviationHref } from "@/lib/self-inspection/deviation-link";

/**
 * "Skapa arbetsorder" on any deviation of a control or form (2026-10-06): a measurement row that is not approved,
 * a deviating row of any table, a point that is not OK or a field with a deviation. The order gets the deviation as its
 * fault, the protocol's place and project, a priority (Hög unless the row says otherwise) and a link back to the very
 * row (`targetId`), so the finished order can lead back there. Once made, the button opens the order and
 * shows its status. Never shown in a read-only protocol unless an order already exists.
 */
export function DeviationOrder({ reasonId, ...props }: Omit<Parameters<typeof WorkOrderButton>[0], "reasonId"> & {
  /** The id of a visible line beside the buttons that already says why they wait (a card's footer); else they get their own line. */
  reasonId?: string;
}) {
  const ownId = useId();
  const { actions, readOnly, targetId, existing } = props;
  // Before the protocol's first save neither button can be used yet: both say why (visibly, and as a toast on a tap).
  const waiting = actions?.canCreateWorkOrder === false && ((!existing && !readOnly && Boolean(actions.createWorkOrder)) || (Boolean(actions.logDeviation) && !actions.loggedDeviation?.(targetId)));
  const describedBy = waiting ? reasonId ?? ownId : undefined;
  const line = waiting && !reasonId ? <DisabledReason id={ownId} reason={UNSAVED_REASON} className="w-full" /> : null;
  // Egenkontroll (etapp 2): beside the work order, the same deviation can go to the programme's deviation log.
  if (!actions?.logDeviation && !actions?.loggedDeviation?.(targetId)) return line ? <span className="inline-flex flex-wrap items-center gap-2"><WorkOrderButton {...props} reasonId={describedBy} />{line}</span> : <WorkOrderButton {...props} reasonId={describedBy} />;
  return <span className="inline-flex flex-wrap items-center gap-2"><WorkOrderButton {...props} reasonId={describedBy} /><DeviationLogButton actions={actions} targetId={targetId} title={props.title} description={props.description} reasonId={describedBy} />{line}</span>;
}

/** Why the buttons wait in a protocol that has never been saved (2026-10-02): an order or entry made now would have no way back. */
export const UNSAVED_REASON = "Spara protokollet först, så kan avvikelsen kopplas hit.";

/**
 * "Till avvikelseloggen" (etapp 2, 2026-10-06): the deviation becomes an entry in the self-inspection
 * programme's log with the protocol and row as its source, so the log leads back here. Once logged, it shows the
 * entry's number. Also on a completed protocol: the log is the programme's, not the protocol's.
 */
function DeviationLogButton({ actions, targetId, title, description, reasonId }: { actions?: FormActions; targetId: string; title: string; description: string; reasonId?: string }) {
  const [busy, setBusy] = useState(false);
  const logged = actions?.loggedDeviation?.(targetId);
  if (logged) return <Button size="sm" variant="outline" asChild data-testid="form-row-deviation-log"><Link href={logged.id ? deviationHref(logged.id) : "/?view=deviations"}><ClipboardList />Avvikelse {logged.number} i loggen</Link></Button>;
  if (!actions?.logDeviation) return null;
  if (actions.canCreateWorkOrder === false) return <Button type="button" size="sm" variant="outline" disabledReason={UNSAVED_REASON} aria-describedby={reasonId} data-testid="form-deviation-log"><ClipboardList />Till avvikelseloggen</Button>;
  const log = async () => {
    setBusy(true);
    try { await actions.logDeviation!({ title: title.replace(/^Åtgärda: /, "").slice(0, 200), description: description.slice(0, 4000), targetId: targetId.slice(0, 100) }); } finally { setBusy(false); }
  };
  return <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void log()} data-testid="form-deviation-log">
    {busy ? <LoaderCircle className="animate-spin" /> : <ClipboardList />}Till avvikelseloggen
  </Button>;
}

function WorkOrderButton({ actions, readOnly, targetId, existing, title, description, fault, priority = "HIGH", order, onLinked, testId = "form-deviation-order", reasonId }: {
  actions?: FormActions;
  readOnly: boolean;
  /** The row, point or field the order is made from; stored as the order's source.rowId. */
  targetId: string;
  /** The work order already made from it. */
  existing?: string;
  title: string;
  description: string;
  fault: string;
  priority?: MaintenancePriority;
  /** More of the row for the order (a card's responsible person, date and severity); its deviation replaces fault and priority. */
  order?: Pick<Parameters<NonNullable<FormActions["createWorkOrder"]>>[0], "assignedToName" | "dueDate" | "deviation">;
  onLinked: (workOrderId: string) => void;
  testId?: string;
  /** The visible line that says why the button waits. */
  reasonId?: string;
}) {
  const [busy, setBusy] = useState(false);
  if (existing) {
    const state = actions?.workOrderStatus?.(existing);
    return <Button type="button" size="sm" variant="outline" onClick={() => actions?.openWorkOrder?.(existing)} disabled={!actions?.openWorkOrder} data-testid="form-row-work-order" data-status={state?.status}>
      {state ? `Arbetsorder: ${state.label}` : "Öppna arbetsorder"}
    </Button>;
  }
  if (readOnly || !actions?.createWorkOrder) return null;
  if (actions.canCreateWorkOrder === false) return <Button type="button" size="sm" variant="outline" disabledReason={UNSAVED_REASON} aria-describedby={reasonId} data-testid={testId}><ClipboardList />Skapa arbetsorder</Button>;
  const create = async () => {
    setBusy(true);
    try {
      const id = await actions.createWorkOrder!({ title: title.slice(0, 200), description: description.slice(0, 4000), targetId: targetId.slice(0, 100), ...order, deviation: order?.deviation ?? { fault: fault.slice(0, 2000), priority } });
      if (id) onLinked(id);
    } finally { setBusy(false); }
  };
  return <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void create()} data-testid={testId}>
    {busy ? <LoaderCircle className="animate-spin" /> : <ClipboardList />}Skapa arbetsorder
  </Button>;
}

/** The ids a protocol links work orders by: a table row by its own id, a point and a field by their keys. */
export const checklistTarget = (checklistKey: string, itemId: string) => `checklist:${checklistKey}:${itemId}`.slice(0, 100);
export const fieldTarget = (fieldKey: string) => `field:${fieldKey}`.slice(0, 100);

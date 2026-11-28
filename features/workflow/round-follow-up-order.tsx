"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Cog, Route, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { partOptions, usePartOptions } from "@/features/maintenance/part-picker";
import { ROUND_FOLLOW_UP_BUTTONS, ROUND_FOLLOW_UP_LABELS, type RoundFollowUpKind, type RoundFollowUpRow } from "@/lib/workflow/round-follow-up";
import { swedishDayKey } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import type { FormActions } from "./form-renderer";
import { UNSAVED_REASON } from "./deviation-order";
import { indicatorBadge } from "./indicator-tone";

/**
 * Driftronden som tillsyn (2026-11-27, lib/workflow/round-follow-up.ts) in the protocol and on the round's work order:
 * a brist gets "Akut arbetsorder" and "Planerad arbetsorder" in place of Skapa arbetsorder. Both ask for the machine (the round
 * point's is chosen; another from the list, or none) and the planned one for a suggested day; the brist's words, comment and
 * photos follow into the order. A brist fixed on the spot gets no work order, only its machine, so it shows in the machine's
 * Historik. The round's work order lists its follow-ups in "Från ronden". The server decides every right.
 */

export const followUpMessage = (kind: RoundFollowUpKind) => kind === "URGENT"
  ? "Den akuta arbetsordern är skapad. Arbetsledare och administratörer har fått en notis. Spara protokollet så sparas kopplingen."
  : "Den planerade arbetsordern är skapad. Arbetsledare och administratörer har fått en notis. Spara protokollet så sparas kopplingen.";

type Choices = { machines: boolean; partId: string | null; partName: string };
type Mode = RoundFollowUpKind | "PART";

/** What the card gives the buttons: the order's words and the row's photos, machine and Klart senast. */
export type FollowUpRowOrder = {
  title: string; description: string; fault: string;
  order: Pick<Parameters<NonNullable<FormActions["createWorkOrder"]>>[0], "assignedToName" | "dueDate" | "deviation">;
  imageIds: string[]; partId: string | null;
};

export function RoundOrderButtons({ actions, readOnly, targetId, row, fixedOnSite, onLinked, onPart, reasonId }: {
  actions: FormActions; readOnly: boolean; targetId: string; row: FollowUpRowOrder; fixedOnSite: boolean;
  onLinked: (workOrderId: string, partId: string | null | undefined) => void;
  /** Åtgärdad direkt: only the machine is chosen for the row. */
  onPart: (partId: string | null) => void;
  reasonId?: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  if (readOnly || !actions.createWorkOrder || !actions.roundProtocolId) return null;
  const waiting = actions.canCreateWorkOrder === false;
  const button = (kind: Mode, label: string, icon: React.ReactNode, testId: string) => waiting
    ? <Button type="button" size="sm" variant="outline" disabledReason={UNSAVED_REASON} aria-describedby={reasonId} data-testid={testId}>{icon}{label}</Button>
    : <Button type="button" size="sm" variant="outline" onClick={() => setMode(kind)} data-testid={testId}>{icon}{label}</Button>;
  return <span className="inline-flex flex-wrap items-center gap-2">
    {fixedOnSite ? button("PART", row.partId ? "Byt maskin" : "Välj maskin", <Cog />, "round-finding-part")
      : <>{button("URGENT", ROUND_FOLLOW_UP_BUTTONS.URGENT, <Siren />, "round-order-urgent")}{button("PLANNED", ROUND_FOLLOW_UP_BUTTONS.PLANNED, <CalendarPlus />, "round-order-planned")}</>}
    {mode ? <RoundOrderDialog mode={mode} actions={actions} targetId={targetId} row={row} onClose={() => setMode(null)}
      onDone={(id, partId) => { setMode(null); if (id) onLinked(id, partId); else onPart(partId ?? null); }} /> : null}
  </span>;
}

function RoundOrderDialog({ mode, actions, targetId, row, onClose, onDone }: {
  mode: Mode; actions: FormActions; targetId: string; row: FollowUpRowOrder; onClose: () => void;
  onDone: (workOrderId: string | null, partId: string | null | undefined) => void;
}) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [failed, setFailed] = useState("");
  // undefined until the person changes it: the server then takes the round point's machine itself.
  const [partId, setPartId] = useState<string | null | undefined>(undefined);
  const [day, setDay] = useState(row.order.dueDate || "");
  const [busy, setBusy] = useState(false);
  const { parts, places, error: partsError } = usePartOptions();
  useEffect(() => {
    let active = true;
    api<Choices>(`/api/round-follow-ups?protocolId=${encodeURIComponent(actions.roundProtocolId ?? "")}&rowId=${encodeURIComponent(targetId)}`, { cache: "no-store" }, { change: false })
      .then((result) => { if (active) setChoices(result); })
      .catch((issue) => { if (active) setFailed((issue as Error).message); });
    return () => { active = false; };
  }, [actions.roundProtocolId, targetId]);
  const chosen = partId === undefined ? row.partId ?? choices?.partId ?? null : partId;
  const options = partOptions(parts ?? [], chosen, places);
  const today = swedishDayKey(new Date());
  const title = mode === "PART" ? "Maskin för bristen" : ROUND_FOLLOW_UP_BUTTONS[mode];
  const save = async () => {
    if (mode === "PART") { onDone(null, chosen); return; }
    setBusy(true);
    try {
      const id = await actions.createWorkOrder!({
        title: row.title.slice(0, 200), description: row.description.slice(0, 4000), targetId: targetId.slice(0, 100), ...row.order,
        deviation: { ...(row.order.deviation ?? {}), fault: (row.order.deviation?.fault ?? row.fault).slice(0, 2000), ...(mode === "URGENT" ? { priority: "URGENT" as const } : {}) },
        followUp: { kind: mode, imageIds: row.imageIds, ...(partId !== undefined || row.partId ? { partId: chosen } : {}), ...(mode === "PLANNED" && day ? { plannedStartDate: day } : {}) },
      });
      if (id) onDone(id, chosen);
    } finally { setBusy(false); }
  };
  const machineField = !choices ? <p className="text-xs text-muted-foreground">{failed || "Hämtar maskinen…"}</p>
    : !choices.machines ? null
    : partsError ? <p className="text-sm" data-testid="round-order-machine">Maskin: {choices.partName || "ingen vald"}</p>
    : <Field id="round-order-part" label="Maskin" value={chosen ?? ""} options={["", ...options.map((option) => option.id)]}
      optionLabels={Object.fromEntries([["", parts === null ? "Hämtar maskinerna…" : "Ingen maskin"], ...options.map((option) => [option.id, option.label])])}
      help={choices.partId && chosen === choices.partId ? "Ronden gäller den här maskinen." : "Bristen och arbetsordern visas i maskinens Historik."}
      onChange={(value) => setPartId(value || null)} />;
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={title} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="round-order-form" data-mode={mode}>
      {mode === "PART" ? <p className="text-sm text-muted-foreground">Bristen är åtgärdad direkt och räknas som hanterad. Välj maskinen så visas den i maskinens Historik.</p>
        : <p className="text-sm text-muted-foreground">{mode === "URGENT" ? "Arbetsordern får prioritet Akut. Arbetsledare och administratörer får en notis i appen och per e-post." : "Arbetsledare och administratörer får en notis i appen."} Bristens beskrivning, kommentar och bilder följer med.</p>}
      {machineField}
      {mode === "PLANNED" ? <Field id="round-order-day" label="Föreslaget datum" type="date" value={day} help="Valfritt. Blir arbetsorderns start." onChange={setDay} /> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: mode === "PART" ? "Spara" : "Skapa arbetsorder", type: "submit", busy, busyLabel: "Skapar…",
        disabledReason: mode === "PLANNED" && day && day < today ? "Välj i dag eller en senare dag." : null, testId: "round-order-save" }} />
    </form>
  </Modal>;
}

/** Från ronden: on the round's work order, every work order made from its brister, with Akut/Planerad and Öppen/Klar. */
export function RoundFollowUpPanel({ workOrderId, refreshKey }: { workOrderId: string; refreshKey?: number }) {
  const [data, setData] = useState<{ rows: RoundFollowUpRow[]; fixedOnSite: number; open: number; truncated: boolean } | null>(null);
  const [failed, setFailed] = useState("");
  useEffect(() => {
    let active = true;
    api<NonNullable<typeof data>>(`/api/round-follow-ups?workOrderId=${encodeURIComponent(workOrderId)}`, { cache: "no-store" }, { change: false })
      .then((result) => { if (active) { setData(result); setFailed(""); } })
      .catch((issue) => { if (active) setFailed((issue as Error).message); });
    return () => { active = false; };
  }, [workOrderId, refreshKey]);
  // Nothing to show, or nothing could be read (the demo has no such list): the box is left out rather than standing empty.
  if (!data || failed) return null;
  if (!data.rows.length && !data.fixedOnSite && !data.open) return null;
  const summary = [data.fixedOnSite ? `${data.fixedOnSite} ${data.fixedOnSite === 1 ? "brist åtgärdad" : "brister åtgärdade"} direkt` : "", data.open ? `${data.open} ${data.open === 1 ? "brist" : "brister"} utan arbetsorder` : ""].filter(Boolean).join(" · ");
  return <div data-testid="round-follow-ups"><Panel icon={Route} title="Från ronden" description="Arbetsordrar som skapats från brister i ronden." count={data.rows.length}>
    {data.rows.length ? <ul className="-mx-4 divide-y border-y text-sm" data-testid="round-follow-up-list">{data.rows.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5" data-testid="round-follow-up-row" data-kind={row.kind} data-open={row.open || undefined}>
      <Badge variant="outline" className={indicatorBadge(row.kind === "URGENT" ? "danger" : "info")}>{ROUND_FOLLOW_UP_LABELS[row.kind]}</Badge>
      <Link className="min-w-0 flex-1 font-medium underline-offset-2 hover:underline [overflow-wrap:anywhere]" href={`/?view=workflow_task&taskType=WORK_ORDER&taskId=${encodeURIComponent(row.id)}`}>{row.title}</Link>
      <Badge variant="outline" className={cn(indicatorBadge(row.open ? "warning" : "success"))}>{row.label}</Badge>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga arbetsordrar från ronden än.</p>}
    {summary ? <p className="mt-2 text-xs text-muted-foreground" data-testid="round-follow-up-summary">{summary}</p> : null}
    {data.truncated ? <p className="text-xs text-muted-foreground">Visar de 100 första.</p> : null}
  </Panel></div>;
}

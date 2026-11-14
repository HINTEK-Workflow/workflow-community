"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ClipboardList, PackageMinus, Plus, Undo2, Wrench } from "lucide-react";
import { PageBackButton, PageHeader, PageSkeleton, usePageHeading } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogActions, Field, Modal, Panel, RowsSkeleton } from "@/features/kfid/ui";
import { MaintenanceFields } from "@/features/workflow/maintenance-fields";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { formatSwedish } from "@/lib/swedish-time";
import { announce } from "@/lib/workflow/toast";
import { useLoadEffect } from "@/lib/use-load-effect";
import { MAINTENANCE_PRIORITIES, MAINTENANCE_PRIORITY_LABELS, MAINTENANCE_TYPE_LABELS, MAINTENANCE_TYPES } from "@/lib/workflow/maintenance";
import { ITEM_SOURCE_LABELS, ITEM_STATUS_LABELS, ITEM_STATUSES, itemTimeProblem, itemTitle, PART_STATUS_LABELS, quantityText, type ItemFields, type ItemStatus } from "@/lib/maintenance/model";
import type { JobPartCard } from "@/lib/maintenance/server";
import { maintenanceGet, maintenancePost, type ItemRow, type ItemView, type Spare } from "./maintenance-api";
import { MachinePartSelect } from "./part-picker";

/**
 * Underhållsposten (2026-10-30): the maintenance fields of one machine part, held by a work order like a task. Its
 * own editor (a page under Underhåll, `&item=`) and two pieces the work order holder (the agent `arbetsorder-hallare`)
 * can render as they are: WorkOrderMaintenanceItems (the order's items in its task list, with "+ Underhållspost") and
 * NewItemDialog. The fields (features/workflow/maintenance-fields.tsx) moved here from the work order on 2026-10-30; what a
 * paused order waits for stays on the order. The server decides who may read and change (lib/maintenance/).
 */
const when = (value: string) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
const workOrderHref = (id: string) => `/?view=workflow_task&taskType=WORK_ORDER&taskId=${encodeURIComponent(id)}`;
const fieldsOf = (item: ItemView): ItemFields => ({
  type: item.type, priority: item.priority, criticality: item.criticality, marking: item.marking, fault: item.fault, cause: item.cause, causeNote: item.causeNote,
  reportedAt: item.reportedAt, stoppedAt: item.stoppedAt, restoredAt: item.restoredAt,
});

export function MaintenanceItemEditor({ itemId, onClose }: { itemId: string; onClose: (partId: string | null) => void }) {
  const [item, setItem] = useState<ItemView | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<ItemFields | null>(null);
  const [status, setStatus] = useState<ItemStatus>("OPEN");
  const [workOrderId, setWorkOrderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taking, setTaking] = useState<Spare | null>(null);
  const load = useCallback(async () => {
    try {
      const { item: next } = await maintenanceGet<{ item: ItemView }>(`part=item&id=${encodeURIComponent(itemId)}`);
      setItem(next); setFields(fieldsOf(next)); setStatus(next.status); setWorkOrderId(next.workOrderId); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, [itemId]);
  useLoadEffect(load);
  usePageHeading(item ? itemTitle(item.partName) : undefined);
  if (error) return <div className="space-y-4"><PageHeader title="Underhållspost" actions={<PageBackButton onClick={() => onClose(null)} />} />
    <p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!item || !fields) return <PageSkeleton label="Hämtar underhållsposten…" />;
  const changed = JSON.stringify(fields) !== JSON.stringify(fieldsOf(item)) || status !== item.status || workOrderId !== item.workOrderId;
  const problem = itemTimeProblem(fields);
  const save = async () => {
    setBusy(true);
    try {
      await maintenancePost({ action: "update_item", id: item.id, version: item.version, item: { ...fields, status, workOrderId } });
      announce("Underhållsposten är sparad.");
      await load();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const giveBack = async (id: string) => {
    try { await maintenancePost({ action: "return", id }); announce("Reservdelen är tillbaka i förrådet."); await load(); } catch (cause) { announce((cause as Error).message, true); }
  };
  return <div className="space-y-4" data-testid="maintenance-item-editor">
    <PageHeader title={itemTitle(item.partName)} description={item.partPath.join(" › ")}
      actions={<>
        <PageBackButton onClick={() => onClose(item.partId)} testId="maintenance-item-back" />
        {item.canEdit ? <Button type="button" busy={busy} busyLabel="Sparar…" disabledReason={!changed ? "Inget är ändrat." : problem || null} onClick={() => void save()} data-testid="maintenance-item-save">Spara</Button> : null}
      </>}>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className={indicatorBadge(item.status === "DONE" ? "success" : item.status === "CANCELLED" ? "neutral" : "info")}>{ITEM_STATUS_LABELS[item.status]}</Badge>
        {ITEM_SOURCE_LABELS[item.source] ? <Badge variant="outline" className={indicatorBadge("warning")}>{ITEM_SOURCE_LABELS[item.source]}</Badge> : null}
        <span>Skapad {when(item.createdAt)}</span>
      </div>
    </PageHeader>
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] [&>*]:min-w-0">
      <div className="space-y-6">
        <MaintenanceFields value={fields} disabled={!item.canEdit} onChange={setFields} />
        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
      </div>
      <div className="space-y-6">
        <Panel icon={ClipboardList} area="work-order" title="Arbetsorder">
          <div className="grid gap-4">
            <Field id="mi-status" label="Status" value={status} options={[...ITEM_STATUSES]} optionLabels={ITEM_STATUS_LABELS} disabled={!item.canEdit} onChange={(next) => setStatus(next as ItemStatus)} />
            <Field id="mi-order" label="Ligger i" value={workOrderId ?? ""} disabled={!item.canEdit} options={["", ...item.workOrders.map((order) => order.id)]}
              optionLabels={Object.fromEntries([["", "Ingen arbetsorder (utkast)"], ...item.workOrders.map((order) => [order.id, order.title])])} onChange={(next) => setWorkOrderId(next || null)} />
            {item.workOrder ? <Link className="text-sm font-medium text-primary underline-offset-2 hover:underline" href={workOrderHref(item.workOrder.id)} data-testid="maintenance-item-work-order">Öppna {item.workOrder.title}</Link>
              : <p className="text-xs text-muted-foreground">En post utan arbetsorder är ett utkast. Reservdelar tas ut när den ligger i en arbetsorder.</p>}
          </div>
        </Panel>
        <Panel icon={PackageMinus} title="Uttag ur förrådet">
          {item.withdrawals.length ? <ul className="-mx-4 divide-y border-y text-sm" data-testid="maintenance-item-withdrawals">{item.withdrawals.map((move) => <li key={move.id} className="flex flex-wrap items-center gap-2 px-5 py-2" data-testid="maintenance-item-withdrawal">
            <span className="min-w-0 flex-1"><span className="font-medium">{quantityText(move.quantity)} {move.unit} {move.itemName}</span>
              <span className="block text-xs text-muted-foreground">{[move.locationName, move.byName, when(move.at), move.returned ? "Tillbakalämnad" : ""].filter(Boolean).join(" · ")}</span></span>
            {item.canWithdraw && !move.returned ? <Button type="button" variant="ghost" size="sm" onClick={() => void giveBack(move.id)}><Undo2 />Ångra</Button> : null}
          </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga uttag.</p>}
          {item.spares.length ? <div className="mt-3 flex flex-wrap gap-2">{item.spares.map((spare) => <Button key={spare.linkId} type="button" variant="outline" size="sm"
            disabledReason={!item.workOrderId ? "Koppla posten till en arbetsorder först." : !item.canWithdraw ? "Du får inte ändra arbetsordern." : spare.total > 0 ? null : `${spare.name} är slut i förrådet.`}
            onClick={() => setTaking(spare)} data-testid="maintenance-item-take"><PackageMinus />{spare.name} ({quantityText(spare.total)} {spare.unit})</Button>)}</div>
            : <p className="mt-2 text-xs text-muted-foreground">Delen har inga reservdelar kopplade.</p>}
        </Panel>
      </div>
    </div>
    {taking && item.workOrderId ? <WithdrawDialog spare={taking} workOrders={item.workOrders.filter((order) => order.id === item.workOrderId)} maintenanceItemId={item.id}
      onClose={() => setTaking(null)} onDone={async () => { setTaking(null); await load(); }} /> : null}
  </div>;
}

/** Lägg på arbetsordern: drawn from the store at once (decided 2026-10-30), from a chosen location or the first with enough. */
export function WithdrawDialog({ spare, workOrders, maintenanceItemId = null, onClose, onDone }: {
  spare: Spare; workOrders: { id: string; title: string }[]; maintenanceItemId?: string | null; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [workOrderId, setWorkOrderId] = useState(workOrders[0]?.id ?? "");
  const stocked = spare.balances.filter((row) => row.quantity > 0);
  const [locationId, setLocationId] = useState(stocked[0]?.locationId ?? "");
  const [quantity, setQuantity] = useState(quantityText(spare.quantity));
  const [busy, setBusy] = useState(false);
  const take = async () => {
    setBusy(true);
    try {
      const done = await maintenancePost<{ text: string }>({ action: "withdraw", move: { itemId: spare.itemId, locationId: locationId || undefined, quantity, workOrderId, maintenanceItemId } });
      announce(done.text);
      await onDone();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={`Lägg på arbetsorder · ${spare.name}`} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void take(); }} data-testid="maintenance-withdraw-form">
      {workOrders.length > 1 ? <Field id="mw-order" label="Arbetsorder" value={workOrderId} options={workOrders.map((order) => order.id)} optionLabels={Object.fromEntries(workOrders.map((order) => [order.id, order.title]))} onChange={setWorkOrderId} />
        : <p className="text-sm">Arbetsorder: <strong>{workOrders[0]?.title ?? "–"}</strong></p>}
      <Field id="mw-location" label="Från" value={locationId} options={stocked.map((row) => row.locationId)} optionLabels={Object.fromEntries(stocked.map((row) => [row.locationId, `${row.locationName} (${quantityText(row.quantity)} ${spare.unit})`]))} onChange={setLocationId} />
      <Field id="mw-qty" label={`Antal (${spare.unit})`} value={quantity} onChange={setQuantity} />
      <p className="text-xs text-muted-foreground">Saldot minskar direkt. Ångra återställer det.</p>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Lägg på", type: "submit", busy, busyLabel: "Tar ut…", disabledReason: !stocked.length ? "Slut i förrådet. Beställ först." : !workOrderId ? "Ingen öppen arbetsorder." : null, testId: "maintenance-withdraw-save" }} />
    </form>
  </Modal>;
}

/** Ny underhållspost: on a part, on one of its open work orders or as a draft. */
export function NewItemDialog({ partId, partName, workOrders, fixedWorkOrderId = null, onClose, onCreated }: {
  partId: string | null; partName?: string; workOrders: { id: string; title: string }[]; fixedWorkOrderId?: string | null; onClose: () => void; onCreated: (id: string) => Promise<void>;
}) {
  const [chosenPart, setChosenPart] = useState<string | null>(partId);
  const [workOrderId, setWorkOrderId] = useState(fixedWorkOrderId ?? workOrders[0]?.id ?? "");
  const [type, setType] = useState<string>("CORRECTIVE");
  const [priority, setPriority] = useState<string>("NORMAL");
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!chosenPart) return;
    setBusy(true);
    try {
      const made = await maintenancePost<{ id: string }>({ action: "create_item", item: { partId: chosenPart, workOrderId: workOrderId || null, type, priority, fault, reportedAt: new Date().toISOString() } });
      announce("Underhållsposten är skapad.");
      await onCreated(made.id);
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={partName ? `Ny underhållspost · ${partName}` : "Ny underhållspost"} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void create(); }} data-testid="maintenance-item-form">
      {partId ? null : <MachinePartSelect id="mi-part" label="Maskindel" emptyLabel="Välj en del" value={chosenPart} onChange={setChosenPart} testId="maintenance-item-part" />}
      {fixedWorkOrderId ? null : <Field id="mi-new-order" label="Arbetsorder" value={workOrderId} options={["", ...workOrders.map((order) => order.id)]}
        optionLabels={Object.fromEntries([["", "Ingen än (utkast)"], ...workOrders.map((order) => [order.id, order.title])])} onChange={setWorkOrderId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="mi-type" label="Typ av underhåll" value={type} options={[...MAINTENANCE_TYPES]} optionLabels={MAINTENANCE_TYPE_LABELS} onChange={setType} />
        <Field id="mi-priority" label="Prioritet" value={priority} options={[...MAINTENANCE_PRIORITIES]} optionLabels={MAINTENANCE_PRIORITY_LABELS} onChange={setPriority} />
      </div>
      <Field id="mi-fault" label="Fel eller symptom" multiline value={fault} placeholder="Vad märktes, och när?" onChange={setFault} />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Skapa", type: "submit", busy, busyLabel: "Skapar…", disabledReason: chosenPart ? null : "Välj en maskindel först.", testId: "maintenance-item-create" }} />
    </form>
  </Modal>;
}

/**
 * Maskinkortet via jobbet (beslut 10, 2026-11-01): the machine's place in the tree, its history and its spare parts.
 * The server sends it only to someone with a job on the machine or the module's read right, and nothing else (lib/maintenance/server.ts).
 */
function JobMachineCard({ partId, onClose }: { partId: string; onClose: () => void }) {
  const [card, setCard] = useState<JobPartCard | null>(null);
  const [error, setError] = useState("");
  useLoadEffect(useCallback(async () => {
    try { setCard(await maintenanceGet<JobPartCard>(`part=job_card&id=${encodeURIComponent(partId)}`)); }
    catch (cause) { setError((cause as Error).message); }
  }, [partId]));
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={card?.part.name ?? "Maskinkort"} size="form" nativeScreen>
    <div className="grid gap-4 text-sm" data-testid="job-machine-card">
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {!card && !error ? <RowsSkeleton rows={3} dense label="Hämtar maskinkortet…" /> : null}
      {card ? <>
        <dl className="grid gap-2">
          {card.part.path.length ? <div><dt className="text-xs text-muted-foreground">Plats</dt><dd className="[overflow-wrap:anywhere]">{card.part.path.join(" › ")}</dd></div> : null}
          {card.part.marking ? <div><dt className="text-xs text-muted-foreground">Märkning</dt><dd className="[overflow-wrap:anywhere]">{card.part.marking}</dd></div> : null}
          <div><dt className="text-xs text-muted-foreground">Status</dt><dd>{PART_STATUS_LABELS[card.part.status]}</dd></div>
        </dl>
        <section aria-labelledby="job-machine-history"><h3 id="job-machine-history" className="mb-1 text-sm font-semibold">Historik</h3>
          {card.history.length ? <ul className="divide-y rounded-lg border" data-testid="job-machine-history">{card.history.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">{item.fault || item.type || "Underhåll"}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{formatSwedish(item.createdAt, { dateStyle: "short" })} · {ITEM_STATUS_LABELS[item.status]}</span>
          </li>)}</ul> : <p className="text-muted-foreground">Ingen historik ännu.</p>}
        </section>
        <section aria-labelledby="job-machine-spares"><h3 id="job-machine-spares" className="mb-1 text-sm font-semibold">Reservdelar</h3>
          {card.spares.length ? <ul className="divide-y rounded-lg border" data-testid="job-machine-spares">{card.spares.map((spare) => <li key={spare.itemId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">{spare.name}{spare.articleNo ? ` · ${spare.articleNo}` : ""}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{spare.total} {spare.unit} i förrådet</span>
          </li>)}</ul> : <p className="text-muted-foreground">Inga kopplade reservdelar.</p>}
        </section>
      </> : null}
      <DialogActions cancel={{ onClick: onClose, label: "Stäng" }} />
    </div>
  </Modal>;
}

/**
 * A work order's maintenance items, for its task list (2026-10-30: "hålls av en arbetsorder som en uppgift"): the
 * order's Underhåll – the old panel on the order moved here. Cloud only; nothing is drawn for a member who may not read the
 * order (the server answers 403) or when the order has none and none may be made.
 */
export function WorkOrderMaintenanceItems({ workOrderId, onItems, lockedReason }: { workOrderId: string; /** The items as read, for the order's header (priority) and Uppdraget (fault). */ onItems?: (items: ItemRow[], workOrderId: string) => void;
  /** The order is completed, cancelled or frozen (kundresan 2026-11-07, L25): + Underhållspost stays, grey with this reason. */
  lockedReason?: string }) {
  const [data, setData] = useState<{ items: ItemRow[]; machinePartId: string | null; canCreate: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await maintenanceGet<{ items: ItemRow[]; machinePartId: string | null; canCreate: boolean }>(`part=work_order&id=${encodeURIComponent(workOrderId)}`);
      setData(next); setFailed(false); onItems?.(next.items, workOrderId);
    } catch { setFailed(true); onItems?.([], workOrderId); }
  }, [workOrderId, onItems]);
  useLoadEffect(load);
  const machines = data ? [...new Map([...(data.machinePartId ? [[data.machinePartId, data.items.find((item) => item.partId === data.machinePartId)?.partName ?? ""] as const] : []), ...data.items.map((item) => [item.partId, item.partName] as const)]).entries()] : [];
  if (failed || (data && !data.items.length && !data.canCreate && !machines.length)) return null;
  return <Panel icon={ClipboardList} area="work-order" title="Underhållsposter" description="Underhåll på maskindelar i den här arbetsordern."
    actions={data?.canCreate ? <Button type="button" variant="outline" size="sm" disabledReason={lockedReason || undefined} onClick={() => setCreating(true)} data-testid="work-order-maintenance-new"><Plus />Underhållspost</Button> : null}>
    <div data-testid="work-order-maintenance-items">
      {!data ? <RowsSkeleton rows={1} dense label="Hämtar underhållsposterna…" />
        : !data.items.length ? <p className="text-sm text-muted-foreground">Inga underhållsposter.</p>
        : <ul className="-mx-4 divide-y border-y text-sm">{data.items.map((item) => <li key={item.id}>
          <Link href={`/?view=maintenance&item=${encodeURIComponent(item.id)}`} className="flex items-center gap-2 px-5 py-2 hover:bg-muted" data-testid="work-order-maintenance-item">
            <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{itemTitle(item.partName)}{item.fault ? ` · ${item.fault}` : ""}</span>
            {item.status === "OPEN" && (item.priority === "URGENT" || item.priority === "HIGH") ? <Badge variant="outline" data-testid="work-order-maintenance-item-priority" className={indicatorBadge(item.priority === "URGENT" ? "danger" : "warning")}>{MAINTENANCE_PRIORITY_LABELS[item.priority]}</Badge> : null}
            <Badge variant="outline" className={indicatorBadge(item.status === "DONE" ? "success" : item.status === "CANCELLED" ? "neutral" : "info")}>{ITEM_STATUS_LABELS[item.status]}</Badge>
          </Link>
        </li>)}</ul>}
      {machines.length ? <div className="mt-3 flex flex-wrap gap-2">{machines.map(([partId, name]) => <Button key={partId} type="button" variant="outline" size="sm" onClick={() => setCard(partId)} data-testid="work-order-machine-card"><Wrench />{name ? `Maskinkort: ${name}` : "Maskinkort"}</Button>)}</div> : null}
    </div>
    {card ? <JobMachineCard partId={card} onClose={() => setCard(null)} /> : null}
    {creating ? <NewItemDialog partId={data?.machinePartId ?? null} workOrders={[]} fixedWorkOrderId={workOrderId} onClose={() => setCreating(false)}
      onCreated={async () => { setCreating(false); await load(); }} /> : null}
  </Panel>;
}

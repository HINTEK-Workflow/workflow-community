"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AlertCircle, Ban, CheckCircle2, ClipboardList, FileText, FlaskConical, Hammer, ImageIcon, Link2,
  ListChecks, OctagonAlert, Package, Pause, PenLine, Play, Plus, Repeat, Send, Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EventToast } from "@/features/workflow/toast-card";
import { Field, Panel, PanelAreaProvider } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { MaintenanceModule } from "./maintenance-module";
import { LevelColumn, LevelSwitch, ProposalLevelContext, useLevelState } from "./proposal-level";
import {
  emptyBasics, emptyRisk, INITIAL_ORDERS, OrderStatus, PEOPLE, SharedBasicsPanel, SharedRiskPanel, TASK_KINDS,
  type Basics, type DemoOrder, type DemoTask, type LastEdit, type RiskState, type TaskKind,
} from "./work-order-holder-parts";

/**
 * Förslag: arbetsordern som hållare (2026-10-30). A page of its own next to the design lab, drawn with the app's
 * shared parts (PageHeader, Panel, Field, Button, Badge, the toast's look) so it reads as Workflow. Nothing is saved:
 * the work orders live in this component's state only, so editing the shared Grunduppgifter or Riskbedömning in the
 * task shows at once in the work order and the other way round.
 */

type View = "arbetsorder" | "uppgift" | "underhallspost" | "sida-vid-sida" | "ny" | "underhall" | "andras";
const VIEWS: { id: View; label: string; icon: typeof Wrench }[] = [
  { id: "arbetsorder", label: "Arbetsorder", icon: Wrench },
  { id: "uppgift", label: "Uppgift", icon: ClipboardList },
  { id: "underhallspost", label: "Underhållspost", icon: Hammer },
  { id: "sida-vid-sida", label: "Sida vid sida", icon: Link2 },
  { id: "ny", label: "Ny", icon: Plus },
  { id: "underhall", label: "Underhåll", icon: Hammer },
  { id: "andras", label: "Vad ändras", icon: ListChecks },
];
const KIND_ICON: Record<TaskKind, typeof Wrench> = { Protokoll: ClipboardList, Driftrond: Repeat, Underhållspost: Hammer };
const KIND_AREA = { Protokoll: "control", Driftrond: "round", Underhållspost: "tools" } as const;
const lookOnly = (what: string) => () => announce(`${what} – visar bara utseendet i förslaget.`);
const hours = (minutes: number) => `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;

export function WorkOrderHolderProposal({ initialView, initialLevel = null }: { initialView: string | null; initialLevel?: string | null }) {
  const { level, native, choose: chooseLevel } = useLevelState(initialLevel);
  const [view, setView] = useState<View>(VIEWS.find((item) => item.id === initialView)?.id ?? "arbetsorder");
  const [orders, setOrders] = useState<DemoOrder[]>(INITIAL_ORDERS);
  const [orderId, setOrderId] = useState(INITIAL_ORDERS[0].id);
  const [taskId, setTaskId] = useState<string | null>(INITIAL_ORDERS[0].tasks[0]?.id ?? null);
  const [lastEdit, setLastEdit] = useState<LastEdit>(null);
  const order = orders.find((item) => item.id === orderId) ?? orders[0];
  const task = order.tasks.find((item) => item.id === taskId) ?? order.tasks[0] ?? null;

  const choose = (next: View) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("vy", next);
    window.history.replaceState(window.history.state, "", url);
  };
  const patchOrder = (patch: Partial<DemoOrder> | ((current: DemoOrder) => Partial<DemoOrder>)) =>
    setOrders((list) => list.map((item) => item.id === order.id ? { ...item, ...(typeof patch === "function" ? patch(item) : patch) } : item));
  // The shared data: one place in the state, written from either view.
  const setBasics = (from: "order" | "task") => (basics: Basics) => { patchOrder({ basics }); setLastEdit({ from, part: "basics", at: Date.now() }); };
  const setRisk = (from: "order" | "task") => (risk: RiskState) => { patchOrder({ risk }); setLastEdit({ from, part: "risk", at: Date.now() }); };
  const patchTask = (id: string, patch: Partial<DemoTask>) => patchOrder((current) => ({ tasks: current.tasks.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const addTask = (kind: TaskKind) => {
    const id = `U-${Date.now() % 100000}`;
    patchOrder((current) => ({ tasks: [...current.tasks, { id, kind, title: `Ny ${kind.toLowerCase()}`, done: false, values: {} }] }));
    setTaskId(id);
    announce(`Uppgiften lades i ${order.id}`);
  };
  const openTask = (id: string) => { setTaskId(id); choose("uppgift"); window.scrollTo({ top: 0 }); };
  const openOrder = () => { choose("arbetsorder"); window.scrollTo({ top: 0 }); };
  const create = (basics: Basics, risk: RiskState, kind: TaskKind | null) => {
    const id = `AO-${1042 + orders.length}`;
    const tasks: DemoTask[] = kind ? [{ id: `U-${Date.now() % 100000}`, kind, title: kind === "Protokoll" ? "Egenkontroll" : kind === "Driftrond" ? "Driftrond pumpstation" : "Underhåll · Pump P1", done: false, values: kind === "Underhållspost" ? { part: "Pumpstation 2 › Pump P1" } : {} }] : [];
    setOrders((list) => [...list, { ...INITIAL_ORDERS[0], id, basics, risk, tasks, execution: { notes: "", deviations: "" }, signing: { name: "", confirmed: false }, timer: { running: false, minutes: 0 }, status: "Planerad", images: 0 }]);
    setOrderId(id);
    setTaskId(tasks[0]?.id ?? null);
    announce(`Arbetsorder ${id} skapades`);
    choose(kind ? "uppgift" : "arbetsorder");
    window.scrollTo({ top: 0 });
  };

  const orderView = <OrderView order={order} lastEdit={lastEdit} onBasics={setBasics("order")} onRisk={setRisk("order")} onPatch={patchOrder} onOpenTask={openTask} onAddTask={addTask} />;
  const taskView = <TaskView order={order} task={task} lastEdit={lastEdit} onBasics={setBasics("task")} onRisk={setRisk("task")} onPatchTask={patchTask} onChooseTask={setTaskId} onOpenOrder={openOrder} onAddTask={addTask} />;

  return <ProposalLevelContext.Provider value={level}><div className="min-h-dvh bg-background" data-testid="holder-proposal">
    <div className="border-b bg-muted/40">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-6">
        <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground"><FlaskConical className="size-4" aria-hidden="true" />Förslag · exempeldata, sparas inte</span>
        <span className="flex items-center gap-3"><LevelSwitch level={level} onChoose={chooseLevel} /><Link href="/?view=stats" className="font-medium text-primary hover:underline">Till Workflow</Link></span>
      </div>
    </div>
    <main className="px-4 py-6 sm:px-6"><LevelColumn level={level}>{/* NativeScreenFrame's own class, on a wrapper that stays (the frame swaps its element when the look changes and would start the page over). */}<div className={native ? "native-screen" : undefined}>
      <PageHeader title="Förslag: arbetsordern som hållare" />
      <div data-detail-min="2"><Panel icon={Link2} area="work-order" title="Så fungerar det">
        <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="holder-intro">
          <li>Arbetsordern håller allt: grunduppgifter, riskbedömning, uppgifter, utförande, signering, bilder och rapport.</li>
          <li>Grunduppgifter och Riskbedömning är samma i arbetsordern och i varje uppgift. Ändra på ett ställe, så ändras båda.</li>
          <li>En ny uppgift skapar alltid sin arbetsorder. En arbetsorder kan skapas utan uppgift.</li>
          <li>Uppgiften innehåller bara sig själv: protokollet, ronden eller underhållet.</li>
        </ul>
      </Panel></div>

      {/* The tabs stand in one fixed place; on a phone one picker, like SectionTabs. */}
      <div className="mb-6 mt-6 w-full border-b pb-4" data-testid="holder-tabs">
        <label className={level === 1 ? "block" : "block sm:hidden"}>
          <span className="sr-only">Visa</span>
          <select className="form-select" aria-label="Visa" value={view} onChange={(event) => choose(event.target.value as View)}>
            {VIEWS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <nav aria-label="Visa" className={cn("-my-1 hidden gap-1.5 overflow-x-auto px-px py-1 [scrollbar-width:none]", level !== 1 && "sm:flex")}>
          {VIEWS.map((item) => <button key={item.id} type="button" aria-current={item.id === view ? "page" : undefined} onClick={() => choose(item.id)} data-testid={`holder-tab-${item.id}`}
            className={cn("touch-target flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm transition-colors", item.id === view ? "border-primary/30 bg-secondary font-medium text-secondary-foreground ring-1 ring-primary/15" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
            <item.icon className={cn("size-4 shrink-0", item.id === view ? "text-primary" : "")} aria-hidden="true" />{item.label}
          </button>)}
        </nav>
        {orders.length > 1 && (view === "arbetsorder" || view === "uppgift" || view === "sida-vid-sida") ? <label className="mt-3 flex max-w-sm items-center gap-2 text-xs font-medium text-muted-foreground">Arbetsorder
          <select className="form-select" value={order.id} onChange={(event) => { const next = orders.find((item) => item.id === event.target.value); setOrderId(event.target.value); setTaskId(next?.tasks[0]?.id ?? null); }} data-testid="holder-order-pick">
            {orders.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.basics.title || "Utan rubrik"}</option>)}
          </select></label> : null}
      </div>

      {view === "arbetsorder" ? orderView
        : view === "uppgift" ? taskView
        : view === "underhallspost" ? <TaskView order={order} task={order.tasks.find((item) => item.kind === "Underhållspost") ?? null} lastEdit={lastEdit} onBasics={setBasics("task")} onRisk={setRisk("task")} onPatchTask={patchTask} onChooseTask={(id) => { setTaskId(id); choose("uppgift"); }} onOpenOrder={openOrder} onAddTask={addTask} />
        : view === "sida-vid-sida" ? <div className="grid items-start gap-6 lg:grid-cols-2" data-testid="holder-side-by-side">
          <section aria-label="Arbetsordern" className="min-w-0 rounded-xl border border-dashed p-3">{orderView}</section>
          <section aria-label="Uppgiften" className="min-w-0 rounded-xl border border-dashed p-3">{taskView}</section>
        </div>
        : view === "ny" ? <NewView key={orders.length} nextId={`AO-${1042 + orders.length}`} onCreate={create} />
        : view === "underhall" ? <MaintenanceModule />
        : <ChangesView />}
    </div></LevelColumn></main>
    <ProposalToast />
  </div></ProposalLevelContext.Provider>;
}

/** The view's own top: title and status to the left, the actions top right (the app's rule), facts under. */
function ViewHeader({ title, status, facts, actions }: { title: ReactNode; status?: ReactNode; facts?: ReactNode; actions?: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3" data-standard-header="">
    <div className="min-w-0 flex-1 basis-60">
      <h2 className="page-title truncate">{title}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{status}{facts}</div>
    </div>
    {actions ? <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start" data-standard-actions="">{actions}</div> : null}
  </div>;
}

// ---------- The work order ----------

function OrderView({ order, lastEdit, onBasics, onRisk, onPatch, onOpenTask, onAddTask }: {
  order: DemoOrder;
  lastEdit: LastEdit;
  onBasics: (basics: Basics) => void;
  onRisk: (risk: RiskState) => void;
  onPatch: (patch: Partial<DemoOrder>) => void;
  onOpenTask: (id: string) => void;
  onAddTask: (kind: TaskKind) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const closed = order.status === "Färdigställd" || order.status === "Utgått";
  const riskDone = Boolean(order.risk.confirmedBy);
  const missing = !riskDone ? "Bekräfta riskbedömningen först." : order.tasks.some((item) => !item.done) ? "Alla uppgifter är inte klara." : !order.execution.notes.trim() ? "Skriv vad som är utfört." : !order.signing.confirmed ? "Signera först." : "";
  return <PanelAreaProvider area="work-order"><div className="@container min-w-0 space-y-6" data-testid="holder-order">
    <ViewHeader title={`${order.id} · ${order.basics.title || "Ny arbetsorder"}`} status={<OrderStatus status={order.status} />}
      facts={<><span>{order.basics.customer}</span><span>{order.basics.place}</span><span className="tabular-nums">{hours(order.timer.minutes)} rapporterad</span></>}
      actions={<Button type="button" onClick={() => announce("Sparat")}>Spara</Button>} />
    <SharedBasicsPanel basics={order.basics} onChange={onBasics} lastEdit={lastEdit} here="order" disabled={closed} />
    <SharedRiskPanel risk={order.risk} onChange={onRisk} lastEdit={lastEdit} here="order" disabled={closed} />

    <Panel icon={ClipboardList} title="Uppgifter" actions={closed ? undefined : <Button type="button" variant="outline" aria-expanded={choosing} onClick={() => setChoosing((value) => !value)} data-testid="holder-add-task"><Plus />Lägg till uppgift</Button>}>
      {choosing ? <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2" data-testid="holder-add-kinds">
        <span className="px-1 text-xs font-medium text-muted-foreground">Vilken sort?</span>
        {TASK_KINDS.map((kind) => { const Icon = KIND_ICON[kind]; return <Button key={kind} type="button" size="sm" variant="outline" onClick={() => { onAddTask(kind); setChoosing(false); }}><Icon />{kind}</Button>; })}
      </div> : null}
      {order.tasks.length ? <ul className="-mx-4 divide-y border-y" data-testid="holder-task-list">{order.tasks.map((item) => {
        const Icon = KIND_ICON[item.kind];
        return <li key={item.id} className="flex items-center gap-3 px-5 py-2.5">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <button type="button" className="block max-w-full truncate text-left text-sm font-semibold hover:underline" onClick={() => onOpenTask(item.id)}>{item.title}</button>
            <p className="truncate text-xs text-muted-foreground">{item.kind} · {order.basics.responsible}</p>
          </div>
          <Badge variant="outline" className={indicatorBadge(item.done ? "success" : "warning")}>{item.done ? "Klar" : "Ej klar"}</Badge>
        </li>;
      })}</ul> : <p className="text-sm text-muted-foreground" data-testid="holder-no-tasks">Inga uppgifter än. Arbetsordern fungerar ändå.</p>}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="holder-rounds-note"><Repeat className="size-3.5" aria-hidden="true" />En arbetsorder kan också hålla underhållsposter och underhållsronder för maskindelar (se Underhåll).</p>
    </Panel>

    {/* Utförande: every button of the work in one row to the LEFT, in a fixed order. */}
    <Panel icon={Wrench} title="Utförande">
      <div className="mb-4 flex flex-wrap items-center justify-start gap-2" data-testid="holder-execution-buttons">
        <Button type="button" variant="outline" disabled={closed} aria-pressed={order.timer.running} className={order.timer.running ? "border-emerald-300 text-emerald-800 dark:text-emerald-200" : undefined}
          onClick={() => onPatch({ timer: { ...order.timer, running: !order.timer.running, minutes: order.timer.minutes + (order.timer.running ? 25 : 0) }, status: order.status === "Planerad" ? "Pågår" : order.status })}>
          {order.timer.running ? <Pause /> : <Play />}{order.timer.running ? "Pausa tid" : "Starta tid"}
        </Button>
        <Button type="button" variant="outline" disabled={closed} onClick={() => { onPatch({ status: order.status === "Hinder" ? "Pågår" : "Hinder" }); announce(order.status === "Hinder" ? "Hindret är löst" : "Hinder rapporterat"); }}><OctagonAlert />{order.status === "Hinder" ? "Lös hindret" : "Rapportera hinder"}</Button>
        <Button type="button" disabled={closed} disabledReason={missing} onClick={() => { onPatch({ status: "Färdigställd", timer: { ...order.timer, running: false } }); announce(`${order.id} är färdigställd`); }}><CheckCircle2 />Färdigställ</Button>
        <Button type="button" variant="outline" disabled={closed} onClick={() => { onPatch({ status: "Utgått", timer: { ...order.timer, running: false } }); announce(`${order.id} har utgått`); }}><Ban />Utgår</Button>
        {closed ? <Button type="button" variant="ghost" onClick={() => onPatch({ status: "Pågår" })}>Återöppna</Button> : null}
      </div>
      {missing && !closed ? <p className="-mt-2 mb-4 text-xs text-muted-foreground" data-testid="holder-complete-reason">{missing}</p> : null}
      <div className="grid gap-4 @3xl:grid-cols-2">
        <Field id={`${order.id}-notes`} label="Utfört arbete" multiline value={order.execution.notes} disabled={closed} onChange={(notes) => onPatch({ execution: { ...order.execution, notes } })} />
        <Field id={`${order.id}-deviations`} label="Avvikelser" multiline value={order.execution.deviations} disabled={closed} onChange={(deviations) => onPatch({ execution: { ...order.execution, deviations } })} />
      </div>
      <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Package className="size-4" aria-hidden="true" />Material och utgifter – som i dag.</p>
    </Panel>

    <Panel icon={PenLine} title="Signering">
      <div className="grid gap-4 @3xl:grid-cols-2">
        <Field id={`${order.id}-signer`} label="Namn på den som signerar" value={order.signing.name} disabled={closed} onChange={(name) => onPatch({ signing: { ...order.signing, name } })} />
        <label className="flex h-10 items-center gap-2.5 self-end text-sm">
          <Checkbox checked={order.signing.confirmed} disabled={closed} onCheckedChange={(checked) => onPatch({ signing: { name: order.signing.name || (checked === true ? PEOPLE[0] : ""), confirmed: checked === true } })} />
          Jag intygar att dokumentationen är granskad
        </label>
      </div>
    </Panel>

    <Panel icon={ImageIcon} title="Bilder" actions={closed ? undefined : <Button type="button" variant="outline" onClick={() => onPatch({ images: order.images + 1 })}><Plus />Lägg till bild</Button>}>
      {order.images ? <div className="grid grid-cols-3 gap-2 @xl:grid-cols-6">{Array.from({ length: order.images }, (_, index) => <div key={index} className="flex aspect-square items-center justify-center rounded-lg border bg-muted/50" aria-label={`Bild ${index + 1}`}><ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" /></div>)}</div>
        : <p className="text-sm text-muted-foreground">Inga bilder än.</p>}
    </Panel>

    <Panel icon={FileText} title="Rapport">
      <p className="mb-3 text-sm text-muted-foreground">En rapport för hela arbetsordern, med uppgifternas protokoll.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={lookOnly("PDF")}><FileText />Visa PDF</Button>
        <Button type="button" variant="outline" onClick={lookOnly("E-post")}><Send />Skicka med e-post</Button>
      </div>
    </Panel>
  </div></PanelAreaProvider>;
}

// ---------- A task ----------

function TaskView({ order, task, lastEdit, onBasics, onRisk, onPatchTask, onChooseTask, onOpenOrder, onAddTask }: {
  order: DemoOrder;
  task: DemoTask | null;
  lastEdit: LastEdit;
  onBasics: (basics: Basics) => void;
  onRisk: (risk: RiskState) => void;
  onPatchTask: (id: string, patch: Partial<DemoTask>) => void;
  onChooseTask: (id: string) => void;
  onOpenOrder: () => void;
  onAddTask: (kind: TaskKind) => void;
}) {
  if (!task) return <div className="space-y-4" data-testid="holder-task">
    <ViewHeader title="Ingen uppgift" facts={<span>{order.id} har inga uppgifter än.</span>} />
    <Panel icon={ClipboardList} title="Lägg till en uppgift">
      <div className="flex flex-wrap gap-2">{TASK_KINDS.map((kind) => { const Icon = KIND_ICON[kind]; return <Button key={kind} type="button" variant="outline" onClick={() => onAddTask(kind)}><Icon />{kind}</Button>; })}</div>
    </Panel>
  </div>;
  const Icon = KIND_ICON[task.kind];
  const set = (key: string) => (value: string) => onPatchTask(task.id, { values: { ...task.values, [key]: value } });
  return <PanelAreaProvider area={KIND_AREA[task.kind]}><div className="@container min-w-0 space-y-6" data-testid="holder-task">
    <ViewHeader title={task.title} status={<Badge variant="outline" className={indicatorBadge(task.done ? "success" : "warning")}>{task.done ? "Klar" : "Ej klar"}</Badge>}
      facts={<><span className="inline-flex items-center gap-1"><Icon className="size-3.5" aria-hidden="true" />{task.kind}</span><button type="button" className="font-medium text-primary hover:underline" onClick={onOpenOrder}>I {order.id}</button></>}
      actions={<Button type="button" onClick={() => announce("Sparat")}>Spara</Button>} />
    {order.tasks.length > 1 ? <div className="-mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Uppgifter i arbetsordern" data-testid="holder-task-pick">
      {order.tasks.map((item) => <button key={item.id} type="button" aria-current={item.id === task.id ? "true" : undefined} onClick={() => onChooseTask(item.id)}
        className={cn("touch-target h-8 max-w-56 truncate rounded-full border px-3 text-xs", item.id === task.id ? "border-primary/30 bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}>{item.title}</button>)}
    </div> : null}
    <SharedBasicsPanel basics={order.basics} onChange={onBasics} holder={order.id} onOpenHolder={onOpenOrder} lastEdit={lastEdit} here="task" />
    <SharedRiskPanel risk={order.risk} onChange={onRisk} holder={order.id} onOpenHolder={onOpenOrder} lastEdit={lastEdit} here="task" />

    <Panel icon={Icon} title={task.kind === "Underhållspost" ? `Underhållspost · ${task.values.part ?? "Hydraulpump"}` : `${task.kind}: ${task.title}`}>
      <Field id={`${task.id}-name`} className="mb-4 max-w-md" label="Uppgiftens namn" value={task.title} onChange={(title) => onPatchTask(task.id, { title })} />
      {task.kind === "Protokoll" ? <ProtocolMock values={task.values} set={set} />
        : task.kind === "Driftrond" ? <RoundMock id={task.id} values={task.values} set={set} />
        : <MaintenanceMock id={task.id} values={task.values} set={set} />}
      <div className="mt-5 flex flex-wrap items-center justify-start gap-3 border-t pt-4">
        <Button type="button" variant={task.done ? "outline" : "default"} onClick={() => onPatchTask(task.id, { done: !task.done })} data-testid="holder-task-done"><CheckCircle2 />{task.done ? "Ångra klar" : "Uppgiften klar"}</Button>
        <span className="text-xs text-muted-foreground">Tid, hinder och färdigställ görs i arbetsordern.</span>
      </div>
    </Panel>
  </div></PanelAreaProvider>;
}

function Choice({ value, options, onChange, label }: { value: string; options: string[]; onChange: (value: string) => void; label: string }) {
  return <span role="radiogroup" aria-label={label} className="flex shrink-0 flex-wrap gap-1.5">{options.map((option) => <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onChange(option)}
    className={cn("touch-target inline-flex h-[var(--control-h)] min-w-14 items-center justify-center rounded-md border bg-card px-3 text-sm font-medium", value === option && (option === "OK" || option === "Nej" ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : option === "Ej aktuellt" ? "border-primary/40 bg-secondary" : "border-red-600 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"))}>{option}</button>)}</span>;
}

function ProtocolMock({ values, set }: { values: Record<string, string>; set: (key: string) => (value: string) => void }) {
  const rows = [["c1", "Armaturer monterade och fastsatta"], ["c2", "Nödljus provat"], ["c3", "Märkning klar"]];
  return <div className="space-y-3 rounded-lg border p-3" data-testid="holder-protocol">
    {rows.map(([key, text]) => <div key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm">{text}</span><Choice label={text} value={values[key] ?? ""} options={["OK", "Ej OK", "Ej aktuellt"]} onChange={set(key)} /></div>)}
  </div>;
}

function RoundMock({ id, values, set }: { id: string; values: Record<string, string>; set: (key: string) => (value: string) => void }) {
  return <div className="grid gap-4 @xl:grid-cols-3" data-testid="holder-round">
    <Field id={`${id}-temp`} label="Temperatur (°C)" type="number" value={values.temp ?? ""} onChange={set("temp")} />
    <Field id={`${id}-pressure`} label="Tryck (bar)" type="number" value={values.pressure ?? ""} onChange={set("pressure")} />
    <div className="grid content-start gap-1.5"><span className="text-xs font-medium">Läckage</span><Choice label="Läckage" value={values.leak ?? ""} options={["Nej", "Ja"]} onChange={set("leak")} /></div>
  </div>;
}

/** Minutes between two datetime-local values; null when one is missing or the order is wrong. */
function downtime(stopped?: string, restored?: string): string {
  if (!stopped || !restored) return "Stilleståndstiden räknas när Ur drift och Åter i drift är ifyllda.";
  const minutes = Math.round((new Date(restored).getTime() - new Date(stopped).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return "Åter i drift ligger före Ur drift.";
  return `Stilleståndstid: ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Underhållspost (2026-10-30): today's maintenance fields, for ONE machine part, held by the work order like a task. */
function MaintenanceMock({ id, values, set }: { id: string; values: Record<string, string>; set: (key: string) => (value: string) => void }) {
  const none = { "": "Inte angiven" };
  return <div className="grid gap-4 @xl:grid-cols-2" data-testid="holder-maintenance">
    <Field id={`${id}-part`} className="@xl:col-span-2" label="Maskindel" value={values.part ?? "Press 4 › Hydraulpump"} onChange={set("part")} options={["Press 4 › Hydraulpump", "Press 4 › Huvudmotor", "Linje 2 › Transportband 1", "Pumpstation 2 › Pump P1"]} help="En del i maskinträdet." />
    <Field id={`${id}-type`} label="Typ av underhåll" value={values.type ?? ""} onChange={set("type")} options={["", "Förebyggande", "Avhjälpande", "Tillståndsbaserat", "Förbättring"]} optionLabels={none} />
    <Field id={`${id}-priority`} label="Prioritet" value={values.priority ?? ""} onChange={set("priority")} options={["", "Akut", "Hög", "Normal", "Låg"]} optionLabels={none} />
    <Field id={`${id}-criticality`} label="Kritikalitet" value={values.criticality ?? ""} onChange={set("criticality")} options={["", "A", "B", "C"]} optionLabels={none} />
    <Field id={`${id}-marking`} label="Märkning" value={values.marking ?? ""} onChange={set("marking")} placeholder="Till exempel E12" />
    <Field id={`${id}-fault`} className="@xl:col-span-2" label="Fel eller symptom" multiline value={values.fault ?? ""} onChange={set("fault")} />
    <Field id={`${id}-cause`} label="Orsak" value={values.cause ?? ""} onChange={set("cause")} options={["", "Slitage", "Felaktig användning", "Yttre påverkan", "Konstruktion", "Annan"]} optionLabels={none} />
    <Field id={`${id}-cause-note`} label="Om orsaken" value={values.causeNote ?? ""} onChange={set("causeNote")} />
    <Field id={`${id}-reported`} label="Felanmält" type="datetime-local" value={values.reported ?? ""} onChange={set("reported")} />
    <div className="hidden @xl:block" aria-hidden="true" />
    <Field id={`${id}-stopped`} label="Ur drift" type="datetime-local" value={values.stopped ?? ""} onChange={set("stopped")} />
    <Field id={`${id}-restored`} label="Åter i drift" type="datetime-local" value={values.restored ?? ""} onChange={set("restored")} />
    <p className="text-sm font-medium @xl:col-span-2" data-testid="holder-downtime">{downtime(values.stopped, values.restored)}</p>
    <p className="text-xs text-muted-foreground @xl:col-span-2">Delens kostnad och stilleståndstid räknas från dess underhållsposter.</p>
  </div>;
}

// ---------- Ny uppgift / Ny arbetsorder ----------

function NewView({ nextId, onCreate }: { nextId: string; onCreate: (basics: Basics, risk: RiskState, kind: TaskKind | null) => void }) {
  const [what, setWhat] = useState<"uppgift" | "arbetsorder">("uppgift");
  const [kind, setKind] = useState<TaskKind>("Protokoll");
  const [basics, setBasics] = useState<Basics>(emptyBasics);
  const [risk, setRisk] = useState<RiskState>(emptyRisk);
  const titleMissing = basics.title.trim() ? "" : "Skriv en rubrik först.";
  return <PanelAreaProvider area="work-order"><div className="@container min-w-0 space-y-6" data-testid="holder-new">
    <ViewHeader title={what === "uppgift" ? "Ny uppgift" : "Ny arbetsorder"}
      facts={<span>{what === "uppgift" ? `Arbetsorder ${nextId} skapas med de här uppgifterna.` : "Uppgifter kan läggas till sedan."}</span>}
      actions={<><Button type="button" variant="outline" onClick={() => { setBasics(emptyBasics()); setRisk(emptyRisk()); }}>Avbryt</Button>
        <Button type="button" disabledReason={titleMissing} onClick={() => onCreate(basics, risk, what === "uppgift" ? kind : null)} data-testid="holder-create">{what === "uppgift" ? "Skapa uppgift" : "Skapa arbetsorder"}</Button></>} />
    <Panel icon={Plus} title="Vad skapar du?">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Vad skapar du?">
        {(["uppgift", "arbetsorder"] as const).map((item) => <Button key={item} type="button" role="radio" aria-checked={what === item} variant={what === item ? "default" : "outline"} onClick={() => setWhat(item)} data-testid={`holder-new-${item}`}>{item === "uppgift" ? "Ny uppgift" : "Ny arbetsorder"}</Button>)}
      </div>
      {/* The row keeps its height when it is empty, so nothing below moves when the choice changes. */}
      <div className="mt-3 flex min-h-[var(--control-h)] flex-wrap items-center gap-2" role="radiogroup" aria-label="Sort">
        {what === "uppgift" ? <><span className="text-xs font-medium text-muted-foreground">Sort:</span>{TASK_KINDS.map((item) => { const Icon = KIND_ICON[item]; return <Button key={item} type="button" size="sm" role="radio" aria-checked={kind === item} variant={kind === item ? "secondary" : "outline"} onClick={() => setKind(item)}><Icon />{item}</Button>; })}</>
          : <span className="text-xs text-muted-foreground">Utan uppgift. Lägg till uppgifter i arbetsordern när du vill.</span>}
      </div>
    </Panel>
    <SharedBasicsPanel basics={basics} onChange={setBasics} />
    <SharedRiskPanel risk={risk} onChange={setRisk} />
  </div></PanelAreaProvider>;
}

// ---------- Vad ändras ----------

const CHANGES: [string, string, string][] = [
  ["Grunduppgifter", "Arbetsordern har alla fält. Uppgiften har bara rubrik, ansvarig, klart senast och plats.", "Samma fält och samma data i båda."],
  ["Riskbedömning", "Görs i arbetsordern. Uppgiften visar bara en länk dit.", "Samma frågor i båda. Svaren syns på båda ställena."],
  ["Ny uppgift", "Får sparas som utkast utan arbetsorder (”Saknar arbetsorder”) och kopplas senare.", "Skapar alltid sin arbetsorder. Inget utkast utan arbetsorder."],
  ["Knapparna", "Starta tid, Rapportera hinder och Utgår uppe till höger. Färdigställ i en egen ruta till höger.", "Alla i Utförande, till vänster."],
  ["Underhåll", "En hopfälld del i varje arbetsorder.", "Underhållspost: fälten flyttar till en egen post per maskindel, som arbetsordern håller. Plus modulen Underhåll."],
  ["Uppgiften", "Grunduppgifter, länk till riskbedömningen, formuläret, bilder, färdigställ och rapport.", "De delade delarna, sedan bara själva uppgiften."],
];
const QUESTIONS: [string, string][] = [
  ["Vad händer med uppgifter som i dag saknar arbetsorder?", "Varje utkast får en egen arbetsorder med sina uppgifter, som vid flytten 2026-10-26."],
  ["Får en uppgift egen ansvarig och plats?", "Nej. Allt i Grunduppgifter är gemensamt. Behövs en annan plats blir det en ny arbetsorder."],
  ["Finns Utförande bara i arbetsordern?", "Ja. Tid, hinder, färdigställ och utgår görs där. Uppgiften har bara ”Uppgiften klar”."],
];

function ChangesView() {
  return <div className="space-y-6" data-testid="holder-changes">
    <Panel icon={ListChecks} area="work-order" title="Vad ändras jämfört med i dag">
      <ul className="-mx-4 divide-y border-y">{CHANGES.map(([what, today, proposal]) => <li key={what} className="grid gap-1 px-5 py-3 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-4">
        <span className="text-sm font-semibold">{what}</span>
        <span className="text-sm text-muted-foreground"><span className="font-medium md:hidden">I dag: </span>{today}</span>
        <span className="text-sm"><span className="font-medium md:hidden">Förslag: </span>{proposal}</span>
      </li>)}</ul>
      <p className="mt-3 hidden text-xs text-muted-foreground md:block">Kolumnerna: vad · i dag · förslag.</p>
    </Panel>
    <Panel icon={AlertCircle} area="work-order" title="Att bestämma">
      <ol className="space-y-3">{QUESTIONS.map(([question, answer], index) => <li key={question} className="text-sm">
        <p className="font-semibold">{index + 1}. {question}</p>
        <p className="mt-0.5 text-muted-foreground">Förslag: {answer}</p>
      </li>)}</ol>
      <p className="mt-3 text-xs text-muted-foreground">Ersätter regeln från 2026-10-27 att en uppgift får sparas som utkast och kopplas senare.</p>
    </Panel>
  </div>;
}

// ---------- The toast, in the workspace's look ----------

/** The page has no workspace around it, so it draws the app's own toast event with the shared card. */
export const ProposalToast = () => <EventToast testId="holder-toast" />;


"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, ChartGantt, ClipboardList, Clock, FileText, Gavel, History, Info, Package, UserCheck, MessageSquare } from "lucide-react";
import { ListEmpty, ListGroup, ListRow, NativeActions, NativeMenuPage, NativePage, useNativeScreen, useNativeTopBar } from "@/components/native";
import { returnToWork, useLeavePage } from "@/components/history-nav";
import { DISCARD_QUESTION, useConfirm } from "@/features/kfid/confirm";
import { leaveWithoutAsking } from "@/lib/workflow/leave-guard";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { parseProjectScreen, PROJECT_SCREEN_TITLE, typeOfTaskKind, withScreen, type ProjectScreen, type TypeKey } from "@/lib/workflow/native-mode";
import { NativeJobGroups } from "@/features/workflow/work-list";
import { projectJobListItem } from "@/features/workflow/work-list-items";
import { summarizeProjectBudget } from "@/lib/workflow/project-budget";
import { formatDurationSeconds } from "@/lib/workflow/duration";
import { isTaskOpen } from "@/lib/workflow/task-cancel";
import { swedishDayKey } from "@/lib/swedish-time";
import { listenForTypedChange } from "@/lib/workflow/typed-change";
import { indicatorBar, progressTone, type IndicatorTone } from "@/features/workflow/indicator-tone";

/**
 * Ett projekt på nivå 1 (2026-10-09, docs/ui-system.md 9): the project page as a menu of rows – Projektets jobb,
 * Tidplan, Planering, Tid, Material, Offerter och utfall, Personalliggare, Beslutslogg, Historik, Uppgifter om projektet –
 * and each row opens the page's own panel as a screen of its own (`&step=`). The panels stay in
 * features/kfid/workflow-projects.tsx, wrapped in `NativeScreen`; only the job list, Tid and the project's form screen are
 * drawn here. Level 2–3, the tablet and the computer never reach this file.
 */
export type NativeProjectJob = {
  id: string;
  kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM";
  title: string;
  status: string;
  dueDate?: string;
  progress: number;
  step?: { label: string } | null;
  assignedToName?: string;
  totalDurationSec?: number;
};

export type NativeProjectProps = {
  name: string;
  /** Customer and place, one line under the title. */
  place: string;
  progress: number;
  statusLabel: string;
  statusTone: IndicatorTone;
  frame: string;
  jobs: NativeProjectJob[];
  timeBudgetMinutes?: number | null;
  outsideFrameMinutes?: number | null;
  plannedCount: number;
  materialRows: number;
  about: readonly (readonly [string, string])[];
  /** The rows whose panel the page has for this person (the others are left out). */
  rows: Partial<Record<"kommentarer" | "tidplan" | "material" | "offerter" | "personalliggare" | "hantering", boolean>>;
  /** Nytt jobb (the project's own chooser) on the job list. */
  newJob?: ReactNode;
  /** Fakturaunderlag (2026-10-10): its row in Material och offerter (features/invoice-basis), null without the right. */
  invoiceRow?: ReactNode;
  /** The project's form for Uppgifter om projektet; null when the person may only read it. */
  form?: ((close: () => void) => ReactNode) | null;
  busy: boolean;
};

const taskHref = (job: Pick<NativeProjectJob, "id" | "kind">) => `/?view=workflow_task&taskId=${encodeURIComponent(job.id)}&taskType=${job.kind}`;

/**
 * Nytt projekt at level 1 (2026-10-09): the project's form as a screen of its own – the title and Avbryt/Skapa in
 * the top bar instead of a view over the project list; the form's own buttons give way. Elsewhere the page's own view.
 */
export function NativeNewProject({ form, busy, children }: { form: (close: () => void) => ReactNode; busy: boolean; children: ReactNode }) {
  const { native } = useNativeScreen();
  const box = useRef<HTMLDivElement | null>(null);
  const [confirm, confirmCard] = useConfirm();
  const leavePage = useLeavePage();
  // Anything typed or chosen in the form makes it changed (2026-10-13); the form keeps its own values.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!native || !element) return;
    // Deferred: the form is drawn by this screen (form(close)), so a re-render inside the first input event would draw the
    // field again with its old value and swallow what was typed.
    return listenForTypedChange(element, () => setDirty(true));
  }, [native]);
  const releaseBack = useUnsavedGuard(native && dirty && !busy, confirm, undefined, { browserBack: true });
  // Avbryt asks when something is changed (2026-10-13) and goes back where the person came from, never out of Workflow.
  const close = () => void (async () => {
    if (dirty && !(await confirm(DISCARD_QUESTION))) return;
    leaveWithoutAsking();
    leavePage("/?view=projects");
  })();
  // Skapa presses the form's own button, so a missing name gives its reason ("Ange projektets namn först.") as the button does.
  useNativeTopBar(native ? { title: "Nytt projekt", cancel: { onClick: close }, save: { label: "Skapa", busy, onClick: () => void releaseBack().then(() => box.current?.querySelector<HTMLButtonElement>('[data-dialog-role="primary"]')?.click()) } } : null);
  if (!native) return <>{children}</>;
  return <div ref={box} className="native-page native-screen pb-4 [&_.dialog-actions]:hidden" data-testid="native-new-project">
    {confirmCard}
    <p className="px-1 pb-3 text-[0.8125rem] leading-5 text-muted-foreground">Projektets grunduppgifter. Jobb kopplas till projektet efteråt.</p>
    <div className="native-group p-4">{form(close)}</div>
  </div>;
}

/** The title, the place and the progress over the project's menu. */
export function NativeProjectHead({ place, progress, statusLabel, statusTone, frame }: NativeProjectProps) {
  const { native, step } = useNativeScreen();
  if (!native || step) return null;
  return <div data-testid="native-project-head">
    {/* The top bar names the project (M1, 2026-10-12): no large title of the page's own repeats it. */}
    {place ? <p className="px-1 pt-1 text-sm leading-5 text-muted-foreground">{place}</p> : null}
    {/* The bar lies under the line of text, never over it (audit 2026-10-12). */}
    <div className="px-1 pb-2 pt-3">
      <div className="relative block h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${progress} procent klart`} data-testid="native-project-progress">
        <div className={`h-full rounded-full ${indicatorBar(statusTone === "danger" ? "danger" : progressTone({ percent: progress }))}`} style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">{[`${progress} % klart`, statusLabel, frame].filter(Boolean).join(" · ")}</p>
    </div>
  </div>;
}

/** The project's menu of rows, and the screens drawn here: the job list, Tid and Uppgifter om projektet. */
export function NativeProjectRows(props: NativeProjectProps) {
  const { native, step } = useNativeScreen();
  const router = useRouter();
  const params = useSearchParams();
  const formBox = useRef<HTMLDivElement | null>(null);
  const screen = parseProjectScreen(step);
  const href = (to: ProjectScreen) => withScreen(params.toString(), to);
  // Bakåt is a step back when the menu is where the person came from, so the menu keeps its place.
  const close = () => returnToWork(withScreen(params.toString(), null), (address) => router.push(address));
  const editing = screen === "uppgifter" && Boolean(props.form);
  // Every screen has the top bar (M1): the menu names the project, a screen goes back to "Projektet" (Avbryt/Spara while editing).
  useNativeTopBar(native ? screen ? {
    title: PROJECT_SCREEN_TITLE[screen],
    ...(editing ? {
      cancel: { onClick: close },
      save: { busy: props.busy, onClick: () => formBox.current?.querySelector("form")?.requestSubmit() },
    } : { back: { label: "Projektet" } }),
  } : { title: props.name || "Projekt" } : null);
  if (!native) return null;
  const reportedSec = props.jobs.reduce((sum, job) => sum + (job.totalDurationSec ?? 0), 0);
  if (screen === "jobb") return <JobList jobs={props.jobs} newJob={props.newJob} />;
  if (screen === "tid") return <ProjectTime {...props} reportedSec={reportedSec} />;
  if (screen === "uppgifter") return props.form
    // The form's own buttons give way to Avbryt and Spara in the top bar.
    ? <div ref={formBox} className="native-page pb-4 [&_.dialog-actions]:hidden" data-testid="native-project-form">{props.form(close)}</div>
    : <NativePage><ListGroup testId="native-project-about">
      {props.about.length ? props.about.map(([label, value]) => <ListRow key={label} title={value} subtitle={label} wrap />) : <ListEmpty>Projektet har inga fler uppgifter.</ListEmpty>}
    </ListGroup></NativePage>;
  if (screen) return null;
  const open = props.jobs.filter((job) => isTaskOpen(job.status));
  const today = swedishDayKey(new Date());
  const late = open.filter((job) => job.dueDate && job.dueDate < today).length;
  const row = (key: ProjectScreen, type: TypeKey, icon: LucideIcon, extra: { subtitle?: string; value?: string; subtitleTone?: "danger" } = {}) =>
    <ListRow key={key} type={type} icon={icon} title={PROJECT_SCREEN_TITLE[key]} href={href(key)} testId={`native-row-${key}`} {...extra} />;
  const money = [props.rows.material ? row("material", "quote", Package, { value: props.materialRows ? String(props.materialRows) : undefined }) : null,
    props.rows.offerter ? row("offerter", "quote", FileText) : null, props.invoiceRow ?? null].filter(Boolean);
  // M2 (2026-10-12): the two most used choices, Jobb and Tidplan, as big tiles; everything else as rows under them.
  const jobSubtitle = props.jobs.length ? [`${open.length} ${open.length === 1 ? "öppet" : "öppna"}`, late ? `${late} ${late === 1 ? "förfallet" : "förfallna"}` : ""].filter(Boolean).join(" · ") : "Inga jobb än";
  return <NativeMenuPage testId="native-project"
    tiles={[
      { title: PROJECT_SCREEN_TITLE.jobb, subtitle: jobSubtitle, type: "project", icon: ClipboardList, href: href("jobb"), testId: "native-row-jobb" },
      ...(props.rows.tidplan ? [{ title: PROJECT_SCREEN_TITLE.tidplan, subtitle: "Vecka för vecka", type: "time" as const, icon: ChartGantt, href: href("tidplan"), testId: "native-row-tidplan" }] : []),
    ]}
    groups={[]}>
    {/* One entry for the plan (2026-10-12): Tidplan is the tile, Planering the row (its bookings and budget); the office page Planering is on display 2. */}
    <ListGroup title="Tid och planering" testId="native-project-planning">
      {row("planering", "time", CalendarClock, { subtitle: props.plannedCount ? `${props.plannedCount} ${props.plannedCount === 1 ? "planerad aktivitet" : "planerade aktiviteter"}` : "Inget planerat" })}
      {row("tid", "time", Clock, { value: formatDurationSeconds(reportedSec) })}
    </ListGroup>
    {money.length ? <ListGroup title="Material och offerter" testId="native-project-money">{money}</ListGroup> : null}
    <ListGroup title="Mer" testId="native-project-more">
      {props.rows.personalliggare ? row("personalliggare", "checkin", UserCheck, { subtitle: "Checka in och ut" }) : null}
      {props.rows.kommentarer ? row("kommentarer", "neutral", MessageSquare) : null}
      {row("beslut", "neutral", Gavel)}
      {row("historik", "neutral", History)}
      {row("uppgifter", "project", Info, { subtitle: [props.place, props.frame].filter(Boolean).join(" · ") || undefined })}
      {props.rows.hantering ? row("hantering", "neutral", FileText, { subtitle: "Rapport, egenkontroll, arkivera och avsluta" }) : null}
    </ListGroup>
  </NativeMenuPage>;
}

/**
 * Projektets jobb: grouped Förfallet, I dag, Denna vecka, Senare by Klart senast; each row opens the job. The same row as
 * the Jobb tab (B3, NativeJobGroups): the job's step stands where the list has customer and place, with who has it.
 */
function JobList({ jobs, newJob }: { jobs: NativeProjectJob[]; newJob?: ReactNode }) {
  const today = swedishDayKey(new Date());
  const items = [...jobs].sort((left, right) => (left.dueDate || "9999").localeCompare(right.dueDate || "9999")).map((job) => projectJobListItem(job, today));
  return <NativePage testId="native-project-job-list">
    {/* Nytt jobb is a row of the list, not a big blue button (audit 2026-10-12). */}
    {newJob ? <NativeActions testId="native-project-new-job-row">{newJob}</NativeActions> : null}
    {items.length ? <NativeJobGroups items={items} responsible rowTestId="native-project-job" /> : <ListGroup><ListEmpty>Projektet har inga jobb än.</ListEmpty></ListGroup>}
  </NativePage>;
}

/** Tid: the reported time against the budget, and per job (each row opens the job's own Tid). */
function ProjectTime({ jobs, timeBudgetMinutes, outsideFrameMinutes, reportedSec }: NativeProjectProps & { reportedSec: number }) {
  const budget = summarizeProjectBudget(timeBudgetMinutes, reportedSec);
  const minutes = (value: number) => formatDurationSeconds(value * 60);
  const withTime = jobs.filter((job) => (job.totalDurationSec ?? 0) > 0);
  return <NativePage testId="native-project-time">
    <ListGroup footer="Planerad tid står under Planering och räknas inte som rapporterad.">
      <ListRow type="time" title="Rapporterad tid" value={formatDurationSeconds(reportedSec)} />
      <ListRow type="time" title="Tidsbudget" value={budget.hasBudget ? minutes(budget.budgetMinutes) : "Inte angiven"} />
      {budget.hasBudget ? <ListRow type="time" title={budget.isOverBudget ? "Överskriden budget" : "Återstår"} value={minutes(budget.isOverBudget ? budget.overBudgetMinutes : budget.remainingMinutes)}
        pill={budget.isOverBudget ? { label: "Över budget", tone: "danger" } : budget.isHighUsage ? { label: `${budget.percentUsed} %`, tone: "warning" } : null} /> : null}
    </ListGroup>
    {outsideFrameMinutes ? <p className="notice mt-3 text-sm" data-testid="native-project-time-outside">{minutes(outsideFrameMinutes)} är rapporterat utanför projektets tidsram. Tiden räknas men bör stämmas av.</p> : null}
    <ListGroup title="Per jobb">
      {withTime.length ? withTime.map((job) => <ListRow key={job.id} type={typeOfTaskKind(job.kind)} title={job.title || "Utan rubrik"} href={`${taskHref(job)}&step=tid`} value={formatDurationSeconds(job.totalDurationSec ?? 0)} />)
        : <ListEmpty>Ingen tid är rapporterad på projektets jobb än.</ListEmpty>}
    </ListGroup>
  </NativePage>;
}

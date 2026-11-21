"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { FileText, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Panel } from "@/features/kfid/ui";
import type { CustomerItem, ProjectItem } from "@/features/kfid/types";
import { taskDueDateError } from "@/lib/workflow/project-frame";
import { holderLine, workflowTaskHref } from "@/lib/workflow/work-order-link";
import { CustomerField, type CustomerPlaceChange, type CustomerQuickLinks } from "./customer-field";
import type { SavePlace } from "./place-picker";
import { TaskScheduleFields } from "./task-schedule-fields";

/**
 * Arbetsordern som hållare (2026-10-30): Grunduppgifter is ONE component, drawn on the same data in the work order,
 * in every task of it and on a draft without one. In a work order it edits the order itself; in a task it edits the task's
 * work order (with the line "Hör till arbetsorder X – ändras på båda ställena" and Öppna arbetsordern), since a task never
 * has a responsible person, place or dates of its own (lib/workflow/work-order-link.ts); on a draft it edits the draft's
 * own fields, which move to the work order when it is made. The fields are the work order's: Rubrik, Projekt, Kund och plats,
 * Ansvarig, Start, Klart senast and Beskrivning. What only a work order has (status, round, Uppskattad tid, Etapp, the
 * temporary place, the choice of work order) comes in the slots, so nothing is drawn twice.
 */
export type SharedBasicsValue = {
  title: string; description: string; projectId: string | null; customerId: string | null; facilityId?: string | null;
  assignedToUserId: string | null; assignedToName: string; plannedStartDate?: string; dueDate: string; estimatedMinutes?: number | null; stage?: string; createdAt?: string;
};
export type SharedBasicsMember = { id: string; name: string; canRead?: boolean };

export function HolderLine({ workOrder, readable = true, testId = "task-holder-line" }: { workOrder: { id: string; title: string }; readable?: boolean; testId?: string }) {
  return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm" data-testid={testId}>
    <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="min-w-0 flex-1">{holderLine(workOrder.title)}</span>
    {readable ? <Link href={workflowTaskHref({ id: workOrder.id, kind: "WORK_ORDER" })} className="text-xs font-medium text-primary hover:underline" data-testid="task-work-order-open">Öppna arbetsordern</Link> : null}
  </p>;
}

export function SharedBasicsPanel({ holder, holderReadable, description, testId = "shared-basics", children }: {
  /** The work order a task belongs to: the panel then says the data is shared. */
  holder?: { id: string; title: string } | null;
  holderReadable?: boolean;
  description?: string;
  testId?: string;
  children: ReactNode;
}) {
  // The work order's colour when the data is the work order's; a draft's own Grunduppgifter take the page's (card-headers [ii]).
  return <Panel icon={FileText} area={holder ? "work-order" : undefined} title="Grunduppgifter" description={description}>
    <div className="grid gap-4" data-testid={testId}>
      {/* The same test id as the locked line it replaces (2026-10-26), so a task's page still names its work order there. */}
      {holder ? <HolderLine workOrder={holder} readable={holderReadable} testId="task-work-order-line" /> : null}
      {children}
    </div>
  </Panel>;
}

export function SharedBasicsFields({ value, customers, projects, members, disabled = false, idPrefix = "task", hideTitle = false, titleLabel = "Rubrik", projectSlot, afterProject, planningExtras, extras, afterGrid,
  onTitle, onDescription, onCustomer, onResponsible, onSchedule, onDueDate, memberNote, assigneeNote, customer, hideProject = false, hideDescription = false, schedule, title: titleOptions, assignee: assigneeOptions, description: descriptionOptions }: {
  value: SharedBasicsValue;
  customers: CustomerItem[];
  projects: ProjectItem[];
  members: SharedBasicsMember[];
  disabled?: boolean;
  /** The fields' ids: `task` on the page's own job (the work order, a draft), `holder` when a task edits its work order. */
  idPrefix?: string;
  /** A protocol whose title follows one of its own fields (the control's layout) shows no Rubrik here. */
  hideTitle?: boolean;
  /** The description stands elsewhere (the project popup has it under Fler uppgifter, so the form fits a popup). */
  hideDescription?: boolean;
  /** The title's label: "Arbetsorderns rubrik" when a task edits its work order (användartest 2026-10-31, fel 1: a control's
   *  name was typed there and renamed the work order). */
  titleLabel?: string;
  /** The project choice of a new work order; without it the project is shown (it moves only through the project). */
  projectSlot?: ReactNode;
  afterProject?: ReactNode;
  /** After Klart senast: Uppskattad tid and Etapp of a work order. */
  planningExtras?: ReactNode;
  /** Status and the round a work order holds. */
  extras?: ReactNode;
  /** Under the grid, before Beskrivning: the temporary place. */
  afterGrid?: ReactNode;
  onTitle: (title: string) => void;
  onDescription: (description: string) => void;
  onCustomer: (change: CustomerPlaceChange) => void;
  onResponsible: (id: string, name?: string) => void;
  onSchedule: (values: { plannedStartDate?: string; estimatedMinutes?: number | null; stage?: string }) => void;
  onDueDate: (dueDate: string) => void;
  /** A word after a person's name in Ansvarig (" – når inte krävd nivå"). */
  memberNote?: (member: SharedBasicsMember) => string;
  /** A line under Ansvarig (the level of the chosen person). */
  assigneeNote?: ReactNode;
  customer: { locked: boolean; lockedNote?: string; placeNote?: string; savePlace?: SavePlace; quick?: CustomerQuickLinks; search?: boolean; placeOpenRequest?: number; autoPlace?: boolean };
  /** The project's own form (variant Jobb, Lika är rätt 2026-11-14): no Projekt field, since the job is the project itself. */
  hideProject?: boolean;
  /** In place of Start and Klart senast: the project's own time frame. */
  schedule?: ReactNode;
  title?: { maxLength?: number; required?: boolean; autoFocus?: boolean };
  assignee?: { label?: string; empty?: string };
  description?: { label?: string; note?: string; maxLength?: number };
}) {
  const project = projects.find((item) => item.id === value.projectId);
  const dueDateError = project ? taskDueDateError(value.dueDate, project) : null;
  const assignable = members.filter((member) => member.canRead !== false || member.id === value.assignedToUserId);
  const someoneLeftOut = members.some((member) => member.canRead === false);
  const id = (name: string) => `${idPrefix}-${name}`;
  const label = "space-y-2 text-xs font-medium text-muted-foreground";
  return <>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {hideTitle ? null : <label className={label}>{titleLabel}<Input id={id("title")} value={value.title} maxLength={titleOptions?.maxLength ?? 200} required={titleOptions?.required} autoFocus={titleOptions?.autoFocus} disabled={disabled} onChange={(event) => onTitle(event.target.value)} /></label>}
      {hideProject ? null : projectSlot ?? <div className={label}><span className="block">Projekt</span><p className="flex h-[var(--control-h)] items-center truncate rounded-md border bg-muted/40 px-3 text-sm text-foreground" data-testid={id("project-shown")}>{project?.name || "Inget projekt"}</p></div>}
      {afterProject}
      <CustomerField id={idPrefix} customers={customers} customerId={value.customerId} facilityId={value.facilityId ?? null} locked={customer.locked} lockedNote={customer.lockedNote}
        placeNote={customer.placeNote} disabled={disabled} savePlace={customer.savePlace} quick={customer.quick} search={customer.search} placeOpenRequest={customer.placeOpenRequest} autoPlace={customer.autoPlace} onChange={onCustomer} />
      {members.length || assigneeOptions ? <label className={label}>{assigneeOptions?.label ?? "Ansvarig"}<select id={id("assignee")} className="form-select" value={value.assignedToUserId ?? ""} disabled={disabled} aria-describedby={someoneLeftOut ? id("assignee-hint") : undefined}
        onChange={(event) => onResponsible(event.target.value)}>
        <option value="">{assigneeOptions?.empty ?? "Inte tilldelad"}</option>
        {assignable.map((member) => <option key={member.id} value={member.id}>{member.name}{member.canRead === false ? " – får inte läsa jobbet" : memberNote?.(member) ?? ""}</option>)}
      </select>{assigneeNote}{someoneLeftOut ? <span id={id("assignee-hint")} className="block font-normal">Listan visar de som får läsa jobbet.</span> : null}</label>
        : <label className={label}>Ansvarig<Input id={id("assignee")} value={value.assignedToName} disabled={disabled} onChange={(event) => onResponsible("", event.target.value)} /></label>}
      {/* Tidplan: Start, then Klart senast – the job's period. */}
      {schedule ?? <>
      <TaskScheduleFields part="start" task={value} frame={project} onChange={onSchedule} />
      <label className={label}>Klart senast<Input id={id("due-date")} type="date" value={value.dueDate} disabled={disabled} min={project?.startDate || undefined} max={project?.startDate ? project.dueDate || undefined : undefined}
        aria-invalid={dueDateError ? true : undefined} aria-describedby={dueDateError ? id("due-date-error") : undefined} onChange={(event) => onDueDate(event.target.value)} />
        {dueDateError ? <span id={id("due-date-error")} className="block font-normal text-destructive">{dueDateError}</span> : null}</label>
      </>}
      {planningExtras}
      {extras}
    </div>
    {afterGrid}
    {hideDescription ? null : <label className="block space-y-2 text-xs font-medium text-muted-foreground">{descriptionOptions?.label ?? "Beskrivning"}<textarea aria-label={descriptionOptions?.label ?? "Beskrivning"} className="form-textarea" value={value.description} maxLength={descriptionOptions?.maxLength ?? 5000} disabled={disabled} onChange={(event) => onDescription(event.target.value)} />
      {descriptionOptions?.note ? <span className="block font-normal">{descriptionOptions.note}</span> : null}</label>}
  </>;
}

/**
 * Grunduppgifter, variant Affär (Lika är rätt, 2026-11-14): offert, inköp and fakturaunderlag draw the same card as the
 * work order (variant Jobb above) with the same grid, labels and customer field, in the same order – Rubrik, Projekt,
 * Arbetsorder (when there is one), Kund, Plats, the page's own fields, and Beskrivning last over the whole width. Variant Jobb
 * has who and when (Ansvarig, Start, Klart senast); Affär has the deal's own fields in `children`. A field with no use on the
 * page is left out (an inköp has no place; a basis made on a job shows its project).
 */
export type DealProject = { value: string | null; options: ProjectItem[]; onChange: (id: string | null, project: ProjectItem | null) => void;
  /** The project cannot be changed here: the name is shown, with where it comes from under it. */
  locked?: { name: string; note?: string } | null;
  /** The saved project when it is no longer among the options (archived). */
  current?: { id: string; name: string } | null; testId?: string };
export type DealCustomer = { customers: CustomerItem[]; customerId: string | null; facilityId: string | null; onChange: (change: CustomerPlaceChange) => void;
  noPlace?: boolean; search?: boolean; quick?: CustomerQuickLinks; savePlace?: SavePlace; locked?: boolean; lockedNote?: string; label?: string; testId?: string };

export function DealBasicsFields({ idPrefix, disabled = false, title, project, workOrder, customer, description, children }: {
  idPrefix: string;
  disabled?: boolean;
  title: { value: string; onChange: (value: string) => void; placeholder?: string; testId?: string };
  project?: DealProject | null;
  /** The work order the document belongs to, as a link. */
  workOrder?: { id: string; title: string } | null;
  customer: DealCustomer;
  description: { label: string; value: string; onChange: (value: string) => void; ariaLabel: string; maxLength?: number; testId?: string };
  /** The page's own fields (Kundtyp, Giltig till, Moms …), after Kund and Plats. */
  children?: ReactNode;
}) {
  const label = "space-y-2 text-xs font-medium text-muted-foreground";
  const shownProjects = project ? project.options.filter((item) => item.id === project.value || (!item.archivedAt && !item.closedAt)) : [];
  return <>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid={`${idPrefix}-basics`}>
      <label className={label}>Rubrik<Input id={`${idPrefix}-title`} value={title.value} maxLength={200} disabled={disabled} placeholder={title.placeholder} data-testid={title.testId} onChange={(event) => title.onChange(event.target.value)} /></label>
      {project ? project.locked ? <div className={label}><span className="block">Projekt</span>
        <p className="flex h-[var(--control-h)] items-center truncate rounded-md border bg-muted/40 px-3 text-sm text-foreground" data-testid={`${idPrefix}-project-shown`}>{project.locked.name}</p>
        {project.locked.note ? <span className="block font-normal">{project.locked.note}</span> : null}</div>
        : <label className={label}>Projekt (valfritt)
          <select className="form-select" value={project.value ?? ""} disabled={disabled} aria-label="Projekt" data-testid={project.testId}
            onChange={(event) => { const id = event.target.value || null; project.onChange(id, id ? project.options.find((item) => item.id === id) ?? null : null); }}>
            <option value="">Inget projekt</option>
            {shownProjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            {project.value && !shownProjects.some((item) => item.id === project.value) && project.current ? <option value={project.current.id}>{project.current.name}</option> : null}
          </select>
        </label> : null}
      {workOrder ? <div className={label}><span className="block">Arbetsorder</span>
        <p className="flex h-[var(--control-h)] items-center truncate text-sm font-normal text-foreground"><Link className="truncate text-primary underline-offset-4 hover:underline" href={workflowTaskHref({ id: workOrder.id, kind: "WORK_ORDER" })} data-testid={`${idPrefix}-work-order-link`}>{workOrder.title}</Link></p>
      </div> : null}
      <CustomerField id={idPrefix} customers={customer.customers} customerId={customer.customerId} facilityId={customer.facilityId} disabled={disabled} search={customer.search} quick={customer.quick} savePlace={customer.savePlace}
        locked={customer.locked} lockedNote={customer.lockedNote} customerLabel={customer.label} noPlace={customer.noPlace} customerTestId={customer.testId} onChange={customer.onChange} />
      {children}
    </div>
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">{description.label}
      <textarea aria-label={description.ariaLabel} className="form-textarea min-h-20" value={description.value} maxLength={description.maxLength ?? 5000} disabled={disabled} data-testid={description.testId} onChange={(event) => description.onChange(event.target.value)} />
    </label>
  </>;
}

/** Kedjan (Lika är rätt): a chosen project fills an empty customer and place; a customer already chosen is never replaced. */
export function customerFromProject(current: { customerId: string | null; facilityId: string | null }, project: ProjectItem | null): { customerId: string | null; facilityId: string | null } {
  if (!project || current.customerId || !project.customerId) return current;
  return { customerId: project.customerId, facilityId: project.facilityId ?? null };
}

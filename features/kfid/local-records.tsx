"use client";

import { useConfirm } from "./confirm";
import { CustomerCardLink } from "./customer-card";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  HardDrive,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { workflowTaskProgress } from "@/lib/workflow/task-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateForCompletion } from "@/lib/kfid/model";
import { Empty, Field, Modal, Panel, Status } from "./ui";
import { CustomerAccordionList } from "./customer-accordion-list";
import { CustomerWork } from "./record-archive";
import { WorkOverview, type WorkflowOverviewData } from "./analytics";
import { OverviewKpiDashboard } from "@/features/workflow/overview-kpis";
import { summarizeOverviewKpis } from "@/lib/workflow/overview-kpis";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { effectiveWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import {
  changeLocalRecordState,
  saveLocalCustomerRecord,
  type LocalCustomer,
  type LocalRecordAction,
  type LocalRecordKind,
  type LocalWorkspaceDocument,
} from "./local-workspace-store";

const blankCustomer = {
  name: "",
  company: "",
  address: "",
  postalCode: "",
  city: "",
  email: "",
  phone: "",
  mobile: "",
  lat: "",
  lng: "",
  notes: "",
};

type CustomerForm = typeof blankCustomer;

export function LocalDashboard({
  workspace,
  currentUserId,
  fileBased = false,
}: {
  workspace: LocalWorkspaceDocument;
  currentUserId: string;
  fileBased?: boolean;
}) {
  const controls = workspace.controls.filter((item) => !item.deletedAt);
  // Same key figures as Cloud, computed from the open .hwf. The file owner is the only person, so there is no team view.
  const localTasks = [
    ...workspace.workflowTasks.map((task) => ({ kind: task.kind, status: task.status, dueDate: task.dueDate, completedAt: task.completedAt, isMine: true, projectId: task.projectId })),
    // An open control with remaining mandatory points needs action, as in the notifications (2026-09-26).
    ...controls.map((control) => ({ kind: "CONTROL" as const, status: control.status === "COMPLETED" ? "COMPLETED" : validateForCompletion(control.data, { attachmentCount: workspace.attachments.filter((attachment) => attachment.controlId === control.id).length }).errors.length ? "NEEDS_ACTION" : "IN_PROGRESS", dueDate: "", completedAt: control.status === "COMPLETED" ? control.updatedAt : null, isMine: true, projectId: control.projectId })),
  ];
  const kpis = summarizeOverviewKpis({
    scope: "mine",
    currentUserId,
    members: [{ id: currentUserId, weeklyWorkMinutes: effectiveWeeklyWorkMinutes(workspace.organization.weeklyWorkMinutes, workspace.localIdentity.weeklyWorkMinutes) }],
    tasks: localTasks,
    projects: workspace.projects.map((project) => {
      const own = localTasks.filter((task) => task.projectId === project.id);
      const status = summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, dueDate: project.dueDate, tasks: own, activities: workspace.plannedActivities.filter((activity) => activity.projectId === project.id) });
      return { status, timeBudgetMinutes: project.timeBudgetMinutes, reportedMinutes: Math.round([...workspace.workflowTasks, ...workspace.controls.filter((control) => !control.deletedAt)].filter((task) => task.projectId === project.id).flatMap((task) => task.timeEntries).reduce((sum, entry) => sum + entry.durationSec, 0) / 60), isMine: true };
    }),
    timeEntries: [...workspace.workflowTasks, ...workspace.controls.filter((control) => !control.deletedAt)].flatMap((task) => task.timeEntries.map((entry) => ({ userId: entry.userId, startedAt: entry.startedAt, durationSec: entry.durationSec }))),
    activities: workspace.plannedActivities.filter((activity) => !activity.deletedAt).map((activity) => ({ startsAt: activity.startsAt, endsAt: activity.endsAt, assignedToUserId: activity.assignedToUserId, assignedToUserIds: activity.assignedToUserIds, assignments: activity.assignments, status: activity.status, projectId: activity.projectId })),
  });
  const overviewData: WorkflowOverviewData = {
    controls: controls.map((control) => {
      const completion = validateForCompletion(control.data, { attachmentCount: workspace.attachments.filter((attachment) => attachment.controlId === control.id).length });
      return { id: control.id, number: control.number, title: control.title, project: control.project, performer: control.performer, date: control.date, status: control.status, version: control.version, deletedAt: control.deletedAt, updatedAt: control.updatedAt, postedAt: control.postedAt, customerId: control.customerId, projectId: control.projectId, lastOpenedAt: control.lastOpenedAt, completion: { complete: completion.complete, errors: completion.errors.length, warnings: completion.warnings.length, percent: completion.progress.percent } };
    }),
    projects: workspace.projects.map((project) => ({ ...project, status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, dueDate: project.dueDate, tasks: localTasks.filter((task) => task.projectId === project.id), activities: workspace.plannedActivities.filter((activity) => activity.projectId === project.id) }), controls: controls.filter((control) => control.projectId === project.id).map((control) => { const completion = validateForCompletion(control.data, { attachmentCount: workspace.attachments.filter((attachment) => attachment.controlId === control.id).length }); return { id: control.id, title: control.title, status: control.status, updatedAt: control.updatedAt, completion: completion.progress.percent }; }), workflowTasks: workspace.workflowTasks.filter((task) => task.projectId === project.id).map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, updatedAt: task.updatedAt, projectId: task.projectId })) })),
    workflowTasks: workspace.workflowTasks.filter((task) => !task.projectId).map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, updatedAt: task.updatedAt, projectId: task.projectId })),
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-4"><div><h1 className="page-title">Översikt</h1><p className="page-description mt-2">Följ projektens progression och fortsätt där arbetet stannade. <span className="whitespace-nowrap">{fileBased ? "Lokal arbetsytefil." : "Lokal mapp."}</span></p></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/?view=projects">{workspace.projects.length} projekt</Link></Button><Button asChild variant="outline"><Link href="/?view=new_project"><Plus />Nytt projekt</Link></Button><Button asChild><Link href="/?view=new_task"><Plus />Ny uppgift</Link></Button></div></div>
      <OverviewKpiDashboard team={null} mine={kpis} />
      <WorkOverview localData={overviewData} />
    </div>
  );
}

export function LocalRecordArchive({
  kind,
  workspace,
  commit,
  customerId,
  notify,
  fileBased = false,
}: {
  kind: LocalRecordKind;
  workspace: LocalWorkspaceDocument;
  commit: (next: LocalWorkspaceDocument) => Promise<LocalWorkspaceDocument>;
  customerId?: string;
  notify: (text: string, error?: boolean) => void;
  fileBased?: boolean;
}) {
  const controls = kind === "controls";
  const [query, setQuery] = useState("");
  const [confirmCard, confirmElement] = useConfirm();
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<LocalCustomer | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerForm>(blankCustomer);
  // The file owner has full local rights, so every kind of work is counted.
  const localCustomerWork = (id: string) => ({
    projects: workspace.projects.filter((project) => project.customerId === id).length,
    workOrders: workspace.workflowTasks.filter((task) => task.customerId === id && task.kind === "WORK_ORDER").length,
    riskAssessments: workspace.workflowTasks.filter((task) => task.customerId === id && task.kind === "RISK_ASSESSMENT").length,
    controls: workspace.controls.filter((control) => !control.deletedAt && control.customerId === id).length,
  });
  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("sv-SE");
    const source = controls ? workspace.controls : workspace.customers;
    return source
      .filter((item) => Boolean(item.deletedAt) === trash)
      .filter((item) =>
        controls && customerId && "customerId" in item
          ? item.customerId === customerId
          : true,
      )
      .filter((item) =>
        !needle
          ? true
          : JSON.stringify(item).toLocaleLowerCase("sv-SE").includes(needle),
      )
      .sort((a, b) =>
        controls
          ? b.updatedAt.localeCompare(a.updatedAt)
          : "name" in a && "name" in b
            ? a.name.localeCompare(b.name, "sv-SE")
            : 0,
      );
  }, [controls, customerId, query, trash, workspace]);

  function openCustomer(item?: LocalCustomer) {
    setEditing(item ?? null);
    setCustomer(
      item
        ? {
            name: item.name,
            company: item.company,
            address: item.address,
            postalCode: item.postalCode,
            city: item.city,
            email: item.email,
            phone: item.phone,
            mobile: item.mobile,
            lat: item.lat == null ? "" : String(item.lat),
            lng: item.lng == null ? "" : String(item.lng),
            notes: item.notes,
          }
        : blankCustomer,
    );
    setCustomerOpen(true);
  }

  async function changeState(action: LocalRecordAction, id: string) {
    if (
      action !== "restore" &&
      !(await confirmCard(action === "purge"
        ? { title: "Radera posten permanent?", message: "Posten raderas ur den lokala filen. Det går inte att ångra.", confirmLabel: "Radera permanent", tone: "danger" }
        : { title: "Flytta till papperskorgen?", message: "Posten flyttas till den lokala papperskorgen och kan återställas.", confirmLabel: "Flytta till papperskorgen", tone: "danger" }))
    )
      return;
    setBusy(true);
    try {
      await commit(changeLocalRecordState(workspace, kind, action, [id]));
      notify(
        action === "restore"
          ? "Posten är återställd i den lokala filen."
          : action === "purge"
            ? "Posten är permanent raderad ur den lokala filen."
            : "Posten har flyttats till den lokala papperskorgen.",
      );
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {confirmElement}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">
            {controls ? "Mina kontroller" : "Kundregister"}
          </h1>
          <p className="page-description mt-2">
            {controls
              ? fileBased
                ? "Kontroller i den öppna lokala Workflow-arbetsytefilen."
                : "Kontroller i den anslutna lokala Workflow-mappen."
              : fileBased
                ? "Kundregister i den öppna lokala Workflow-arbetsytefilen."
                : "Kundregister i den anslutna lokala Workflow-mappen."}
          </p>
        </div>
        {controls ? (
          <Button asChild>
            <Link href="/?view=new">
              <Plus />
              Ny kontroll
            </Link>
          </Button>
        ) : (
          <Button onClick={() => openCustomer()}>
            <Plus />
            Ny kund
          </Button>
        )}
      </div>
      <p className="notice flex items-center gap-2">
        <HardDrive className="size-4 shrink-0" />
        {fileBased
          ? "Ändringar stannar i den här fliken tills du laddar ned en uppdaterad .hwf-arbetsytefil."
          : "Ändringar i registret skrivs direkt till den valda lokala mappen och föregående register sparas som kfid-workspace.backup.json."}
      </p>
      <Panel title={controls ? "Kontrollarkiv" : "Kundregister"}>
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              className="h-10 pl-10"
              aria-label={controls ? "Sök lokala kontroller" : "Sök lokala kunder"}
              placeholder={controls ? "Sök projekt, utförare eller innehåll…" : "Sök namn, adress eller kontaktuppgift…"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            variant={trash ? "secondary" : "outline"}
            onClick={() => setTrash((value) => !value)}
          >
            <Trash2 />
            {trash ? "Visa aktiva" : "Papperskorg"}
          </Button>
        </div>
        {items.length ? (
          <>
          {controls && <div className="archive-card-list space-y-3 lg:hidden">
            {items.map((raw) => {
              if (controls) {
                const item = raw as LocalWorkspaceDocument["controls"][number];
                const completion = validateForCompletion(item.data, {
                  attachmentCount: workspace.attachments.filter((attachment) => attachment.controlId === item.id).length,
                });
                return (
                  <article key={item.id} className="min-w-0 rounded-xl border bg-card p-4">
                    <Link className="block break-words font-medium hover:text-primary" href={`/?view=new&id=${item.id}`}>#{item.number} · {item.title}</Link>
                    {item.project && <p className="mt-1 break-words text-xs text-muted-foreground">{item.project}</p>}
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-muted-foreground">Utförare</dt><dd className="mt-1 break-words">{item.performer || "—"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Datum</dt><dd className="mt-1">{item.date || "—"}</dd></div>
                      <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1"><Status status={item.status} />{item.status === "DRAFT" && <span className="ml-2 text-xs text-muted-foreground">{completion.progress.percent}% komplett</span>}</dd></div>
                    </dl>
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {trash ? <>
                        <Button variant="outline" disabled={busy} onClick={() => void changeState("restore", item.id)}><RotateCcw />Återställ</Button>
                        <Button variant="destructive" disabled={busy} onClick={() => void changeState("purge", item.id)}><Trash2 />Radera permanent</Button>
                      </> : <>
                        <Button asChild variant="outline"><Link aria-label={`Öppna ${item.title}`} href={`/?view=new&id=${item.id}`}><ArrowUpRight />Öppna</Link></Button>
                        <Button variant="outline" disabled={busy} onClick={() => void changeState("delete", item.id)}><Trash2 />Ta bort</Button>
                      </>}
                    </div>
                  </article>
                );
              }
              const item = raw as LocalCustomer;
              return (
                <article key={item.id} className="min-w-0 rounded-xl border bg-card p-4">
                  <button className="block max-w-full break-words text-left font-medium hover:text-primary" onClick={() => openCustomer(item)}>{item.name}</button>
                  {item.company && <p className="mt-1 break-words text-xs text-muted-foreground">{item.company}</p>}
                  <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">Adress</dt><dd className="mt-1 break-words">{[item.address, item.postalCode, item.city].filter(Boolean).join(", ") || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Kontakt</dt><dd className="mt-1 break-all">{item.email || item.phone || item.mobile || "—"}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Arbete</dt><dd className="mt-1"><CustomerWork customerId={item.id} work={localCustomerWork(item.id)} /></dd></div>
                  </dl>
                  <div className={`mt-4 grid grid-cols-1 gap-2 ${trash ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                    {trash ? <>
                      <Button variant="outline" disabled={busy} onClick={() => void changeState("restore", item.id)}><RotateCcw />Återställ</Button>
                      <Button variant="destructive" disabled={busy} onClick={() => void changeState("purge", item.id)}><Trash2 />Radera permanent</Button>
                    </> : <>
                      <Button variant="outline" onClick={() => openCustomer(item)}>Redigera</Button><CustomerCardLink customer={item} />
                      <Button asChild variant="outline"><Link aria-label={`Ny uppgift för ${item.name}`} href={`/?view=new_task&customerId=${item.id}`}><Plus />Ny uppgift</Link></Button>
                      <Button variant="outline" disabled={busy} onClick={() => void changeState("delete", item.id)}><Trash2 />Ta bort</Button>
                    </>}
                  </div>
                </article>
              );
            })}
          </div>}
          {!controls && (
            <CustomerAccordionList
              items={(items as LocalCustomer[]).map((item) => ({
                ...item,
                controlCount: workspace.controls.filter(
                  (control) => !control.deletedAt && control.customerId === item.id,
                ).length,
              }))}
              controlLink={(item) => <CustomerWork customerId={item.id} work={localCustomerWork(item.id)} />}
              actions={(item) => {
                const customerItem = (items as LocalCustomer[]).find((candidate) => candidate.id === item.id)!;
                return (
                  <div className={`grid grid-cols-1 gap-2 ${trash ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                    {trash ? <>
                      <Button variant="outline" disabled={busy} onClick={() => void changeState("restore", item.id)}><RotateCcw />Återställ</Button>
                      <Button variant="destructive" disabled={busy} onClick={() => void changeState("purge", item.id)}><Trash2 />Radera permanent</Button>
                    </> : <>
                      <Button variant="outline" onClick={() => openCustomer(customerItem)}>Redigera</Button><CustomerCardLink customer={customerItem} />
                      <Button asChild variant="outline"><Link aria-label={`Ny uppgift för ${customerItem.name}`} href={`/?view=new_task&customerId=${item.id}`}><Plus />Ny uppgift</Link></Button>
                      <Button variant="outline" disabled={busy} onClick={() => void changeState("delete", item.id)}><Trash2 />Ta bort</Button>
                    </>}
                  </div>
                );
              }}
            />
          )}
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table min-w-[760px]">
              <thead>
                <tr>
                  <th>{controls ? "Kontroll" : "Kund"}</th>
                  <th>{controls ? "Utförare" : "Adress"}</th>
                  <th>{controls ? "Datum" : "Kontakt"}</th>
                  <th>{controls ? "Status" : "Arbete"}</th>
                  <th aria-label="Åtgärder" />
                </tr>
              </thead>
              <tbody>
                {items.map((raw) => {
                  if (controls) {
                    const item = raw as LocalWorkspaceDocument["controls"][number];
                    const completion = validateForCompletion(item.data, {
                      attachmentCount: workspace.attachments.filter(
                        (attachment) => attachment.controlId === item.id,
                      ).length,
                    });
                    return (
                      <tr key={item.id}>
                        <td>
                          <p className="font-medium">#{item.number} · {item.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{item.project}</p>
                        </td>
                        <td>{item.performer || "—"}</td>
                        <td>{item.date || "—"}</td>
                        <td>
                          <Status status={item.status} />
                          {item.status === "DRAFT" && (
                            <p className="mt-1 text-xs text-muted-foreground">{completion.progress.percent}% komplett</p>
                          )}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            {trash ? (
                              <>
                                <Button variant="ghost" size="icon" aria-label={`Återställ ${item.title}`} disabled={busy} onClick={() => void changeState("restore", item.id)}><RotateCcw /></Button>
                                <Button variant="ghost" size="icon" aria-label={`Radera permanent ${item.title}`} disabled={busy} onClick={() => void changeState("purge", item.id)}><Trash2 className="text-destructive" /></Button>
                              </>
                            ) : (
                              <>
                                <Button asChild variant="ghost" size="icon"><Link aria-label={`Öppna ${item.title}`} href={`/?view=new&id=${item.id}`}><ArrowUpRight /></Link></Button>
                                <Button variant="ghost" size="icon" aria-label={`Ta bort ${item.title}`} disabled={busy} onClick={() => void changeState("delete", item.id)}><Trash2 /></Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  const item = raw as LocalCustomer;
                  return (
                    <tr key={item.id}>
                      <td><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.company}</p></td>
                      <td>{[item.address, item.postalCode, item.city].filter(Boolean).join(", ") || "—"}</td>
                      <td>{item.email || item.phone || item.mobile || "—"}</td>
                      <td><CustomerWork customerId={item.id} work={localCustomerWork(item.id)} /></td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {trash ? (
                            <>
                              <Button variant="ghost" size="icon" aria-label={`Återställ ${item.name}`} disabled={busy} onClick={() => void changeState("restore", item.id)}><RotateCcw /></Button>
                              <Button variant="ghost" size="icon" aria-label={`Radera permanent ${item.name}`} disabled={busy} onClick={() => void changeState("purge", item.id)}><Trash2 className="text-destructive" /></Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => openCustomer(item)}>Redigera</Button>
                              <Button asChild variant="ghost" size="icon"><Link aria-label={`Kundkort för ${item.name}`} href={`/?view=customers&customerId=${item.id}`}><ArrowUpRight /></Link></Button>
                              <Button asChild variant="ghost" size="icon"><Link aria-label={`Ny uppgift för ${item.name}`} href={`/?view=new_task&customerId=${item.id}`}><Plus /></Link></Button>
                              <Button variant="ghost" size="icon" aria-label={`Ta bort ${item.name}`} disabled={busy} onClick={() => void changeState("delete", item.id)}><Trash2 /></Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <Empty
            title={trash ? "Papperskorgen är tom" : controls ? "Inga kontroller hittades" : "Inga kunder hittades"}
            description={query ? "Prova ett annat sökord." : "Skapa den första posten i den lokala arbetsytan."}
          />
        )}
      </Panel>
      <Modal
        open={customerOpen}
        onOpenChange={setCustomerOpen}
        title={editing ? "Redigera lokal kund" : "Ny lokal kund"}
      >
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              const result = saveLocalCustomerRecord(
                workspace,
                customer,
                editing?.id,
                editing?.version,
              );
              await commit(result.workspace);
              setCustomerOpen(false);
              notify(editing ? "Kunden är uppdaterad lokalt." : "Kunden är skapad lokalt.");
            } catch (error) {
              notify((error as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["name", "Namn / kontaktperson"], ["company", "Företag"],
              ["email", "E-post"], ["phone", "Telefon"], ["mobile", "Mobil"],
              ["address", "Adress"], ["postalCode", "Postnummer"], ["city", "Ort"],
              ["lat", "Latitud"], ["lng", "Longitud"],
            ].map(([key, label]) => (
              <Field
                key={key}
                id={`local-customer-${key}`}
                label={label}
                required={key === "name"}
                type={key === "email" ? "email" : key === "lat" || key === "lng" ? "number" : "text"}
                value={customer[key as keyof CustomerForm]}
                onChange={(value) => setCustomer((current) => ({ ...current, [key]: value }))}
              />
            ))}
          </div>
          <label className="block space-y-2 text-xs font-medium text-muted-foreground">
            Anteckningar
            <textarea className="form-textarea" value={customer.notes} onChange={(event) => setCustomer((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <Button type="submit" disabled={busy}>
            <Save />
            Spara kund lokalt
          </Button>
        </form>
      </Modal>
    </div>
  );
}

"use client";

import { useConfirm } from "./confirm";
import { PageHeader } from "@/components/page-shell";
import { CustomerCardLink } from "./customer-card";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CustomerListPage, customerChips } from "./customer-register-layout";
import Link from "next/link";
import {
  HardDrive,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { workflowTaskProgress } from "@/lib/workflow/task-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Panel } from "./ui";
import { customerPayload, type ReadCustomer, type SaveCustomer } from "./customer-form-dialog";
import { CustomerCreateDialog, CustomerInlineEdit } from "./customer-register-forms";
import { firstPlaceOf } from "@/lib/kfid/customer-first-place";
import { CustomerAccordionList } from "./customer-accordion-list";
import { BulkBar, CustomerRowActions, CustomerWork, SelectAllRow, bulkConfirm, escapeClears, useWideRegister } from "./record-archive";
import { Checkbox } from "@/components/ui/checkbox";
import { bulkOutcomeMessage, selectionState, toggleAllOnPage, toggleOne } from "@/lib/kfid/bulk-selection";
import { WorkOverview, type WorkflowOverviewData } from "./analytics";
import { OverviewKpiDashboard } from "@/features/workflow/overview-kpis";
import { summarizeOverviewKpis } from "@/lib/workflow/overview-kpis";
import { capacityWeek } from "@/lib/workflow/capacity-summary";
import { capacityLoads, type PlanningRound } from "@/lib/workflow/planning-rounds";
import { swedishDayKey } from "@/lib/swedish-time";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { effectiveWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import {
  changeLocalRecordState,
  localCustomerItem,
  saveLocalCustomerRecord,
  saveLocalNewCustomer,
  type LocalCustomer,
  type LocalRecordAction,
  type LocalWorkspaceDocument,
} from "./local-workspace-store";
import { useListPrefs } from "@/components/list-filter-bar";
import { useAddressEntryState } from "@/components/use-address-filter";
import { CUSTOMER_FILTERS, CUSTOMER_SORTS, listLocalCustomers, type CustomerFilter } from "@/lib/kfid/customer-list";
import { compareCustomerTitles } from "@/lib/kfid/customer-name";
import { allowedFilter } from "@/lib/url-filters";


export function LocalDashboard({
  workspace,
  currentUserId,
  fileBased = false,
  rounds,
}: {
  workspace: LocalWorkspaceDocument;
  currentUserId: string;
  fileBased?: boolean;
  /** The file's round occurrences in a period: with beräknad tid they load the person as in Cloud (2026-11-02). */
  rounds: (period: { from: string; to: string }) => PlanningRound[];
}) {
  const week = capacityWeek();
  const weekRounds = rounds({ from: swedishDayKey(week.startsAt), to: swedishDayKey(new Date(week.endsAt.getTime() - 1)) });
  // Same key figures as Cloud, computed from the open .hwf. The file owner is the only person, so there is no team view.
  const localTasks = workspace.workflowTasks.map((task) => ({ kind: task.kind, status: task.status, dueDate: task.dueDate, completedAt: task.completedAt, isMine: true, projectId: task.projectId }));
  const kpis = summarizeOverviewKpis({
    scope: "mine",
    currentUserId,
    members: [{ id: currentUserId, weeklyWorkMinutes: effectiveWeeklyWorkMinutes(workspace.organization.weeklyWorkMinutes, workspace.localIdentity.weeklyWorkMinutes) }],
    tasks: localTasks,
    projects: workspace.projects.map((project) => {
      const own = localTasks.filter((task) => task.projectId === project.id);
      const status = summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: own, activities: workspace.plannedActivities.filter((activity) => activity.projectId === project.id) });
      return { status, timeBudgetMinutes: project.timeBudgetMinutes, reportedMinutes: Math.round(workspace.workflowTasks.filter((task) => task.projectId === project.id).flatMap((task) => task.timeEntries).reduce((sum, entry) => sum + entry.durationSec, 0) / 60), isMine: true };
    }),
    timeEntries: workspace.workflowTasks.flatMap((task) => task.timeEntries.map((entry) => ({ userId: entry.userId, startedAt: entry.startedAt, durationSec: entry.durationSec }))),
    activities: capacityLoads(workspace.plannedActivities.filter((activity) => !activity.deletedAt).map((activity) => ({ startsAt: activity.startsAt, endsAt: activity.endsAt, assignedToUserId: activity.assignedToUserId, assignedToUserIds: activity.assignedToUserIds, assignments: activity.assignments, status: activity.status, projectId: activity.projectId,
      workflowTaskId: activity.workflowTaskId, workflowTask: activity.workflowTaskId ? { status: workspace.workflowTasks.find((task) => task.id === activity.workflowTaskId)?.status ?? null } : null })), weekRounds),
  });
  const overviewData: WorkflowOverviewData = {
    projects: workspace.projects.map((project) => ({ ...project, status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: localTasks.filter((task) => task.projectId === project.id), activities: workspace.plannedActivities.filter((activity) => activity.projectId === project.id) }), workflowTasks: workspace.workflowTasks.filter((task) => task.projectId === project.id).map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, updatedAt: task.updatedAt, projectId: task.projectId, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName })) })),
    workflowTasks: workspace.workflowTasks.filter((task) => !task.projectId).map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, updatedAt: task.updatedAt, projectId: task.projectId })),
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Översikt" description={<>Följ projektens progression och fortsätt där arbetet stannade. <span className="whitespace-nowrap">{fileBased ? "Lokal arbetsytefil." : "Lokal mapp."}</span></>} actions={<><Button asChild variant="outline"><Link href="/?view=projects">{workspace.projects.length} projekt</Link></Button><Button asChild variant="outline"><Link href="/?view=new_project"><Plus />Nytt projekt</Link></Button><Button asChild><Link href="/?view=new_task"><Plus />Ny uppgift</Link></Button></>} />
      <OverviewKpiDashboard team={null} mine={kpis} />
      <WorkOverview localData={overviewData} />
    </div>
  );
}

/** The customer register in the open file (the older controls' archive is gone with its editor, 2026-10-06). */
export function LocalRecordArchive({
  workspace,
  commit,
  notify,
  fileBased = false,
  customerId = null,
  renderCard,
}: {
  workspace: LocalWorkspaceDocument;
  commit: (next: LocalWorkspaceDocument) => Promise<LocalWorkspaceDocument>;
  notify: (text: string, error?: boolean) => void;
  fileBased?: boolean;
  /** The customer chosen in the address (plan 1R): its card stands beside the list. */
  customerId?: string | null;
  renderCard?: (customerId: string, extras: { onDeleteCustomer: () => void }) => ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [confirmCard, confirmElement] = useConfirm();
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // Redigera kund folds the form out in the row; Ny kund is a popup on display 3 and a page on display 2 (plan 1Q, 2026-10-11).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const wide = useWideRegister();
  // Saved in the open file like the rest of the register; handed back the way the customer choices hold a customer.
  const saveCustomer: SaveCustomer = async (value, existing, options) => {
    const result: { workspace: LocalWorkspaceDocument; customer: LocalCustomer; firstPlaceError?: string } = existing
      ? saveLocalCustomerRecord(workspace, customerPayload(value, existing), existing.id, existing.version)
      : saveLocalNewCustomer(workspace, customerPayload(value, null), options?.firstPlace ? firstPlaceOf(value) : null);
    await commit(result.workspace);
    return { ...localCustomerItem(result.customer), lat: result.customer.lat ?? null, lng: result.customer.lng ?? null, facilities: [], ...(result.firstPlaceError ? { firstPlaceError: result.firstPlaceError } : {}) };
  };
  const readCustomer: ReadCustomer = async (id) => {
    const item = workspace.customers.find((candidate) => candidate.id === id);
    if (!item) throw new Error("Kunden hittades inte.");
    return { ...localCustomerItem(item), lat: item.lat ?? null, lng: item.lng ?? null, facilities: [] };
  };
  const editor = (id: string) => <CustomerInlineEdit customerId={id} read={readCustomer} save={saveCustomer} idPrefix="local-customer" submitLabel="Spara kund lokalt" message="Kunden är uppdaterad lokalt."
    onClose={() => setEditingId(null)} />;
  // The file owner has full local rights, so every kind of work is counted.
  const localCustomerWork = (id: string) => ({
    projects: workspace.projects.filter((project) => project.customerId === id).length,
    workOrders: workspace.workflowTasks.filter((task) => task.customerId === id && task.kind === "WORK_ORDER").length,
    riskAssessments: workspace.workflowTasks.filter((task) => task.customerId === id && task.kind === "RISK_ASSESSMENT").length,
  });
  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("sv-SE");
    return workspace.customers
      .filter((item) => Boolean(item.deletedAt) === trash)
      .filter((item) =>
        !needle
          ? true
          : JSON.stringify(item).toLocaleLowerCase("sv-SE").includes(needle),
      )
      .sort(compareCustomerTitles);
  }, [query, trash, workspace]);
  // The shared toppvisning (2026-10-31), the same rules as Cloud on the file's customers.
  const prefs = useListPrefs("customers", "", { sorts: CUSTOMER_SORTS });
  const [type, setType] = useAddressEntryState<CustomerFilter>("customers.type", "filter", (raw) => allowedFilter(raw, CUSTOMER_FILTERS), "all");
  const listed = useMemo(() => listLocalCustomers(items, { filter: type, sort: prefs.sort }), [items, type, prefs.sort]);

  // One page with the card (plan 1R): with no customer chosen the first in the list is, by replacing the address.
  const [seenCustomer, setSeenCustomer] = useState(customerId);
  if (customerId !== seenCustomer) { setSeenCustomer(customerId); if (customerId && trash) setTrash(false); }

  function openCustomer(item?: LocalCustomer) {
    if (item) setEditingId(item.id); else setCustomerOpen(true);
  }

  async function changeState(action: LocalRecordAction, target: string | string[]) {
    const ids = Array.isArray(target) ? target : [target];
    if (!ids.length) return false;
    if ((action !== "restore" || ids.length > 1) &&
      !(await confirmCard(bulkConfirm(action, ids.length, ["post", "poster"], "Posterna raderas ur den lokala filen. Det går inte att ångra."))))
      return false;
    setBusy(true);
    try {
      await commit(changeLocalRecordState(workspace, "customers", action, ids));
      notify(ids.length === 1
        ? action === "restore" ? "Posten är återställd i den lokala filen." : action === "purge" ? "Posten är permanent raderad ur den lokala filen." : "Posten har flyttats till den lokala papperskorgen."
        : bulkOutcomeMessage(action, { ok: ids.length, failed: [] }).text);
      setSelected([]);
      return true;
    } catch (error) {
      notify((error as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const pageIds = items.map((item) => item.id);
  const headState = selectionState(selected, pageIds);

  // Display 2 and 3 (2026-10-14): the customer's own page for an address with customerId, otherwise the list page.
  if (renderCard && !trash && customerId) return <div className="space-y-6">
    {confirmElement}
    {renderCard(customerId, { onDeleteCustomer: () => void changeState("delete", customerId).then((done) => { if (done) router.replace("/?view=customers", { scroll: false }); }) })}
  </div>;
  if (renderCard && !trash) {
    return <div className="space-y-6">
      {confirmElement}
      <CustomerListPage description={fileBased ? "Kundregister i den öppna lokala Workflow-arbetsytefilen." : "Kundregister i den anslutna lokala Workflow-mappen."} count={listed.items.length}
        onTrash={() => setTrash(true)} onNew={() => openCustomer()}
        intro={<p className="notice flex items-center gap-2">
          <HardDrive className="size-4 shrink-0" />
          {fileBased
            ? "Ändringar finns kvar i fliken tills du laddar ned arbetsytefilen."
            : "Ändringar sparas direkt i den valda mappen."}
        </p>}
        items={listed.items.map((item) => ({ id: item.id, name: item.name, company: item.company, customerType: item.customerType, address: item.address, city: item.city, phone: item.phone, mobile: item.mobile, email: item.email, projects: workspace.projects.filter((project) => project.customerId === item.id).length }))}
        filter={{ chips: customerChips(listed.counts), value: type, onChange: setType }}
        sort={{ value: prefs.sort, onChange: prefs.setSort }}
        view={{ value: prefs.view, onChange: prefs.setView }}
        query={query} onQuery={setQuery} searchLabel="Sök lokala kunder"
        emptyText={query ? "Prova ett annat sökord." : "Skapa den första kunden med Ny kund."} />
      <CustomerCreateDialog open={customerOpen} onOpenChange={setCustomerOpen} save={saveCustomer} idPrefix="local-customer" submitLabel="Spara kund lokalt" title="Ny lokal kund"
        message="Kunden är skapad lokalt." onSaved={(customer) => router.push(`/?view=customers&customerId=${encodeURIComponent(customer.id)}`)} />
    </div>;
  }

  return (
    <div className="space-y-6">
      {confirmElement}
      <PageHeader title="Kunder" description={fileBased ? "Kundregister i den öppna lokala Workflow-arbetsytefilen." : "Kundregister i den anslutna lokala Workflow-mappen."} actions={<Button onClick={() => openCustomer()}><Plus />Ny kund</Button>} />
      <p className="notice flex items-center gap-2">
        <HardDrive className="size-4 shrink-0" />
        {fileBased
          ? "Ändringar finns kvar i fliken tills du laddar ned arbetsytefilen."
          : "Ändringar sparas direkt i den valda mappen."}
      </p>
      <Panel title="Kundregister">
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              className="pl-10"
              aria-label="Sök lokala kunder"
              placeholder="Sök namn, adress eller kontaktuppgift…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            variant={trash ? "secondary" : "outline"}
            onClick={() => { setSelected([]); setTrash((value) => !value); }}
          >
            <Trash2 />
            {trash ? "Visa aktiva" : "Papperskorg"}
          </Button>
        </div>
        {items.length ? (
          <div onKeyDown={escapeClears(() => setSelected([]))}>
          <div className="mb-3 space-y-2">
            <BulkBar count={selected.length} trash={trash} busy={busy} onRestore={() => void changeState("restore", selected)} onPurge={() => void changeState("purge", selected)} onDelete={() => void changeState("delete", selected)} onClear={() => setSelected([])} />
            <SelectAllRow selected={selected} pageIds={pageIds} onChange={setSelected} />
          </div>
          {(
            <CustomerAccordionList
              items={items}
              leading={(item) => <Checkbox aria-label={`Markera ${item.name}`} checked={selected.includes(item.id)} onCheckedChange={(value) => setSelected((current) => toggleOne(current, item.id, value === true))} />}
              editor={(item) => editingId === item.id && !trash && !wide ? editor(item.id) : null}
              work={(item) => <CustomerWork customerId={item.id} work={localCustomerWork(item.id)} />}
              actions={(item) => {
                const customerItem = items.find((candidate) => candidate.id === item.id)!;
                return (
                  <div className={`grid grid-cols-1 gap-2 ${trash ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                    {trash ? <>
                      <Button variant="outline" disabled={busy} onClick={() => void changeState("restore", item.id)}><RotateCcw />Återställ</Button>
                      <Button variant="destructive" disabled={busy} onClick={() => void changeState("purge", item.id)}><Trash2 />Radera permanent</Button>
                    </> : <>
                      <Button variant="outline" aria-label={`Redigera ${customerItem.name}`} onClick={() => openCustomer(customerItem)}><Pencil />Redigera</Button><CustomerCardLink customer={customerItem} />
                      <Button variant="outline" disabled={busy} onClick={() => void changeState("delete", item.id)}><Trash2 />Ta bort</Button>
                    </>}
                  </div>
                );
              }}
            />
          )}
          <div className="hidden overflow-x-auto xl:block">
            <table className="data-table min-w-[760px]">
              {/* Fixed columns (steg 10): the actions' buttons and the tick box keep their width, the rest share the room. */}
              <colgroup><col className="w-12" /><col /><col /><col className="w-56" /><col /><col className={trash ? "w-52" : "w-64"} /></colgroup>
              <thead>
                <tr>
                  <th><Checkbox aria-label="Markera alla på sidan" checked={headState === "all" ? true : headState === "some" ? "indeterminate" : false} onCheckedChange={(v) => setSelected((old) => toggleAllOnPage(old, pageIds, v === true || headState === "none"))} /></th>
                  <th>Kund</th>
                  <th>Adress</th>
                  <th>Kontakt</th>
                  <th>Arbete</th>
                  <th aria-label="Åtgärder" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  return (
                    <Fragment key={item.id}>
                    <tr>
                      <td><Checkbox aria-label={`Markera ${item.name}`} checked={selected.includes(item.id)} onCheckedChange={(v) => setSelected((old) => toggleOne(old, item.id, v === true))} /></td>
                      <td><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.company}</p></td>
                      <td>{[item.address, item.postalCode, item.city].filter(Boolean).join(", ") || "—"}</td>
                      <td>{item.email || item.phone || item.mobile || "—"}</td>
                      <td><CustomerWork customerId={item.id} work={localCustomerWork(item.id)} /></td>
                      <td>
                        <CustomerRowActions id={item.id} name={item.name} trash={trash} busy={busy}
                          onEdit={trash ? undefined : () => openCustomer(item)}
                          onDelete={trash ? undefined : () => void changeState("delete", item.id)}
                          onRestore={trash ? () => void changeState("restore", item.id) : undefined}
                          onPurge={trash ? () => void changeState("purge", item.id) : undefined} />
                      </td>
                    </tr>
                    {editingId === item.id && !trash && wide ? <tr data-testid="customer-edit-row"><td colSpan={6} className="bg-muted/20">{editor(item.id)}</td></tr> : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        ) : (
          <Empty
            title={trash ? "Papperskorgen är tom" : "Inga kunder hittades"}
            description={query ? "Prova ett annat sökord." : "Skapa den första posten i den lokala arbetsytan."}
          />
        )}
      </Panel>
      <CustomerCreateDialog open={customerOpen} onOpenChange={setCustomerOpen} save={saveCustomer} idPrefix="local-customer" submitLabel="Spara kund lokalt" title="Ny lokal kund"
        message="Kunden är skapad lokalt." onSaved={() => undefined} />
    </div>
  );
}

"use client";

import { plural } from "@/lib/plural";
import { useConfirm } from "./confirm";
import { CustomerCard } from "./customer-card";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { listPlaceLabel, tempPlaceOf } from "@/lib/workflow/temp-place";
import { CustomerRegisterSwitch } from "@/features/workflow/customer-register-switch";
import { localCustomerCardData } from "./local-customer-card";
import { localReportIdentity } from "./local-report-identity";
import { fetchReportFonts } from "@/lib/workflow/report-fonts";
import { facilityLabel } from "@/lib/workflow/customer-facility";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatSwedish } from "@/lib/swedish-time";
import {
  FilePlus2,
  FileUp,
  FolderOpen,
  HardDrive,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskNotifications, useTaskNotificationFeed } from "@/features/workflow/task-notifications";
import { SelfInspectionPage } from "@/features/self-inspection/self-inspection-page";
import { InstrumentsPage, instrumentsBackendFrom } from "@/features/self-inspection/instruments";
import { localSelfInspectionBackend, localSelfInspectionWork } from "@/features/self-inspection/local-backend";
import { localWorkOrderFromDeviation, localWorkspaceAfterOrderSave } from "@/features/self-inspection/local-deviation-link";
import { SelfInspectionWorkProvider } from "@/features/self-inspection/work";
import { documentReminders } from "@/lib/self-inspection/model";
import { localTaskSubject } from "@/lib/self-inspection/work";
import { planningScope } from "@/lib/self-inspection/planning-scope";
import { PLANNING_FORM_ID } from "@/lib/workflow/builtin-planning-form";
import { useLocalRunningTimers } from "@/features/workflow/running-timer";
import type { RunningTimer } from "@/lib/workflow/running-timer";
import { dayInFrame, hasProjectFrame, projectFieldRows } from "@/lib/workflow/project-frame";
import { swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { Modal, Panel } from "./ui";
import { LocalDashboard, LocalRecordArchive } from "./local-records";
import { WorkflowProjects, type WorkflowProject } from "./workflow-projects";
import { CustomerQuickDialog, customerPayload, type SaveCustomer } from "./customer-form-dialog";
import type { ProjectReportChoice } from "@/features/workflow/report-options";
import { WorkflowTaskEditor, type WorkflowTaskRecord } from "@/features/workflow/workflow-task-editor";
import { WorkOrderList } from "@/features/workflow/work-order-list";
import { FormRounds } from "@/features/workflow/form-rounds";
import { CompanyValues, type CompanyValuesData } from "@/features/workflow/company-values";
import { api } from "@/features/kfid/api";
import { publishLocalCompanyValues } from "@/features/calculators/company-calc-values";
import { roundLegacyPlace, scheduleViews, type FormSchedule } from "@/lib/workflow/form-schedule";
import { planningRounds } from "@/lib/workflow/planning-rounds";
import { nextPlannedAt } from "@/lib/workflow/work-orders";
import { customerReceiptOf, workflowTaskProgress, type WorkflowTaskKind } from "@/lib/workflow/task-model";
import { localJobStep } from "@/lib/workflow/risk-step-local";
import { summarizeProjectMaterials, workOrderMaterialSources } from "@/lib/workflow/project-materials";
import { effectiveWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import { createWorkflowPdfReport, protocolNumberOf, type WorkflowReportOptions, type WorkflowReportTask } from "@/lib/workflow/report";
import { TimeReport } from "@/features/workflow/time-report";
import {
  createDirectoryLocalAttachmentStore,
  createMemoryLocalAttachmentStore,
  removeLocalAttachmentFiles,
  stageLocalWorkflowTaskAttachment,
  type LocalAttachmentStore,
} from "./local-attachments";
import {
  createLocalWorkspaceBundle,
  downloadLocalWorkspaceBundle,
  localWorkspaceBundleFilename,
  parseLocalWorkspaceBundle,
  type LocalWorkspaceBundleImport,
} from "./local-workspace-bundle";
import { looksLikeZip, parseLocalExportZip, type LocalExportZipProgress } from "./local-export-zip";
import {
  createLocalWorkspace,
  ensureLocalWritePermission,
  loadOrCreateLocalWorkspace,
  localCustomerItem,
  linkLocalTaskToProject,
  prepareLocalWorkspaceSave,
  recalledLocalDirectory,
  rememberLocalDirectory,
  saveLocalProjectRecord,
  saveLocalPlannedActivity,
  removeLocalPlannedActivity,
  saveLocalWorkSchedule,
  setLocalProjectArchived,
  setLocalProjectClosed,
  addLocalProjectDecision,
  saveLocalCustomerFacility,
  saveLocalCustomerRecord,
  saveLocalNewCustomer,
  setLocalCustomerFacilityActive,
  deleteLocalCustomerFacility,
  saveLocalWorkflowTaskRecord,
  saveLocalFormLimitProfile,
  saveLocalCompanyValues,
  saveLocalFormSchedule,
  removeLocalFormSchedule,
  saveLocalWorkflowTimeEntry,
  removeLocalWorkflowTimeEntry,
  reopenLocalWorkflowTask,
  setLocalWorkflowTaskCancelled,
  updateLocalWorkflowTimer,
  updateLocalProjectTimer,
  removeLocalWorkOrder,
  setLocalAttachmentReceipt,
  localRoundOrderPlaces,
  saveLocalWorkspace,
  type LocalCustomer,
  type LocalWorkspaceDocument,
  localWorkToBook,
} from "./local-workspace-store";
import { firstPlaceOf } from "@/lib/kfid/customer-first-place";
import {
  deleteLocalWorkspaceRecovery,
  loadLocalWorkspaceRecovery,
  saveLocalWorkspaceRecovery,
} from "./local-workspace-recovery";
import type { View, ShellUser } from "@/components/app-shell";
import type { CustomerItem, Overview } from "./types";
import { useRegisterLocalStorageActions, useRegisterLocalWorkspaceSearch, useRegisterUnsavedWork, type LocalSearch } from "@/components/workspace-actions";
import { parseSearchQuery, searchTooShort } from "@/lib/search/query";
import { searchLocalWorkspace } from "@/lib/search/local";
import { placeSummary, type CustomerFacilityInput } from "@/lib/workflow/customer-facility";
import { saveBlob } from "@/lib/download";
import { DownloadButton } from "@/components/ui/download-button";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * The open file's round schedules, the same shape as Cloud (Driftronder and Planering). Where a round is done is its work
 * order's (2026-10-27 kväll); what a round stored of its own before then is only the suggestion for that work order.
 */
function localScheduleItems(workspace: LocalWorkspaceDocument): FormSchedule[] {
  return workspace.formSchedules.filter((item) => !item.deletedAt).map((item) => ({
    id: item.id, version: item.version, title: item.title, templateId: item.templateId, assignedToUserId: item.assignedToUserId, assignedToName: item.assignedToName, active: item.active,
    rule: item.rule, reminders: item.reminders, templateName: item.templateName || "Formulär", legacyPlace: roundLegacyPlace(item), createdAt: item.createdAt, updatedAt: item.updatedAt,
  }));
}

function formatFileSize(bytes: number) {
  if (bytes < 1_000) return `${bytes} byte`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function downloadBytes(bytes: Uint8Array, filename: string, type = "application/pdf") {
  saveBlob(bytes as BlobPart, filename, type);
}

async function reportImage(blob: Blob, mimeType: string) {
  if (mimeType !== "image/webp") return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType };
  const bitmap = await createImageBitmap(blob); const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0); bitmap.close();
  const converted = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Bilden kunde inte konverteras.")), "image/png"));
  return { bytes: new Uint8Array(await converted.arrayBuffer()), mimeType: "image/png" };
}

export function LocalWorkspace({
  organization,
  user,
  view,
  customerId,
  projectId,
  taskId,
  taskType,
  timeTaskId,
  overview,
  notify,
}: {
  organization: { id: string; name: string };
  user: ShellUser;
  view: View;
  customerId?: string;
  projectId?: string;
  taskId?: string;
  taskType?: string;
  timeTaskId?: string;
  overview: Overview;
  notify: (text: string, error?: boolean) => void;
}) {
  const [confirmCard, confirmElement] = useConfirm();
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(
    null,
  );
  const [rememberedDirectory, setRememberedDirectory] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [storage, setStorage] = useState<LocalAttachmentStore | null>(null);
  const [backend, setBackend] = useState<"directory" | "bundle" | null>(null);
  const [workspace, setWorkspace] = useState<LocalWorkspaceDocument | null>(
    null,
  );
  const [remembered, setRemembered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bundleName, setBundleName] = useState("");
  const [bundleDirty, setBundleDirty] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingBundle, setPendingBundle] = useState<
    (LocalWorkspaceBundleImport & { name: string }) | null
  >(null);
  const [recovery, setRecovery] = useState<LocalWorkspaceBundleImport | null>(null);
  // A large export zip is read part by part (local-export-zip.ts): how far it has come, and a way to stop it.
  const [reading, setReading] = useState<LocalExportZipProgress | null>(null);
  const readingAbort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const supported =
    typeof window !== "undefined" && Boolean(window.showDirectoryPicker);

  useEffect(() => {
    if (!supported) return;
    void recalledLocalDirectory(organization.id)
      .then((handle) => {
        setRememberedDirectory(handle ?? null);
        setRemembered(Boolean(handle));
      })
      .catch(() => setRemembered(false));
  }, [organization.id, supported]);

  useEffect(() => {
    void loadLocalWorkspaceRecovery(organization.id)
      .then(setRecovery)
      .catch(() => {
        setRecovery(null);
        notify("En lokal återställningskopia kunde inte läsas och ignorerades.", true);
      });
  }, [organization.id, notify]);

  useRegisterUnsavedWork("local-bundle", bundleDirty ? "Arbetsytefilen har ändringar som inte har laddats ned." : null);
  useEffect(() => {
    if (!bundleDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [bundleDirty]);

  async function open(handle: FileSystemDirectoryHandle, request: boolean) {
    setBusy(true);
    try {
      if (!(await ensureLocalWritePermission(handle, request)))
        throw new Error(
          "Workflow behöver läs- och skrivåtkomst till den valda mappen.",
        );
      const next = await loadOrCreateLocalWorkspace(handle, organization);
      setDirectory(handle);
      setRememberedDirectory(handle);
      setStorage(createDirectoryLocalAttachmentStore(handle));
      setBackend("directory");
      setWorkspace(next);
      setBundleDirty(false);
      setBundleName("");
      try {
        await rememberLocalDirectory(organization.id, handle);
      } catch {
        // A remembered handle is a convenience. The workspace remains usable.
      }
      notify(`Den lokala Workflow-mappen ”${handle.name}” är ansluten.`);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function pickDirectory() {
    try {
      if (
        bundleDirty &&
        !(await confirmCard({ title: "Byta arbetsyta?", message: "Arbetsytefilen har ändringar som inte har laddats ned.", confirmLabel: "Byt ändå", tone: "danger" }))
      )
        return;
      const handle = await window.showDirectoryPicker?.({
        id: `kfid-${organization.id}`,
        mode: "readwrite",
      });
      if (handle) await open(handle, true);
    } catch (error) {
      if ((error as DOMException).name !== "AbortError")
        notify((error as Error).message, true);
    }
  }

  async function createBundleWorkspace() {
    if (
      bundleDirty &&
      !(await confirmCard({ title: "Skapa en ny arbetsyta?", message: "Arbetsytefilen har ändringar som inte har laddats ned.", confirmLabel: "Skapa ny ändå", tone: "danger" }))
    )
      return;
    setDirectory(null);
    const nextStorage = createMemoryLocalAttachmentStore();
    const nextWorkspace = createLocalWorkspace(organization);
    setStorage(nextStorage);
    setBackend("bundle");
    setWorkspace(nextWorkspace);
    setBundleName(localWorkspaceBundleFilename(organization.name));
    setBundleDirty(true);
    void saveLocalWorkspaceRecovery(nextWorkspace, nextStorage)
      .then(() => setRecovery(null))
      .catch(() => notify("Arbetsytan skapades, men återställningskopian kunde inte sparas i webbläsaren.", true));
    notify("En ny lokal arbetsyta är skapad. Ladda ned filen för att bevara den.");
  }

  async function selectBundle(file: File) {
    setBusy(true);
    const abort = new AbortController();
    try {
      // The Cloud copy of a large company is a zip in parts (S4): read part by part with its progress, never whole.
      let parsed: LocalWorkspaceBundleImport;
      if (await looksLikeZip(file)) {
        readingAbort.current = abort;
        setReading({ done: 0, total: file.size, text: "Läser exportfilen" });
        parsed = await parseLocalExportZip(file, organization.id, { onProgress: setReading, signal: abort.signal });
      } else parsed = await parseLocalWorkspaceBundle(file, organization.id);
      setPendingBundle({ ...parsed, name: file.name });
    } catch (error) {
      if ((error as DOMException).name === "AbortError") notify("Inläsningen av exportfilen avbröts. Inget har ändrats.");
      else notify((error as Error).message, true);
    } finally {
      if (readingAbort.current === abort) readingAbort.current = null;
      setReading(null);
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  // Stopped when the page closes, so no part is read for a page that is gone.
  useEffect(() => () => readingAbort.current?.abort(), []);
  const readPercent = reading ? Math.round((reading.done / Math.max(1, reading.total)) * 100) : 0;
  // The same status line and bar as the catalogue's import (features/integrations/solar-register.tsx).
  const readingNote = reading ? <div className="mt-3 space-y-1.5 text-sm" data-testid="local-zip-reading">
    <div className="flex items-center justify-between gap-2">
      <p role="status" className="min-w-0 text-muted-foreground">{reading.text} · {readPercent} %</p>
      <Button type="button" variant="ghost" size="sm" onClick={() => readingAbort.current?.abort()} data-testid="local-zip-cancel">Avbryt</Button>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Förlopp för exportfilen" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readPercent}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${readPercent}%` }} />
    </div>
  </div> : null;

  function openPendingBundle() {
    if (!pendingBundle) return;
    setDirectory(null);
    setStorage(createMemoryLocalAttachmentStore(pendingBundle.files));
    setBackend("bundle");
    setWorkspace(pendingBundle.workspace);
    setBundleName(
      localWorkspaceBundleFilename(organization.name, pendingBundle.name),
    );
    setBundleDirty(false);
    void deleteLocalWorkspaceRecovery(organization.id).then(() => setRecovery(null));
    notify(`Arbetsytefilen ”${pendingBundle.name}” är öppnad lokalt.`);
    setPendingBundle(null);
  }

  function restoreRecovery() {
    if (!recovery) return;
    setDirectory(null);
    setStorage(createMemoryLocalAttachmentStore(recovery.files));
    setBackend("bundle");
    setWorkspace(recovery.workspace);
    setBundleName(localWorkspaceBundleFilename(organization.name));
    setBundleDirty(true);
    setRecovery(null);
    notify("Den kraschåterställda arbetsytan är öppnad. Ladda ned en ny .hwf-fil.");
  }

  async function exportBundle() {
    if (!workspace || !storage) return;
    setBusy(true);
    try {
      const blob = await createLocalWorkspaceBundle(workspace, storage);
      const filename = localWorkspaceBundleFilename(
        organization.name,
        bundleName || undefined,
      );
      downloadLocalWorkspaceBundle(blob, filename);
      setBundleName(filename);
      if (backend === "bundle") {
        setBundleDirty(false);
        await deleteLocalWorkspaceRecovery(organization.id);
        setRecovery(null);
      }
      notify(`Arbetsytan har laddats ned som ”${filename}”.`);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const commit = useCallback(
    async (next: LocalWorkspaceDocument) => {
      if (!storage || !backend)
        throw new Error("Ingen lokal Workflow-arbetsyta är öppen.");
      const saved =
        backend === "directory"
          ? await saveLocalWorkspace(directory!, next)
          : prepareLocalWorkspaceSave(next);
      setWorkspace(saved);
      if (backend === "bundle") setBundleDirty(true);
      const remaining = new Set(saved.attachments.map((item) => item.id));
      const removed = (workspace?.attachments ?? []).filter(
        (item) => !remaining.has(item.id),
      );
      if (removed.length)
        await removeLocalAttachmentFiles(storage, removed);
      if (backend === "bundle") {
        try {
          await saveLocalWorkspaceRecovery(saved, storage);
        } catch {
          notify("Ändringen finns kvar i fliken, men återställningskopian kunde inte uppdateras.", true);
        }
      }
      return saved;
    },
    [backend, directory, notify, storage, workspace],
  );

  // The Kalkylator reads the company's values from the open file (fixed 2026-10-12: they were never handed over), and
  // its Företagets värden saves them with the same write as Inställningar → Värden och referenser, for the administrator.
  const calcAdmin = Boolean(overview.admin);
  // Arbetet är redan utfört (Arbetssätt, 2026-11-02): the company's choice, the same in the file as in Cloud.
  const riskExceptionAllowed = overview.settings?.riskException !== false;
  const calcActor = user?.name || user?.email || "";
  useEffect(() => {
    publishLocalCompanyValues(workspace && storage ? {
      values: workspace.companyValues,
      save: calcAdmin ? async (inputs) => { const next = saveLocalCompanyValues(workspace, inputs, calcActor); return (await commit(next)).companyValues; } : null,
    } : null);
  }, [workspace, storage, commit, calcAdmin, calcActor]);
  useEffect(() => () => publishLocalCompanyValues(null), []);

  const customerItems = useMemo<CustomerItem[]>(
    () =>
      (workspace?.customers ?? []).map((customer) => ({
        ...localCustomerItem(customer),
        lat: customer.lat ?? null,
        lng: customer.lng ?? null,
        facilities: (workspace?.customerFacilities ?? []).filter((facility) => facility.customerId === customer.id),
      })),
    [workspace],
  );
  // The linked customer facility (decision 11) for project fields and reports.
  // A place in reports: its whole way with the facility's address (Platser, 2026-10-04).
  const localFacility = (id: string | null | undefined) => placeSummary(workspace?.customerFacilities ?? [], id);
  const localCustomerName = (id: string | null | undefined) => { const customer = id ? workspace?.customers.find((item) => item.id === id) : undefined; return customer ? customerTitle(customer) : ""; };
  const workflowTaskItems = useMemo<WorkflowTaskRecord[]>(() => (workspace?.workflowTasks ?? []).map((task) => {
      // Hör till arbetsorder (Fas 2): the order the task belongs to; its time runs on the order (Tid på jobbet).
      const order = task.workOrderId ? workspace?.workflowTasks.find((item) => item.id === task.workOrderId) : undefined;
      const runsMine = (entries: typeof task.timeEntries) => entries.some((entry) => !entry.endedAt && entry.userId === (user?.email ?? "local-user"));
      return {
        ...task,
        workOrderId: task.workOrderId ?? null,
        // Utgår (2026-10-09): the reason and when, as the editor reads them from Cloud.
        cancelReason: task.cancellation?.reason ?? "", cancelledAt: task.cancellation?.at ?? null,
        workOrder: order ? { id: order.id, title: order.title, status: order.status, readable: true } : null,
        progress: workflowTaskProgress(task),
        totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)) : 0), 0),
        timerRunning: runsMine(task.timeEntries) || Boolean(order && runsMine(order.timeEntries)),
        attachments: (workspace?.attachments ?? []).filter((attachment) => attachment.taskId === task.id).map(({ id, filename, mimeType, size, receipt, createdAt }) => ({ id, filename, mimeType, size, receipt: receipt === true, createdAt })),
      };
    }), [user?.email, workspace]);
  // Sök over the open file with the same matching and ranking as Cloud (2026-10-05, lib/search/local.ts).
  const localSearch = useCallback<LocalSearch>((query, options) => {
    const parsed = parseSearchQuery(query);
    if (!workspace || !parsed.active || searchTooShort(parsed)) return { groups: [], fuzzy: false };
    const scoped = options?.expand ? { ...parsed, filters: { ...parsed.filters, types: [options.expand] } } : parsed;
    return searchLocalWorkspace(workspace, scoped, { me: user?.email ?? "local-user", local: true, perGroup: options?.expand ? 30 : 6 });
  }, [workspace, user?.email]);
  useRegisterLocalWorkspaceSearch(workspace ? localSearch : null);

  const notificationSources = useMemo(() => {
    if (!workspace) return null;
    const archived = new Set(workspace.projects.filter((project) => project.archivedAt).map((project) => project.id));
    // Akut lives on maintenance items (Cloud only, 2026-10-30): a Local work order is never urgent.
    return [
      ...workspace.workflowTasks.map((task) => ({ ...task, archived: Boolean(task.projectId && archived.has(task.projectId)), urgent: false })),
    ];
  }, [workspace]);
  // Finished work orders from a deviation (flödesvåg 2); the Local file owner sees the whole file, like the other reminders.
  const notificationFollowUps = useMemo(() => {
    if (!workspace) return [];
    const archived = new Set(workspace.projects.filter((project) => project.archivedAt).map((project) => project.id));
    const byId = new Map(workspace.workflowTasks.map((task) => [task.id, task]));
    return workspace.workflowTasks.flatMap((task) => {
      const source = task.data.kind === "WORK_ORDER" ? task.data.details.source : undefined;
      const origin = source ? byId.get(source.taskId) : undefined;
      return source && task.status === "COMPLETED" ? [{
        workOrder: { id: task.id, title: task.title, status: task.status, completedAt: task.completedAt, source },
        origin: origin ? { id: origin.id, title: origin.title, kind: origin.kind, updatedAt: origin.updatedAt, archived: Boolean(origin.projectId && archived.has(origin.projectId)) } : null,
      }] : [];
    });
  }, [workspace]);
  // Egenkontroll (2026-10-06): the programme in the file, its owner as administrator; the same reminders as Cloud.
  const selfInspectionMe = useMemo(() => ({ id: user?.email ?? "local-user", name: user?.name || user?.email || "Jag" }), [user?.email, user?.name]);
  const selfInspectionReminders = useMemo(() => workspace ? documentReminders(workspace.selfInspection, { me: selfInspectionMe, admin: true }) : [], [workspace, selfInspectionMe]);
  const selfInspection = useMemo(() => workspace ? localSelfInspectionBackend({
    doc: workspace.selfInspection, me: selfInspectionMe, company: workspace.organization.name,
    identity: () => localReportIdentity(overview, workspace.organization.name),
    save: async (next) => { await commit({ ...workspace, selfInspection: next }); },
    // Avvikelse ↔ arbetsorder (2026-10-10): the log's work orders, and Skapa arbetsorder saving the order and the link together.
    tasks: workspace.workflowTasks, createWorkOrder: async (deviationId) => { const next = localWorkOrderFromDeviation(workspace, deviationId); await commit(next); return { doc: next.selfInspection, tasks: next.workflowTasks }; },
  }) : null, [workspace, selfInspectionMe, commit, overview]);
  const instrumentsBackend = useMemo(() => selfInspection ? instrumentsBackendFrom(selfInspection) : null, [selfInspection]);
  // Etapp 2–3: projects and tasks read the same programme from the file (the kind of work, levels, instruments, deviations),
  // the customer's special requirements from the customer card and the scope of the project's planning protocol (2026-10-07).
  const selfInspectionWork = useMemo(() => workspace ? localSelfInspectionWork({
    doc: workspace.selfInspection, me: selfInspectionMe, save: async (next) => { await commit({ ...workspace, selfInspection: next }); }, tasks: workspace.workflowTasks,
    targetOf: (target) => {
      const task = target.taskId ? workspace.workflowTasks.find((item) => item.id === target.taskId) : undefined;
      const project = workspace.projects.find((item) => item.id === (task?.projectId ?? target.projectId));
      const customer = workspace.customers.find((item) => item.id === (task?.customerId ?? project?.customerId));
      const protocols = project ? workspace.workflowTasks.flatMap((item) => item.projectId === project.id && item.data.kind === "FORM" && item.data.details.templateId === PLANNING_FORM_ID
        ? [{ id: item.id, title: item.title, updatedAt: item.updatedAt, document: item.data.details.document, values: item.data.details.values }] : []) : [];
      // The risk class follows the task, or the form (Workflow's own are known by id) or kind a new one starts from.
      const subject = task ? localTaskSubject(task) : target.formId ? { kind: "FORM" as const, formId: target.formId, category: null } : target.kind === "WORK_ORDER" || target.kind === "RISK_ASSESSMENT" ? { kind: target.kind as "WORK_ORDER" | "RISK_ASSESSMENT" } : null;
      return { projectId: project?.id ?? null, customerRequirements: customer?.specialRequirements ?? "", planning: planningScope(protocols), subject };
    },
  }) : null, [workspace, selfInspectionMe, commit]);
  const notificationFeed = useTaskNotificationFeed({ localSources: notificationSources, localFollowUps: notificationFollowUps, localExtra: selfInspectionReminders, enabled: Boolean(notificationSources) });
  // The open file's own running timers for the top bar, paused through the same local rule as the editor.
  const localTimerUserId = user?.email ?? "local-user";
  // Work orders' and (Projekttid, 2026-10-26) projects' own running time.
  const runningTimers = useMemo<RunningTimer[] | null>(() => workspace ? [
    ...workspace.workflowTasks.map((task) => ({ id: task.id, title: task.title, kind: task.kind as RunningTimer["kind"], projectId: task.projectId, timeEntries: task.timeEntries })),
    ...workspace.projects.map((project) => ({ id: project.id, title: project.name, kind: "PROJECT" as const, projectId: project.id, timeEntries: project.timeEntries })),
  ].flatMap((task) => task.timeEntries
    .filter((entry) => !entry.endedAt && entry.userId === localTimerUserId)
    .map((entry) => ({ entryId: entry.id, taskId: task.id, taskTitle: task.title, kind: task.kind, ...(task.kind === "PROJECT" ? { projectId: task.id } : {}), projectName: workspace.projects.find((project) => project.id === task.projectId)?.name ?? null, startedAt: entry.startedAt }))) : null, [localTimerUserId, workspace]);
  useLocalRunningTimers(runningTimers, async (timer, options) => {
    if (!workspace) return [];
    const result = timer.kind === "PROJECT" ? updateLocalProjectTimer(workspace, timer.taskId, "PAUSE", localTimerUserId, options) : updateLocalWorkflowTimer(workspace, timer.taskId, "PAUSE", localTimerUserId, options);
    await commit(result.workspace);
    return result.stopped;
  });
  // A place added or changed from a Plats field goes into the open file like one saved on the customer card (Platser,
  // 2026-10-04; editing from the field 2026-10-08). An existing place keeps its id, so every link to it holds.
  const saveLocalPlace = async (placeCustomerId: string, place: CustomerFacilityInput, existing?: { id: string; version?: number }) => {
    if (!workspace) throw new Error("Öppna arbetsytan först.");
    const next = saveLocalCustomerFacility(workspace, placeCustomerId, { id: existing?.id, facility: place });
    if (existing) { await commit(next); return existing.id; }
    const created = next.customerFacilities.find((item) => !workspace.customerFacilities.some((item2) => item2.id === item.id));
    await commit(next);
    if (!created) throw new Error("Platsen kunde inte läggas till.");
    return created.id;
  };
  // "Lägg till kund" / "Redigera kund" from a customer choice (2026-10-08): saved in the open file like the register
  // does it, and handed back as the choice lists hold it, so it is chosen at once.
  const saveLocalCustomerFromField: SaveCustomer = async (value, existing, options) => {
    if (!workspace) throw new Error("Öppna arbetsytan först.");
    // A new customer may get its first place with the same address in the same write (2026-10-10).
    const result: { workspace: LocalWorkspaceDocument; customer: LocalCustomer; firstPlaceError?: string } = existing
      ? saveLocalCustomerRecord(workspace, customerPayload(value, existing), existing.id, existing.version)
      : saveLocalNewCustomer(workspace, customerPayload(value, null), options?.firstPlace ? firstPlaceOf(value) : null);
    await commit(result.workspace);
    return { ...localCustomerItem(result.customer), lat: result.customer.lat ?? null, lng: result.customer.lng ?? null, facilities: result.workspace.customerFacilities.filter((facility) => facility.customerId === result.customer.id),
      ...(result.firstPlaceError ? { firstPlaceError: result.firstPlaceError } : {}) };
  };
  const [cardCustomerEdit, setCardCustomerEdit] = useState<CustomerItem | null>(null);
  const native = useNativeMode();
  let localContent: React.ReactNode = null;
  if (workspace && storage) {
    if (view === "notifications")
      localContent = <TaskNotifications feed={notificationFeed} />;
    else if (view === "self_inspection" && selfInspection)
      localContent = <SelfInspectionPage backend={selfInspection} />;
    // Avvikelser (2026-10-30): the log as a page of its own, kept in the open file like the rest.
    else if (view === "deviations" && selfInspection)
      localContent = <SelfInspectionPage backend={selfInspection} mode="deviations" />;
    // The instrument register has its own page (2026-10-07), kept in the open file like the rest of Egenkontroll.
    else if (view === "instruments" && instrumentsBackend)
      localContent = <InstrumentsPage backend={instrumentsBackend} />;
    // Värden och referenser (2026-10-06): the forms' limits from the server, the values in the open file.
    else if (view === "company_values" && overview.admin)
      localContent = <CompanyValues key={workspace.workspaceId} notify={notify} backend={{
        load: async () => ({ ...(await api<CompanyValuesData>("/api/company-values", { cache: "no-store" })), canEdit: true, values: workspace.companyValues }),
        save: async (inputs) => { const next = saveLocalCompanyValues(workspace, inputs, user?.name || user?.email || ""); await commit(next); return next.companyValues; },
      }} />;
    else if (view === "workflow_task") {
      localContent = <WorkflowTaskEditor
        rowOptions={{ rowsOnTop: false }}
        userName={user?.name || undefined}
        kind={(taskType === "RISK_ASSESSMENT" || taskType === "FORM" ? taskType : "WORK_ORDER") as WorkflowTaskKind}
        taskId={taskId}
        projectId={projectId}
        customerId={customerId}
        customers={customerItems}
        projects={workspace.projects}
        local={{
          // Limit profiles in the file (2026-09-28); Local has no company versions of forms, so the family is the form itself.
          limits: { profiles: workspace.formLimitProfiles.map((profile) => ({ ...profile })), company: workspace.companyValues, save: async (input) => { await commit(saveLocalFormLimitProfile(workspace, input, input.templateId, user?.name || user?.email || "")); } },
          tasks: workflowTaskItems,
          riskExceptionAllowed,
          members: user ? [{ id: user.email, name: user.name || user.email }] : [],
          savePlace: saveLocalPlace,
          saveCustomer: saveLocalCustomerFromField,
          // "Upprepa kontrollen" (2026-10-06): the file's owner plans the round in the file, like Driftronder below.
          rounds: {
            // The file's rounds, also for a work order that holds one (Avser driftrond, Skapa arbetsorder för ronden).
            load: async () => { const today = swedishDayKey(new Date()); return { canPlan: true, today, schedules: scheduleViews(localScheduleItems(workspace), workspace.workflowTasks, today, localRoundOrderPlaces(workspace), swedishClock()) }; },
            save: async (input, templateName) => { await commit(saveLocalFormSchedule(workspace, input, templateName).workspace); },
            remove: async (id) => { await commit(removeLocalFormSchedule(workspace, id)); },
            members: user ? [{ id: user.email, name: user.name || user.email }] : [],
          },
          save: async (input, extra) => {
            // Time written when completing is added in the same change to the file, before the task is locked (2026-09-30).
            const base = extra?.time ? saveLocalWorkflowTimeEntry(workspace, { taskId: input.id, ...extra.time }, user?.email ?? "local-user", "", user?.name || user?.email || "") : workspace;
            const result = saveLocalWorkflowTaskRecord(base, input, { riskExceptionAllowed });
            // Avvikelse ↔ arbetsorder (2026-10-10): a new order from a protocol row takes its log entries; a finished one closes them.
            await commit(localWorkspaceAfterOrderSave(result.workspace, { taskId: result.task.id, previousStatus: base.workflowTasks.find((task) => task.id === result.task.id)?.status ?? null, owner: selfInspectionMe }));
            return { id: result.task.id, version: result.task.version, stopped: result.stopped };
          },
          timer: async (id, command, input, options) => {
            const saved = saveLocalWorkflowTaskRecord(workspace, input, { riskExceptionAllowed });
            const result = updateLocalWorkflowTimer(saved.workspace, id, command, user?.email ?? "local-user", options);
            await commit(result.workspace);
            return result.stopped;
          },
          reopen: async (id) => { await commit(reopenLocalWorkflowTask(workspace, id)); },
          cancel: async (id, input) => { await commit(setLocalWorkflowTaskCancelled(workspace, id, input)); },
          upload: async (id, file, options) => {
            if (!storage) throw new Error("Den lokala fillagringen är inte tillgänglig.");
            const result = await stageLocalWorkflowTaskAttachment(storage, workspace, { taskId: id, file, receipt: options?.receipt });
            try { await commit(result.workspace); } catch (error) { await removeLocalAttachmentFiles(storage, [result.attachment]); throw error; }
            return result.attachment.id;
          },
          // Ta bort arbetsorder (svar 2b): the order and its tasks leave the file, then their attachment files.
          removeWorkOrder: async (id) => {
            const result = removeLocalWorkOrder(workspace, id);
            await commit(result.workspace);
            if (storage && result.attachments.length) await removeLocalAttachmentFiles(storage, result.attachments);
          },
          setReceipt: async (id, attachmentId, receipt) => { await commit(setLocalAttachmentReceipt(workspace, id, attachmentId, receipt)); },
          removeAttachment: async (id, attachmentId) => {
            if (!storage) throw new Error("Den lokala fillagringen är inte tillgänglig.");
            const attachment = workspace.attachments.find((item) => item.id === attachmentId && item.taskId === id);
            if (!attachment) throw new Error("Bilagan hittades inte i den lokala arbetsytan.");
            const saved = await commit({ ...workspace, attachments: workspace.attachments.filter((item) => item.id !== attachmentId) });
            void saved; await removeLocalAttachmentFiles(storage, [attachment]);
          },
          openAttachment: async (attachmentId) => {
            if (!storage) throw new Error("Den lokala fillagringen är inte tillgänglig.");
            const attachment = workspace.attachments.find((item) => item.id === attachmentId);
            if (!attachment) throw new Error("Bilagan hittades inte i den lokala arbetsytan.");
            saveBlob(await storage.read(attachment), attachment.filename);
          },
          report: async (input, options, variant = "pdf") => {
            if (!storage) throw new Error("Den lokala fillagringen är inte tillgänglig.");
            const fontBytes = await fetchReportFonts();
            const identity = await localReportIdentity(overview, workspace.organization.name);
            const attachments = await Promise.all(workspace.attachments.filter((attachment) => attachment.taskId === input.id).map(async (attachment) => { const converted = attachment.mimeType.startsWith("image/") ? await reportImage(await storage.read(attachment), attachment.mimeType) : null; return { id: attachment.id, filename: attachment.filename, mimeType: converted?.mimeType ?? attachment.mimeType, receipt: attachment.receipt === true, bytes: converted?.bytes }; }));
            const reportProject = workspace.projects.find((project) => project.id === input.projectId);
            // Protokollmallen (beslut 6): the saved task's completion time and the receipt on the task or its work order, as Cloud reads them
            // (app/api/workflow-tasks/snapshot-report; PDF review 2026-11-03, finding 2) – the editor's record carries neither.
            const storedTask = workspace.workflowTasks.find((task) => task.id === input.id);
            const reportWorkOrder = input.workOrderId ? workspace.workflowTasks.find((task) => task.id === input.workOrderId) : undefined;
            const reportTask: WorkflowReportTask = { ...input, ...(input.kind === "FORM" && input.id ? { protocolNumber: protocolNumberOf(input.id) } : {}), completedAt: storedTask?.completedAt ?? null, customerReceipt: customerReceiptOf(input.data) ?? customerReceiptOf(reportWorkOrder?.data), projectName: reportProject?.name, workOrderTitle: localWorkOrderTitle(workspace, (input as { workOrderId?: string | null }).workOrderId), projectFields: reportProject ? projectFieldRows({ ...reportProject, facility: localFacility(reportProject.facilityId), customer: workspace.customers.find((customer) => customer.id === reportProject.customerId) ?? null }) : undefined, facilityName: localFacility(input.facilityId) ? facilityLabel(localFacility(input.facilityId)!) : undefined, customerName: workspace.customers.find((customer) => customer.id === input.customerId)?.company || workspace.customers.find((customer) => customer.id === input.customerId)?.name, attachments };
            const fileTitle = input.title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");
            // A protocol can also be taken out as Excel or as the empty form, like the control (2026-09-27).
            if ((variant === "xlsx" || variant === "xlsx-blank") && reportTask.data.kind === "FORM") {
              const { createFormExcel } = await import("@/lib/workflow/form-excel");
              const blank = variant === "xlsx-blank";
              downloadBytes(await createFormExcel({ company: identity.company, branding: identity.branding, task: reportTask, blank }), `${blank ? `${reportTask.data.details.templateName}-tom-mall` : fileTitle}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
              return;
            }
            // The company's colours, logo and sender as in Cloud (PDF review 2026-11-03, finding 1).
            const bytes = await createWorkflowPdfReport({ ...identity, tasks: [reportTask], options, fontBytes, blank: variant === "blank" });
            downloadBytes(bytes, `${fileTitle}-${variant === "blank" ? "tom-mall" : "rapport"}.pdf`);
          },
        }}
      />;
    }
    else if (view === "time") {
      const identity = user?.email ?? "local-user";
      // A task given is its work order's time (Arbetsordern styr, 2026-10-26).
      localContent = <TimeReport focusTaskId={timeTaskId ? workspace.workflowTasks.find((task) => task.id === timeTaskId)?.workOrderId ?? timeTaskId : undefined} local={{
        // Arbetsordern styr (2026-10-26): time is on work orders and on projects themselves (Projekttid).
        tasks: [...workspace.workflowTasks.filter((task) => task.kind === "WORK_ORDER").map((task) => ({
          id: task.id,
          title: task.title,
          kind: task.kind,
          status: task.status,
          projectId: task.projectId,
          project: task.projectId ? { name: workspace.projects.find((project) => project.id === task.projectId)?.name ?? "Okänt projekt" } : null,
          archived: Boolean(task.projectId && workspace.projects.find((project) => project.id === task.projectId)?.archivedAt),
          timeEntries: task.timeEntries.filter((entry) => entry.userId === identity),
        })), ...workspace.projects.map((project) => ({
          id: project.id, title: project.name, kind: "PROJECT" as const, status: project.closedAt ? "COMPLETED" : "IN_PROGRESS", projectId: project.id,
          project: { name: project.name }, archived: Boolean(project.archivedAt), timeEntries: project.timeEntries.filter((entry) => entry.userId === identity),
        }))],
        schedule: { organizationWeeklyWorkMinutes: workspace.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: workspace.localIdentity.weeklyWorkMinutes, canEditOrganization: true, events: [] },
        saveSchedule: async (input) => { await commit(saveLocalWorkSchedule(workspace, input, user?.name || user?.email || "")); },
        save: async (entry, reason) => { await commit(saveLocalWorkflowTimeEntry(workspace, entry, identity, reason, user?.name || user?.email || "")); },
        remove: async (id, reason) => { await commit(removeLocalWorkflowTimeEntry(workspace, id, identity, reason, user?.name || user?.email || "")); },
        history: (entryId) => workspace.timeEntryEvents.filter((event) => event.entryId === entryId),
      }} />;
    }
    // Driftronder (2026-09-28) from the open file: the same overview as Cloud; the file's owner plans the rounds.
    else if (view === "rounds") {
      localContent = <FormRounds revision={workspace.updatedAt} backend={{
        load: async () => {
          const today = swedishDayKey(new Date());
          // Driftrond i arbetsordern (2026-10-27): only read – the round's work order for a period is made by the person.
          return { canPlan: true, today, schedules: scheduleViews(localScheduleItems(workspace), workspace.workflowTasks, today, localRoundOrderPlaces(workspace), swedishClock()) };
        },
        save: async (input, templateName) => { await commit(saveLocalFormSchedule(workspace, input, templateName).workspace); },
        remove: async (id) => { await commit(removeLocalFormSchedule(workspace, id)); },
        members: user ? [{ id: user.email, name: user.name || user.email }] : [],
      }} />;
    }
    else if (view === "work_orders") {
      // Local is one person's file: every work order in it counts as created by the owner.
      const identity = user?.email ?? "local-user";
      localContent = <WorkOrderList canCreate personId={identity} local={{ tasks: workspace.workflowTasks.filter((task) => task.kind === "WORK_ORDER").map((task) => ({
        // Local has no maintenance items: the list knows only what a paused order waits for.
        maintenance: task.data.kind === "WORK_ORDER" ? { waitingOn: task.data.details.waitingOn ?? "" } : undefined,
        id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress(task), responsibleName: task.assignedToName, isMine: true,
        customerName: localCustomerName(task.customerId), placeName: listPlaceLabel(localFacility(task.facilityId)?.name, tempPlaceOf(task.data)),
        dueDate: task.dueDate, projectId: task.projectId, projectName: workspace.projects.find((project) => project.id === task.projectId)?.name ?? "", updatedAt: task.updatedAt,
        plannedAt: nextPlannedAt(workspace.plannedActivities.filter((activity) => activity.workflowTaskId === task.id)), roundScheduleId: task.roundScheduleId ?? null,
      })) }} />;
    }
    else if (["new_project", "projects", "planning", "project", "tasks"].includes(view)) {
      const projects: WorkflowProject[] = workspace.projects.map((project) => ({
        ...project,
        // Same rule as Cloud: reported time on a Swedish day outside the project's frame.
        outsideFrameMinutes: hasProjectFrame(project) ? Math.round([...workspace.workflowTasks.filter((task) => task.projectId === project.id).flatMap((task) => task.timeEntries), ...project.timeEntries]
          .filter((entry) => entry.endedAt && !dayInFrame(swedishDayKey(entry.startedAt), project)).reduce((sum, entry) => sum + entry.durationSec, 0) / 60) : 0,
        // Projekttid (2026-10-26): the project's own time, finished and running.
        projectTimeSec: project.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)) : 0), 0),
        customer: customerItems.find((customer) => customer.id === project.customerId) ?? null,
        facility: localFacility(project.facilityId),
        // Material i projektet (2026-10-09): the open project's summed material rows, as in Cloud.
        ...(view === "project" && project.id === projectId ? { materials: summarizeProjectMaterials(workOrderMaterialSources(workspace.workflowTasks.filter((task) => task.projectId === project.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), undefined, { prices: true }) } : {}),
        // Samlad bild (Fas 4B): the work order a task belongs to and each job's current step, as in Cloud.
        workflowTasks: workspace.workflowTasks.filter((task) => task.projectId === project.id).map((task) => ({ id: task.id, title: task.title, status: task.status, updatedAt: task.updatedAt, projectId: task.projectId, dueDate: task.dueDate, plannedStartDate: task.plannedStartDate ?? "", createdAt: task.createdAt, roundScheduleId: task.roundScheduleId ?? null, estimatedMinutes: task.estimatedMinutes ?? null,
          workOrderId: task.workOrderId ?? null, step: localJobStep(workspace.workflowTasks, task), customerId: task.customerId, progress: workflowTaskProgress(task), kind: task.kind, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, customerName: localCustomerName(task.customerId), placeName: listPlaceLabel(localFacility(task.facilityId)?.name, tempPlaceOf(task.data)), totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)) : 0), 0) })),
      }));
      const localBookedJob = (taskId: string | null) => { const task = taskId ? workspace.workflowTasks.find((item) => item.id === taskId) : undefined; return task ? { status: task.status } : null; };
      localContent = <WorkflowProjects
        view={view as "new_project" | "projects" | "planning" | "project" | "tasks"}
        projectId={projectId}
        // Planering under Projekt (2026-10-30): Local has no Tidplan, so Planering is its Kalender (a menu button until then).
        projectPages={{ planning: false, summary: false, calendar: true }}
        personId={user?.email ?? "local-user"}
        customers={customerItems}
        local={{
          savePlace: saveLocalPlace,
          saveCustomer: saveLocalCustomerFromField,
          projectTimer: async (targetProjectId, command, options) => {
            const result = updateLocalProjectTimer(workspace, targetProjectId, command, user?.email ?? "local-user", options);
            await commit(result.workspace);
            return result.stopped;
          },
          projects,
          workflowTasks: workspace.workflowTasks.map((task) => ({ id: task.id, title: task.title, status: task.status, updatedAt: task.updatedAt, projectId: task.projectId, dueDate: task.dueDate, plannedStartDate: task.plannedStartDate ?? "", createdAt: task.createdAt, roundScheduleId: task.roundScheduleId ?? null, customerId: task.customerId, progress: workflowTaskProgress(task), kind: task.kind,
            workOrderId: task.workOrderId ?? null, workOrderTitle: task.workOrderId ? workspace.workflowTasks.find((item) => item.id === task.workOrderId)?.title ?? "" : "", assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, customerName: localCustomerName(task.customerId), placeName: listPlaceLabel(localFacility(task.facilityId)?.name, tempPlaceOf(task.data)), maintenance: task.data.kind === "WORK_ORDER" ? { waitingOn: task.data.details.waitingOn ?? "" } : null, totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)) : 0), 0) })),
          save: async (input) => {
            const result = saveLocalProjectRecord(workspace, input, user?.name || user?.email || "");
            await commit(result.workspace);
            return result.project.id;
          },
          link: async (task, targetProjectId, apply) => {
            const updated = linkLocalTaskToProject(workspace, task.id, task.kind, targetProjectId, apply, user?.name || user?.email || "");
            await commit(updated);
          },
          archive: async (targetProjectId, archived) => {
            await commit(setLocalProjectArchived(workspace, targetProjectId, archived, user?.name || user?.email || ""));
          },
          close: async (targetProjectId, closed) => {
            await commit(setLocalProjectClosed(workspace, targetProjectId, closed, user?.name || user?.email || ""));
          },
          decide: async (targetProjectId, decision) => {
            await commit(addLocalProjectDecision(workspace, targetProjectId, decision, user?.name || user?.email || ""));
          },
          reopen: async (taskId) => {
            await commit(reopenLocalWorkflowTask(workspace, taskId));
          },
          // The booked job's status, as Cloud sends it: a booking on a job that has utgått never clashes (2026-10-09).
          plannedActivities: workspace.plannedActivities.map((activity) => ({ ...activity, workflowTask: localBookedJob(activity.workflowTaskId) })),
          // Driftronder i Planeringen (2026-10-06): computed from the file's schedules for the shown period, never stored.
          rounds: async (period) => planningRounds(localScheduleItems(workspace), workspace.workflowTasks, period, swedishDayKey(new Date()), undefined, localRoundOrderPlaces(workspace), swedishClock()),
          toBook: () => localWorkToBook(workspace, swedishDayKey(new Date())),
          savePlannedActivity: async (input) => {
            const result = saveLocalPlannedActivity(workspace, input, user?.name || user?.email || "");
            await commit(result.workspace);
            return { id: result.activity.id, version: result.activity.version };
          },
          removePlannedActivity: async (id, version) => {
            const result = removeLocalPlannedActivity(workspace, id, version, user?.name || user?.email || "");
            await commit(result.workspace);
          },
          members: user ? [{ id: user.email, name: user.name || user.email }] : [],
          capacity: {
            currentUserId: user?.email ?? "local-user",
            weeklyWorkMinutes: effectiveWeeklyWorkMinutes(workspace.organization.weeklyWorkMinutes, workspace.localIdentity.weeklyWorkMinutes),
          },
          teamCapacity: {
            canViewTeam: true,
            organizationWeeklyWorkMinutes: workspace.organization.weeklyWorkMinutes,
            members: [{
              id: user?.email ?? "local-user",
              name: user?.name || user?.email || "Lokal ägare",
              weeklyWorkMinutes: effectiveWeeklyWorkMinutes(workspace.organization.weeklyWorkMinutes, workspace.localIdentity.weeklyWorkMinutes),
              memberWeeklyWorkMinutes: workspace.localIdentity.weeklyWorkMinutes,
              events: workspace.workScheduleEvents.filter((event) => event.scope === "MEMBER").map((event) => ({
                id: event.id, previousMinutes: event.previousMinutes, nextMinutes: event.nextMinutes, actorName: event.actorName, createdAt: event.createdAt,
              })),
            }],
            activities: workspace.plannedActivities.filter((activity) => !activity.deletedAt).map((activity) => ({
              id: activity.id, title: activity.title, startsAt: activity.startsAt, endsAt: activity.endsAt, assignedToUserId: activity.assignedToUserId, assignedToUserIds: activity.assignedToUserIds, assignments: activity.assignments, status: activity.status, projectId: activity.projectId, workflowTask: localBookedJob(activity.workflowTaskId), workflowTaskId: activity.workflowTaskId,
            })),
          },
          report: async (project, options: WorkflowReportOptions, selected: ProjectReportChoice[]) => {
            if (!storage) throw new Error("Den lokala fillagringen är inte tillgänglig.");
            const fontBytes = await fetchReportFonts();
            // The company's colours, logo and sender as in Cloud (PDF review 2026-11-03, finding 1).
            const identity = await localReportIdentity(overview, workspace.organization.name);
            const workflowReports: WorkflowReportTask[] = await Promise.all(selected.map(async (choice) => {
              const task = workspace.workflowTasks.find((item) => item.id === choice.id); if (!task) throw new Error("En vald uppgift saknas i den lokala arbetsytan.");
              const attachments = await Promise.all(workspace.attachments.filter((attachment) => attachment.taskId === task.id).map(async (attachment) => { const converted = attachment.mimeType.startsWith("image/") ? await reportImage(await storage.read(attachment), attachment.mimeType) : null; return { id: attachment.id, filename: attachment.filename, mimeType: converted?.mimeType ?? attachment.mimeType, receipt: attachment.receipt === true, bytes: converted?.bytes }; }));
              return { ...task, customerReceipt: customerReceiptOf(task.data) ?? customerReceiptOf(workspace.workflowTasks.find((item) => item.id === task.workOrderId)?.data), workOrderTitle: localWorkOrderTitle(workspace, task.workOrderId), facilityName: localFacility(task.facilityId) ? facilityLabel(localFacility(task.facilityId)!) : undefined, totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)) : 0), 0), projectId: project.id, projectName: project.name, customerName: workspace.customers.find((customer) => customer.id === task.customerId)?.company || workspace.customers.find((customer) => customer.id === task.customerId)?.name, attachments };
            }));
            const { PDFDocument } = await import("pdf-lib");
            const result = await PDFDocument.create();
            const coverBytes = await createWorkflowPdfReport({ ...identity, title: "Projektrapport", projectName: project.name, projectFields: projectFieldRows({ ...(workspace.projects.find((item) => item.id === project.id) ?? project), facility: localFacility(project.facilityId), customer: workspace.customers.find((customer) => customer.id === project.customerId) ?? null }), tasks: workflowReports, taskCount: workflowReports.length, options, fontBytes });
            const cover = await PDFDocument.load(coverBytes); (await result.copyPages(cover, cover.getPageIndices())).forEach((page) => result.addPage(page));
            // Protocols follow as their own PDFs in the control's look (2026-09-27), without the sender box, which
            // stands once on the cover (PDF review 2026-11-03, finding 7).
            for (const protocol of workflowReports.filter((task) => task.kind === "FORM")) {
              const source = await PDFDocument.load(await createWorkflowPdfReport({ ...identity, sender: null, tasks: [protocol], options, fontBytes }));
              (await result.copyPages(source, source.getPageIndices())).forEach((page) => result.addPage(page));
            }
            const { stampContinuousFooter, projectReportFooterLeft, projectReportMetadata } = await import("@/lib/workflow/report-merge");
            projectReportMetadata(result, { projectName: project.name, company: identity.company });
            await stampContinuousFooter(result, { fontBytes, left: projectReportFooterLeft(project.name), company: identity.company, sender: identity.sender });
            downloadBytes(await result.save(), `${project.name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")}-projektrapport.pdf`);
          },
        }}
      />;
    }
    // The customer card (decision 12B) from the open file, with the same facility rules as Cloud.
    else if (view === "customers") {
      // The customer card (decision 12B) from the open file, with the same facility rules as Cloud. Redigera kund on the card
      // (2026-10-08) uses the same form as the quick link; the card is read again after a save. On display 2 and 3 the card
      // stands beside the register's list on one page (plan 1R); at level 1 it is screens of its own.
      const card = (id: string, extras?: { onDeleteCustomer: () => void }) => <CustomerCard key={`${id}-${workspace.customers.find((item) => item.id === id)?.version ?? 0}`} customerId={id} onEdit={(customer) => setCardCustomerEdit(customer)} canCreateProject onDeleteCustomer={extras?.onDeleteCustomer} customerEditor={{ save: saveLocalCustomerFromField, read: async (customer) => {
          const item = workspace.customers.find((candidate) => candidate.id === customer);
          if (!item) throw new Error("Kunden hittades inte.");
          return { ...localCustomerItem(item), lat: item.lat ?? null, lng: item.lng ?? null, facilities: workspace.customerFacilities.filter((facility) => facility.customerId === customer) };
        } }} local={{
        load: async (kind, page) => localCustomerCardData(workspace, id, kind, page, overview.settings?.maintenance === true),
        saveFacility: async (input) => { await commit(saveLocalCustomerFacility(workspace, id, input)); },
        setFacilityActive: async (facility, isActive) => { await commit(setLocalCustomerFacilityActive(workspace, facility, isActive)); },
        deleteFacility: async (facility) => { await commit(deleteLocalCustomerFacility(workspace, facility)); },
      }} />;
      localContent = native && customerId
        ? <>{card(customerId)}
          {cardCustomerEdit ? <CustomerQuickDialog key={cardCustomerEdit.id} editing={cardCustomerEdit} open onOpenChange={(open) => { if (!open) setCardCustomerEdit(null); }} save={saveLocalCustomerFromField} onSaved={() => notify("Kunden är uppdaterad lokalt.")} /> : null}</>
        : (
        <CustomerRegisterSwitch maintenance={overview.settings?.maintenance === true} local={{
          places: workspace.customerFacilities.filter((place) => workspace.customers.some((customer) => customer.id === place.customerId && !customer.deletedAt)),
          customerName: (id) => { const customer = workspace.customers.find((item) => item.id === id); return customer ? customerTitle(customer) : ""; },
          openWorkOrders: (id) => workspace.workflowTasks.filter((task) => task.kind === "WORK_ORDER" && task.status !== "COMPLETED" && task.facilityId === id).length,
        }}><LocalRecordArchive
          workspace={workspace}
          commit={commit}
          notify={notify}
          fileBased={backend === "bundle"}
          customerId={customerId}
          renderCard={card}
        /></CustomerRegisterSwitch>
      );
    }
    else
      localContent = (
        <LocalDashboard
          rounds={(period) => planningRounds(localScheduleItems(workspace), workspace.workflowTasks, period, swedishDayKey(new Date()), undefined, localRoundOrderPlaces(workspace), swedishClock()).rounds}
          workspace={workspace}
          currentUserId={user?.email ?? "local-user"}
          fileBased={backend === "bundle"}
        />
      );
  }

  const workspaceCounts = workspace
    ? `${plural(workspace.customers.filter((item) => !item.deletedAt).length, "kund", "kunder")} · ${plural(workspace.workflowTasks.length, "uppgift", "uppgifter")} · ${plural(workspace.attachments.length, "bilaga", "bilagor")}`
    : "";
  const storageName =
    backend === "directory" ? directory?.name || "Lokal mapp" : bundleName;
  const storageTime = workspace
    ? formatSwedish(workspace.updatedAt, { hour: "2-digit", minute: "2-digit" })
    : "";
  useRegisterLocalStorageActions(
    workspace
      ? {
          label: "Lokal lagring",
          detail:
            backend === "bundle" && bundleDirty
              ? `${storageName} · Osparade ändringar`
              : `${storageName} · Sparad ${storageTime}`,
          attention: backend === "bundle" && bundleDirty,
          open: () => setManagerOpen(true),
        }
      : null,
  );

  return (
    <div className="space-y-6">
      {confirmElement}
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept=".hwf,.kfid,.zip,application/vnd.hintek.workflow-file,application/vnd.hintek.kfid-workspace,application/zip"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void selectBundle(file);
          event.target.value = "";
        }}
      />
      {!workspace && (
        <>
          <div>
            <h1 className="page-title">Lokal arbetsyta</h1>
          </div>
          <div className="notice flex gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" />
            <p>
              Kunder, projekt och kontroller sparas i en fil på den här datorn
              och skickas aldrig till servern.
            </p>
          </div>
        </>
      )}
      {!workspace && recovery && (
        <Panel
          title="Återställ osparat arbete"
          description="Det finns en återställningskopia i den här webbläsaren. Den har inte skickats till servern."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {plural(recovery.workspace.customers.length, "kund", "kunder")} · {plural(recovery.workspace.workflowTasks.length, "uppgift", "uppgifter")} · sparad {formatSwedish(recovery.workspace.updatedAt, { dateStyle: "short", timeStyle: "short" })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={restoreRecovery}>Återställ arbetsyta</Button>
              <Button
                variant="outline"
                onClick={() => {
                  void deleteLocalWorkspaceRecovery(organization.id).then(() => setRecovery(null));
                }}
              >
                Ta bort kopian
              </Button>
            </div>
          </div>
        </Panel>
      )}
      {!workspace && <Panel
        className="local-workspace-panel"
        title="Öppna lokal arbetsyta"
        description="Första gången? Välj Skapa ny. Har du en mapp eller fil sedan tidigare, öppna den. Innehållet skickas inte till servern."
      >
          <div className="space-y-5">
            {!supported ? (
              <div className="rounded-xl border bg-secondary/40 p-4 text-sm leading-6">
                Firefox och Safari kan inte ge direkt mappåtkomst. Därför
                öppnar och sparar Workflow hela arbetsytan som en enda lokal fil med
                register, kontroller och bilagor.
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              {supported ? (
                <div className="rounded-xl border p-4">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-secondary p-3 text-primary">
                      <HardDrive className="size-6" />
                    </span>
                    <div>
                      <p className="font-medium">Direkt lokal mapp</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Rekommenderas i Chrome och Edge. Varje uttrycklig
                        sparning skrivs direkt till den valda mappen.
                      </p>
                    </div>
                  </div>
                  <Button
                    className="mt-4"
                    disabled={busy}
                    onClick={() =>
                      void (remembered && rememberedDirectory
                        ? open(rememberedDirectory, true)
                        : pickDirectory())
                    }
                  >
                    <FolderOpen />
                    {remembered && rememberedDirectory
                      ? `Öppna ${rememberedDirectory.name}`
                      : "Välj lokal mapp"}
                  </Button>
                </div>
              ) : null}
              <div className="rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-secondary p-3 text-primary">
                    <FileUp className="size-6" />
                  </span>
                  <div>
                    <p className="font-medium">Manuell arbetsytefil</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Fungerar i Firefox, Safari, Chrome och Edge. Efter
                      ändringar laddar du ned en uppdaterad .hwf-fil.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <FileUp />
                    Öppna fil
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={createBundleWorkspace}
                  >
                    <FilePlus2 />
                    Skapa ny
                  </Button>
                </div>
                {readingNote}
              </div>
            </div>
          </div>
      </Panel>}
      {workspace && backend === "bundle" && bundleDirty && (
        <div role="status" className="local-storage-attention flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 flex-1 leading-5">
            Arbetsytefilen har osparade ändringar.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setManagerOpen(true)}
          >
            Hantera
          </Button>
        </div>
      )}
      {workspace && (
        <Modal size="compact" open={managerOpen} onOpenChange={setManagerOpen} title="Lokal lagring">
          <div className="space-y-4">
            <div>
              <p className="font-medium">{storageName}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {workspaceCounts} · {backend === "bundle" && bundleDirty ? "Osparade ändringar" : `Sparad ${storageTime}`}
              </p>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {backend === "bundle"
                ? "Spara och ladda sedan ned arbetsytefilen. Inga kontrolluppgifter skickas till servern."
                : "Spara skriver till den valda mappen. Inga kontrolluppgifter skickas till servern."}
            </p>
            {backend === "bundle" && bundleDirty && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                Ladda ned arbetsytefilen innan du stänger eller laddar om sidan.
              </div>
            )}
            <div className="local-workspace-actions grid gap-2">
              <DownloadButton variant="default" disabled={busy} onClick={() => void exportBundle()}>
                Ladda ned arbetsytefil
              </DownloadButton>
              <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
                <FileUp />
                Öppna arbetsytefil
              </Button>
              {supported && (
                <Button variant="outline" disabled={busy} onClick={() => void pickDirectory()}>
                  <FolderOpen />
                  Byt till mapp
                </Button>
              )}
            </div>
            {readingNote}
          </div>
        </Modal>
      )}
      <SelfInspectionWorkProvider value={selfInspectionWork}>{localContent}</SelfInspectionWorkProvider>
      <Modal
        open={Boolean(pendingBundle)}
        onOpenChange={(open) => {
          if (!open) setPendingBundle(null);
        }}
        title="Kontrollera arbetsytefil"
        size="compact"
      >
        {pendingBundle ? (
          <div className="space-y-5">
            <div className="rounded-xl border bg-secondary/30 p-4">
              <p className="font-medium">{pendingBundle.name}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Företag</dt>
                <dd>{pendingBundle.workspace.organization.name}</dd>
                <dt className="text-muted-foreground">Kunder</dt>
                <dd>{pendingBundle.workspace.customers.length}</dd>
                <dt className="text-muted-foreground">Uppgifter</dt>
                <dd>{pendingBundle.workspace.workflowTasks.length}</dd>
                <dt className="text-muted-foreground">Bilagor</dt>
                <dd>
                  {pendingBundle.workspace.attachments.length} ·{" "}
                  {formatFileSize(pendingBundle.attachmentBytes)}
                </dd>
                <dt className="text-muted-foreground">Exporterad</dt>
                <dd>
                  {formatSwedish(pendingBundle.exportedAt, { dateStyle: "short", timeStyle: "short" })}
                </dd>
              </dl>
            </div>
            {bundleDirty ? (
              <p className="text-sm leading-6 text-amber-700 dark:text-amber-300">
                Den nu öppna arbetsytan har ändringar som inte har laddats ned.
                De ersätts i den här fliken om du fortsätter.
              </p>
            ) : null}
            <p className="text-sm leading-6 text-muted-foreground">
              Filens struktur, företagskoppling och samtliga bilagors
              kontrollsummor är godkända. Inga data har skickats till servern.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingBundle(null)}>
                Avbryt
              </Button>
              <Button onClick={openPendingBundle}>Öppna arbetsyta</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/** Hör till arbetsorder (Fas 4B): the title of the work order a task belongs to, for its report. */
function localWorkOrderTitle(workspace: { workflowTasks: { id: string; kind: string; title: string }[] }, workOrderId: string | null | undefined) {
  return workOrderId ? workspace.workflowTasks.find((task) => task.id === workOrderId && task.kind === "WORK_ORDER")?.title || undefined : undefined;
}

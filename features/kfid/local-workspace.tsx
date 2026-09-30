"use client";

import { useConfirm } from "./confirm";
import { CustomerCard } from "./customer-card";
import { localCustomerCardData } from "./local-customer-card";
import { facilityLabel } from "@/lib/workflow/customer-facility";
import { controlProgress } from "@/lib/workflow/project-progress";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatSwedish } from "@/lib/swedish-time";
import { PDFDocument, rgb } from "pdf-lib";
import {
  Download,
  FilePlus2,
  FileUp,
  FolderOpen,
  HardDrive,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { validateForCompletion } from "@/lib/kfid/model";
import { TaskNotifications, useTaskNotificationFeed } from "@/features/workflow/task-notifications";
import { useLocalRunningTimers } from "@/features/workflow/running-timer";
import type { RunningTimer } from "@/lib/workflow/running-timer";
import { dayInFrame, hasProjectFrame, projectFieldRows } from "@/lib/workflow/project-frame";
import { swedishDayKey } from "@/lib/swedish-time";
import { attachmentLabel } from "@/lib/kfid/editor-tools";
import { Modal, Panel } from "./ui";
import { Editor, type LocalEditorAdapter } from "./editor";
import { LocalDashboard, LocalRecordArchive } from "./local-records";
import { WorkflowProjects, type WorkflowProject } from "./workflow-projects";
import type { ProjectReportChoice } from "@/features/workflow/report-options";
import { WorkflowTaskEditor, type WorkflowTaskRecord } from "@/features/workflow/workflow-task-editor";
import { WorkOrderList } from "@/features/workflow/work-order-list";
import { FormRounds } from "@/features/workflow/form-rounds";
import { scheduleViews } from "@/lib/workflow/form-schedule";
import { nextPlannedAt } from "@/lib/workflow/work-orders";
import { workflowTaskProgress, type WorkflowTaskKind } from "@/lib/workflow/task-model";
import { effectiveWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import { createWorkflowPdfReport, type WorkflowReportOptions, type WorkflowReportTask } from "@/lib/workflow/report";
import { TimeReport } from "@/features/workflow/time-report";
import {
  copyLocalAttachmentFiles,
  createDirectoryLocalAttachmentStore,
  createMemoryLocalAttachmentStore,
  loadLocalAttachmentItems,
  removeLocalAttachmentFiles,
  stageLocalAttachment,
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
import {
  createLocalWorkspace,
  ensureLocalWritePermission,
  loadOrCreateLocalWorkspace,
  localCustomerItem,
  linkLocalTaskToProject,
  prepareLocalWorkspaceSave,
  recalledLocalDirectory,
  rememberLocalDirectory,
  saveLocalControlRecord,
  saveLocalCustomerRecord,
  saveLocalProjectRecord,
  saveLocalPlannedActivity,
  removeLocalPlannedActivity,
  saveLocalWorkSchedule,
  setLocalProjectArchived,
  setLocalProjectClosed,
  addLocalProjectDecision,
  saveLocalCustomerFacility,
  setLocalCustomerFacilityActive,
  saveLocalWorkflowTaskRecord,
  saveLocalFormLimitProfile,
  saveLocalFormSchedule,
  removeLocalFormSchedule,
  saveLocalWorkflowTimeEntry,
  removeLocalWorkflowTimeEntry,
  reopenLocalWorkflowTask,
  updateLocalWorkflowTimer,
  saveLocalWorkspace,
  type LocalWorkspaceDocument,
} from "./local-workspace-store";
import {
  deleteLocalWorkspaceRecovery,
  loadLocalWorkspaceRecovery,
  saveLocalWorkspaceRecovery,
} from "./local-workspace-recovery";
import type { View, ShellUser } from "@/components/app-shell";
import type { CustomerItem, Overview, Preferences } from "./types";
import { useRegisterLocalStorageActions, useRegisterLocalWorkspaceSearch, useRegisterUnsavedWork, type WorkspaceSearchResult } from "@/components/workspace-actions";

function formatFileSize(bytes: number) {
  if (bytes < 1_000) return `${bytes} byte`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function downloadBytes(bytes: Uint8Array, filename: string, type = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
  controlId,
  customerId,
  projectId,
  taskId,
  taskType,
  timeTaskId,
  overview,
  preferences,
  notify,
  refreshAccount,
}: {
  organization: { id: string; name: string };
  user: ShellUser;
  view: View;
  controlId?: string;
  customerId?: string;
  projectId?: string;
  taskId?: string;
  taskType?: string;
  timeTaskId?: string;
  overview: Overview;
  preferences: Preferences;
  notify: (text: string, error?: boolean) => void;
  refreshAccount: () => Promise<void>;
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

  useRegisterUnsavedWork("local-bundle", bundleDirty ? "Arbetsytefilen har ändringar som inte har laddats ned. Ladda ned .hwf-filen först om du vill behålla dem." : null);
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
    try {
      const parsed = await parseLocalWorkspaceBundle(file, organization.id);
      setPendingBundle({ ...parsed, name: file.name });
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

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
  const localFacility = (id: string | null | undefined) => id ? workspace?.customerFacilities.find((facility) => facility.id === id) ?? null : null;
  const workflowTaskItems = useMemo<WorkflowTaskRecord[]>(() => (workspace?.workflowTasks ?? []).map((task) => ({
        ...task,
        progress: workflowTaskProgress(task),
        totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)) : 0), 0),
        timerRunning: task.timeEntries.some((entry) => !entry.endedAt && entry.userId === (user?.email ?? "local-user")),
        attachments: (workspace?.attachments ?? []).filter((attachment) => attachment.taskId === task.id).map(({ id, filename, mimeType, size, createdAt }) => ({ id, filename, mimeType, size, createdAt })),
      })), [user?.email, workspace]);
  const localSearch = useCallback((query: string): WorkspaceSearchResult => {
    const needle = query.trim().toLocaleLowerCase("sv-SE");
    const matches = (...values: unknown[]) => values.some((value) => String(value ?? "").toLocaleLowerCase("sv-SE").includes(needle));
    if (!workspace || needle.length < 2) return { projects: [], tasks: [], controls: [], customers: [] };
    return {
      projects: workspace.projects.filter((project) => matches(project.name, project.description, project.responsibleName, workspace.customers.find((customer) => customer.id === project.customerId)?.name)).slice(0, 6).map(({ id, name, description, responsibleName, archivedAt }) => ({ id, name, description, responsibleName, archivedAt })),
      tasks: workspace.workflowTasks.filter((task) => matches(task.title, task.description, task.assignedToName, JSON.stringify(task.data), workspace.projects.find((project) => project.id === task.projectId)?.name)).slice(0, 6).map(({ id, title, description, kind, status, projectId, assignedToName }) => ({ id, title, description, kind, status, projectId, assignedToName })),
      controls: workspace.controls.filter((control) => !control.deletedAt && matches(control.title, control.project, control.performer, control.date, JSON.stringify(control.data))).slice(0, 6).map(({ id, number, title, date, performer }) => ({ id, number, title, date, performer })),
      customers: workspace.customers.filter((customer) => !customer.deletedAt && matches(customer.name, customer.company, customer.address, customer.email, customer.phone, customer.mobile, customer.notes)).slice(0, 6).map(({ id, name, company }) => ({ id, name, company })),
    };
  }, [workspace]);
  useRegisterLocalWorkspaceSearch(workspace ? localSearch : null);

  const controlItems = useMemo(
    () =>
      (workspace?.controls ?? []).map((control) => {
        const completion = validateForCompletion(control.data, {
          attachmentCount: workspace?.attachments.filter(
            (item) => item.controlId === control.id,
          ).length,
        });
        return {
          id: control.id,
          number: control.number,
          title: control.title,
          project: control.project,
          performer: control.performer,
          date: control.date,
          status: control.status,
          version: control.version,
          deletedAt: control.deletedAt,
          updatedAt: control.updatedAt,
          postedAt: control.postedAt,
          customerId: control.customerId,
          projectId: control.projectId,
          lastOpenedAt: control.lastOpenedAt,
          completion: {
            complete: completion.complete,
            errors: completion.errors.length,
            warnings: completion.warnings.length,
            percent: completion.progress.percent,
          },
        };
      }),
    [workspace],
  );
  const notificationSources = useMemo(() => {
    if (!workspace) return null;
    const archived = new Set(workspace.projects.filter((project) => project.archivedAt).map((project) => project.id));
    return [
      ...workspace.workflowTasks.map((task) => ({ ...task, archived: Boolean(task.projectId && archived.has(task.projectId)) })),
      ...controlItems.map((control) => ({ id: control.id, title: control.title, status: control.status, kind: "COMMISSIONING_CONTROL" as const, deletedAt: control.deletedAt, completionErrors: control.completion.errors, archived: Boolean(control.projectId && archived.has(control.projectId)) })),
    ];
  }, [controlItems, workspace]);
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
  const notificationFeed = useTaskNotificationFeed({ localSources: notificationSources, localFollowUps: notificationFollowUps, enabled: Boolean(notificationSources) });
  // The open file's own running timers for the top bar, paused through the same local rule as the editor.
  const localTimerUserId = user?.email ?? "local-user";
  const runningTimers = useMemo<RunningTimer[] | null>(() => workspace ? [
    ...workspace.workflowTasks.map((task) => ({ id: task.id, title: task.title, kind: task.kind as RunningTimer["kind"], projectId: task.projectId, timeEntries: task.timeEntries })),
    ...workspace.controls.filter((control) => !control.deletedAt).map((control) => ({ id: control.id, title: control.title || "Kontroll", kind: "KFID" as const, projectId: control.projectId, timeEntries: control.timeEntries })),
  ].flatMap((task) => task.timeEntries
    .filter((entry) => !entry.endedAt && entry.userId === localTimerUserId)
    .map((entry) => ({ entryId: entry.id, taskId: task.id, taskTitle: task.title, kind: task.kind, projectName: workspace.projects.find((project) => project.id === task.projectId)?.name ?? null, startedAt: entry.startedAt }))) : null, [localTimerUserId, workspace]);
  useLocalRunningTimers(runningTimers, async (timer) => {
    if (!workspace) return [];
    const result = updateLocalWorkflowTimer(workspace, timer.taskId, "PAUSE", localTimerUserId);
    await commit(result.workspace);
    return result.stopped;
  });
  const refreshLocal = useCallback(async () => {
    if (backend !== "directory" || !directory) return;
    setWorkspace(await loadOrCreateLocalWorkspace(directory, organization));
  }, [backend, directory, organization]);
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshLocal(), refreshAccount()]);
  }, [refreshAccount, refreshLocal]);
  const adapter = useMemo<LocalEditorAdapter | undefined>(() => {
    if (!workspace || !storage) return undefined;
    const loaded = async (
      control: LocalWorkspaceDocument["controls"][number],
      source = workspace,
    ) => ({
        id: control.id,
        number: control.number,
        title: control.title,
        project: control.project,
        performer: control.performer,
        date: control.date,
        status: control.status,
        version: control.version,
        deletedAt: control.deletedAt,
        updatedAt: control.updatedAt,
        postedAt: control.postedAt,
        customerId: control.customerId,
        projectId: control.projectId,
        lastOpenedAt: control.lastOpenedAt,
        data: control.data,
        attachments: await loadLocalAttachmentItems(
          storage,
          source.attachments.filter((item) => item.controlId === control.id),
        ),
        revisions: control.revisions,
      });
    return {
      fileBased: backend === "bundle",
      customers: customerItems.filter((customer) => !customer.deletedAt),
      controls: controlItems,
      projects: workspace.projects.map((project) => ({ id: project.id, name: project.name })),
      loadControl: async (id) => {
        const control = workspace.controls.find(
          (item) => item.id === id && !item.deletedAt,
        );
        if (!control)
          throw new Error("Kontrollen hittades inte i den lokala arbetsytan.");
        return loaded(control);
      },
      saveControl: async (input) => {
        // Completing a control stops the owner's timer on it first.
        const base = input.status === "COMPLETED" && input.id && workspace.controls.some((item) => item.id === input.id && item.timeEntries.some((entry) => !entry.endedAt))
          ? updateLocalWorkflowTimer(workspace, input.id, "PAUSE", localTimerUserId).workspace : workspace;
        const result = saveLocalControlRecord(base, input);
        let next = result.workspace;
        let written: LocalWorkspaceDocument["attachments"] = [];
        if (
          input.includeAttachments &&
          input.sourceId &&
          input.sourceId !== result.control.id
        ) {
          const copied = await copyLocalAttachmentFiles(
            storage,
            next,
            input.sourceId,
            result.control.id,
          );
          next = copied.workspace;
          written = copied.written;
        }
        try {
          const saved = await commit(next);
          return loaded(result.control, saved);
        } catch (error) {
          await removeLocalAttachmentFiles(storage, written);
          throw error;
        }
      },
      createCustomer: async (data) => {
        const result = saveLocalCustomerRecord(workspace, data);
        await commit(result.workspace);
        return {
          ...localCustomerItem(result.customer),
          lat: result.customer.lat ?? null,
          lng: result.customer.lng ?? null,
        };
      },
      uploadAttachments: async (input) => {
        let next = workspace;
        const added: LocalWorkspaceDocument["attachments"] = [];
        const errors: string[] = [];
        for (const file of input.files) {
          try {
            const result = await stageLocalAttachment(storage, next, {
              controlId: input.controlId,
              file,
              section: input.section,
              rowId: input.rowId,
            });
            next = result.workspace;
            added.push(result.attachment);
          } catch (error) {
            errors.push(`${file.name}: ${(error as Error).message}`);
          }
        }
        try {
          const saved = added.length ? await commit(next) : workspace;
          return {
            attachments: await loadLocalAttachmentItems(
              storage,
              saved.attachments.filter(
                (item) => item.controlId === input.controlId,
              ),
            ),
            errors,
          };
        } catch (error) {
          await removeLocalAttachmentFiles(storage, added);
          throw error;
        }
      },
      deleteAttachment: async (controlId, attachmentId) => {
        const control = workspace.controls.find(
          (item) => item.id === controlId && !item.deletedAt,
        );
        if (!control)
          throw new Error("Kontrollen hittades inte i den lokala arbetsytan.");
        if (control.status === "COMPLETED")
          throw new Error("En färdigställd kontroll kan inte ändras.");
        if (
          !workspace.attachments.some(
            (item) => item.id === attachmentId && item.controlId === controlId,
          )
        )
          throw new Error("Bilagan hittades inte i den lokala arbetsytan.");
        const saved = await commit({
          ...workspace,
          attachments: workspace.attachments.filter(
            (item) => item.id !== attachmentId,
          ),
        });
        return loadLocalAttachmentItems(
          storage,
          saved.attachments.filter((item) => item.controlId === controlId),
        );
      },
      clearAttachments: async (controlId) => {
        const control = workspace.controls.find(
          (item) => item.id === controlId && !item.deletedAt,
        );
        if (!control)
          throw new Error("Kontrollen hittades inte i den lokala arbetsytan.");
        if (control.status === "COMPLETED")
          throw new Error("En färdigställd kontroll kan inte ändras.");
        await commit({
          ...workspace,
          attachments: workspace.attachments.filter(
            (item) => item.controlId !== controlId,
          ),
        });
      },
      refresh: refreshLocal,
      timer: async (controlId, command) => {
        const result = updateLocalWorkflowTimer(workspace, controlId, command, localTimerUserId);
        await commit(result.workspace);
        return result.stopped;
      },
      tasks: workspace.workflowTasks.map((task) => ({ id: task.id, title: task.title, status: task.status, kind: task.kind, dueDate: task.dueDate, projectId: task.projectId })),
      timeFor: (controlId) => {
        const entries = workspace.controls.find((item) => item.id === controlId)?.timeEntries ?? [];
        return {
          totalDurationSec: entries.reduce((sum, entry) => sum + (entry.endedAt ? entry.durationSec : Math.max(0, Math.floor((Date.now() - Date.parse(entry.startedAt)) / 1000))), 0),
          timerRunning: entries.some((entry) => !entry.endedAt && entry.userId === localTimerUserId),
        };
      },
    };
  }, [backend, commit, controlItems, customerItems, localTimerUserId, refreshLocal, storage, workspace]);

  let localContent: React.ReactNode = null;
  if (workspace && adapter) {
    if (view === "new")
      localContent = (
        <Editor
          user={user}
          controlId={controlId}
          initialCustomerId={customerId}
          initialProjectId={projectId}
          overview={overview}
          preferences={preferences}
          refresh={refreshAll}
          notify={notify}
          local={adapter}
        />
      );
    else if (view === "notifications")
      localContent = <TaskNotifications feed={notificationFeed} />;
    else if (view === "workflow_task") {
      localContent = <WorkflowTaskEditor
        rowOptions={{ rowsOnTop: preferences.rowsOnTop, showExamples: preferences.showExamples }}
        userName={user?.name || undefined}
        kind={(taskType === "RISK_ASSESSMENT" || taskType === "FORM" ? taskType : "WORK_ORDER") as WorkflowTaskKind}
        taskId={taskId}
        projectId={projectId}
        customerId={customerId}
        customers={customerItems}
        projects={workspace.projects}
        local={{
          // Limit profiles in the file (2026-09-28); Local has no company versions of forms, so the family is the form itself.
          limits: { profiles: workspace.formLimitProfiles.map((profile) => ({ ...profile })), save: async (input) => { await commit(saveLocalFormLimitProfile(workspace, input, input.templateId, user?.name || user?.email || "")); } },
          tasks: workflowTaskItems,
          members: user ? [{ id: user.email, name: user.name || user.email }] : [],
          save: async (input, extra) => {
            // Time written when completing is added in the same change to the file, before the task is locked (2026-09-30).
            const base = extra?.time ? saveLocalWorkflowTimeEntry(workspace, { taskId: input.id, ...extra.time }, user?.email ?? "local-user", "", user?.name || user?.email || "") : workspace;
            const result = saveLocalWorkflowTaskRecord(base, input);
            await commit(result.workspace);
            return { id: result.task.id, version: result.task.version, stopped: result.stopped };
          },
          timer: async (id, command, input) => {
            const saved = saveLocalWorkflowTaskRecord(workspace, input);
            const result = updateLocalWorkflowTimer(saved.workspace, id, command, user?.email ?? "local-user");
            await commit(result.workspace);
            return result.stopped;
          },
          reopen: async (id) => { await commit(reopenLocalWorkflowTask(workspace, id)); },
          upload: async (id, file) => {
            if (!storage) throw new Error("Den lokala fillagringen är inte tillgänglig.");
            const result = await stageLocalWorkflowTaskAttachment(storage, workspace, { taskId: id, file });
            try { await commit(result.workspace); } catch (error) { await removeLocalAttachmentFiles(storage, [result.attachment]); throw error; }
            return result.attachment.id;
          },
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
            const blob = await storage.read(attachment); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = attachment.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
          },
          report: async (input, options, variant = "pdf") => {
            if (!storage) throw new Error("Den lokala fillagringen är inte tillgänglig.");
            const fontResponse = await fetch("/fonts/DejaVuSans.ttf"); if (!fontResponse.ok) throw new Error("Typsnittet för PDF kunde inte läsas in.");
            const attachments = await Promise.all(workspace.attachments.filter((attachment) => attachment.taskId === input.id).map(async (attachment) => { const converted = attachment.mimeType.startsWith("image/") ? await reportImage(await storage.read(attachment), attachment.mimeType) : null; return { id: attachment.id, filename: attachment.filename, mimeType: converted?.mimeType ?? attachment.mimeType, bytes: converted?.bytes }; }));
            const reportProject = workspace.projects.find((project) => project.id === input.projectId);
            const reportTask: WorkflowReportTask = { ...input, projectName: reportProject?.name, projectFields: reportProject ? projectFieldRows({ ...reportProject, facility: localFacility(reportProject.facilityId) }) : undefined, facilityName: localFacility(input.facilityId) ? facilityLabel(localFacility(input.facilityId)!) : undefined, customerName: workspace.customers.find((customer) => customer.id === input.customerId)?.company || workspace.customers.find((customer) => customer.id === input.customerId)?.name, attachments };
            const fileTitle = input.title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");
            // A protocol can also be taken out as Excel or as the empty form, like the control (2026-09-27).
            if ((variant === "xlsx" || variant === "xlsx-blank") && reportTask.data.kind === "FORM") {
              const { createFormExcel } = await import("@/lib/workflow/form-excel");
              const blank = variant === "xlsx-blank";
              downloadBytes(await createFormExcel({ company: workspace.organization.name, task: reportTask, blank }), `${blank ? `${reportTask.data.details.templateName}-tom-mall` : fileTitle}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
              return;
            }
            const bytes = await createWorkflowPdfReport({ company: workspace.organization.name, tasks: [reportTask], options, fontBytes: new Uint8Array(await fontResponse.arrayBuffer()), blank: variant === "blank" });
            downloadBytes(bytes, `${fileTitle}-${variant === "blank" ? "tom-mall" : "rapport"}.pdf`);
          },
        }}
      />;
    }
    else if (view === "time") {
      const identity = user?.email ?? "local-user";
      localContent = <TimeReport focusTaskId={timeTaskId} local={{
        tasks: [...workspace.workflowTasks.map((task) => ({
          id: task.id,
          title: task.title,
          kind: task.kind,
          status: task.status,
          projectId: task.projectId,
          project: task.projectId ? { name: workspace.projects.find((project) => project.id === task.projectId)?.name ?? "Okänt projekt" } : null,
          archived: Boolean(task.projectId && workspace.projects.find((project) => project.id === task.projectId)?.archivedAt),
          timeEntries: task.timeEntries.filter((entry) => entry.userId === identity),
        })), ...workspace.controls.filter((control) => !control.deletedAt).map((control) => ({
          // Controls take manual time only (decision 13).
          id: control.id,
          title: control.title,
          kind: "COMMISSIONING_CONTROL" as const,
          status: control.status,
          projectId: control.projectId,
          project: control.projectId ? { name: workspace.projects.find((project) => project.id === control.projectId)?.name ?? "Okänt projekt" } : null,
          archived: Boolean(control.projectId && workspace.projects.find((project) => project.id === control.projectId)?.archivedAt),
          timeEntries: control.timeEntries.filter((entry) => entry.userId === identity),
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
          const schedules = workspace.formSchedules.filter((item) => !item.deletedAt).map((item) => {
            const customer = workspace.customers.find((entry) => entry.id === item.customerId);
            return { ...item, reminders: item.reminders, templateName: item.templateName || "Formulär", facilityName: workspace.customerFacilities.find((facility) => facility.id === item.facilityId)?.name ?? "",
              customerName: customer ? customer.company || customer.name : "", projectName: workspace.projects.find((project) => project.id === item.projectId)?.name ?? "" };
          });
          return { canPlan: true, today, schedules: scheduleViews(schedules, workspace.workflowTasks, today) };
        },
        save: async (input, templateName) => { await commit(saveLocalFormSchedule(workspace, input, templateName).workspace); },
        remove: async (id) => { await commit(removeLocalFormSchedule(workspace, id)); },
        customers: customerItems,
        projects: workspace.projects.filter((project) => !project.archivedAt).map((project) => ({ id: project.id, name: project.name })),
        members: user ? [{ id: user.email, name: user.name || user.email }] : [],
      }} />;
    }
    else if (view === "work_orders") {
      // Local is one person's file: every work order in it counts as created by the owner.
      const identity = user?.email ?? "local-user";
      localContent = <WorkOrderList canCreate local={{ userId: identity, tasks: workspace.workflowTasks.map((task) => ({
        id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress(task), assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, createdBy: identity,
        customerName: workspace.customers.find((customer) => customer.id === task.customerId)?.company || workspace.customers.find((customer) => customer.id === task.customerId)?.name || "",
        dueDate: task.dueDate, projectId: task.projectId, projectName: workspace.projects.find((project) => project.id === task.projectId)?.name ?? "", updatedAt: task.updatedAt,
        plannedAt: nextPlannedAt(workspace.plannedActivities.filter((activity) => activity.workflowTaskId === task.id)),
      })) }} />;
    }
    else if (["new_project", "projects", "planning", "project", "tasks"].includes(view)) {
      const projects: WorkflowProject[] = workspace.projects.map((project) => ({
        ...project,
        // Same rule as Cloud: reported time on a Swedish day outside the project's frame.
        outsideFrameMinutes: hasProjectFrame(project) ? Math.round([...workspace.workflowTasks, ...workspace.controls.filter((control) => !control.deletedAt)].filter((task) => task.projectId === project.id).flatMap((task) => task.timeEntries)
          .filter((entry) => entry.endedAt && !dayInFrame(swedishDayKey(entry.startedAt), project)).reduce((sum, entry) => sum + entry.durationSec, 0) / 60) : 0,
        customer: customerItems.find((customer) => customer.id === project.customerId) ?? null,
        facility: localFacility(project.facilityId),
        controls: controlItems.filter((control) => control.projectId === project.id && !control.deletedAt).map((control) => ({
          id: control.id,
          number: control.number,
          title: control.title,
          status: control.status,
          updatedAt: control.updatedAt,
          projectId: control.projectId,
          customerId: control.customerId,
          lastOpenedAt: control.lastOpenedAt,
          completion: controlProgress(control.status, control.completion?.percent),
          // Manual time on the control (decision 13).
          totalDurationSec: workspace.controls.find((item) => item.id === control.id)?.timeEntries.reduce((sum, entry) => sum + entry.durationSec, 0) ?? 0,
        })),
        workflowTasks: workspace.workflowTasks.filter((task) => task.projectId === project.id).map((task) => ({ id: task.id, title: task.title, status: task.status, updatedAt: task.updatedAt, projectId: task.projectId, dueDate: task.dueDate, customerId: task.customerId, progress: workflowTaskProgress(task), kind: task.kind, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)) : 0), 0) })),
      }));
      localContent = <WorkflowProjects
        view={view as "new_project" | "projects" | "planning" | "project" | "tasks"}
        projectId={projectId}
        customers={customerItems}
        controls={controlItems.filter((control) => !control.deletedAt).map((control) => ({
          id: control.id,
          number: control.number,
          title: control.title,
          status: control.status,
          updatedAt: control.updatedAt,
          projectId: control.projectId,
          customerId: control.customerId,
          lastOpenedAt: control.lastOpenedAt,
          completion: controlProgress(control.status, control.completion?.percent),
        }))}
        local={{
          projects,
          workflowTasks: workspace.workflowTasks.map((task) => ({ id: task.id, title: task.title, status: task.status, updatedAt: task.updatedAt, projectId: task.projectId, dueDate: task.dueDate, customerId: task.customerId, progress: workflowTaskProgress(task), kind: task.kind, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)) : 0), 0) })),
          save: async (input) => {
            const result = saveLocalProjectRecord(workspace, input, user?.name || user?.email || "");
            await commit(result.workspace);
            return result.project.id;
          },
          link: async (task, targetProjectId, apply) => {
            const updated = linkLocalTaskToProject(workspace, task.id, task.kind ?? "COMMISSIONING_CONTROL", targetProjectId, apply, user?.name || user?.email || "");
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
          plannedActivities: workspace.plannedActivities,
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
            timeEntries: [...workspace.workflowTasks, ...workspace.controls.filter((control) => !control.deletedAt)].flatMap((task) => task.timeEntries.filter((entry) => entry.userId === (user?.email ?? "local-user"))),
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
              startsAt: activity.startsAt, endsAt: activity.endsAt, assignedToUserId: activity.assignedToUserId, assignedToUserIds: activity.assignedToUserIds, assignments: activity.assignments, status: activity.status, projectId: activity.projectId,
            })),
          },
          report: async (project, options: WorkflowReportOptions, selected: ProjectReportChoice[]) => {
            if (!storage) throw new Error("Den lokala fillagringen är inte tillgänglig.");
            const fontResponse = await fetch("/fonts/DejaVuSans.ttf"); if (!fontResponse.ok) throw new Error("Typsnittet för PDF kunde inte läsas in.");
            const fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
            const workflowReports: WorkflowReportTask[] = await Promise.all(selected.filter((choice) => choice.kind !== "COMMISSIONING_CONTROL").map(async (choice) => {
              const task = workspace.workflowTasks.find((item) => item.id === choice.id); if (!task) throw new Error("En vald uppgift saknas i den lokala arbetsytan.");
              const attachments = await Promise.all(workspace.attachments.filter((attachment) => attachment.taskId === task.id).map(async (attachment) => { const converted = attachment.mimeType.startsWith("image/") ? await reportImage(await storage.read(attachment), attachment.mimeType) : null; return { id: attachment.id, filename: attachment.filename, mimeType: converted?.mimeType ?? attachment.mimeType, bytes: converted?.bytes }; }));
              return { ...task, facilityName: localFacility(task.facilityId) ? facilityLabel(localFacility(task.facilityId)!) : undefined, totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)) : 0), 0), projectId: project.id, projectName: project.name, customerName: workspace.customers.find((customer) => customer.id === task.customerId)?.company || workspace.customers.find((customer) => customer.id === task.customerId)?.name, attachments };
            }));
            const result = await PDFDocument.create();
            const coverBytes = await createWorkflowPdfReport({ company: workspace.organization.name, title: "Projektrapport", projectName: project.name, projectFields: projectFieldRows({ ...(workspace.projects.find((item) => item.id === project.id) ?? project), facility: localFacility(project.facilityId) }), tasks: workflowReports, taskCount: workflowReports.length, options, fontBytes });
            const cover = await PDFDocument.load(coverBytes); (await result.copyPages(cover, cover.getPageIndices())).forEach((page) => result.addPage(page));
            // Protocols follow as their own PDFs in the control's look, like the controls (2026-09-27).
            for (const protocol of workflowReports.filter((task) => task.kind === "FORM")) {
              const source = await PDFDocument.load(await createWorkflowPdfReport({ company: workspace.organization.name, tasks: [protocol], options, fontBytes }));
              (await result.copyPages(source, source.getPageIndices())).forEach((page) => result.addPage(page));
            }
            const reportCore = await import("@/lib/kfid/report-core");
            for (const choice of selected.filter((item) => item.kind === "COMMISSIONING_CONTROL")) {
              const control = workspace.controls.find((item) => item.id === choice.id && item.projectId === project.id && !item.deletedAt); if (!control) throw new Error("En vald kontroll saknas i den lokala arbetsytan.");
              const reportFiles = await Promise.all(workspace.attachments.filter((attachment) => attachment.controlId === control.id).filter((attachment) => options.attachments || (options.images && attachment.mimeType.startsWith("image/"))).map(async (attachment) => { const converted = options.images && attachment.mimeType.startsWith("image/") ? await reportImage(await storage.read(attachment), attachment.mimeType) : null; return { filename: attachment.filename, mimeType: converted?.mimeType ?? attachment.mimeType, section: attachment.section!, rowId: attachment.rowId, label: attachmentLabel(control.data, { ...attachment, section: attachment.section! }), bytes: converted?.bytes }; }));
              const controlBytes = await reportCore.createPdfReport(control.data, { company: workspace.organization.name }, reportFiles, false, fontBytes);
              const source = await PDFDocument.load(controlBytes); const pages = await result.copyPages(source, source.getPageIndices());
              if (control.status !== "COMPLETED") pages.forEach((page) => page.drawText("UTKAST – EJ SLUTFÖRD", { x: 390, y: 812, size: 9, color: rgb(0.65, 0.35, 0.02) }));
              pages.forEach((page) => result.addPage(page));
            }
            const { stampContinuousFooter } = await import("@/lib/workflow/report-merge");
            await stampContinuousFooter(result, { fontBytes, left: `HINTEK Workflow · Projektrapport · ${project.name}`, company: workspace.organization.name });
            downloadBytes(await result.save(), `${project.name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")}-projektrapport.pdf`);
          },
        }}
      />;
    }
    // The customer card (decision 12B) from the open file, with the same facility rules as Cloud.
    else if (view === "customers" && customerId)
      localContent = <CustomerCard key={customerId} customerId={customerId} local={{
        load: async (kind, page) => localCustomerCardData(workspace, customerId, kind, page),
        saveFacility: async (input) => { await commit(saveLocalCustomerFacility(workspace, customerId, input)); },
        setFacilityActive: async (id, isActive) => { await commit(setLocalCustomerFacilityActive(workspace, id, isActive)); },
      }} />;
    else if (view === "controls" || view === "customers")
      localContent = (
        <LocalRecordArchive
          kind={view}
          workspace={workspace}
          commit={commit}
          customerId={customerId}
          notify={notify}
          fileBased={backend === "bundle"}
        />
      );
    else
      localContent = (
        <LocalDashboard
          workspace={workspace}
          currentUserId={user?.email ?? "local-user"}
          fileBased={backend === "bundle"}
        />
      );
  }

  const workspaceCounts = workspace
    ? `${workspace.customers.filter((item) => !item.deletedAt).length} kunder · ${workspace.controls.filter((item) => !item.deletedAt).length} kontroller · ${workspace.attachments.length} bilagor`
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
        accept=".hwf,.kfid,application/vnd.hintek.workflow-file,application/vnd.hintek.kfid-workspace"
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
            <p className="page-description mt-2">
              Kundregister och kontroller lagras på den här datorn – inte i
              HINTEK Cloud.
            </p>
          </div>
          <div className="notice flex gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" />
            <p>
              Serverspärren för lokal lagring är aktiv. Workflows moln-API avvisar
              kund- och kontrolldata för detta företag.
            </p>
          </div>
        </>
      )}
      {!workspace && recovery && (
        <Panel
          title="Återställ osparat arbete"
          description="Workflow hittade en lokal, kraschbeständig återställningskopia i den här webbläsaren. Den har inte skickats till HINTEK."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {recovery.workspace.customers.length} kunder · {recovery.workspace.controls.length} kontroller · sparad {formatSwedish(recovery.workspace.updatedAt, { dateStyle: "short", timeStyle: "short" })}
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
        description="Använd en direktansluten mapp eller en komplett arbetsytefil. Innehållet skickas inte till HINTEK."
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
        <Modal open={managerOpen} onOpenChange={setManagerOpen} title="Lokal lagring">
          <div className="space-y-4">
            <div>
              <p className="font-medium">{storageName}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {workspaceCounts} · {backend === "bundle" && bundleDirty ? "Osparade ändringar" : `Sparad ${storageTime}`}
              </p>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {backend === "bundle"
                ? "Spara behåller ändringarna i fliken. Ladda sedan ned arbetsytefilen. Inga kontrolluppgifter skickas till HINTEK."
                : "Ändringar skrivs till den valda mappen när du väljer Spara. Inga kontrolluppgifter skickas till HINTEK."}
            </p>
            {backend === "bundle" && bundleDirty && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                Ladda ned arbetsytefilen innan du stänger eller laddar om sidan.
              </div>
            )}
            <div className="local-workspace-actions grid gap-2">
              <Button disabled={busy} onClick={() => void exportBundle()}>
                <Download />
                Ladda ned arbetsytefil
              </Button>
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
          </div>
        </Modal>
      )}
      {localContent}
      <Modal
        open={Boolean(pendingBundle)}
        onOpenChange={(open) => {
          if (!open) setPendingBundle(null);
        }}
        title="Kontrollera arbetsytefil"
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
                <dt className="text-muted-foreground">Kontroller</dt>
                <dd>{pendingBundle.workspace.controls.length}</dd>
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
              kontrollsummor är godkända. Inga data har skickats till HINTEK.
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

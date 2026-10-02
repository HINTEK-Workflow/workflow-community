"use client";

import { facilityLabel } from "@/lib/workflow/customer-facility";
import { useEffect, useRef, useState } from "react";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, CheckCircle2, Copy, FileText, FolderKanban, History, Package, Paperclip, Plus, RotateCcw, Save, Send, ShieldAlert, ShieldCheck, Trash2, Undo2, Upload, UserRound, Users, Wrench, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal, Panel, ShowMore } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { TaskPageFold, useDetailLevel } from "./use-detail-level";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { useRegisterEditorActions } from "@/components/workspace-actions";
import { CustomerPicker } from "@/features/kfid/customer-picker";
import { openFormPreviewPdf } from "./form-preview-pdf";
import { api } from "@/features/kfid/api";
import type { CustomerItem, ProjectItem } from "@/features/kfid/types";
import { workflowTaskAttachmentLimit, workflowTaskCompletion, workflowTaskProgress, type WorkflowTaskKind, type WorkflowTaskStatus } from "@/lib/workflow/task-model";
import type { WorkflowReportOptions } from "@/lib/workflow/report";
import { ReportOptionsButton, type ReportVariant } from "./report-options";
import { EditorHeader, type EditorFact } from "./editor-header";
import { indicatorBadge } from "./indicator-tone";
import { announceTimerChange } from "./running-timer";
import { projectFieldRows, taskDueDateError } from "@/lib/workflow/project-frame";
import type { StoppedTimer } from "@/lib/workflow/running-timer";
import { clearMeasurements, copyFormValues, formApprovalTotals, formCompletion, formHasContent, formLeafBlocks, formRowsWithoutOrder, formOptionalSections, formSectionActive, initialFormValues, type FormDocument, type FormTableBlock, type FormValues } from "@/lib/workflow/form-document";
import { applyFormPrefill, type FormPrefill, type FormPrefillSource } from "@/lib/workflow/form-prefill";
import { FormRenderer, sectionHasSummary, type FormActions, type FormMedia, type FormRowOptions, type FormTaskInline } from "./form-renderer";
import { FormLimitsPanel, FormTrendPanel, type LocalLimits } from "./form-task-extras";
import { CompletionCard, type CompletionCardSummary } from "./form-blocks";
import { announce } from "@/lib/workflow/toast";
import { selectFormHistory, type FormHistoryItem } from "@/lib/workflow/form-history";
import { CompleteTaskDialog, type CompletionTime } from "./complete-task-dialog";
import { NextSteps, type LinkedTask } from "./next-steps";
import { clientExtensions } from "@ee/client";
import { FlowGuide, focusTarget } from "./flow-guide";
import { formFlow, riskFlow, workOrderFlow } from "@/lib/workflow/task-flow";
import { CustomerSearchBox } from "@/features/kfid/customer-search-box";

type Risk = { id: string; hazard: string; likelihood: number; consequence: number; protectiveMeasure: string; residualLikelihood: number; residualConsequence: number };
type Material = { id: string; name: string; quantity: string; unit: string };
type TaskData =
  | { kind: "WORK_ORDER"; details: { executionNotes: string; deviations: string; materials: Material[]; signature: { name: string; confirmed: boolean; signedAt: string | null }; closeNotes: string; source?: { taskId: string; title: string; kind?: WorkflowTaskKind; rowId?: string } } }
  | { kind: "RISK_ASSESSMENT"; details: { risks: Risk[]; generalMeasures: string; approval: { name: string; confirmed: boolean; approvedAt: string | null } } }
  | { kind: "FORM"; details: { templateId: string; templateVersion: number; templateName: string; publisherName?: string; document: FormDocument; values: FormValues } };
/** The published form version a new protocol is created from (2026-09-26). */
export type FormTemplateChoice = { templateId: string; version: number; name: string; document: FormDocument; allowStandalone?: boolean; allowInProject?: boolean; area?: string; publisher?: string };
type TaskRevision = { id: string; version: number; createdAt: string; snapshot: { title: string; description: string; status: WorkflowTaskStatus; progress: number; data: TaskData; completedAt: string | null } };
export type WorkflowTaskRecord = { id: string; version: number; kind: WorkflowTaskKind; formArea?: string | null; title: string; description: string; status: WorkflowTaskStatus; progress: number; projectId: string | null; customerId: string | null; facilityId?: string | null; siteId: string | null; departmentId: string | null; assignedToUserId: string | null; assignedToName: string; dueDate: string; data: TaskData; totalDurationSec: number; timerRunning: boolean; revisions?: TaskRevision[]; revisionCount?: number; attachments?: { id: string; filename: string; mimeType: string; size: number; createdAt: string }[] };
type Member = { id: string; name: string };
type Site = { id: string; name: string; isActive: boolean; departments: { id: string; name: string; isActive: boolean }[] };

const emptyData = (kind: WorkflowTaskKind, form?: FormTemplateChoice | null): TaskData => kind === "WORK_ORDER"
  ? { kind, details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } }
  : kind === "FORM" && form
    ? { kind, details: { templateId: form.templateId, templateVersion: form.version, templateName: form.name, ...(form.publisher ? { publisherName: form.publisher } : {}), document: form.document, values: initialFormValues(form.document) } }
    : { kind: "RISK_ASSESSMENT", details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } };

/** What the person edits; everything else (version, time, attachments, history) always comes from the server. */
const taskKey = (record: WorkflowTaskRecord) => JSON.stringify(PERSON_FIELDS.map((key) => record[key]));
const PERSON_FIELDS = ["title", "description", "status", "projectId", "customerId", "facilityId", "siteId", "departmentId", "assignedToUserId", "assignedToName", "dueDate", "data"] as const;

const { WorkOrderProposal, RiskMeasuresAssist, ProtocolReview } = clientExtensions;
const statusLabels: Record<WorkflowTaskStatus, string> = { PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Slutförd" };

/**
 * The form builder's preview (2026-09-28): the real task editor with the draft and example answers, so what the
 * builder shows is exactly what the person filling in the protocol gets. Nothing is fetched or stored; the sample
 * customer, project and place stand in for the company's own.
 */
export type FormPreviewInput = { document: FormDocument; name: string; values: FormValues; area?: string; publisher?: string; onValuesChange?: (values: FormValues) => void };
const PREVIEW_SITES: Site[] = [{ id: "preview-site", name: "Huvudkontoret", isActive: true, departments: [{ id: "preview-department", name: "Service", isActive: true }] }];
const PREVIEW_MESSAGE = "Förhandsgranskning: inget sparas.";

function WorkflowTaskEditorBody({ kind, taskId, projectId, customerId, customers, projects, form: initialForm = null, local, rowOptions, userName, preview }: {
  /** The person's "nya rader överst" and example-row settings, used by a form's measurement rows like the control. */
  rowOptions?: FormRowOptions;
  /** The signed-in person's name, for fields that start from the user (the control's Utfört av). */
  userName?: string;
  /** The builder's preview: the draft as the task editor shows it, without saving anything. */
  preview?: FormPreviewInput;
  kind: WorkflowTaskKind; taskId?: string; projectId?: string; customerId?: string; customers: CustomerItem[]; projects: ProjectItem[]; form?: FormTemplateChoice | null; local?: { limits?: LocalLimits; tasks: WorkflowTaskRecord[]; members?: Member[]; save: (task: WorkflowTaskRecord, extra?: { time?: CompletionTime }) => Promise<{ id: string; version: number; stopped?: StoppedTimer[] }>; timer: (id: string, command: "START" | "PAUSE", task: WorkflowTaskRecord) => Promise<StoppedTimer[] | void>; reopen?: (id: string) => Promise<void>; upload?: (id: string, file: File) => Promise<string | void>; removeAttachment?: (id: string, attachmentId: string) => Promise<void>; openAttachment?: (attachmentId: string) => Promise<void>; report?: (task: WorkflowTaskRecord, options: WorkflowReportOptions, variant?: ReportVariant) => Promise<void> } }) {
  const router = useRouter();
  const [confirm, confirmCard] = useConfirm();
  // On a phone or tablet a lower display level starts the project's facts folded: the top of a task shows the work, not the address book (2026-10-02).
  const detailLevel = useDetailLevel();
  // A new protocol is created from the form's published version (`formId` from Ny uppgift); an existing one carries its own.
  const searchParams = useSearchParams();
  const formId = preview ? null : searchParams.get("formId");
  // "Spara som" (2026-09-27): a new protocol that starts from another one's answers.
  const copyOf = preview ? null : searchParams.get("copyOf");
  // A round started from Driftronder (2026-09-28): the schedule, its day and the facility it is made at.
  const roundParam = preview ? null : searchParams.get("scheduleId");
  const occurrenceParam = preview ? null : searchParams.get("occurrence");
  const facilityParam = preview ? null : searchParams.get("facilityId");
  const roundTitleParam = preview ? null : searchParams.get("roundTitle")?.trim().slice(0, 160) || null;
  const [form, setForm] = useState<FormTemplateChoice | null>(preview ? { templateId: "preview", version: 1, name: preview.name, document: preview.document, area: preview.area, publisher: preview.publisher } : initialForm);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    if (kind !== "FORM" || taskId || !formId || form?.templateId === formId) return;
    let active = true;
    api<{ templateId: string; version: number; name: string; document: FormDocument; allowStandalone?: boolean; allowInProject?: boolean; area?: string; publisher?: string }>(`/api/forms?id=${encodeURIComponent(formId)}`)
      .then((result) => { if (active) { setForm({ templateId: result.templateId, version: result.version, name: result.name, document: result.document, allowStandalone: result.allowStandalone, allowInProject: result.allowInProject, area: result.area, publisher: result.publisher }); setFormError(""); } })
      .catch((issue) => { if (active) setFormError((issue as Error).message); });
    return () => { active = false; };
  }, [kind, taskId, formId, form?.templateId]);
  // A task created in a project inherits the project's frame (2026-09-26): the customer is locked to the
  // project's, the responsible member and "Klart senast" are prefilled and the date must stay within the frame.
  const inherit = (base: WorkflowTaskRecord, project: ProjectItem | undefined): WorkflowTaskRecord => project ? {
    ...base,
    projectId: project.id,
    customerId: project.customerId ?? base.customerId,
    // The project's customer facility (decision 11) is prefilled; another facility of the same customer can be chosen.
    facilityId: base.facilityId || (project.customerId ? project.facilityId ?? null : null),
    assignedToUserId: base.assignedToUserId ?? project.responsibleUserId ?? null,
    assignedToName: base.assignedToUserId ? base.assignedToName : project.responsibleName ?? base.assignedToName,
    dueDate: base.dueDate || project.dueDate || "",
  } : { ...base, projectId: null };
  // The builder's preview starts from its example answers instead of an empty protocol.
  const blankData = (): TaskData => {
    const data = emptyData(kind, form);
    if (preview && data.kind === "FORM") return { ...data, details: { ...data.details, values: preview.values } };
    if (data.kind === "FORM" && roundParam && occurrenceParam && /^\d{4}-\d{2}-\d{2}$/.test(occurrenceParam)) return { ...data, details: { ...data.details, values: { ...data.details.values, round: { scheduleId: roundParam, occurrence: occurrenceParam } } } };
    return data;
  };
  const blankTask = (): WorkflowTaskRecord => inherit({ id: "", version: 0, kind, title: kind === "FORM" && form ? (roundParam && roundTitleParam && occurrenceParam ? `${roundTitleParam} ${occurrenceParam}` : form.name) : "", description: "", status: "PLANNED", progress: 0, projectId: null, customerId: customerId ?? null, facilityId: facilityParam ?? null, siteId: null, departmentId: null, assignedToUserId: null, assignedToName: "", dueDate: "", data: blankData(), totalDurationSec: 0, timerRunning: false }, projects.find((project) => project.id === projectId));
  const [task, setTask] = useState<WorkflowTaskRecord>(blankTask);
  // The newest task, for what is applied after an answer has arrived (HINTEK AI's proposals, 2026-10-02).
  const latestTask = useRef(task);
  useEffect(() => { latestTask.current = task; });
  // The task's title follows a field when the form says so (the control's Projekt / anläggning), else stays as typed.
  const titled = (next: WorkflowTaskRecord): WorkflowTaskRecord => {
    if (next.data.kind !== "FORM" || !next.data.details.document.task.titleKey) return next;
    const title = (String(next.data.details.values.fields[next.data.details.document.task.titleKey] ?? "").trim() || next.data.details.templateName).slice(0, 200);
    return title === next.title ? next : { ...next, title };
  };
  /**
   * A protocol's fields that start from the task (2026-09-27, like the control's customer picker): customer,
   * contact, e-mail, facility, project, responsible person and today. A new choice replaces what the old one filled in.
   */
  const prefilled = (next: WorkflowTaskRecord, kinds?: FormPrefill[], overwrite = false): WorkflowTaskRecord => {
    if (next.data.kind !== "FORM" || next.status === "COMPLETED") return next;
    const project = projects.find((item) => item.id === next.projectId);
    const customer = customers.find((item) => item.id === (project?.customerId ?? next.customerId));
    const facility = customer?.facilities?.find((item) => item.id === next.facilityId);
    const source: FormPrefillSource = { today: swedishDayKey(new Date()) };
    if (customer) Object.assign(source, { customer: customer.company || customer.name, contact: customer.name, email: customer.email });
    if (project) source.project = project.name;
    if (facility || project) source.facility = facility ? facilityLabel(facility) : project!.name;
    if (next.assignedToName) source.assignee = next.assignedToName;
    if (userName) source.user = userName;
    const values = applyFormPrefill(next.data.details.document, next.data.details.values, source, { kinds, overwrite });
    return titled(values === next.data.details.values ? next : { ...next, data: { ...next.data, details: { ...next.data.details, values } } });
  };
  // A new protocol fills its empty fields once the customer and project lists have arrived.
  useEffect(() => { if (!task.id) setTask((current) => prefilled(current)); }, [customers, projects, form?.templateId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [members, setMembers] = useState<Member[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // The last save's error, for the completion dialog that covers the page's message.
  const lastError = useRef("");
  const [customerPicker, setCustomerPicker] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The guided flow (2026-09-30): completing asks for time in the same step; linked work orders show their state.
  const [completeOpen, setCompleteOpen] = useState(false);
  // Skicka med e-post, at the foot of every control (2026-10-02): the recipient and an optional message.
  const [sendOpen, setSendOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [sendNote, setSendNote] = useState("");
  const [linkedOrders, setLinkedOrders] = useState<Record<string, LinkedTask>>({});
  const [savedAt, setSavedAt] = useState("");
  // What the server last confirmed (or the blank start): the page is unsaved when the person's fields differ from it.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const attachmentInput = useRef<HTMLInputElement | null>(null);
  // The task as the server last confirmed it (or as it was just sent). A reply from the server replaces only what the
  // person has not changed since, so text typed while a save or reload is under way is kept (2026-09-30: "Utfört
  // arbete" typed right after the first save was lost when the new task was read back).
  const baseline = useRef<WorkflowTaskRecord | null>(null);
  const applyServer = (server: WorkflowTaskRecord) => { setSavedKey(taskKey(server)); setTask((current) => {
    const base = baseline.current;
    baseline.current = server;
    if (!base || !current.id || current.id !== server.id) return server;
    const merged: WorkflowTaskRecord = { ...server };
    for (const key of PERSON_FIELDS) if (JSON.stringify(current[key]) !== JSON.stringify(base[key])) (merged as Record<string, unknown>)[key] = current[key];
    return merged;
  }); };

  async function load() {
    if (preview) { setMembers(userName ? [{ id: "preview-user", name: userName }] : []); setSites(PREVIEW_SITES); return; }
    try {
      const [taskResult, structure] = await Promise.all([local ? Promise.resolve({ tasks: local.tasks, members: local.members ?? [] }) : api<{ tasks: WorkflowTaskRecord[]; members: Member[] }>(taskId ? `/api/workflow-tasks?id=${encodeURIComponent(taskId)}` : "/api/workflow-tasks?members=only"), api<{ sites: Site[] }>("/api/organization-structure")]);
      setMembers(taskResult.members);
      setSites(structure.sites);
      if (taskId && !local) {
        const current = taskResult.tasks.find((item) => item.id === taskId);
        if (!current) throw new Error("Uppgiften hittades inte.");
        applyServer(current);
      }
    } catch (issue) { setError((issue as Error).message); }
  }
  useEffect(() => { void load(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Ny" from an open editor navigates to the same type without a taskId; start from a blank task of that type.
  useEffect(() => { if (!taskId) { baseline.current = null; const fresh = prefilled(blankTask()); setSavedKey(taskKey(fresh)); setTask(fresh); setMessage(""); setError(""); } }, [taskId, kind, form?.templateId, form?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  // Spara som: the new protocol gets the source's answers, place and customer, without signatures or pictures.
  useEffect(() => {
    if (!copyOf || taskId || kind !== "FORM" || !form) return;
    let active = true;
    const source = local ? Promise.resolve(local.tasks.find((item) => item.id === copyOf)) : api<{ tasks: WorkflowTaskRecord[] }>(`/api/workflow-tasks?id=${encodeURIComponent(copyOf)}`).then((result) => result.tasks[0]);
    source.then((item) => {
      if (!active || !item || item.data.kind !== "FORM") return;
      const values = clearMeasurements(item.data.details.document, copyFormValues(item.data.details.values));
      setTask((current) => current.data.kind !== "FORM" ? current : titled({ ...current, title: `${item.title} (kopia)`.slice(0, 200), description: item.description, projectId: item.projectId, customerId: item.customerId, facilityId: item.facilityId ?? null, siteId: item.siteId, departmentId: item.departmentId, data: { ...current.data, details: { ...current.data.details, values } } }));
      setMessage("Kopian är inte sparad än. Mätvärden, bedömningar och sammanfattning är tömda; kontrollera övriga uppgifter och spara.");
    }).catch((issue) => { if (active) setError((issue as Error).message); });
    return () => { active = false; };
  }, [copyOf, taskId, kind, form?.templateId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The state of the work orders made from this protocol's rows, shown on each row (read within the person's rights).
  const orderIds = task.data.kind === "FORM" ? Object.values(task.data.details.values.tables).flat().map((row) => row.workOrderId).filter((id): id is string => Boolean(id)) : [];
  const orderKey = [...new Set(orderIds)].sort().join(",");
  useEffect(() => {
    if (!orderKey || preview) { setLinkedOrders({}); return; }
    if (local) { setLinkedOrders(Object.fromEntries(local.tasks.filter((item) => orderKey.split(",").includes(item.id)).map((item) => [item.id, { id: item.id, title: item.title, status: item.status, kind: item.kind, dueDate: item.dueDate }]))); return; }
    let active = true;
    api<{ links: LinkedTask[] }>(`/api/workflow-tasks?links=${encodeURIComponent(orderKey)}`).then((result) => { if (active) setLinkedOrders(Object.fromEntries(result.links.map((item) => [item.id, item]))); }).catch(() => undefined);
    return () => { active = false; };
  }, [orderKey, local?.tasks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!local || !taskId) return;
    const current = local.tasks.find((item) => item.id === taskId);
    if (current) applyServer(current);
  }, [local?.tasks, taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedSite = sites.find((site) => site.id === task.siteId);
  const selectedProject = projects.find((project) => project.id === task.projectId);
  // An archived or closed project freezes its work (simulation 2026-10-02: the page looked editable and only the save failed).
  const frozen = Boolean(selectedProject && (selectedProject.archivedAt || selectedProject.closedAt));
  const customerLocked = Boolean(selectedProject?.customerId);
  // Facilities of the task's customer (decision 11); a paused facility stays selectable only when already linked.
  const facilityCustomerId = (customerLocked ? selectedProject?.customerId : task.customerId) ?? "";
  const facilityOptions = (customers.find((customer) => customer.id === facilityCustomerId)?.facilities ?? []).filter((facility) => facility.isActive || facility.id === task.facilityId);
  const dueDateError = selectedProject ? taskDueDateError(task.dueDate, selectedProject) : null;

  const completion = workflowTaskCompletion(task);
  // The control's Grunduppgifter (2026-09-27): a form can draw the task's project, customer and place inside its
  // own first section instead of Workflow's task panel; the title then follows a field and the customer is picked like
  // the control does it, beside the contact person.
  const inlineTask = task.data.kind === "FORM" && task.data.details.document.task.layout === "inline";
  // One foot for every document type (2026-10-02, decision 2.3: "alla typer av dokument skall ha samma
  // approach ... inga avarter", this applies to arbetsorder and uppgifter too): Bilder och dokument, the completion
  // card with Historik and Färdigställ, then Rapport och hantering with Exportera and Skicka med e-post.
  const controlFoot = true;
  // Word choice only (the structure above is identical for every kind): a work order and a risk assessment are
  // "slutförda", a protocol "färdigställt".
  const isForm = task.data.kind === "FORM";
  const docWord = isForm ? "Protokollet" : task.kind === "WORK_ORDER" ? "Arbetsordern" : "Riskbedömningen";
  // A completed KFID protocol cannot be reopened (Spara som continues it instead); every other kind can (Återöppna
  // in the header below, same condition).
  const reopenable = task.formArea !== "kfid";
  // Like the control, time starts once the field the title follows is filled in, so the protocol gets its name when it is saved.
  const titleField = inlineTask && task.data.kind === "FORM" && task.data.details.document.task.titleKey ? formLeafBlocks(task.data.details.document).find((block) => block.type === "field" && block.key === (task.data.kind === "FORM" ? task.data.details.document.task.titleKey : "")) : undefined;
  const titleFieldEmpty = Boolean(titleField && task.data.kind === "FORM" && !String(task.data.details.values.fields[titleField.type === "field" ? titleField.key : ""] ?? "").trim());
  // The same fact row as the control's header (2026-09-27): what the task holds, who and when.
  const overdue = Boolean(task.dueDate && task.status !== "COMPLETED" && task.dueDate < swedishDayKey(new Date()));
  const headerFacts: EditorFact[] = [
    ...(task.data.kind === "WORK_ORDER" ? [{ icon: Package, label: `${task.data.details.materials.length} material` }] : []),
    ...(task.data.kind === "RISK_ASSESSMENT" ? [{ icon: ShieldAlert, label: `${task.data.details.risks.length} ${task.data.details.risks.length === 1 ? "risk" : "risker"}` }] : []),
    ...(task.data.kind === "FORM" ? formHeaderFacts(task.data.details.document, task.data.details.values, task.data.details.publisherName, task.data.details.templateVersion) : []),
    { icon: Paperclip, label: `${task.attachments?.length ?? 0} bilagor`, iconClassName: "text-sky-600" },
    // Where the task belongs, as links back (the guided flow, 2026-09-30).
    ...(selectedProject && task.id && !preview ? [{ icon: FolderKanban, label: selectedProject.name, href: `/?view=project&projectId=${encodeURIComponent(selectedProject.id)}`, iconClassName: "text-muted-foreground" }] : []),
    ...(task.data.kind === "WORK_ORDER" && task.data.details.source?.kind && !preview ? [{ icon: Undo2, label: `Från ${task.data.details.source.title || "uppgiften"}`, href: `/?view=workflow_task&taskId=${encodeURIComponent(task.data.details.source.taskId)}&taskType=${task.data.details.source.kind}`, iconClassName: "text-muted-foreground" }] : []),
    // A form drawn like the control has no Ansvarig field, so an empty one is not announced (2026-09-28).
    ...(inlineTask && !task.assignedToName ? [] : [{ icon: UserRound, label: task.assignedToName || "Ingen ansvarig", iconClassName: "text-muted-foreground" }]),
    ...(task.dueDate ? [{ icon: CalendarClock, label: `${overdue ? "Förfallen" : "Klart senast"} ${task.dueDate}`, tone: overdue ? "danger" as const : undefined, iconClassName: overdue ? "text-current" : "text-muted-foreground" }] : []),
  ];
  // Leads to the field and marks it light red (2026-10-01); a panel's own field when the id is a section.
  // With a message it is also shown as a toast, so it is seen where the person is (2026-10-01).
  const focusRequirement = (field: string, message?: string) => { focusTarget(field, message); };

  const dirty = !preview && savedKey !== null && taskKey(task) !== savedKey;
  useUnsavedGuard(dirty, confirm, kind === "FORM" ? "protokollet" : kind === "WORK_ORDER" ? "arbetsordern" : "riskbedömningen");
  // The bottom menu's Save and the "unsaved" guard follow this page, not only the old control (2026-10-02).
  useRegisterEditorActions({
    scope: "task", save: () => { void save(); }, newControl: () => undefined, canSave: !preview && task.status !== "COMPLETED" && !frozen, canCreate: false,
    busy, dirty, controlActions: [], runControlAction: () => undefined,
  });
  async function save(status = task.status, time: CompletionTime | null = null): Promise<string | false> {
    // Where a new protocol may be used follows its form (decision 2); the server checks the same.
    const usageProblem = !task.id && kind === "FORM" && form ? (task.projectId && form.allowInProject === false ? `${form.name} kan inte kopplas till ett projekt.` : !task.projectId && form.allowStandalone === false ? `${form.name} måste kopplas till ett projekt. Välj projekt.` : "") : "";
    if (usageProblem) { lastError.current = usageProblem; setError(usageProblem); setMessage(""); return false; }
    if (preview) { setError(""); setMessage(PREVIEW_MESSAGE); return false; }
    if (status === "COMPLETED" && !completion.ready) {
      // Said once, in the toast; the page's own list shows the rest (2026-10-01: no extra box at the top).
      setError("");
      setMessage("");
      focusRequirement(completion.issues[0].field, `Kvar före slutförande: ${completion.issues[0].message}`);
      return false;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const data = task.data;
      const payload = { ...task, id: task.id || undefined, status, data, customerId: selectedProject?.customerId ?? task.customerId } as WorkflowTaskRecord;
      // Time written when completing is registered first, while the task can still take time (Local in the same change).
      if (time && !local) await api("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "save", entry: { taskId: task.id, ...time } }) });
      const result: { id: string; version: number; stopped?: StoppedTimer[] } = local ? await local.save(payload, time ? { time } : undefined) : await api<{ id: string; version: number; stopped?: StoppedTimer[] }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "save", task: payload }) });
      if (status === "COMPLETED") announceTimerChange(result.stopped ?? []);
      // What was sent is the baseline for the reply; edits made meanwhile stay (the data is not reset to what was sent).
      baseline.current = { ...payload, id: result.id, version: result.version, status };
      setSavedKey(taskKey(baseline.current));
      // The saved status is the person's own now (Local too), so the reply that follows never reads it as an edit.
      setTask((current) => local ? { ...current, status } : { ...current, id: result.id, version: result.version, status });
      setSavedAt(formatSwedish(new Date(), { timeStyle: "short" }));
      setMessage(status === "COMPLETED" ? `${time ? "Tiden är registrerad och uppgiften" : "Uppgiften"} är slutförd.` : "Uppgiften är sparad.");
      if (!task.id) router.replace(`/?view=workflow_task&taskId=${encodeURIComponent(result.id)}&taskType=${kind}`);
      if (!local) await load();
      return result.id;
    } catch (issue) { lastError.current = (issue as Error).message; setError((issue as Error).message); return false; } finally { setBusy(false); }
  }
  async function timer(command: "START" | "PAUSE") {
    if (preview) { setMessage(PREVIEW_MESSAGE); return; }
    // Cloud saves first, also a new task (2026-09-27: start time directly); Local saves inside its timer call.
    if (local && !task.id) { setError("Spara uppgiften innan tidrapporteringen startas."); return; }
    const id = local ? task.id : await save();
    if (!id) return;
    setBusy(true);
    try {
      const stopped = local ? await local.timer(id, command, task) : (await api<{ stopped?: StoppedTimer[] }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "timer", id, command }) })).stopped;
      if (!local) await load();
      // The top bar shows the running timer in every tab; a long entry that just stopped gets a warning.
      announceTimerChange(stopped ?? []);
    }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  async function reopen() {
    if (!task.id) return;
    setBusy(true); setError(""); setMessage("");
    try { if (local?.reopen) await local.reopen(task.id); else await api("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "reopen", id: task.id }) }); if (!local) await load(); setMessage("Uppgiften är återöppnad och kan redigeras igen."); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  // Several files at once, like the control's Lägg till fil; each becomes an attachment of the saved task.
  async function upload(files: File[]) {
    if (!task.id || preview) return;
    setBusy(true); setError("");
    try { for (const file of files) { if (local?.upload) await local.upload(task.id, file); else { const form = new FormData(); form.set("taskId", task.id); form.set("file", file); await api("/api/workflow-task-files", { method: "POST", body: form }); } } if (!local) await load(); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  async function removeAllAttachments() {
    const items = task.attachments ?? [];
    if (!task.id || !items.length || !(await confirm({ title: "Ta bort alla bilagor?", message: `${items.length} ${items.length === 1 ? "bilaga" : "bilagor"} tas bort från uppgiften. Bilder som valts i formuläret försvinner därifrån.`, confirmLabel: "Ta bort alla", tone: "danger" }))) return;
    setBusy(true); setError("");
    try { for (const item of items) { if (local?.removeAttachment) await local.removeAttachment(task.id, item.id); else await api(`/api/workflow-task-files/${encodeURIComponent(item.id)}`, { method: "DELETE" }); } if (!local) await load(); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  // A picture taken inside the form (2026-09-26): the protocol is saved first, so a new protocol gets its id
  // and nothing typed is lost, then the file becomes an attachment and its id is placed in the form.
  const formMedia: FormMedia = {
    thumbnail: local ? undefined : (attachmentId) => `/api/workflow-task-files/${encodeURIComponent(attachmentId)}`,
    upload: async (file) => {
      const id = await save();
      if (!id) return null;
      if (local?.upload) return (await local.upload(id, file)) || null;
      const form = new FormData(); form.set("taskId", id); form.set("file", file);
      const created = await api<{ id: string }>("/api/workflow-task-files", { method: "POST", body: form });
      // Only the attachments are refreshed (by the saved id – a new protocol's id is not in this render yet), so
      // nothing typed meanwhile is replaced.
      const fresh = (await api<{ tasks: WorkflowTaskRecord[] }>(`/api/workflow-tasks?id=${encodeURIComponent(id)}`)).tasks.find((item) => item.id === id);
      if (fresh) setTask((current) => ({ ...current, id, version: fresh.version, attachments: fresh.attachments }));
      return created.id;
    },
  };
  async function removeAttachment(id: string) {
    if (preview) return;
    setBusy(true); setError("");
    try { if (local?.removeAttachment) await local.removeAttachment(task.id, id); else await api(`/api/workflow-task-files/${encodeURIComponent(id)}`, { method: "DELETE" }); if (!local) await load(); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  async function exportReport(options: WorkflowReportOptions, _selected?: unknown, variant: ReportVariant = "pdf", show = false) {
    // The builder's preview draws the PDF from the answers on screen; Excel needs a saved protocol.
    if (preview) {
      if (variant === "xlsx" || variant === "xlsx-blank" || task.data.kind !== "FORM") { setMessage("Excel finns när protokollet är sparat."); return; }
      openFormPreviewPdf({ meta: { name: preview.name }, document: task.data.details.document, values: task.data.details.values, blank: variant === "blank" });
      return;
    }
    const blank = variant === "blank" || variant === "xlsx-blank";
    const excel = variant === "xlsx" || variant === "xlsx-blank";
    // An empty template needs no saved protocol (2026-09-28): Local draws it from the form on screen, Cloud from
    // the published version. A report of the answers saves an unsaved protocol first, like starting the timer does.
    if (blank && !local && task.data.kind === "FORM") {
      const url = `/api/forms/blank?id=${encodeURIComponent(task.data.details.templateId)}&version=${task.data.details.templateVersion}${excel ? "&format=xlsx" : ""}`;
      if (show) { window.open(`${url}&inline=1`, "_blank", "noopener"); return; }
      const link = document.createElement("a"); link.href = url; link.download = ""; link.click();
      return;
    }
    // A report of the answers is a snapshot of what is on screen (2026-09-30): nothing is saved, so no draft is
    // left behind, and unsaved changes are included. A saved protocol lends its pictures and reported time.
    const snapshotTask = { ...task, title: task.title.trim() || (task.data.kind === "FORM" ? task.data.details.templateName : "") || "Uppgift", customerId: selectedProject?.customerId ?? task.customerId };
    if (local?.report) return local.report(snapshotTask, options, variant);
    if (!blank) {
      const sections = Object.entries(options).filter(([, included]) => included).map(([key]) => key).join(",");
      const payload = JSON.stringify({ task: { ...snapshotTask, id: task.id || undefined }, format: excel ? "xlsx" : "pdf", inline: show, sections });
      // Förhandsgranska opens in a new tab (a form post keeps it a normal page); PDF and Excel download.
      if (show) {
        const post = document.createElement("form");
        post.method = "POST";
        post.action = "/api/workflow-tasks/snapshot-report";
        post.target = "_blank";
        const field = document.createElement("input");
        field.type = "hidden";
        field.name = "payload";
        field.value = payload;
        post.append(field);
        document.body.append(post);
        post.submit();
        post.remove();
        return;
      }
      setBusy(true);
      try {
        const body = new FormData();
        body.set("payload", payload);
        const response = await fetch("/api/workflow-tasks/snapshot-report", { method: "POST", body });
        if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "Rapporten kunde inte skapas.");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(await response.blob());
        link.download = `${snapshotTask.title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")}${excel ? ".xlsx" : "-rapport.pdf"}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
      return;
    }
    const id = task.id || await save();
    if (!id) return;
    const sections = Object.entries(options).filter(([, included]) => included).map(([key]) => key).join(",");
    const url = `/api/workflow-tasks/${encodeURIComponent(id)}/report?sections=${encodeURIComponent(sections)}${excel ? "&format=xlsx" : ""}${blank ? "&blank=1" : ""}`;
    // "Förhandsgranska" opens the PDF in a new tab to read or print, like the control; the others download.
    if (show) { window.open(`${url}&inline=1`, "_blank", "noopener"); return; }
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    link.click();
  }

  if (kind === "FORM" && !taskId && task.data.kind !== "FORM") return <Panel title="Nytt protokoll">
    <p role={formError ? "alert" : "status"} className={formError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{formError || (formId ? "Hämtar formuläret…" : "Välj formuläret under Ny uppgift.")}</p>
    {formError || !formId ? <Button variant="outline" className="mt-4" onClick={() => router.push("/?view=new_task")}>Till Ny uppgift</Button> : null}
  </Panel>;
  const customerName = customers.find((customer) => customer.id === (customerLocked ? selectedProject?.customerId : task.customerId))?.name ?? "";
  const chooseCustomer = (customer: CustomerItem | null) => setTask((current) => {
    const next = { ...current, customerId: customer?.id ?? null, facilityId: null };
    if (next.data.kind !== "FORM") return next;
    const source: FormPrefillSource = customer ? { customer: customer.company || customer.name, contact: customer.name, email: customer.email } : { customer: "", contact: "", email: "" };
    const values = applyFormPrefill(next.data.details.document, next.data.details.values, source, { kinds: ["customer", "contact", "email"], overwrite: true });
    return titled({ ...next, data: { ...next.data, details: { ...next.data.details, values } } });
  });
  const projectSelect = <select className="form-select" value={task.projectId ?? ""} disabled={Boolean(task.id) || (kind === "FORM" && form?.allowInProject === false)} title={task.id ? "Byt projekt via projektets Koppla befintlig uppgift." : undefined} onChange={(e) => { const next = projects.find((project) => project.id === e.target.value); setTask(prefilled(task.id ? { ...task, projectId: next?.id ?? null, customerId: next?.customerId ?? task.customerId } : inherit({ ...task, dueDate: "" }, next), ["project", "facility", "customer", "contact", "email"], true)); }}><option value="">Fristående uppgift</option>{projects.filter((project) => (!project.archivedAt && !project.closedAt) || project.id === task.projectId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>;
  const inlineSlots: FormTaskInline | undefined = inlineTask ? {
    top: projects.length ? <label className="block space-y-1 text-xs text-muted-foreground">{kind === "FORM" && form?.allowStandalone === false ? "Projektkoppling (krävs)" : "Projektkoppling (valfri)"}{projectSelect}</label> : null,
    beside: { contact: <>
      <Button type="button" variant="outline" size="icon" className="customer-link-button h-10 w-10 shrink-0" disabled={customerLocked || task.status === "COMPLETED"} aria-label="Välj eller skapa kund" title={customerLocked ? `Kopplad kund: ${customerName} (följer projektet)` : task.customerId ? `Kopplad kund: ${customerName}` : "Välj eller skapa kund"} onClick={() => setCustomerPicker(true)}><Users /></Button>
      {task.customerId && !customerLocked && task.status !== "COMPLETED" ? <Button type="button" variant="outline" size="icon" className="customer-link-button h-10 w-10 shrink-0" aria-label="Ta bort kundkoppling" onClick={() => chooseCustomer(null)}><Trash2 /></Button> : null}
    </> },
    after: !local && sites.length ? <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs text-muted-foreground">Plats (valfri)<select aria-label="Plats" className="form-select" value={task.siteId || ""} onChange={(e) => setTask({ ...task, siteId: e.target.value || null, departmentId: null })}><option value="">Ingen plats</option>{sites.filter((site) => site.isActive || site.id === task.siteId).map((site) => <option key={site.id} value={site.id}>{site.name}{!site.isActive && " (pausad)"}</option>)}</select></label>
      <label className="space-y-1 text-xs text-muted-foreground">Avdelning (valfri)<select aria-label="Avdelning" className="form-select" value={task.departmentId || ""} disabled={!task.siteId} onChange={(e) => setTask({ ...task, departmentId: e.target.value || null })}><option value="">Ingen avdelning</option>{selectedSite?.departments.filter((department) => department.isActive || department.id === task.departmentId).map((department) => <option key={department.id} value={department.id}>{department.name}{!department.isActive && " (pausad)"}</option>)}</select></label>
    </div> : null,
  } : undefined;
  // The task's pictures and documents exactly like the control's panel (2026-09-28): cards with the picture, the
  // file name and its size; Lägg till fil in the header from the moment the task is saved; before the summary when the
  // form has one, like the control's, otherwise after the form.
  const attachments = task.attachments ?? [];
  const attachmentsPanel = <Panel title="Bilder och dokument" description={`Högst ${workflowTaskAttachmentLimit(task.kind)} bilder eller dokument. Max 10 MB per fil.${task.kind === "FORM" && !inlineTask ? " Bilder som tas i formuläret hamnar också här." : ""}`}
    actions={<Button type="button" variant="outline" disabled={busy || task.status === "COMPLETED" || !task.id || Boolean(preview)} title={!task.id ? "Spara uppgiften först." : undefined} onClick={() => attachmentInput.current?.click()}><Upload />Lägg till fil</Button>}>
    <input ref={attachmentInput} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,.docx,.xlsx" className="sr-only" aria-label="Ladda upp bilaga" disabled={busy || task.status === "COMPLETED" || !task.id} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void upload(files); }} />
    {attachments.length ? <Button type="button" variant="ghost" className="mb-4 text-destructive" disabled={busy || task.status === "COMPLETED"} onClick={() => void removeAllAttachments()}><Trash2 />Ta bort alla bilagor</Button> : null}
    {!attachments.length ? <p className="text-sm text-muted-foreground">Inga bilagor tillagda.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{attachments.map((attachment) => {
      const url = local ? null : `/api/workflow-task-files/${encodeURIComponent(attachment.id)}`;
      return <div key={attachment.id} className="overflow-hidden rounded-lg border">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private attachment behind the session, not a static asset */}
        {url && attachment.mimeType.startsWith("image/") ? <a href={url} target="_blank" rel="noreferrer" className="block w-full" aria-label={`Visa ${attachment.filename}`}><img src={url} alt={attachment.filename} className="h-36 w-full object-cover" /></a> : null}
        <div className="flex items-start justify-between gap-2 p-3">
          <div className="min-w-0">
            {local?.openAttachment || !url ? <button type="button" className="block max-w-full truncate text-sm font-medium hover:underline" aria-label={`Öppna ${attachment.filename}`} onClick={() => void local?.openAttachment?.(attachment.id)}>{attachment.filename}</button>
              : <a href={url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline" aria-label={`Öppna ${attachment.filename}`}>{attachment.filename}</a>}
            <p className="mt-1 text-xs text-muted-foreground">{Math.ceil(attachment.size / 1024)} kB · {formatSwedish(attachment.createdAt, { dateStyle: "medium" })}</p>
          </div>
          <Button size="icon" variant="ghost" aria-label={`Ta bort ${attachment.filename}`} disabled={busy || task.status === "COMPLETED"} onClick={() => void removeAttachment(attachment.id)}><Trash2 /></Button>
        </div>
      </div>;
    })}</div>}
  </Panel>;
  const formHasSummary = task.data.kind === "FORM" && task.data.details.document.blocks.some((block) => block.type === "section" && sectionHasSummary(block));
  // The control's Historik and Färdigställ at the foot of Sammanfattning, and its Rapport och hantering after the form.
  // Completing opens one dialog that also asks "Vill du skriva tid?" (2026-09-30); what is missing is shown first.
  // Slutför is never a dead button (2026-10-01: "jag klickar på den grå knappen och inget händer"): with
  // something missing it leads to the first missing field, marked light red, and says what to do; an unsaved task is
  // saved first.
  const complete = async () => {
    if (!completion.ready) {
      const issue = completion.issues[0];
      // Said once, in the toast, while the page moves to the field; the list under Slutför shows all that is left.
      setMessage(""); setError("");
      focusRequirement(issue.field, `Kvar före slutförande: ${issue.message}${completion.issues.length > 1 ? ` (och ${completion.issues.length - 1} till)` : ""}`);
      return;
    }
    if (!task.id && !(await save())) return;
    setCompleteOpen(true);
  };
  const completeWith = async (time: CompletionTime | null): Promise<boolean | string> => {
    lastError.current = "";
    return (await save("COMPLETED", time)) ? true : lastError.current || "Uppgiften kunde inte slutföras.";
  };
  // Rows of a protocol that are meant to be followed up as work orders but have none yet, named in the dialog.
  const rowsWithoutOrder = task.data.kind === "FORM" ? formRowsWithoutOrder(task.data.details.document, task.data.details.values) : 0;
  // HINTEK AI's proposed measures for a risk assessment form (2026-10-02): the table with a hazard and a measure column.
  // Only rows with a hazard and no measure are offered; a proposal is put in – and undone – on the newest values.
  const riskTable = task.data.kind === "FORM" ? formLeafBlocks(task.data.details.document).find((block): block is FormTableBlock => block.type === "table" && ["fara", "atgard"].every((key) => block.columns.some((column) => column.key === key))) ?? null : null;
  const cellText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const scaleValue = (value: unknown) => Math.min(5, Math.max(1, Math.round(Number(value)) || 1));
  const risksWithoutMeasure = riskTable && task.data.kind === "FORM"
    ? (task.data.details.values.tables[riskTable.key] ?? []).filter((row) => !row.example && cellText(row.cells.fara) && !cellText(row.cells.atgard)).slice(0, 40)
      .map((row) => ({ id: row.id, hazard: cellText(row.cells.fara).slice(0, 500), likelihood: scaleValue(row.cells.sannolikhet), consequence: scaleValue(row.cells.konsekvens) }))
    : [];
  const applyRiskMeasures = (measures: { riskId: string; measure: string }[]) => {
    const key = riskTable?.key ?? "";
    const write = (pick: (row: { id: string; cells: Record<string, unknown> }) => string | null) => {
      const now = latestTask.current;
      if (now.data.kind !== "FORM") return;
      const values = now.data.details.values;
      setTask({ ...now, data: { ...now.data, details: { ...now.data.details, values: { ...values, tables: { ...values.tables, [key]: (values.tables[key] ?? []).map((row) => { const next = pick(row); return next === null ? row : { ...row, cells: { ...row.cells, atgard: next } }; }) } } } } });
    };
    // Only fields that are still empty are filled; undo empties only the ones that still hold the proposed text.
    const filled = new Map<string, string>();
    write((row) => { const item = measures.find((candidate) => candidate.riskId === row.id); if (!item || cellText(row.cells.atgard)) return null; filled.set(row.id, item.measure); return item.measure; });
    return () => write((row) => (filled.has(row.id) && row.cells.atgard === filled.get(row.id) ? "" : null));
  };
  // A follow-up work order from a saved task (2026-09-30): the task's project, customer, facility and place come along
  // and the work order links back to it.
  async function createFollowUp() {
    if (!task.id || busy) return;
    const order = { id: undefined, version: 0, kind: "WORK_ORDER", title: `Åtgärd: ${task.title}`.slice(0, 200), description: `Uppföljning av ${task.data.kind === "FORM" ? task.data.details.templateName.toLowerCase() : "riskbedömningen"} ${task.title}.`.slice(0, 5000), status: "PLANNED", progress: 0,
      projectId: task.projectId, customerId: selectedProject?.customerId ?? task.customerId, facilityId: task.facilityId ?? null, siteId: task.siteId, departmentId: task.departmentId,
      assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, dueDate: "", data: { kind: "WORK_ORDER", details: { ...(emptyData("WORK_ORDER", null).details as object), source: { taskId: task.id, title: task.title.slice(0, 200), kind: task.kind } } }, totalDurationSec: 0, timerRunning: false } as unknown as WorkflowTaskRecord;
    setBusy(true); setError("");
    try {
      const result = local ? await local.save(order) : await api<{ id: string }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "save", task: order }) });
      router.push(`/?view=workflow_task&taskId=${encodeURIComponent(result.id)}&taskType=WORK_ORDER`);
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  // Historik and Färdigställ: at the foot of the form's own Sammanfattning when it has one, otherwise in the foot panel.
  const completeRow = <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
    <Button type="button" variant="outline" disabled={!task.id || busy} onClick={() => setHistoryOpen(true)}><History />Historik</Button>
    <Button id="task-complete" type="button" disabled={busy || task.status === "COMPLETED" || frozen} className={completion.ready ? undefined : "opacity-60"} title={completion.ready ? "Färdigställ och lås protokollet" : `Klicka för att se vad som saknas: ${completion.issues[0]?.message ?? ""}`} onClick={() => void complete()}><CheckCircle2 />Färdigställ</Button>
  </div>;
  const summaryFoot = Boolean(inlineSlots) && formHasSummary;
  if (inlineSlots) {
    inlineSlots.beforeSummary = formHasSummary ? attachmentsPanel : undefined;
    inlineSlots.summaryFooter = completeRow;
  }
  // A control without its own Sammanfattning gets the same completion card and buttons in a panel of their own.
  // A work order's or risk assessment's own completion (workflowTaskCompletion) is adapted to the card's shape; a
  // protocol keeps using the form's own, richer one (its totals and switched-off sections read the same as always).
  const genericCompletion: CompletionCardSummary = { requirements: completion.requirements.map((item) => ({ blockId: item.field, message: item.message, met: item.met })), issues: completion.issues.map((item) => ({ blockId: item.field, message: item.message, met: false })), ready: completion.ready, percent: completion.progress };
  const completePanel = controlFoot && !summaryFoot ? <Panel title="Färdigställ" description={`Se vad som återstår och färdigställ ${docWord.toLowerCase()} när ${isForm ? "det" : "den"} är klar${isForm ? "t" : ""}.`}>
    {task.status === "COMPLETED" ? <p className="text-sm text-muted-foreground">{docWord} är {isForm ? "färdigställt" : "slutförd"} och låst.{reopenable ? ` Öppna ${isForm ? "det" : "den"} igen med Återöppna om ${isForm ? "det" : "den"} behöver ändras.` : " Fortsätt i en kopia med Spara som."}</p> : <CompletionCard completion={task.data.kind === "FORM" ? formCompletion(task.data.details.document, task.data.details.values) : genericCompletion} onFocusIssue={(blockId) => focusRequirement(isForm ? `form-${blockId}` : blockId)} />}
    {completeRow}
  </Panel> : null;
  // The saved protocol's report as a PDF to one recipient; an unsaved or changed protocol is saved first.
  const openSend = () => {
    if (!recipient && task.data.kind === "FORM") {
      const field = formLeafBlocks(task.data.details.document).find((block) => block.type === "field" && block.prefill === "email");
      const fromForm = field && field.type === "field" ? String(task.data.details.values.fields[field.key] ?? "").trim() : "";
      setRecipient(fromForm || customers.find((customer) => customer.id === (selectedProject?.customerId ?? task.customerId))?.email || "");
    }
    setSendOpen(true);
  };
  const send = async () => {
    if (preview) { setSendOpen(false); setMessage(PREVIEW_MESSAGE); return; }
    // A completed protocol is locked and already saved.
    const id = task.status === "COMPLETED" ? task.id : await save();
    if (!id) { setSendOpen(false); return; }
    setBusy(true);
    try {
      await api(`/api/workflow-tasks/${encodeURIComponent(id)}/send`, { method: "POST", body: JSON.stringify({ email: recipient.trim(), ...(sendNote.trim() ? { message: sendNote.trim() } : {}) }) });
      setSendOpen(false); setSendNote("");
      announce(`Rapporten är skickad till ${recipient.trim()}.`);
    } catch (issue) { announce((issue as Error).message, true); } finally { setBusy(false); }
  };
  const reportPanel = controlFoot ? <Panel key="report" title="Rapport och hantering" description={`Rapport, export${isForm ? ", tomma mallar" : ""} och utskick av ${docWord.toLowerCase()}.`} className="report-panel" collapsible defaultCollapsed
    persistentContent={<div className="flex flex-wrap items-center gap-2">
      <ReportOptionsButton kind={task.kind} disabled={busy} onExport={exportReport} />
      <Button type="button" variant="outline" data-testid="task-send-mail" disabled={busy || Boolean(local) || !task.title.trim() || titleFieldEmpty} title={local ? "Kan inte skicka i lokalt läge. Exportera rapporten och skicka den själv." : undefined} onClick={openSend}><Send />Skicka med e-post</Button>
    </div>}>
    <p className="text-xs leading-5 text-muted-foreground">{local ? "Rapporter skapas på den här datorn. Ett osparat protokoll sparas i arbetsytan när rapporten skapas; tomma mallar kan tas ut när som helst. E-post skickas inte i lokalt läge – exportera rapporten och skicka den själv." : "Tomma mallar kan tas ut när som helst. Skicka med e-post sparar protokollet och skickar rapporten som PDF till mottagaren. Rapporten ritas med företagets färger och logotyp."}</p>
  </Panel> : null;
  const formDocument = task.data.kind === "FORM" ? task.data.details.document : null;
  // A deviation row becomes a work order in the same project and customer (2026-09-28); the row keeps its id.
  const formActions: FormActions | undefined = preview ? undefined : {
    openWorkOrder: (id) => router.push(`/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=WORK_ORDER`),
    workOrderStatus: (id) => linkedOrders[id] ? { status: linkedOrders[id].status, label: statusLabels[linkedOrders[id].status as WorkflowTaskStatus] ?? linkedOrders[id].status } : undefined,
    canCreateWorkOrder: Boolean(task.id),
    createWorkOrder: async ({ title, description, assignedToName = "", dueDate = "" }) => {
      // The work order links back to a saved protocol (2026-10-02: the button waits for the first save, so no order is
      // left without its link and a second press cannot make a duplicate), and its Nästa steg leads back here.
      const protocolId = task.id;
      if (!protocolId) return null;
      const base = emptyData("WORK_ORDER", null);
      const member = members.find((item) => item.name.trim().toLowerCase() === assignedToName.trim().toLowerCase());
      const order = { id: undefined, version: 0, kind: "WORK_ORDER", title, description: `${description}${description ? "\n\n" : ""}Från ${task.title || "protokollet"}.`.slice(0, 5000), status: "PLANNED", progress: 0,
        projectId: task.projectId, customerId: selectedProject?.customerId ?? task.customerId, facilityId: task.facilityId ?? null, siteId: task.siteId, departmentId: task.departmentId,
        assignedToUserId: member?.id ?? null, assignedToName: member?.name ?? assignedToName, dueDate, data: { kind: "WORK_ORDER", details: { ...(base.details as object), source: { taskId: protocolId, title: task.title.slice(0, 200), kind: "FORM" } } }, totalDurationSec: 0, timerRunning: false } as unknown as WorkflowTaskRecord;
      try {
        const result = local ? await local.save(order) : await api<{ id: string }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "save", task: order }) });
        setMessage("Arbetsordern är skapad och kopplad till raden. Spara protokollet så sparas kopplingen.");
        return result.id;
      } catch (issue) { setError((issue as Error).message); return null; }
    },
  };
  // The progress line (2026-10-01): the steps of this kind of task, from the same rules as progress and Slutför.
  const flow = task.data.kind === "WORK_ORDER"
    ? workOrderFlow({ saved: Boolean(task.id), title: task.title, status: task.status, assigned: Boolean(task.assignedToUserId || task.assignedToName.trim()), dueDate: task.dueDate, timerRunning: task.timerRunning, totalDurationSec: task.totalDurationSec, executionNotes: task.data.details.executionNotes, signatureName: task.data.details.signature.name, signatureConfirmed: task.data.details.signature.confirmed })
    : task.data.kind === "RISK_ASSESSMENT"
      ? riskFlow({ saved: Boolean(task.id), title: task.title, status: task.status, risks: task.data.details.risks, approvalName: task.data.details.approval.name, approvalConfirmed: task.data.details.approval.confirmed })
      : formFlow({ saved: Boolean(task.id), title: titleFieldEmpty ? "" : task.title, status: task.status, issues: completion.issues, signatureBlocks: formLeafBlocks(task.data.details.document).filter((block) => block.type === "signature").map((block) => block.id), titleFieldLabel: titleField && "label" in titleField ? titleField.label : undefined,
        moments: formMoments(task.data.details.document, task.data.details.values) });
  const flowGuide = <FlowGuide flow={flow} page={task.id || `new-${kind}`} missing={completion.issues.map((issue) => issue.message)}
    pageLabel={task.data.kind === "FORM" ? task.data.details.templateName : kind === "WORK_ORDER" ? "Arbetsorder" : "Riskbedömning"}
    advisor={preview ? undefined : {
      kind: task.data.kind, currentTaskId: task.id, saved: Boolean(task.id), completed: task.status === "COMPLETED", today: swedishDayKey(new Date()), dueDate: task.dueDate,
      unsavedNew: !task.id && Boolean(task.title.trim()) && !titleFieldEmpty, timerAvailable: true, timerRunning: task.timerRunning, totalDurationSec: task.totalDurationSec,
      deviationsNoted: task.data.kind === "WORK_ORDER" && Boolean(task.data.details.deviations.trim()), rowsWithoutOrder,
      highResidualRisks: task.data.kind === "RISK_ASSESSMENT" ? task.data.details.risks.filter((risk) => risk.residualLikelihood * risk.residualConsequence >= 10).length : 0,
    }}
    handlers={{ startTimer: () => void timer("START"), complete: () => void complete(), save: () => void save() }} />;
  return <div className="space-y-6">
    {confirmCard}
    {inlineTask ? <CustomerPicker open={customerPicker} onOpenChange={setCustomerPicker} onSelect={(customer) => { chooseCustomer(customer); setCustomerPicker(false); }} localCustomers={local || preview ? customers : undefined} /> : null}
    <EditorHeader
      // A control or risk assessment made as a form reads as what it is, not as "Formulär" (2026-09-27); the
      // heading of a new protocol, the status and the line under it follow the form, exactly like the originals (2026-09-28).
      eyebrow={task.data.kind === "FORM" ? `${(task.formArea ?? form?.area ?? "forms") === "forms" ? "Formulär · " : ""}${task.data.details.templateName}` : kind === "WORK_ORDER" ? "Arbetsorder" : "Riskbedömning"}
      title={task.id ? task.title : formDocument ? formDocument.task.newTitle || `Nytt protokoll: ${task.data.kind === "FORM" ? task.data.details.templateName : ""}` : kind === "WORK_ORDER" ? "Ny arbetsorder" : "Ny riskbedömning"}
      status={inlineTask ? (task.status === "COMPLETED" ? "COMPLETED" : "DRAFT") : task.status}
      statusLabel={inlineTask ? (task.status === "COMPLETED" ? "Färdigställd" : "Utkast") : statusLabels[task.status]}
      progress={workflowTaskProgress(task)}
      detail={<span>{task.id ? `Version ${task.version}${savedAt ? ` · Sparad ${savedAt}` : ""}` : formDocument?.task.tagline || "Skapa uppgiften fristående eller koppla den till ett projekt."}</span>}
      facts={headerFacts}
      timer={{
        running: task.timerRunning,
        totalDurationSec: task.totalDurationSec,
        onToggle: () => void timer(task.timerRunning ? "PAUSE" : "START"),
        disabled: busy || task.status === "COMPLETED" || frozen || !task.title.trim() || titleFieldEmpty || (Boolean(local) && !task.id),
        hint: task.status === "COMPLETED" ? "En slutförd uppgift kan inte tidrapporteras." : titleFieldEmpty && titleField && "label" in titleField ? `Ange ${titleField.label.toLowerCase()} först, så sparas protokollet när tiden startar.` : !task.title.trim() ? "Ange en rubrik först, så sparas uppgiften när tiden startar." : "Spara uppgiften innan tidrapporteringen startas.",
      }}
      actions={<>
        {/* A completed control is never reopened; it is continued with Spara som (2026-09-27). */}
        {task.status === "COMPLETED" && task.formArea !== "kfid" ? <Button variant="outline" disabled={busy} onClick={() => void reopen()}><RotateCcw />Återöppna</Button> : null}
        {/* Spara som copies a saved protocol; the control's header shows it from the start, so an unsaved one just saves. */}
        {task.id && task.kind !== "WORK_ORDER" && !preview ? <Button variant="outline" disabled={busy} onClick={() => void createFollowUp()} title="Ny arbetsorder med uppgiftens projekt, kund och anläggning"><Wrench />Skapa arbetsorder</Button> : null}
        {/* HINTEK AI words a work order from the saved task's deviations; nothing is created until the person confirms. */}
        {task.id && !preview && !local && WorkOrderProposal ? <WorkOrderProposal taskId={task.id} task={task as unknown as Record<string, unknown>} disabled={busy} /> : null}
        {/* Granska med AI: a second pair of eyes on a saved protocol with results; it changes nothing. */}
        {task.id && task.data.kind === "FORM" && !preview && !local && ProtocolReview && formHasContent(task.data.details.values) ? <ProtocolReview taskId={task.id} disabled={busy} /> : null}
        {/* … and a measure for each risk of a risk assessment form that has none yet. */}
        {riskTable && !preview && !local && task.status !== "COMPLETED" && RiskMeasuresAssist ? <RiskMeasuresAssist title={task.title} taskId={task.id || undefined} risks={risksWithoutMeasure} onApply={applyRiskMeasures} disabled={busy} /> : null}
        {task.data.kind === "FORM" && (task.id || inlineTask) ? <Button variant="outline" disabled={busy} onClick={() => { if (task.id) router.push(`/?view=workflow_task&taskType=FORM&formId=${encodeURIComponent(task.data.kind === "FORM" ? task.data.details.templateId : "")}&copyOf=${encodeURIComponent(task.id)}`); else void save(); }}><Copy />Spara som</Button> : null}
      </>}
      primaryAction={<Button disabled={busy || task.status === "COMPLETED" || frozen || !task.title.trim()} onClick={() => void save()}><Save />{busy ? "Arbetar…" : "Spara"}</Button>}
      flow={flowGuide}
    />
    {(error || message) && <p role={error ? "alert" : "status"} className={error ? "notice text-destructive" : "notice"}>{error || message}</p>}
    {error && /har ändrats/i.test(error) && task.id && !local ? <div className="notice space-y-2" data-testid="task-conflict">
      <p className="text-sm">Din version är kvar här tills du läser in den senaste. Kopiera det du skrivit först om du vill behålla det.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(task.data.details, null, 2)).then(() => setMessage("Din version är kopierad."))}>Kopiera min version</Button><Button type="button" size="sm" onClick={() => { baseline.current = null; setError(""); void load(); }}>Läs in senaste</Button></div>
    </div> : null}
    {task.status === "COMPLETED" && task.id && !preview ? <NextSteps task={task} projectName={selectedProject?.name} source={task.data.kind === "WORK_ORDER" ? task.data.details.source ?? null : null}
      localTasks={local?.tasks} onCreateWorkOrder={task.kind !== "WORK_ORDER" ? () => void createFollowUp() : undefined} /> : null}
    <CompleteTaskDialog open={completeOpen} onOpenChange={setCompleteOpen} title={`Färdigställ ${docWord.toLowerCase()}`}
      lockText={`${isForm ? "Protokollet låses för ändringar; du kan senare skapa en kopia med Spara som." : `${docWord} låses för ändringar och sparas i historiken.${reopenable ? " Återöppna den vid behov." : ""}`}${rowsWithoutOrder ? ` ${rowsWithoutOrder === 1 ? "En rad" : `${rowsWithoutOrder} rader`} som kan följas upp saknar arbetsorder; skapa den på raden först om den behövs.` : ""}`}
      totalDurationSec={task.totalDurationSec} timerRunning={task.timerRunning} canReportTime={!preview} onComplete={completeWith} />
    {/* The content sits in an ordinary block inside the fieldset: Chromium sometimes left the form renderer (a container
        query container) without layout when it was a direct child of the fieldset's anonymous content box – an empty
        form after starting a round (2026-09-29, tmp repro 3 of 30). */}
    {frozen ? <div className="notice" data-testid="task-project-frozen">Projektet {selectedProject?.archivedAt ? "är arkiverat" : "är avslutat"}, så uppgiften är skrivskyddad. Återställ eller återöppna projektet för att arbeta vidare.</div> : null}
    <fieldset disabled={busy || task.status === "COMPLETED" || frozen} className="min-w-0">
    <div className="min-w-0 space-y-6">
    {selectedProject && projectFieldRows(selectedProject).length ? <Panel key={`project-facts-${detailLevel}`} collapsible defaultCollapsed={detailLevel < 3} title="Projektets uppgifter" description={`Från projektet ${selectedProject.name}. Ändras i projektet och skrivs ut i rapporten.`} actions={preview ? undefined : <Button asChild variant="outline"><Link href={`/?view=project&projectId=${encodeURIComponent(selectedProject.id)}`} data-testid="task-open-project"><FolderKanban />Öppna projektet</Link></Button>}><dl data-testid="task-project-fields" className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">{projectFieldRows(selectedProject).map(([label, value]) => <div key={label} className={label === "Arbetsbeskrivning" ? "sm:col-span-2 xl:col-span-4" : undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap">{value}</dd></div>)}</dl></Panel> : null}
    {inlineTask ? null : <Panel title="Grunduppgifter" description="Projekt, kund, plats, ansvarig och planering återanvänds i arbetsflödet.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Rubrik<Input id="task-title" value={task.title} maxLength={200} onChange={(e) => setTask({ ...task, title: e.target.value })} /></label>
        <label className="space-y-2 text-xs font-medium text-muted-foreground" title={task.id ? "Byt projekt via projektets Koppla befintlig uppgift." : undefined}>{kind === "FORM" && form?.allowStandalone === false ? "Projekt (krävs för det här formuläret)" : "Projekt (valfritt)"}{task.id ? <span className="ml-1 font-normal">· byts via projektets Koppla</span> : null}<select className="form-select" value={task.projectId ?? ""} disabled={Boolean(task.id) || (kind === "FORM" && form?.allowInProject === false)} onChange={(e) => { const next = projects.find((project) => project.id === e.target.value); setTask(prefilled(task.id ? { ...task, projectId: next?.id ?? null, customerId: next?.customerId ?? task.customerId } : inherit({ ...task, dueDate: "" }, next), ["project", "facility", "customer", "contact", "email"], true)); }}><option value="">Fristående uppgift</option>{projects.filter((project) => (!project.archivedAt && !project.closedAt) || project.id === task.projectId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="space-y-2 text-xs font-medium text-muted-foreground">{customerLocked ? "Kund (från projektet)" : "Kund (valfritt)"}<select className="form-select" value={(customerLocked ? selectedProject?.customerId : task.customerId) ?? ""} disabled={customerLocked} title={customerLocked ? "Kunden följer projektet." : undefined} onChange={(e) => setTask(prefilled({ ...task, customerId: e.target.value || null, facilityId: null }, ["customer", "contact", "email", "facility"], true))}><option value="">Ingen kund</option>{/* Customer choices are read on demand; keep the current value visible meanwhile. */}{(customerLocked ? selectedProject?.customerId : task.customerId) && !customers.some((customer) => customer.id === (customerLocked ? selectedProject?.customerId : task.customerId)) ? <option value={(customerLocked ? selectedProject?.customerId : task.customerId) ?? ""}>Hämtar kund…</option> : null}{customers.filter((customer) => !customer.deletedAt || customer.id === task.customerId).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
        <CustomerSearchBox enabled={!local && !customerLocked} onPick={(customer) => setTask(prefilled({ ...task, customerId: customer.id, facilityId: null }, ["customer"], true))} />
        {facilityCustomerId ? <label className="space-y-2 text-xs font-medium text-muted-foreground">Kundens anläggning (valfri)<select className="form-select" value={task.facilityId ?? ""} onChange={(e) => setTask(prefilled({ ...task, facilityId: e.target.value || null }, ["facility"], true))}><option value="">Ingen anläggning</option>{task.facilityId && !facilityOptions.some((facility) => facility.id === task.facilityId) ? <option value={task.facilityId}>{customers.length ? "Anläggningen finns inte längre" : "Hämtar anläggning…"}</option> : null}{facilityOptions.map((facility) => <option key={facility.id} value={facility.id}>{facilityLabel(facility)}{facility.isActive ? "" : " (pausad)"}</option>)}</select></label> : null}
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Plats (valfri)<select className="form-select" value={task.siteId ?? ""} onChange={(e) => setTask({ ...task, siteId: e.target.value || null, departmentId: null })}><option value="">Ingen plats</option>{sites.filter((site) => site.isActive || site.id === task.siteId).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Avdelning (valfri)<select className="form-select" value={task.departmentId ?? ""} disabled={!task.siteId} onChange={(e) => setTask({ ...task, departmentId: e.target.value || null })}><option value="">Ingen avdelning</option>{selectedSite?.departments.filter((department) => department.isActive || department.id === task.departmentId).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        {members.length ? <label className="space-y-2 text-xs font-medium text-muted-foreground">Ansvarig<select className="form-select" value={task.assignedToUserId ?? ""} onChange={(e) => { const member = members.find((item) => item.id === e.target.value); setTask(prefilled({ ...task, assignedToUserId: member?.id ?? null, assignedToName: member?.name ?? "" }, ["assignee"])); }}><option value="">Inte tilldelad</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label> : <label className="space-y-2 text-xs font-medium text-muted-foreground">Ansvarig<Input value={task.assignedToName} onChange={(e) => setTask({ ...task, assignedToName: e.target.value, assignedToUserId: null })} /></label>}
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Klart senast<Input id="task-due-date" type="date" value={task.dueDate} min={selectedProject?.startDate || undefined} max={selectedProject?.startDate ? selectedProject.dueDate || undefined : undefined} aria-invalid={dueDateError ? true : undefined} aria-describedby={dueDateError ? "task-due-date-error" : undefined} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} />{dueDateError ? <span id="task-due-date-error" className="block font-normal text-destructive">{dueDateError}</span> : null}</label>
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Status<select className="form-select" value={task.status} disabled={task.status === "COMPLETED"} onChange={(e) => setTask({ ...task, status: e.target.value as WorkflowTaskStatus })}>{Object.entries(statusLabels).filter(([value]) => value !== "COMPLETED" || task.status === "COMPLETED").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <label className="mt-4 block space-y-2 text-xs font-medium text-muted-foreground">Beskrivning<textarea aria-label="Beskrivning" className="form-textarea" value={task.description} maxLength={5000} onChange={(e) => setTask({ ...task, description: e.target.value })} /></label>
    </Panel>}
    {/* Earlier protocols and trends inform; visningsnivå 1 leaves them out on a phone or tablet. */}
    {task.data.kind === "FORM" ? <div data-detail-min="2" className="empty:hidden"><FormHistory taskId={task.id} templateId={task.data.details.templateId} customerId={(selectedProject?.customerId ?? task.customerId) || null} facilityId={task.facilityId ?? null} local={preview ? [] : local?.tasks} /></div> : null}
    {task.data.kind === "FORM" ? <FormLimitsPanel document={task.data.details.document} values={task.data.details.values} templateId={task.data.details.templateId} facilityId={task.facilityId ?? null}
      facilityName={facilityOptions.find((facility) => facility.id === task.facilityId)?.name ?? ""} readOnly={task.status === "COMPLETED" || frozen || Boolean(preview)} local={local?.limits}
      onValues={(values) => setTask((current) => current.data.kind === "FORM" ? { ...current, data: { ...current.data, details: { ...current.data.details, values } } } : current)} /> : null}
    {task.data.kind === "FORM" && !preview ? <div data-detail-min="2" className="empty:hidden"><FormTrendPanel document={task.data.details.document} values={task.data.details.values} templateId={task.data.details.templateId} templateVersion={task.data.details.templateVersion} taskId={task.id}
      facilityId={task.facilityId ?? null} customerId={(selectedProject?.customerId ?? task.customerId) || null} local={local?.tasks} /></div> : null}
    {task.data.kind === "FORM" ? <FormRenderer panels actions={formActions} inline={inlineSlots} title={task.data.details.templateName} document={task.data.details.document} values={task.data.details.values} attachments={task.attachments} media={formMedia} rowOptions={rowOptions} readOnly={task.status === "COMPLETED" || frozen} onChange={(values) => { preview?.onValuesChange?.(values); setTask((current) => current.data.kind === "FORM" ? titled({ ...current, data: { ...current.data, details: { ...current.data.details, values } } }) : current); }} />
      : task.data.kind === "WORK_ORDER" ? <WorkOrderFields data={task.data} onChange={(data) => setTask({ ...task, data })} /> : <RiskFields data={task.data} onChange={(data) => setTask({ ...task, data })} title={task.title} taskId={task.id || undefined} assist={!local && !preview && task.status !== "COMPLETED"} />}
    </div>
    </fieldset>
    {summaryFoot ? null : attachmentsPanel}
    {completePanel}
    {reportPanel}
    {controlFoot ? <Modal open={historyOpen} onOpenChange={setHistoryOpen} title="Versionshistorik" className="max-w-3xl">{task.id ? <TaskHistory key={task.id} bare taskId={task.id} revisions={task.revisions ?? []} total={task.revisionCount ?? task.revisions?.length ?? 0} local={Boolean(local)} /> : null}</Modal> : null}
    {controlFoot ? <Modal open={sendOpen} onOpenChange={setSendOpen} title="Skicka med e-post">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Mottagarens e-post<Input id="task-send-email" type="email" required maxLength={254} value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Meddelande (valfritt)<textarea aria-label="Meddelande" className="form-textarea" maxLength={2000} value={sendNote} onChange={(event) => setSendNote(event.target.value)} /></label>
        <p className="page-description">Protokollet sparas och rapporten skickas som PDF. {task.status === "COMPLETED" ? "" : "Protokollet är inte färdigställt; rapporten märks som ej slutförd."}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSendOpen(false)}>Avbryt</Button><Button type="submit" disabled={busy || !recipient.trim()}><Send />Skicka</Button></div>
      </form>
    </Modal> : null}
  </div>;
}

/**
 * Earlier protocols of the same form for the same facility or customer (2026-09-26: follow up earlier
 * inspections). Shown only when there are any; each opens in its own editor.
 */
function FormHistory({ taskId, templateId, customerId, facilityId, local }: { taskId: string; templateId: string; customerId: string | null; facilityId: string | null; local?: WorkflowTaskRecord[] }) {
  const [remote, setRemote] = useState<FormHistoryItem[]>([]);
  const items = local ? selectFormHistory(local, { taskId: taskId || undefined, templateId, customerId, facilityId }) : customerId || facilityId ? remote : [];
  useEffect(() => {
    if (local || (!customerId && !facilityId)) return;
    let active = true;
    const params = new URLSearchParams({ formHistory: templateId, ...(facilityId ? { facilityId } : { customerId: customerId! }), ...(taskId ? { exclude: taskId } : {}) });
    api<{ items: FormHistoryItem[] }>(`/api/workflow-tasks?${params}`).then((result) => { if (active) setRemote(result.items); }).catch(() => { if (active) setRemote([]); });
    return () => { active = false; };
  }, [local, taskId, templateId, customerId, facilityId]);
  if (!items.length) return null;
  return <Panel title="Tidigare protokoll" description={`Samma formulär för ${facilityId ? "anläggningen" : "kunden"}, senaste först. Följ upp anmärkningarna från förra kontrollen.`} collapsible>
    <ol className="divide-y rounded-lg border" data-testid="form-history">{items.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
      <a className="min-w-0 flex-1 truncate font-medium text-primary hover:underline" href={`/?view=workflow_task&taskId=${encodeURIComponent(item.id)}&taskType=FORM`}>{item.title}</a>
      <span className="text-xs text-muted-foreground">{item.date ? `${formatSwedish(item.date, { dateStyle: "medium" })} · ` : ""}{statusLabels[item.status as WorkflowTaskStatus] ?? item.status}</span>
      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${indicatorBadge(item.deviations ? "danger" : "success")}`}>{item.deviations ? `${item.deviations} ${item.deviations === 1 ? "avvikelse" : "avvikelser"}` : "Inga avvikelser"}</span>
      {item.nextDate ? <span className="text-xs text-muted-foreground">Nästa: {item.nextDate}</span> : null}
    </li>)}</ol>
  </Panel>;
}

// Paged history (2026-09-26): Cloud sends the newest versions and a count; older pages load on request.
// Local already holds the whole .hwf in memory, so it only pages the rendering.
function TaskHistory({ taskId, revisions, total, local, bare = false }: { taskId: string; revisions: TaskRevision[]; total: number; local: boolean; /** Without the panel, inside the control's Versionshistorik dialog. */ bare?: boolean }) {
  const [older, setOlder] = useState<TaskRevision[]>([]);
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const merged = [...new Map([...revisions, ...older].map((revision) => [revision.id, revision])).values()].sort((left, right) => right.version - left.version);
  const ordered = local ? merged.slice(0, limit) : merged;
  const count = Math.max(total, merged.length);
  const loadMore = async () => {
    if (local) return setLimit((current) => current + 20);
    setBusy(true);
    try {
      const oldest = merged[merged.length - 1]?.version ?? 0;
      const page = await api<{ revisions: TaskRevision[] }>(`/api/workflow-tasks?revisionsFor=${encodeURIComponent(taskId)}&before=${oldest}`);
      setOlder((current) => [...current, ...page.revisions]);
    } finally { setBusy(false); }
  };
  const description = count ? `${count} ${count === 1 ? "sparad version" : "sparade versioner"}, senaste först. Äldre versioner är skrivskyddade.` : "Tidigare sparade versioner är skrivskyddade och visar dokumentationen som gällde vid varje sparning.";
  const body = <>
    {ordered.length ? <div className="space-y-2">{ordered.map((revision) => {
      const snapshot = revision.snapshot;
      return <details key={revision.id} className="group rounded-xl border bg-card open:bg-muted/15">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><History className="size-3.5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Version {revision.version}</span><span className="block text-xs text-muted-foreground">{formatSwedish(revision.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span></span>
          <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium">{statusLabels[snapshot.status]} · {snapshot.progress}%</span>
        </summary>
        <div className="border-t px-4 py-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-xs font-medium text-muted-foreground">Rubrik</dt><dd className="mt-1 whitespace-pre-wrap">{snapshot.title}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Beskrivning</dt><dd className="mt-1 whitespace-pre-wrap">{snapshot.description || "Ingen beskrivning"}</dd></div></dl>
          {snapshot.data.kind === "FORM" ? <div className="mt-4"><FormRenderer document={snapshot.data.details.document} values={snapshot.data.details.values} readOnly onChange={() => undefined} /></div> : snapshot.data.kind === "WORK_ORDER" ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><HistoryText label="Utfört arbete" value={snapshot.data.details.executionNotes} /><HistoryText label="Avvikelser" value={snapshot.data.details.deviations} /><HistoryText label="Signerad av" value={snapshot.data.details.signature.name} /><HistoryText label="Avslutande kommentar" value={snapshot.data.details.closeNotes} /></div> : <div className="mt-4 space-y-3"><HistoryText label="Gemensamma skyddsåtgärder" value={snapshot.data.details.generalMeasures} />{snapshot.data.details.risks.length ? <ol className="space-y-2">{snapshot.data.details.risks.map((risk, index) => <li key={risk.id} className="rounded-lg border bg-background p-3"><p className="text-xs font-semibold">Risk {index + 1}: {risk.hazard || "Ej beskriven"}</p><p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">Skyddsåtgärd: {risk.protectiveMeasure || "Ej beskriven"}</p><p className="mt-1 text-xs text-muted-foreground">Riskvärde {risk.likelihood * risk.consequence} → {risk.residualLikelihood * risk.residualConsequence}</p></li>)}</ol> : <p className="text-xs text-muted-foreground">Inga risker dokumenterades i denna version.</p>}<HistoryText label="Godkänd av" value={snapshot.data.details.approval.name} /></div>}
        </div>
      </details>;
    })}</div> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Ingen sparad versionshistorik finns för uppgiften.</p>}
    <ShowMore shown={ordered.length} total={count} busy={busy} onMore={() => void loadMore()} />
  </>;
  if (bare) return <div><p className="page-description mb-4">{description}</p>{body}</div>;
  return <Panel title="Historik" description={description}>{body}</Panel>;
}

/** The facts the originals show in the header: control points and approved (the control), or the number of objects ("2 risker"). */
function formHeaderFacts(document: FormDocument, values: FormValues, publisher: string | undefined, version: number): EditorFact[] {
  const facts: EditorFact[] = [];
  const blocks = formLeafBlocks(document);
  if (blocks.some((block) => (block.type === "table" && block.columns.some((column) => column.input === "assessment")) || (block.type === "checklist" && block.mode === "check"))) {
    const totals = formApprovalTotals(document, values);
    facts.push({ icon: Zap, label: `${totals.reduce((sum, item) => sum + item.total, 0)} kontrollpunkter` }, { icon: ShieldCheck, label: `${totals.reduce((sum, item) => sum + item.ok, 0)} godkända`, iconClassName: "text-emerald-600" });
  } else for (const block of blocks) if (block.type === "table" && block.itemLabelPlural) {
    const count = (values.tables[block.key] ?? []).filter((row) => !row.example).length;
    facts.push({ icon: ShieldAlert, label: `${count} ${count === 1 ? (block.itemLabel || "objekt").toLowerCase() : block.itemLabelPlural}` });
    break;
  }
  if (publisher && publisher !== "HINTEK") facts.push({ icon: FileText, label: `Formulär från ${publisher} · version ${version}`, iconClassName: "text-muted-foreground" });
  return facts;
}

function HistoryText({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm">{value || "Inte angivet"}</p></div>;
}

function WorkOrderFields({ data, onChange }: { data: Extract<TaskData, { kind: "WORK_ORDER" }>; onChange: (data: Extract<TaskData, { kind: "WORK_ORDER" }>) => void }) {
  const details = data.details;
  return <><Panel title="Utförande" description="Dokumentera utfört arbete, material, anteckningar och avvikelser."><div className="grid gap-4 lg:grid-cols-2"><label className="space-y-2 text-xs font-medium text-muted-foreground">Utfört arbete<textarea aria-label="Utfört arbete" id="task-execution" className="form-textarea min-h-28" value={details.executionNotes} onChange={(e) => onChange({ ...data, details: { ...details, executionNotes: e.target.value } })} /></label><label className="space-y-2 text-xs font-medium text-muted-foreground">Avvikelser<textarea aria-label="Avvikelser" className="form-textarea min-h-28" value={details.deviations} onChange={(e) => onChange({ ...data, details: { ...details, deviations: e.target.value } })} /></label></div><div className="mt-5 flex items-center justify-between"><h3 className="text-sm font-semibold">Material</h3><Button size="sm" variant="outline" onClick={() => onChange({ ...data, details: { ...details, materials: [...details.materials, { id: crypto.randomUUID(), name: "", quantity: "", unit: "" }] } })}><Plus />Lägg till material</Button></div><div className="mt-3 space-y-2">{details.materials.map((material) => <div key={material.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_8rem_auto]"><Input aria-label="Material" placeholder="Material" value={material.name} onChange={(e) => onChange({ ...data, details: { ...details, materials: details.materials.map((item) => item.id === material.id ? { ...item, name: e.target.value } : item) } })} /><Input aria-label="Mängd" placeholder="Mängd" value={material.quantity} onChange={(e) => onChange({ ...data, details: { ...details, materials: details.materials.map((item) => item.id === material.id ? { ...item, quantity: e.target.value } : item) } })} /><Input aria-label="Enhet" placeholder="Enhet" value={material.unit} onChange={(e) => onChange({ ...data, details: { ...details, materials: details.materials.map((item) => item.id === material.id ? { ...item, unit: e.target.value } : item) } })} /><Button variant="ghost" size="icon" aria-label="Ta bort material" onClick={() => onChange({ ...data, details: { ...details, materials: details.materials.filter((item) => item.id !== material.id) } })}><Trash2 /></Button></div>)}</div></Panel><Panel title="Signering och avslut" description="Signeringen ingår i arbetsorderns slutdokumentation."><div className="grid gap-4 lg:grid-cols-2"><label className="space-y-2 text-xs font-medium text-muted-foreground">Namn på den som signerar<Input id="task-signature-name" value={details.signature.name} onChange={(e) => onChange({ ...data, details: { ...details, signature: { ...details.signature, name: e.target.value } } })} /></label><label className="flex h-10 items-center gap-2.5 self-end text-sm"><Checkbox id="task-signature-confirmed" checked={details.signature.confirmed} onCheckedChange={(checked) => onChange({ ...data, details: { ...details, signature: { ...details.signature, confirmed: checked === true } } })} />Jag intygar att dokumentationen är granskad</label></div><label className="mt-4 block space-y-2 text-xs font-medium text-muted-foreground">Avslutande kommentar<textarea aria-label="Avslutande kommentar" className="form-textarea" value={details.closeNotes} onChange={(e) => onChange({ ...data, details: { ...details, closeNotes: e.target.value } })} /></label></Panel></>;
}

function RiskFields({ data, onChange, title = "", taskId, assist = false }: { data: Extract<TaskData, { kind: "RISK_ASSESSMENT" }>; onChange: (data: Extract<TaskData, { kind: "RISK_ASSESSMENT" }>) => void; title?: string; taskId?: string; assist?: boolean }) {
  const details = data.details;
  // HINTEK AI's proposed measures are put in after the person has read them, and may be undone later: both work on
  // the newest data, not on what the page held when the proposal was asked for.
  const latest = useRef({ data, onChange });
  useEffect(() => { latest.current = { data, onChange }; });
  const applyMeasures = (measures: { riskId: string; measure: string }[]) => {
    const now = latest.current;
    // Only fields that are still empty are filled; what the person has written since is never replaced.
    const filled = measures.filter((item) => now.data.details.risks.some((risk) => risk.id === item.riskId && !risk.protectiveMeasure.trim()));
    now.onChange({ ...now.data, details: { ...now.data.details, risks: now.data.details.risks.map((risk) => { const item = filled.find((candidate) => candidate.riskId === risk.id); return item ? { ...risk, protectiveMeasure: item.measure.slice(0, 1000) } : risk; }) } });
    return () => {
      const current = latest.current;
      // Undo empties only the fields that still hold the proposed text.
      current.onChange({ ...current.data, details: { ...current.data.details, risks: current.data.details.risks.map((risk) => filled.some((item) => item.riskId === risk.id && item.measure.slice(0, 1000) === risk.protectiveMeasure) ? { ...risk, protectiveMeasure: "" } : risk) } });
    };
  };
  const withoutMeasure = details.risks.filter((risk) => risk.hazard.trim() && !risk.protectiveMeasure.trim()).slice(0, 40).map((risk) => ({ id: risk.id, hazard: risk.hazard.trim(), likelihood: risk.likelihood, consequence: risk.consequence }));
  const update = (id: string, values: Partial<Risk>) => onChange({ ...data, details: { ...details, risks: details.risks.map((risk) => risk.id === id ? { ...risk, ...values } : risk) } });
  const addRisk = () => onChange({ ...data, details: { ...details, risks: [...details.risks, { id: crypto.randomUUID(), hazard: "", likelihood: 1, consequence: 1, protectiveMeasure: "", residualLikelihood: 1, residualConsequence: 1 }] } });
  return <>
    <Panel title="Bedömningsstöd" description="Femgradig skala och riskmatris. Samma skala används före och efter skyddsåtgärderna." collapsible defaultCollapsed>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-3 self-start sm:grid-cols-2">
          <ScaleHelp title="Sannolikhet" items={likelihoodOptions} />
          <ScaleHelp title="Konsekvens" items={consequenceOptions} />
          <div className="notice sm:col-span-2"><strong>Så bedöms risken:</strong> multiplicera sannolikhet med konsekvens. Dokumentera sedan en konkret skyddsåtgärd och bedöm den kvarvarande risken på nytt. Mycket hög eller hög kvarvarande risk bör åtgärdas innan arbetet startar.</div>
        </div>
        <RiskMatrix />
      </div>
    </Panel>
    <Panel title="Identifierade risker" description="Beskriv faran och skyddsåtgärden och bedöm risken före och efter åtgärden." actions={details.risks.length ? <>{assist && RiskMeasuresAssist ? <RiskMeasuresAssist title={title} taskId={taskId} risks={withoutMeasure} onApply={applyMeasures} /> : null}<Button id="task-add-risk" size="sm" variant="outline" onClick={addRisk}><Plus />Lägg till risk</Button></> : undefined}>
      <div className="space-y-3">{details.risks.length ? details.risks.map((risk, index) => {
        const initial = riskAssessment(risk.likelihood * risk.consequence);
        const residual = riskAssessment(risk.residualLikelihood * risk.residualConsequence);
        return <article key={risk.id} className="rounded-xl border bg-card p-3 transition-colors focus-within:border-primary/40 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground" aria-hidden="true">{index + 1}</span>Risk {index + 1}</h3><div className="flex flex-wrap items-center gap-1.5"><RiskBadge label="Före" score={initial.score} /><span className="text-muted-foreground" aria-hidden="true">→</span><RiskBadge label="Efter" score={residual.score} /><Button variant="ghost" size="icon" aria-label={`Ta bort risk ${index + 1}`} onClick={() => onChange({ ...data, details: { ...details, risks: details.risks.filter((item) => item.id !== risk.id) } })}><Trash2 /></Button></div></div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2"><label className="space-y-1 text-xs font-medium text-muted-foreground">Risk eller fara<textarea aria-label="Risk eller fara" id={`task-risk-${index}-hazard`} rows={2} className="form-textarea min-h-16" placeholder="Exempel: fall från stege, spänningssatt del eller tunga lyft" value={risk.hazard} onChange={(e) => update(risk.id, { hazard: e.target.value })} /></label><label className="space-y-1 text-xs font-medium text-muted-foreground">Skyddsåtgärd<textarea aria-label="Skyddsåtgärd" id={`task-risk-${index}-measure`} rows={2} className="form-textarea min-h-16" placeholder="Vad ska göras, av vem och före vilket moment" value={risk.protectiveMeasure} onChange={(e) => update(risk.id, { protectiveMeasure: e.target.value })} /></label></div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <RiskRating id={`task-risk-${index}-before`} title="Före skyddsåtgärd" likelihood={risk.likelihood} consequence={risk.consequence} onLikelihood={(value) => update(risk.id, { likelihood: value })} onConsequence={(value) => update(risk.id, { consequence: value })} />
            <RiskRating id={`task-risk-${index}-after`} title="Kvarvarande risk efter åtgärd" likelihood={risk.residualLikelihood} consequence={risk.residualConsequence} onLikelihood={(value) => update(risk.id, { residualLikelihood: value })} onConsequence={(value) => update(risk.id, { residualConsequence: value })} />
          </div>
        </article>;
      }) : <div className="rounded-xl border border-dashed bg-muted/20 px-5 py-8 text-center"><ShieldAlert className="mx-auto size-7 text-primary" /><p className="mt-3 text-sm font-semibold">Inga risker identifierade ännu</p><p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted-foreground">Gå igenom arbetsmoment, arbetsplats, verktyg, energi, lyft och omgivning. Lägg till varje betydande fara som en egen risk.</p><Button id="task-add-risk" className="mt-4" size="sm" onClick={addRisk}><Plus />Lägg till första risken</Button></div>}</div>
    </Panel>
    <Panel title="Gemensamma åtgärder och godkännande" description="Sammanfatta övergripande skydd och låt ansvarig granska bedömningen innan arbetet startar.">
      <label className="block space-y-2 text-xs font-medium text-muted-foreground">Gemensamma skyddsåtgärder<textarea aria-label="Gemensamma skyddsåtgärder" className="form-textarea" placeholder="Exempel: arbetsberedning, avspärrning, personlig skyddsutrustning och kontroll före start" value={details.generalMeasures} onChange={(e) => onChange({ ...data, details: { ...details, generalMeasures: e.target.value } })} /></label>
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><label className="space-y-2 text-xs font-medium text-muted-foreground">Godkänd av<Input id="task-approval-name" placeholder="För- och efternamn" value={details.approval.name} onChange={(e) => onChange({ ...data, details: { ...details, approval: { ...details.approval, name: e.target.value } } })} /></label><label className="flex h-10 items-center gap-2.5 self-end text-sm"><Checkbox id="task-approval-confirmed" checked={details.approval.confirmed} onCheckedChange={(checked) => onChange({ ...data, details: { ...details, approval: { ...details.approval, confirmed: checked === true } } })} />Jag har granskat riskerna, åtgärderna och den kvarvarande risknivån</label></div>
    </Panel>
  </>;
}

const likelihoodOptions = ["Mycket osannolik", "Osannolik", "Möjlig", "Sannolik", "Mycket sannolik"];
const consequenceOptions = ["Försumbar", "Mindre", "Allvarlig", "Mycket allvarlig", "Katastrofal"];

function riskAssessment(score: number) {
  // Same indicator meaning as the rest of Workflow: high risk is red, moderate is amber and low is green.
  // "Mycket hög" is the same red at full strength so the matrix still separates the two high levels.
  if (score >= 17) return { score, label: "Mycket hög", className: "border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-700" };
  if (score >= 10) return { score, label: "Hög", className: indicatorBadge("danger") };
  if (score >= 5) return { score, label: "Måttlig", className: indicatorBadge("warning") };
  return { score, label: "Låg", className: indicatorBadge("success") };
}

function ScaleHelp({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-xl border bg-muted/20 p-4"><h3 className="text-sm font-semibold">{title}</h3><ol className="mt-3 space-y-2">{items.map((item, index) => <li key={item} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-card font-semibold text-foreground ring-1 ring-border">{index + 1}</span>{item}</li>)}</ol></div>;
}

function RiskMatrix() {
  return <div className="rounded-xl border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Riskmatris 5 × 5</h3><p className="mt-1 text-[11px] text-muted-foreground">Konsekvens lodrätt · sannolikhet vågrätt</p></div><ShieldAlert className="size-4 text-primary" /></div><div className="mt-3 grid w-fit grid-cols-[1.25rem_repeat(5,2.15rem)] gap-1 text-center text-[11px]" role="img" aria-label="Riskmatris med risknivå från 1 till 25"><span />{[1,2,3,4,5].map((value) => <span key={`top-${value}`} className="py-0.5">{value}</span>)}{[5,4,3,2,1].flatMap((consequence) => [<span key={`label-${consequence}`} className="flex items-center justify-center font-medium">{consequence}</span>, ...[1,2,3,4,5].map((likelihood) => { const level = riskAssessment(likelihood * consequence); return <span key={`${consequence}-${likelihood}`} className={`flex size-[2.15rem] items-center justify-center rounded border font-semibold ${level.className}`} title={`${level.label}: ${likelihood * consequence}`}>{likelihood * consequence}</span>; })])}</div><div className="mt-3 flex flex-wrap gap-1.5">{[1,5,10,17].map((score) => { const level = riskAssessment(score); return <span key={score} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${level.className}`}>{level.label}</span>; })}</div></div>;
}

function RiskBadge({ label, score }: { label: string; score: number }) {
  const level = riskAssessment(score);
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${level.className}`}>{label}: {score} · {level.label}</span>;
}

function RiskRating({ id, title, likelihood, consequence, onLikelihood, onConsequence }: { id: string; title: string; likelihood: number; consequence: number; onLikelihood: (value: number) => void; onConsequence: (value: number) => void }) {
  const level = riskAssessment(likelihood * consequence);
  // The level is shown once in the card header badges (2026-09-25), so the rating itself keeps a neutral frame.
  return <fieldset id={id} tabIndex={-1} className="min-w-0 rounded-lg border bg-muted/30 px-3 pb-3 pt-1"><legend className="px-1 text-xs font-semibold text-foreground">{title}</legend><div className="grid grid-cols-2 gap-2"><label className="space-y-1 text-[11px] font-medium text-muted-foreground">Sannolikhet<select className="form-select" value={likelihood} onChange={(event) => onLikelihood(Number(event.target.value))}>{likelihoodOptions.map((label, index) => <option key={label} value={index + 1}>{index + 1} · {label}</option>)}</select></label><label className="space-y-1 text-[11px] font-medium text-muted-foreground">Konsekvens<select className="form-select" value={consequence} onChange={(event) => onConsequence(Number(event.target.value))}>{consequenceOptions.map((label, index) => <option key={label} value={index + 1}>{index + 1} · {label}</option>)}</select></label></div><p className="sr-only">Risknivå {level.score}, {level.label} ({likelihood} × {consequence})</p></fieldset>;
}

/** The moments a form asks the person to pick (the control's Isolation, Kontinuitet …), as a step on the progress line. */
function formMoments(document: FormDocument, values: FormValues) {
  const optional = formOptionalSections(document);
  if (!document.moments.requireOne || !optional.length) return undefined;
  const label = /^moment$/i.test(document.moments.label.trim()) ? "Moment" : document.moments.label.trim() || "Moment";
  return { label: label === "Moment" ? "Kontrollmoment" : label, met: optional.some((section) => formSectionActive(section, values)), target: `form-${optional[0].id}` };
}

/** A task page: on display level 1 its panels start folded except the current step's (see TaskPageFold). */
export function WorkflowTaskEditor(props: React.ComponentProps<typeof WorkflowTaskEditorBody>) {
  return <TaskPageFold.Provider value><WorkflowTaskEditorBody {...props} /></TaskPageFold.Provider>;
}

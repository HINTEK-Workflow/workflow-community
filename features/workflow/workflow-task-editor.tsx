"use client";

import { withReturn } from "@/lib/workflow/return-link";
import { STANDARD_PAGE_WIDTH, usePageTrail } from "@/components/page-shell";
import { EditorAside, EditorAsideLayout } from "@/components/editor-aside";
import { ContactActions } from "@/components/contact-actions";
import { placeAddress, placeLabel, placePath, placePosition } from "@/lib/workflow/customer-facility";
import { cloudSavePlace, PlacePicker, type SavePlace } from "./place-picker";
import { CustomerField, type CustomerPlaceChange } from "./customer-field";
import { SharedBasicsFields, SharedBasicsPanel } from "./shared-basics";
import { useHolderWorkOrder } from "./use-holder-work-order";
import { TempPlaceField } from "./temp-place-field";
import { cloudReadCustomer, cloudSaveCustomer, blankCustomerForm, type SaveCustomer } from "@/features/kfid/customer-form-dialog";
import { useCustomerReference } from "@/features/kfid/customer-options";
import { customerPlaceSource, inheritProjectCustomerPlace, placeAfterCustomerChange, placeChoiceHint, placeFieldFollowsPlace } from "@/lib/workflow/customer-place";
import { copyTempPlace, tempPlaceIsEmpty, tempPlaceLabel, tempPlaceOf, tempPlacePosition, withTempPlace, type TempPlace } from "@/lib/workflow/temp-place";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { isLateTask } from "@/lib/workflow/late-tasks";
import { isDormant } from "@/lib/maintenance/plan-model";
import { formatDurationSeconds } from "@/lib/workflow/duration";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Clock3, Hammer, Link2, Pause, Play, OctagonAlert, Camera, CalendarClock, LoaderCircle, Car, Receipt, CheckCircle2, ClipboardCheck, MapPin, PenLine, Copy, FileText, FolderKanban, History, Package, Paperclip, Plus, RotateCcw, Save, Search, Send, ShieldAlert, Siren, ShieldCheck, Trash2, Undo2, Upload, UserCheck, UserRound, Users, Wrench, Zap, Images, Info, ListChecks, Lightbulb, ClipboardList, MessageSquare } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CollapsibleSection, DialogActions, Modal, Panel, PanelAreaProvider, ShowMore } from "@/features/kfid/ui";
import { panelAreaOfTask } from "@/lib/workflow/panel-area";
import { DialogPage } from "@/features/kfid/dialog-page";
import { DISCARD_QUESTION, useConfirm, type ConfirmOptions } from "@/features/kfid/confirm";
import { TaskPageFold, useDetailLevel, useNativeMode } from "./use-detail-level";
import { ListEmpty, ListFact, ListGroup, ListRow, NativeActions, NativeLargeTitle, NativeLead, NativePage, NativeFlowBar, StepBar, Tile, TileGrid, useNativeTopBar } from "@/components/native";
import { InvoiceBasisNativeRow, useTaskInvoiceBasis } from "@/features/invoice-basis/invoice-basis-panel";
import { useModules } from "./use-modules";
import { EDITING_SCREENS, jobRowAction, formPartForTarget, formPartLabel, formParts, JOB_SCREEN_TITLE, jobFlowIndex, jobFlowSteps, jobStepRows, parseFormPart, parseJobScreen, screenForTarget, typeOfTaskKind, type JobScreen } from "@/lib/workflow/native-mode";
import { returnToWork, useLeavePage } from "@/components/history-nav";
import { useReturnTo, useSubPageHref } from "@/features/kfid/use-return-to";
import { leaveWithoutAsking, leavingWithoutAsking } from "@/lib/workflow/leave-guard";
import { useWorkViewDefaults } from "./use-work-view";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { executionFirst } from "@/lib/workflow/detail-level";
import { useRegisterEditorActions } from "@/components/workspace-actions";
import { CustomerPicker } from "@/features/kfid/customer-picker";
import { openFormPreviewPdf } from "./form-preview-pdf";
import { api, SESSION_BACK_EVENT } from "@/features/kfid/api";
import type { CustomerItem, ProjectItem } from "@/features/kfid/types";
import { formCompletionShown, workflowTaskAttachmentLimit, workflowTaskCompletion, workflowTaskProgress, WORK_ORDER_NOTES_MAX, type WorkflowTaskKind, type WorkflowTaskStatus } from "@/lib/workflow/task-model";
import type { WorkflowReportOptions } from "@/lib/workflow/report";
import { ReportOptionsButton, type ReportVariant } from "./report-options";
import { announceArchiveResult } from "./report-archive-client";
import { RISK_CLASS_TEXTS } from "@/lib/self-inspection/levels";
import { EDITOR_PRIMARY_REASON_ID, EditorHeader, HeaderActionNodes, type EditorFact, type MaybeHeaderAction } from "./editor-header";
import { indicatorBadge } from "./indicator-tone";
import { Badge } from "@/components/ui/badge";
import { withParam } from "@/lib/workflow/navigation";
import { SCAN_START_PARAM, scanPoint } from "@/lib/workflow/place-scan";
import { cn } from "@/lib/utils";
import { announceTimerChange, NativeJobTimerCard, stopMessage, useShortStopGuard, useStartTimerGuard } from "./running-timer";
import { useRunningTimers } from "@/components/workspace-actions";
import { keepsWorkflowRegister, staffRegisterReminder } from "@/lib/workflow/staff-register";
import { checkInFromTimer, JobCheckIn, staffRegisterOnSite, StaffRegisterPanel } from "./staff-register-panel";
import { projectFieldRows, taskDueDateError } from "@/lib/workflow/project-frame";
import { TaskScheduleFields } from "@/features/workflow/task-schedule-fields";
import { formatTimerDuration, type StoppedTimer } from "@/lib/workflow/running-timer";
import { clearMeasurements, copyFormValues, formApprovalTotals, formHasContent, formJudgesByLimits, formLeafBlocks, formRowsWithoutOrder, formOptionalSections, formResultText, formSectionActive, formJudgedYesNo, initialFormValues, type FormDocument, type FormTableBlock, type FormValues } from "@/lib/workflow/form-document";
import { applyFormPrefill, customerPrefill, type FormPrefill, type FormPrefillSource } from "@/lib/workflow/form-prefill";
import { AssignmentPanel, useSelfInspectionWork } from "@/features/self-inspection/work";
import { deviationFacts, NativeDeviationRows } from "@/features/self-inspection/deviation-links";
import { assignBlock, assignmentWarnings, workBlock } from "@/lib/self-inspection/work";
import { applyPlanningMoments, documentHasPlanningMoments, momentsNotChosen, planningNote } from "@/lib/self-inspection/planning-scope";
import { FormRenderer, sectionHasSummary, type FormActions, type FormMedia, type FormRowOptions, type FormTaskInline } from "./form-renderer";
import { FormLimitsPanel, FormTrendPanel, type LocalLimits } from "./form-task-extras";
import { CompletionCard, type CompletionCardSummary } from "./form-blocks";
import { announce, withdrawAnnouncement } from "@/lib/workflow/toast";
import { selectFormHistory, type FormHistoryItem } from "@/lib/workflow/form-history";
import { CompleteTaskDialog, type CompletionTime } from "./complete-task-dialog";
import { NextSteps, type LinkedTask } from "./next-steps";
import { ScheduleDialog, cloudRoundsBackend, type RoundsBackend } from "./form-rounds";
import { repeatScheduleDraft } from "@/lib/workflow/form-schedule";
import { clientExtensions } from "@ee/client";
import { FlowGuide, focusTarget, setMissingTargetHandler } from "./flow-guide";
import { formFlow, riskFlow, workOrderFlow, workOrderFromQuote } from "@/lib/workflow/task-flow";
import { nextStepAction, nextStepLine, titleHelpText } from "@/lib/workflow/next-step";
import { changedPaths, keepSentText, mergeKeepingSaved, pathKey, pathWithin, sameJson, stableJson, taskPathLabel, threeWayMerge, valueAtPath, withValueAt, type MergePath } from "@/lib/workflow/task-merge";
import { AUTOSAVE_DELAY_MS, isOwnEcho, saveIndicator, type AutosaveState } from "@/lib/workflow/autosave";
import { useTaskLive, type TaskChange } from "./use-task-live";
// Hör till arbetsorder och tid på jobbet (Fas 2, 2026-10-08).
import { WorkOrderField } from "./work-order-field";
import { RoundHolderField, type RoundChoice } from "./round-holder-field";
import { CommentThread } from "./comment-thread";
import { roundHolderTitle, roundOfProtocolValues } from "@/lib/workflow/round-work-orders";
import { roundSafetyOf, roundSafetyRefusal, roundSafetyRequired, roundSafetyState, type RoundSafety } from "@/lib/workflow/round-safety";
import { ROUND_SAFETY_TARGET, RoundSafetyPanel } from "./round-safety-panel";
import { WorkOrderChoice, withChosenWorkOrder } from "./work-order-choice";
import { LinkedTasksPanel } from "./linked-tasks-panel";
import { WorkOrderMaintenanceItems } from "@/features/maintenance/maintenance-item-editor";
import { StoreMaterialRow } from "@/features/maintenance/store-material-row";
import { storeRowLabel } from "@/lib/workflow/store-rows";
import type { ItemRow as MaintenanceItemRow } from "@/features/maintenance/maintenance-api";
import { draftKeepsWorkOrder, type LinkedTaskRow, openTasksWarning, inheritFromWorkOrder, SHARED_BASIC_LABELS, sharedBasicsDifference, WORK_ORDER_CREATED_FROM_DRAFT, type SharedBasicShown, taskIsSigned, taskNeedsWorkOrder, timeOnWorkOrderLabel, timeOwnerId, workflowTaskHref, WORK_ORDER_MISSING_LABEL, WORK_ORDER_REQUIRED, workOrderLockedLine, workOrderRemovalRefusal, workOrderRemovalSummary, type WorkOrderOption } from "@/lib/workflow/work-order-link";
import { FOLLOW_UP_ORDER_LABEL, headerWorkOrderShown } from "@/lib/workflow/new-choices";
import { TaskBrief } from "./task-brief";
import { TaskBookingLine } from "./task-bookings";
import { bookJobHref } from "@/lib/workflow/bookings";
import { expenseTotal, formatSek, isBlankMaterialRow, isCarCostRow, isExpenseRow, MATERIAL_UNIT_SUGGESTIONS, parseAmount, rowAmount, withoutNewBlankRows, type MaterialRow } from "@/lib/workflow/expenses";
import { assigneeReadRefusal } from "@/lib/workflow/assignee-access";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { formTargetBlockId, formTargetWorkOrderId } from "@/lib/workflow/deviation-target";
import { materialRowPrice, parsePercent, unpricedText, withCompanyMarkup, workOrderTotals } from "@/lib/workflow/material-prices";
import { QuoteFromWorkOrder } from "@/features/quotes/quote-from-work-order";
import { ArticleNumberFields, CopiedPrice, PriceMark } from "@/features/workflow/catalogue-picker";
import { ArticleBrowserDialog, type ArticleAdd } from "@/features/catalogue/article-browser";
import { WholesaleExport } from "@/features/wholesale/wholesale-export";
import { readPurchase, usePurchaseQuickPick } from "@/features/purchases/purchase-link";
import { RowProduct } from "@/features/catalogue/product-info";
import { materialRowsFromPurchase } from "@/lib/purchases/model";
import { fromMaterialRows } from "@/lib/wholesale/sources";
import { useUndoRemove } from "@/features/kfid/use-undo-remove";
import { CarCostDialog, type CarCostDestination, type CarCostStartPlace } from "./car-cost-dialog";
import { highestPriority, MAINTENANCE_PRIORITY_LABELS, maintenanceFromDeviation, WAITING_REASON_LABELS, WAITING_REASONS, waitingReasonOf, workOrderStatusLabel, type WaitingReason } from "@/lib/workflow/maintenance";
import { isTimeDrivenStatus, manualStatusChoices } from "@/lib/workflow/task-status-rule";
import { isTaskCancelled, isTaskOpen } from "@/lib/workflow/task-cancel";
import { TaskCancelDialog, TaskCancelledNotice } from "./task-cancel-dialog";
// Start på alla jobb, Etapp och Rapportera hinder (plan 1M, 2026-10-11).
import { ObstacleDialog, ObstacleNotice } from "./obstacle-dialog";
import { AutomaticOrderNotice } from "./machine-alarm";
import { AssignButton, AssignWorkOrderDialog } from "./assign-dialog";
import { assignRefusal, bookPeopleHref, isAlarmWorkOrder, isFaultWorkOrder } from "@/lib/workflow/assign-work-order";
import { jobObstacle, reportObstacle, resolveObstacle, type ObstacleInput, type StoredObstacle } from "@/lib/workflow/obstacles";
import { defaultStartDate, stageSuggestions } from "@/lib/workflow/job-planning";
// Riskbedömning som steg (2026-10-08): the rule in lib/workflow/risk-step.ts, the panel and its hook beside it.
import { riskCheckOf, riskStepRefusal, withRiskCheck, emptyRiskCheck, type RiskCheck } from "@/lib/workflow/risk-step";
import { createExtendedAssessment, RISK_STEP_TARGET, RiskStepPanel, useRiskStep } from "./risk-step-panel";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { saveResponse } from "@/lib/download";
import { customerTitle } from "@/lib/kfid/customer-name";

type Risk = { id: string; hazard: string; likelihood: number; consequence: number; protectiveMeasure: string; residualLikelihood: number; residualConsequence: number };
type Material = MaterialRow;
// Tillfällig plats (2026-10-08): every kind may carry one extra place of its own beside its details.
type TaskData = ({ kind: "WORK_ORDER"; details: { executionNotes: string; deviations: string; materials: Material[]; signature: { name: string; confirmed: boolean; signedAt: string | null }; closeNotes: string; customerReceipt?: { name: string; at: string | null }; source?: { taskId: string; title: string; kind?: WorkflowTaskKind; rowId?: string }; waitingOn?: WaitingReason | "" } }
  | { kind: "RISK_ASSESSMENT"; details: { risks: Risk[]; generalMeasures: string; approval: { name: string; confirmed: boolean; approvedAt: string | null } } }
  | { kind: "FORM"; details: { templateId: string; templateVersion: number; templateName: string; publisherName?: string; document: FormDocument; values: FormValues } }) & { tempPlace?: TempPlace; riskCheck?: RiskCheck; riskStep?: boolean; obstacle?: StoredObstacle; roundSafety?: RoundSafety; roundSafetyStep?: boolean };
/** The published form version a new protocol is created from (2026-09-26). */
export type FormTemplateChoice = { templateId: string; version: number; name: string; document: FormDocument; allowStandalone?: boolean; allowInProject?: boolean; area?: string; publisher?: string };
type TaskRevision = { id: string; version: number; createdAt: string; snapshot: { title: string; description: string; status: WorkflowTaskStatus; progress: number; data: TaskData; completedAt: string | null; /** A plain line for the history, e.g. who took an automatic order. */ note?: string } };
export type WorkflowTaskRecord = { id: string; version: number; kind: WorkflowTaskKind; formArea?: string | null; title: string; description: string; status: WorkflowTaskStatus; progress: number; projectId: string | null; customerId: string | null; facilityId?: string | null; assignedToUserId: string | null; assignedToName: string; dueDate: string; plannedStartDate?: string; estimatedMinutes?: number | null; stage?: string; createdAt?: string; createdBy?: string; updatedAt?: string; data: TaskData; totalDurationSec: number; timerRunning: boolean; workOrderId?: string | null; workOrder?: { id: string; title: string; status: string; readable?: boolean } | null;
  /** Driftrond i arbetsordern (2026-10-27): the round a work order holds for its period (0.24.0: and the day it was made for). */ roundScheduleId?: string | null; roundOccurrence?: string | null;
  /** Återkommande underhåll (2026-10-30): the plan an occurrence's work order belongs to, its day, and when a person activated it early. */ maintenancePlanId?: string | null; maintenanceDue?: string | null; maintenanceActivatedAt?: string | null;
  /** The time on the work order reported from this task (a round occurrence's own time, 2026-10-27). */ ownDurationSec?: number; revisions?: TaskRevision[]; revisionCount?: number; attachments?: { id: string; filename: string; mimeType: string; size: number; receipt?: boolean; createdAt: string }[]; cancelReason?: string; cancelledAt?: string | null };
/** `canRead`: whether the person may read the job's type (Cloud and the demo); the Ansvarig list offers only them. */
type Member = { id: string; name: string; canRead?: boolean };

const emptyData = (kind: WorkflowTaskKind, form?: FormTemplateChoice | null): TaskData => kind === "WORK_ORDER"
  ? { kind, details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } }
  : kind === "FORM" && form
    ? { kind, details: { templateId: form.templateId, templateVersion: form.version, templateName: form.name, ...(form.publisher ? { publisherName: form.publisher } : {}), document: form.document, values: initialFormValues(form.document) } }
    : { kind: "RISK_ASSESSMENT", details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } };

/** What the person edits; everything else (version, time, attachments, history) always comes from the server. */
// Order-independent, so the server's reply of an unchanged task never reads as an unsaved change (2026-10-09).
const taskKey = (record: WorkflowTaskRecord) => stableJson(PERSON_FIELDS.map((key) => record[key]));
/** The controls whose leaving saves at once: text fields, and the ticks and answer buttons of a checklist (användartest
 *  2026-10-31, fel 5: a tick is a button, so leaving it saved nothing until the pause). */
const LEAVE_SAVES = "input, textarea, select, [role=checkbox], [role=radio], [role=switch], [aria-pressed]";
const PERSON_FIELDS = ["title", "description", "status", "projectId", "customerId", "facilityId", "workOrderId", "roundScheduleId", "assignedToUserId", "assignedToName", "dueDate", "plannedStartDate", "estimatedMinutes", "stage", "data"] as const;
type PersonFields = Pick<WorkflowTaskRecord, (typeof PERSON_FIELDS)[number]>;
/** The ids of the material and expense rows in a saved key (taskKey), for what a save leaves out. */
function savedRowIds(key: string | null): Set<string> {
  if (!key) return new Set();
  try {
    const data = (JSON.parse(key) as unknown[])[PERSON_FIELDS.indexOf("data")] as TaskData | undefined;
    return new Set(data?.kind === "WORK_ORDER" ? data.details.materials.map((row) => row.id) : []);
  } catch { return new Set(); }
}
/** The task as a save sends it: without new material or expense rows that are still blank (lib/workflow/expenses.ts). */
function savableTask(record: WorkflowTaskRecord, savedKey: string | null): WorkflowTaskRecord {
  if (record.data.kind !== "WORK_ORDER") return record;
  const materials = withoutNewBlankRows(record.data.details.materials, savedRowIds(savedKey));
  return materials === record.data.details.materials ? record : { ...record, data: { ...record.data, details: { ...record.data.details, materials } } };
}
const personFields = (record: WorkflowTaskRecord) => Object.fromEntries(PERSON_FIELDS.map((key) => [key, record[key]])) as PersonFields;

// Live sync and autosave (2026-10-04). A draft in the browser keeps what the person typed through a lost
// connection or a crashed tab, and stays after signing out (like the control's drafts); it is per person and task.
const DRAFT_PREFIX = "workflow.task-draft.";
const DRAFT_MAX_AGE_MS = 30 * 24 * 3600_000;
type TaskDraft = { at: number; version: number; base: PersonFields | null; task: PersonFields };
function readDraft(key: string): TaskDraft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(key) || "null") as TaskDraft | null;
    return draft && typeof draft.at === "number" && draft.task && Date.now() - draft.at < DRAFT_MAX_AGE_MS ? draft : null;
  } catch { return null; }
}
function forgetDraft(key: string | null) { if (key) try { localStorage.removeItem(key); } catch { /* storage blocked */ } }
function pruneDrafts() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(DRAFT_PREFIX) && !readDraft(key)) localStorage.removeItem(key);
  } catch { /* storage blocked */ }
}
/** "Erik" → "Eriks", "Lars" → "Lars": the possessive used in the messages about a colleague's change. */
/** A screen of the job whose menu is `menu` (`&step=`, `&part=`, `&item=` added to the same address). */
function isScreenOf(url: string, menu: string): boolean {
  try {
    const params = new URL(url, "http://local").searchParams;
    if (!params.has("step")) return false;
    for (const key of ["step", "part", "item"]) params.delete(key);
    const own = new URL(menu, "http://local").searchParams;
    params.sort(); own.sort();
    return params.toString() === own.toString();
  } catch { return false; }
}
const possessive = (name: string) => /[sxz]$/i.test(name) ? name : `${name}s`;
/** "1 bilaga", "2 bilagor" (simulation 2026-10-10: "1 bilagor"). */
const countOf = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
/** A work order with the signer's name the page shows prefilled (the person's own) written in, or the same record when nothing is shown. */
function withShownSigner(record: WorkflowTaskRecord, name: string | undefined): WorkflowTaskRecord {
  const shown = (name ?? "").trim();
  if (record.data.kind !== "WORK_ORDER" || record.status === "COMPLETED" || !shown) return record;
  const { signature } = record.data.details;
  if (signature.name.trim() || signature.confirmed) return record;
  return { ...record, data: { ...record.data, details: { ...record.data.details, signature: { ...signature, name: shown } } } };
}
const listNames = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} och ${items[items.length - 1]}`;
/** A conflicting value shown as text in the save-conflict notice ("Visa min text"). */
type SaveConflict = { text: string; fields: { key: string; path: MergePath; label: string; mine: unknown }[] };
const conflictText = (value: unknown) => value === undefined || value === null || value === "" ? "(tomt)" : typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value, null, 2);

const { WorkOrderProposal, RiskMeasuresAssist, ProtocolReview } = clientExtensions;
/** Nivå 1 på mobil: the icon of each step row; done steps turn green but keep their icon. */
const STEP_ICON = { risk: ShieldAlert, work: Wrench, material: Package, sign: PenLine, form: ClipboardCheck, complete: CheckCircle2 } as const;
const statusLabels: Record<WorkflowTaskStatus, string> = { PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått" };
/** The Status list (2026-10-08): Planerad and Behöver åtgärdas, plus the current status when time or completion set it. */
const statusOptions = (current: WorkflowTaskStatus) => manualStatusChoices(current).map((value) =>
  <option key={value} value={value}>{statusLabels[value]}{isTimeDrivenStatus(value) ? " (följer tiden)" : ""}</option>);
const statusHint = <span id="task-status-hint" className="block font-normal">Pågår och Pausad sätts när tiden startas och pausas.</span>;

/**
 * The form builder's preview (2026-09-28): the real task editor with the draft and example answers, so what the
 * builder shows is exactly what the person filling in the protocol gets. Nothing is fetched or stored; the sample
 * customer, project and place stand in for the company's own.
 */
export type FormPreviewInput = { document: FormDocument; name: string; values: FormValues; area?: string; publisher?: string; onValuesChange?: (values: FormValues) => void };
const PREVIEW_MESSAGE = "Förhandsgranskning: inget sparas.";

function WorkflowTaskEditorBody({ kind, taskId, projectId, customerId, customers, projects, form: initialForm = null, local, rowOptions, userName, userId, canCreatePlaces = false, canBookJob, customerLinks, preview, prices: pricesProp, invoiceBases = false, canRemove = false, canCreateWorkOrders = true, canEditWorkOrders = true }: {
  /** Skapa arbetsorder on a draft (2026-10-30): only for whoever may create work orders; the server decides again. */
  canCreateWorkOrders?: boolean;
  /** A task edits its work order's Grunduppgifter and Riskbedömning (2026-10-30): only with edit on work orders; the server decides again. */
  canEditWorkOrders?: boolean;
  /** Boka på arbetsordern (2026-11-02): the booking rule for a work order in this project (plannedActivityWriteRefusal); the server decides again. */
  canBookJob?: (projectId: string | null) => boolean;
  /** Ta bort arbetsorder (2026-10-26, svar 2b): the right to remove (Kan ta bort kontroller); the server decides again. */
  canRemove?: boolean;
  /** Fakturaunderlag (QA 2026-10-10): admin or Offerter – läsa; without it the panel is not asked for (no refused request). */
  invoiceBases?: boolean;
  /**
   * Priser på materialraden (2026-10-09): whether the person may see purchase prices and markup, and the company's
   * markup copied to a row that gets its price. Local files show prices to their owner; Cloud follows the server.
   */
  prices?: { visible: boolean; markupPercent: string };
  /** "Lägg till kund" and "Redigera kund" beside the customer choice in Cloud (the customers permission; the server decides). */
  customerLinks?: { canCreate: boolean; canEdit: boolean };
  /** The signed-in person: drafts in the browser are kept per person, and live sync tells their own changes apart. */
  userId?: string;
  /** May add a customer's place from the Plats field (the customers permission; always in Local). */
  canCreatePlaces?: boolean;
  /** The person's "nya rader överst" and example-row settings, used by a form's measurement rows like the control. */
  rowOptions?: FormRowOptions;
  /** The signed-in person's name, for fields that start from the user (the control's Utfört av). */
  userName?: string;
  /** The builder's preview: the draft as the task editor shows it, without saving anything. */
  preview?: FormPreviewInput;
  kind: WorkflowTaskKind; taskId?: string; projectId?: string; customerId?: string; customers: CustomerItem[]; projects: ProjectItem[]; form?: FormTemplateChoice | null; local?: { limits?: LocalLimits; tasks: WorkflowTaskRecord[]; riskExceptionAllowed?: boolean; members?: Member[]; save: (task: WorkflowTaskRecord, extra?: { time?: CompletionTime }) => Promise<{ id: string; version: number; stopped?: StoppedTimer[] }>; timer: (id: string, command: "START" | "PAUSE", task: WorkflowTaskRecord, options?: { keepShort?: boolean }) => Promise<StoppedTimer[] | void>; savePlace?: SavePlace;
    /** Saves a customer in the open file from "Lägg till kund" / "Redigera kund" (2026-10-08). */
    saveCustomer?: SaveCustomer; reopen?: (id: string) => Promise<void>;
    /** Utgår and Återuppta in the open file (2026-10-09); without it the buttons are not shown. */
    cancel?: (id: string, input: { cancel: true; reason: string; keepShort?: boolean } | { cancel: false }) => Promise<void>; upload?: (id: string, file: File, options?: { receipt?: boolean }) => Promise<string | void>; setReceipt?: (id: string, attachmentId: string, receipt: boolean) => Promise<void>; removeAttachment?: (id: string, attachmentId: string) => Promise<void>; openAttachment?: (attachmentId: string) => Promise<void>; report?: (task: WorkflowTaskRecord, options: WorkflowReportOptions, variant?: ReportVariant) => Promise<void>;
    /** The file's rounds, so "Upprepa kontrollen" can plan one (2026-10-06). */
    rounds?: RoundsBackend;
    /** Ta bort arbetsorder in the open file, with its tasks (svar 2b); refused while one is completed or signed. */
    removeWorkOrder?: (id: string) => Promise<void> } }) {
  const router = useRouter();
  const [confirm, confirmCard] = useConfirm();
  // Starta tid while the time runs on another job asks first (2026-10-12); the guard's cards are drawn with the confirm card.
  const { allowStart, element: startTimerGuard } = useStartTimerGuard();
  const { allowStop, element: shortStopGuard } = useShortStopGuard();
  const timerSource = useRunningTimers();
  // "Skapa offert av materialet" is not offered on a finished or invoiced order (2026-10-11); the invoice panel
  // tells whether one of the order's bases is invoiced.
  const [invoiced, setInvoiced] = useState(false);
  const prices = pricesProp ?? (local ? { visible: true, markupPercent: "" } : { visible: false, markupPercent: "" });
  // On a phone or tablet a lower display level starts the project's facts folded: the top of a task shows the work, not the address book (2026-10-02).
  const detailLevel = useDetailLevel();
  // In the app (a phone, A2) the order follows the layout, not Visa mer: the work stays first there.
  const orderLevel = useNativeMode() ? 1 : detailLevel;
  const viewDefaults = useWorkViewDefaults();
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
  // The round's responsible person (2026-10-07): the protocol starts with them as its responsible, whoever starts it; the server checks that they belong to the company.
  const roundAssignee = !preview && roundParam && occurrenceParam && searchParams.get("assignedTo") ? { id: searchParams.get("assignedTo")!.slice(0, 100), name: searchParams.get("assignedToName")?.trim().slice(0, 160) ?? "" } : null;
  // Back from a finished work order (2026-10-06): the row, point or field it was made from.
  const rowParam = preview ? null : searchParams.get("row")?.slice(0, 100) || null;
  // "Ny uppgift till denna arbetsorder" (Fas 2): a new task starts linked to the order; a work order never is.
  const workOrderParam = preview || kind === "WORK_ORDER" ? null : searchParams.get("workOrderId")?.slice(0, 100) || null;
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
  const allPlaces = customers.flatMap((customer) => customer.facilities ?? []);
  const inherit = (base: WorkflowTaskRecord, project: ProjectItem | undefined): WorkflowTaskRecord => project ? {
    ...base,
    projectId: project.id,
    // The project's customer and place (decision 11; 2026-10-08): another place of the same customer can be chosen,
    // a place of another customer never stays.
    ...inheritProjectCustomerPlace(base, project, allPlaces),
    assignedToUserId: base.assignedToUserId ?? project.responsibleUserId ?? null,
    assignedToName: base.assignedToUserId ? base.assignedToName : project.responsibleName ?? base.assignedToName,
    dueDate: base.dueDate || project.dueDate || "",
    // Start på alla jobb (plan 1M): a new job in a project starts today, or the project's first day / last day when today is outside.
    ...(!base.id ? { plannedStartDate: defaultStartDate({ today: base.plannedStartDate || swedishDayKey(new Date()), dueDate: base.dueDate || project.dueDate || "", frame: { startDate: project.startDate ?? "", dueDate: project.dueDate ?? "" } }) } : {}),
  } : { ...base, projectId: null };
  // The builder's preview starts from its example answers instead of an empty protocol.
  const blankData = (): TaskData => {
    const data = emptyData(kind, form);
    if (preview && data.kind === "FORM") return { ...data, details: { ...data.details, values: preview.values } };
    // A protocol started from a round carries the round and its day; where it is done comes with its work order (2026-10-27 kväll).
    if (data.kind === "FORM" && roundParam && occurrenceParam && /^\d{4}-\d{2}-\d{2}$/.test(occurrenceParam)) return { ...data, details: { ...data.details, values: { ...data.details.values, round: { scheduleId: roundParam, occurrence: occurrenceParam, scans: [] } } } };
    return data;
  };
  // Skapa arbetsorder för ronden (2026-10-27, punkt 3): a new work order opened from a round holds it, with the
  // period in the address (a year from the occurrence by default); the person may change everything before saving.
  const dayParam = (key: string) => { const value = preview || kind !== "WORK_ORDER" ? null : searchParams.get(key); return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; };
  const roundOrderParam = preview || kind !== "WORK_ORDER" ? null : searchParams.get("roundScheduleId")?.slice(0, 100) || null;
  const roundPeriodParam = roundOrderParam ? { from: dayParam("roundFrom"), to: dayParam("roundTo") } : null;
  const blankTask = (): WorkflowTaskRecord => inherit({ id: "", version: 0, kind, title: kind === "FORM" && form ? (roundParam && roundTitleParam && occurrenceParam ? `${roundTitleParam} ${occurrenceParam}` : form.name) : "", description: "", status: "PLANNED", progress: 0, projectId: null, customerId: customerId ?? null, facilityId: facilityParam ?? null, assignedToUserId: roundAssignee?.id ?? null, assignedToName: roundAssignee?.name ?? "", dueDate: roundPeriodParam?.to ?? "", plannedStartDate: roundPeriodParam?.from ?? swedishDayKey(new Date()), data: blankData(), totalDurationSec: 0, timerRunning: false, workOrderId: workOrderParam, ...(roundOrderParam ? { roundScheduleId: roundOrderParam } : {}) }, projects.find((project) => project.id === projectId));
  const [task, setTask] = useState<WorkflowTaskRecord>(blankTask);
  // The newest task, for what is applied after an answer has arrived (Workflow AI's proposals, 2026-10-02).
  const latestTask = useRef(task);
  // Inköp (2026-10-16): the one question on a work order's first picked article, and its purchase following the rows.
  // Företagets moduler (0.39.0): the job's panels of a module that is off are not drawn; a job works without them. Display only.
  const moduleIsOn = useModules();
  const purchaseQuickPick = usePurchaseQuickPick({ disabled: kind !== "WORK_ORDER" || Boolean(local) || Boolean(preview) || !moduleIsOn("purchasing"), kind: "work_order", documentId: task.id || null, projectId: task.projectId, workOrderId: task.id || null, title: task.title });
  // A layout effect, so it is current before any passive effect of this commit (a form panel filling in limits, the
  // inspector prefill) reads it: a passive one could put back an older task after such a change (QA 2026-10-10).
  useLayoutEffect(() => { latestTask.current = task; });
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
  const prefilled = (next: WorkflowTaskRecord, kinds?: FormPrefill[], overwrite = false, extra?: FormPrefillSource): WorkflowTaskRecord => {
    if (next.data.kind !== "FORM" || next.status === "COMPLETED") return next;
    const project = projects.find((item) => item.id === next.projectId);
    const customer = customers.find((item) => item.id === (project?.customerId ?? next.customerId));
    const facility = customer?.facilities?.find((item) => item.id === next.facilityId);
    const places = customer?.facilities ?? [];
    const source: FormPrefillSource = { today: swedishDayKey(new Date()) };
    if (customer) Object.assign(source, customerPrefill(customer, project));
    if (project) source.project = project.name;
    // The place's whole way with the facility's address (Platser, 2026-10-04).
    if (facility || project) source.facility = facility ? placeLabel(places, facility.id) : project!.name;
    if (next.assignedToName) source.assignee = next.assignedToName;
    if (userName) source.user = userName;
    Object.assign(source, extra);
    const values = applyFormPrefill(next.data.details.document, next.data.details.values, source, { kinds, overwrite });
    return titled(values === next.data.details.values ? next : { ...next, data: { ...next.data, details: { ...next.data.details, values } } });
  };
  // A new protocol fills its empty fields once the customer and project lists have arrived.
  // The task editor's data effects (this one, "Ny", the scan and the inspector) write into the draft in their order on
  // the same render; moved into rendering or a microtask that order would change, so they stay effects.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- see the note above
  useEffect(() => { if (!task.id) setTask((current) => prefilled(current)); }, [customers, projects, form?.templateId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [members, setMembers] = useState<Member[]>([]);
  // Underhåll (2026-10-30): the maintenance items the work order holds, as its items panel read them (Cloud), for
  // the priority in the header and the fault in Uppdraget. The facts themselves are edited on the item.
  const [itemsRead, setItemsRead] = useState<{ workOrderId: string; items: MaintenanceItemRow[] } | null>(null);
  const readItems = useCallback((items: MaintenanceItemRow[], workOrderId: string) => setItemsRead({ workOrderId, items }), []);
  const orderItems = itemsRead && itemsRead.workOrderId === task.id ? itemsRead.items : [];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // A link to a task that does not exist or that the person may not read shows a plain notice, never an editable blank
  // task with Spara (quality check 2026-10-05, F7). The server refuses either way.
  const [unavailable, setUnavailable] = useState("");
  // The last save's error, for the completion dialog that covers the page's message.
  const lastError = useRef("");
  const [customerPicker, setCustomerPicker] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignError, setAssignError] = useState("");
  // Tilldela from the bell (`&assign=1`): the dialog is open once the order is read, until the person closes it.
  const [assignAskHandled, setAssignAskHandled] = useState("");
  const [obstacleOpen, setObstacleOpen] = useState(false);
  // Ny arbetsorder at level 1 (2026-10-14): the office fields wait under a folded "Fler uppgifter".
  const [moreOpen, setMoreOpen] = useState(false);
  // Etapp: the stages already used in the project, as suggestions (Local: from the file's own jobs).
  const [fetchedStages, setFetchedStages] = useState<{ projectId: string; stages: string[] } | null>(null);
  const stageProjectId = task.projectId;
  // The guided flow (2026-09-30): completing asks for time in the same step; linked work orders show their state.
  const [completeOpen, setCompleteOpen] = useState(false);
  // The order's tasks that are not done, said in Färdigställ (M6); read when the dialog opens.
  const [openTasksText, setOpenTasksText] = useState("");
  const [bookingsRead, setBookingsRead] = useState(0);
  // Skicka med e-post, at the foot of every control (2026-10-02): the recipient and an optional message.
  const [sendOpen, setSendOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [sendNote, setSendNote] = useState("");
  const [fetchedOrders, setFetchedOrders] = useState<Record<string, LinkedTask>>({});
  const [savedAt, setSavedAt] = useState("");
  // Utförande först (2026-10-08): the order is settled once per opened task from its saved responsible, so the page never
  // rearranges itself while the person works – not when a new task is first saved here, nor when Ansvarig is changed.
  const [createdHere, setCreatedHere] = useState("");
  const [orderBasis, setOrderBasis] = useState<{ id: string; responsibleId: string | null }>({ id: "", responsibleId: null });
  // What the server last confirmed (or the blank start): the page is unsaved when the person's fields differ from it.
  const [savedKey, setSavedKeyState] = useState<string | null>(null);
  // The same at once, for a save that waited for another (flush must not send an unchanged task again).
  const savedKeyRef = useRef<string | null>(null);
  const setSavedKey = (key: string | null) => { savedKeyRef.current = key; setSavedKeyState(key); };
  /**
   * What the page fills in by itself on a saved task (the limits that follow the company's values, "Kontrollerat av" from
   * the roles): shown at once, but opening a task never saves it (QA 2026-10-10: every open made a new version). It is
   * saved with the person's next change; while the person has unsaved changes it simply joins them.
   */
  const applyDerived = (update: (current: WorkflowTaskRecord) => WorkflowTaskRecord) => {
    const current = latestTask.current;
    const next = update(current);
    if (next === current) return;
    const clean = Boolean(current.id) && savedKeyRef.current !== null && savedKeyRef.current === taskKey(savable(current));
    latestTask.current = next;
    setTask(next);
    if (clean) setSavedKey(taskKey(savable(next)));
  };
  const attachmentInput = useRef<HTMLInputElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const receiptInput = useRef<HTMLInputElement | null>(null);
  // The task as the server last confirmed it (or as it was just sent). A reply from the server replaces only what the
  // person has not changed since, so text typed while a save or reload is under way is kept (2026-09-30: "Utfört
  // arbete" typed right after the first save was lost when the new task was read back).
  const baseline = useRef<WorkflowTaskRecord | null>(null);
  // A new material or expense row that is still blank is never saved (simulation 2026-10-10, telefon fynd 4: an empty
  // "Ny utgift", 0 kr, stayed on the job after the person left its screen): what a save sends and what counts as unsaved
  // leave it out until something is written in it. Rows already saved stay (lib/workflow/expenses.ts).
  // The saved rows are read from the saved key (state while rendering, its ref elsewhere), never from the baseline ref.
  const savable = (record: WorkflowTaskRecord) => savableTask(record, savedKeyRef.current);
  // Since live sync (2026-10-04) the reply is merged field by field and row by row: the person's own changes
  // since the baseline stay, everything else follows the server, and a colleague's change in another field is kept.
  const applyServer = (incoming: WorkflowTaskRecord, from?: TaskChange) => {
    const base = baseline.current;
    // A read sent before a newer save can arrive after it (a new task's first reload racing its next autosave): an
    // older version is never merged, or it would undo what that save carried (regression 2026-10-06).
    if (base && base.id === incoming.id && typeof base.version === "number" && typeof incoming.version === "number" && incoming.version < base.version) return;
    const before = latestTask.current;
    // Text the server only trimmed stays as typed, so a reply never takes a space or line break from under the caret
    // (2026-10-05).
    const server = base && base.id === incoming.id ? { ...incoming, ...keepSentText(personFields(base), personFields(incoming)) } : incoming;
    baseline.current = server;
    setSavedKey(taskKey(server));
    if (base && before.id === server.id && from && from.byUserId !== userId) reportRemote(base, before, server, from);
    setTask((current) => {
      // A new task in Local keeps no id on screen after its first save (only the baseline has it): it is still this task,
      // so what was typed since that save is merged, not replaced by the file's copy (the lost first input in Local).
      const sameTask = current.id ? current.id === server.id : base?.id === server.id;
      if (!base || !sameTask) return server;
      return { ...server, ...threeWayMerge(personFields(base), personFields(current), personFields(server)).value };
    });
  };
  // What the person saved in the last two minutes: a colleague's change there is announced, since it replaces theirs.
  const recentSaves = useRef<{ path: MergePath; at: number }[]>([]);
  const [remoteNotice, setRemoteNotice] = useState("");
  const [liveNote, setLiveNote] = useState("");
  function reportRemote(base: WorkflowTaskRecord, mine: WorkflowTaskRecord, server: WorkflowTaskRecord, from: TaskChange) {
    const incoming = changedPaths(personFields(base), personFields(server));
    const now = new Date().getTime();
    recentSaves.current = recentSaves.current.filter((entry) => now - entry.at < 120_000);
    if (!incoming.length) return;
    const overlaps = (a: MergePath, b: MergePath) => pathWithin(a, b) || pathWithin(b, a);
    const unsaved = changedPaths(personFields(base), personFields(mine));
    const clashUnsaved = incoming.filter((path) => unsaved.some((own) => overlaps(path, own)));
    const clashSaved = incoming.filter((path) => !clashUnsaved.includes(path) && recentSaves.current.some((entry) => overlaps(path, entry.path)));
    const labels = (paths: MergePath[]) => [...new Set(paths.map((path) => taskPathLabel(server, path)))];
    const time = formatSwedish(new Date(), { timeStyle: "short" });
    if (server.status === "COMPLETED" && base.status !== "COMPLETED") {
      const text = `${from.byName} har färdigställt uppgiften och den är nu låst.${unsaved.length ? " Dina senaste ändringar hann inte sparas. De finns kvar i webbläsaren." : ""}`;
      setRemoteNotice(text); announce(text, Boolean(unsaved.length));
      return;
    }
    if (clashSaved.length) {
      const single = clashSaved.length === 1 ? valueAtPath(personFields(server), clashSaved[0]) : undefined;
      const shown = typeof single === "string" || typeof single === "number" ? `: ”${String(single).slice(0, 80)}”` : "";
      const text = `${from.byName} ändrade också ${listNames(labels(clashSaved))}, som du nyss ändrade. ${possessive(from.byName)} ändring gäller nu${shown}.`;
      setRemoteNotice(text); announce(text, true);
    } else if (clashUnsaved.length) {
      const text = `${from.byName} ändrade ${listNames(labels(clashUnsaved))} samtidigt som du. Din ändring sparas strax och ersätter ${possessive(from.byName)}.`;
      setRemoteNotice(text); announce(text);
    }
    setLiveNote(`Uppdaterad med ${possessive(from.byName)} ändringar ${time}`);
  }
  /**
   * A save refused because someone saved first (409) and both changed the same field (F3, 2026-10-28: "inte tyst
   * skriver över andras ändringar ... tydlig information om vad som faktiskt sparats"): the page shows what is saved,
   * says which fields, and keeps the person's own values so "Använd min text" can save them on purpose.
   */
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const [showMine, setShowMine] = useState(false);

  // The permission area of a new job (Ansvarig lists the people who may read it); a saved job's comes from the server.
  const newJobSubject = workflowSubjectForTask(kind, form?.area);
  // The draft kept in this browser for the task (or for a new one of this kind, form and project).
  const draftKeyFor = (id: string) => !preview && !local && userId ? `${DRAFT_PREFIX}${userId}.${id || `new.${kind}.${formId ?? ""}.${projectId ?? ""}${workOrderParam ? `.${workOrderParam}` : ""}`}` : null;
  // Changes typed before a lost connection or a closed tab come back, merged with what has been saved since.
  function restoreDraft(server: WorkflowTaskRecord) {
    const key = draftKeyFor(server.id);
    const draft = key ? readDraft(key) : null;
    if (!key || !draft) return;
    if (server.status === "COMPLETED") { forgetDraft(key); return; }
    // A draft never takes the task out of its work order (testflöde 2026-10-31).
    const merged = draftKeepsWorkOrder(threeWayMerge(draft.base ?? personFields(server), draft.task, personFields(server)).value, server.workOrderId);
    if (sameJson(merged, personFields(server))) { forgetDraft(key); return; }
    setTask((current) => ({ ...current, ...merged }));
    setMessage(`Osparade ändringar från ${formatSwedish(new Date(draft.at), { dateStyle: "short", timeStyle: "short" })} är återställda och sparas nu.`);
  }
  async function load() {
    if (preview) { setMembers(userName ? [{ id: "preview-user", name: userName }] : []); return; }
    setUnavailable("");
    try {
      const taskResult = await (local ? Promise.resolve({ tasks: local.tasks, members: local.members ?? [] }) : api<{ tasks: WorkflowTaskRecord[]; members: Member[] }>(taskId ? `/api/workflow-tasks?id=${encodeURIComponent(taskId)}` : `/api/workflow-tasks?members=only&subject=${encodeURIComponent(newJobSubject)}`));
      setMembers(taskResult.members);
      // A new job never starts with a responsible person who may not read it (the project's responsible or a round's,
      // simulation 2026-10-10): the server would refuse the save, so the choice is let go and the page says why.
      if (!taskId) {
        const current = latestTask.current;
        const refused = !current.id && current.assignedToUserId ? taskResult.members.find((member) => member.id === current.assignedToUserId && member.canRead === false) : undefined;
        if (refused) {
          const clean = savedKeyRef.current === taskKey(savable(current));
          const next = { ...current, assignedToUserId: null, assignedToName: "" };
          latestTask.current = next; setTask(next);
          if (clean) setSavedKey(taskKey(next));
          setMessage(assigneeReadRefusal(refused.name, newJobSubject));
        }
      }
      if (taskId && !local) {
        const current = taskResult.tasks.find((item) => item.id === taskId);
        if (!current) { setUnavailable("Uppgiften finns inte, eller så saknar du behörighet att öppna den."); return; }
        const first = !baseline.current || baseline.current.id !== current.id;
        applyServer(current);
        if (first) restoreDraft(current);
      }
    } catch (issue) {
      // Without a loaded task there is nothing to edit; an error on a later reload keeps the open editor.
      const status = (issue as { status?: number }).status;
      if (taskId && !local && baseline.current?.id !== taskId) setUnavailable(status === 403 || status === 404 ? "Uppgiften finns inte, eller så saknar du behörighet att öppna den." : (issue as Error).message || "Uppgiften kunde inte hämtas.");
      else setError((issue as Error).message);
    }
  }
  // A new job asks for the people who may read its type, which follows the form once it has arrived.
  useEffect(() => { queueMicrotask(() => void load()); }, [taskId, taskId ? "" : newJobSubject]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => { pruneDrafts(); }, []);
  // "Ny" from an open editor navigates to the same type without a taskId; start from a blank task of that type.
  useEffect(() => {
    if (taskId) return;
    baseline.current = null;
    const fresh = prefilled(blankTask());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one of the editor's data effects (see the note at the prefill effect)
    setSavedKey(taskKey(fresh)); setError("");
    // A new task that was being written when the tab closed comes back once (with Kasta utkastet to start over).
    const draft = copyOf || (kind === "FORM" && !form) ? null : readDraft(draftKeyFor("") ?? "");
    const restored = draft && (draft.task.data as TaskData | undefined)?.kind === fresh.data.kind && (fresh.data.kind !== "FORM" || (draft.task.data as TaskData).kind === "FORM" && (draft.task.data as Extract<TaskData, { kind: "FORM" }>).details.templateVersion === fresh.data.details.templateVersion);
    // The address's work order stays the new task's (testflöde 2026-10-31: a restored control lost it and was saved so).
    setTask(restored ? draftKeepsWorkOrder({ ...fresh, ...draft.task, status: fresh.status }, fresh.workOrderId, { fromAddress: true }) : fresh);
    setDraftRestored(Boolean(restored));
    setMessage(restored ? `Ett osparat utkast från ${formatSwedish(new Date(draft.at), { dateStyle: "short", timeStyle: "short" })} är återställt.` : "");
  }, [taskId, kind, form?.templateId, form?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  // Spara som: the new protocol gets the source's answers, place (also the temporary one) and customer, without
  // signatures or pictures.
  useEffect(() => {
    if (!copyOf || taskId || kind !== "FORM" || !form) return;
    let active = true;
    const source = local ? Promise.resolve(local.tasks.find((item) => item.id === copyOf)) : api<{ tasks: WorkflowTaskRecord[] }>(`/api/workflow-tasks?id=${encodeURIComponent(copyOf)}`).then((result) => result.tasks[0]);
    source.then((item) => {
      if (!active || !item || item.data.kind !== "FORM") return;
      const values = clearMeasurements(item.data.details.document, copyFormValues(item.data.details.values));
      setTask((current) => current.data.kind !== "FORM" ? current : titled({ ...current, title: `${item.title} (kopia)`.slice(0, 200), description: item.description, projectId: item.projectId, customerId: item.customerId, facilityId: item.facilityId ?? null, workOrderId: item.workOrderId ?? null, workOrder: item.workOrder ?? null, data: copyTempPlace({ ...current.data, details: { ...current.data.details, values } }, item.data) }));
      setMessage("Kopian är inte sparad än. Mätvärden, bedömningar och sammanfattning är tömda. Kontrollera och spara.");
    }).catch((issue) => { if (active) setError((issue as Error).message); });
    return () => { active = false; };
  }, [copyOf, taskId, kind, form?.templateId]); // eslint-disable-line react-hooks/exhaustive-deps
  // QR at the object (2026-10-04): a round opened from a scanned label records the scan and shows the place's
  // point – the checklist point or row that names the place or its marking – so nobody has to look for it.
  // Whether the person has done something in a new task (declared here for the scan below; see R2-KTR-01 further down).
  const touchKey = `${taskId ?? ""}|${kind}|${form?.templateId ?? ""}`;
  const [touchedFor, setTouchedFor] = useState("");
  // A scan only opens a protocol made beforehand (2026-10-22): on a new task the address is ignored, so a scan never
  // creates a job (marking a new task as touched would autosave it).
  const scanPlace = preview || !taskId ? null : searchParams.get("scanPlace");
  // Starta ronden after a scan (svar 10, 2026-10-24): the person pressed Starta, so the new round protocol is created
  // at once with the same save as Spara (the server decides the right), and its address keeps the scan so it opens at the point.
  const scanStartPlace = !preview && !taskId && kind === "FORM" && searchParams.get(SCAN_START_PARAM) === "1" ? searchParams.get("scanPlace") : null;
  const scanStarted = useRef(false);
  const scanDone = useRef<string | null>(null);
  const scanShown = useRef<string | null>(null);
  // The scanned point to show: its block opens the form's part on a phone in the app (below, once the screens are known).
  const [scanFocus, setScanFocus] = useState<{ point: string; blockId: string } | null>(null);
  // The state of the work orders made from this protocol's rows, shown on each row (read within the person's rights).
  const orderIds = task.data.kind === "FORM" ? [...Object.values(task.data.details.values.tables).flat().map((row) => row.workOrderId), ...Object.values(task.data.details.values.workOrders ?? {})].filter((id): id is string => Boolean(id)) : [];
  const orderKey = [...new Set(orderIds)].sort().join(",");
  const rowFocused = useRef("");
  const linkedOrdersRef = useRef<Record<string, LinkedTask>>({});
  const rowFocusEffect = () => {
    const timer = window.setTimeout(() => {
      const target = [...window.document.querySelectorAll<HTMLElement>("[data-deviation-target]")].find((element) => element.dataset.deviationTarget === rowParam);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("ring-2", "ring-primary", "ring-offset-2");
      target.setAttribute("data-focused-row", "true");
      // Only where a work order was made from the row and is not known to be open (Fas 2, 2026-10-11): arriving from the
      // deviation log without one gets no toast that claims a finished order.
      const orderId = task.data.kind === "FORM" ? formTargetWorkOrderId(task.data.details.values, rowParam) : null;
      const orderStatus = orderId ? linkedOrdersRef.current[orderId]?.status : undefined;
      if (orderId && (!orderStatus || orderStatus === "COMPLETED"))
        announce("Arbetsordern är utförd. Följ upp avvikelsen här.");
    }, 400);
    return () => window.clearTimeout(timer);
  };
  // Without orders (or in a preview) what was read is forgotten, set while rendering (React's "adjust state when a
  // value changes"); Local reads the orders from its file, Cloud asks the server.
  if ((!orderKey || preview) && Object.keys(fetchedOrders).length) setFetchedOrders({});
  const localTasks = local?.tasks;
  const linkedOrders = useMemo<Record<string, LinkedTask>>(() => !orderKey || preview ? {} : localTasks ? Object.fromEntries(localTasks.filter((item) => orderKey.split(",").includes(item.id)).map((item) => [item.id, { id: item.id, title: item.title, status: item.status, kind: item.kind, dueDate: item.dueDate }])) : fetchedOrders, [fetchedOrders, localTasks, orderKey, preview]);
  useEffect(() => { linkedOrdersRef.current = linkedOrders; }, [linkedOrders]);
  useEffect(() => {
    if (!orderKey || preview || local) return;
    let active = true;
    api<{ links: LinkedTask[] }>(`/api/workflow-tasks?links=${encodeURIComponent(orderKey)}`).then((result) => { if (active) setFetchedOrders(Object.fromEntries(result.links.map((item) => [item.id, item]))); }).catch(() => undefined);
    return () => { active = false; };
  }, [orderKey, local?.tasks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!local || !taskId) return;
    const current = local.tasks.find((item) => item.id === taskId);
    if (current) applyServer(current);
  }, [local?.tasks, taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedProject = projects.find((project) => project.id === task.projectId);
  useEffect(() => {
    if (!stageProjectId || preview || local) return;
    let alive = true;
    api<{ stages: string[] }>(`/api/project-schedule?projectId=${encodeURIComponent(stageProjectId)}&stages=1`).then((result) => { if (alive) setFetchedStages({ projectId: stageProjectId, stages: result.stages }); }, () => { /* no right to read the project's plan: no suggestions */ });
    return () => { alive = false; };
  }, [stageProjectId, preview, local]);
  const stageOptions = local ? stageSuggestions(local.tasks.filter((item) => item.projectId === task.projectId && task.projectId)) : fetchedStages?.projectId === task.projectId ? fetchedStages.stages : [];
  const obstacle = task.id ? jobObstacle({ status: task.status, data: task.data, updatedAt: task.updatedAt }) : null;
  // Brödsmulor (2026-10-09): the task's project and work order above it, each a link, and its title last. A work
  // order the person may not read is left out of the trail.
  const trailWorkOrder = task.kind !== "WORK_ORDER" && task.workOrderId && task.workOrder?.readable !== false ? task.workOrderId : null;
  const trailCustomer = customers.find((customer) => customer.id === task.customerId);
  usePageTrail({ task: task.title.trim() || undefined, customer: trailCustomer ? customerTitle(trailCustomer) : undefined, project: selectedProject?.name, workOrder: trailWorkOrder ? task.workOrder?.title : undefined },
    { projectId: task.projectId ?? undefined, workOrderId: trailWorkOrder ?? undefined });
  // Egenkontroll (etapp 2–3; levels 2026-10-07): read before any early return (hooks). A new task asks about the form (or
  // the kind) it starts from, so its risk class shows from the start.
  // A control also asks for the scope the project's planning protocol selects (2026-10-07); only a form with such moments does.
  const asksPlanning = task.data.kind === "FORM" && documentHasPlanningMoments(task.data.details.document);
  const work = useSelfInspectionWork({ taskId: task.id || null, projectId: task.projectId ?? null, planning: asksPlanning, formId: !task.id && kind === "FORM" ? form?.templateId ?? null : null, kind: !task.id && kind !== "FORM" ? kind : null }, !preview);
  // An archived or closed project freezes its work (simulation 2026-10-02: the page looked editable and only the save failed).
  const projectFrozen = Boolean(selectedProject && (selectedProject.archivedAt || selectedProject.closedAt));
  // Utgår (2026-10-09): a job that will not be done is read-only like a frozen one until it is restored (Återuppta).
  const cancelled = isTaskCancelled(task.status);
  const frozen = projectFrozen || cancelled;
  // Roller med nivå (2026-10-07): when the person's level does not reach the task's risk class the content is read-only and
  // the page says why; the planning fields stay open, so a supervisor of enough level can be made responsible and the person
  // can then work under supervision. A finished task is not explained again. The server decides again on every save.
  const levelBlock = !preview && task.status !== "COMPLETED" && work.context ? workBlock(work.context, { responsibleId: task.assignedToUserId, responsibleName: task.assignedToName }) : null;
  // Uppgifter får skapas först (2026-10-27): a draft without a work order keeps its own fields (rubrik, ansvarig,
  // datum, plats) open, but the work – the time, the protocol, signing and Färdigställ – waits until it is linked. The
  // server refuses the same (lib/workflow/work-order-link.ts).
  const linkBlock = !preview && taskNeedsWorkOrder(task) && task.status !== "COMPLETED" && !cancelled ? WORK_ORDER_REQUIRED : null;
  const startBlock = levelBlock ?? linkBlock;
  const contentLocked = frozen || Boolean(startBlock);
  if (task.id !== orderBasis.id) setOrderBasis({ id: task.id, responsibleId: task.id && task.id !== createdHere ? task.assignedToUserId ?? null : null });
  // Utförande först: for the responsible person on a phone or tablet at level 1–2 the work comes right under Uppdraget and
  // the planning panels follow it (folded, with their title and Visa). Order only; nothing is removed.
  // The Arbetsledare work view (2026-10-08) keeps the planning first.
  const workFirst = !preview && viewDefaults.executionFirst && executionFirst({ level: orderLevel, saved: Boolean(task.id), responsibleId: orderBasis.id === task.id ? orderBasis.responsibleId : null, viewerId: userId });
  const assigneeBlock = !preview && task.assignedToUserId && work.context ? assignBlock(work.context, { id: task.assignedToUserId, name: task.assignedToName }) : null;
  // The responsible person, from Ansvarig or from the level notice below (a person under supervision opens the task by
  // naming a supervisor of enough level). "Utfört av" is the one who does the job: it follows the chosen person while it
  // still holds what the page filled in itself (simulation 2026-10-10: it kept the name of the boss who created the
  // protocol for someone else).
  const withResponsible = (current: WorkflowTaskRecord, id: string) => {
    const member = members.find((item) => item.id === id);
    const next = { ...current, assignedToUserId: member?.id ?? null, assignedToName: member?.name ?? "" };
    const performed = current.data.kind === "FORM" ? formLeafBlocks(current.data.details.document).find((block) => block.type === "field" && block.prefill === "user") : undefined;
    const performedText = performed && "key" in performed && current.data.kind === "FORM" ? String(current.data.details.values.fields[performed.key] ?? "").trim() : "";
    const followsPage = !performedText || performedText === current.assignedToName.trim() || performedText === (userName ?? "").trim();
    return followsPage ? prefilled(next, ["assignee", "user"], true, { user: next.assignedToName || userName || "" }) : prefilled(next, ["assignee"]);
  };
  const chooseResponsible = (id: string) => setTask((current) => withResponsible(current, id));
  /**
   * Tilldela (2026-11-07): the chosen person becomes Ansvarig through the ordinary save, so the server checks rights, level and
   * Origin, keeps the version and tells the person. More people open the booking form with them ticked; the time is chosen there.
   */
  async function assignTo(responsibleId: string, more: string[]) {
    const member = members.find((item) => item.id === responsibleId);
    if (!member) return false;
    setAssignError("");
    lastError.current = "";
    const next = withResponsible(latestTask.current, responsibleId);
    latestTask.current = next;
    setTask(next);
    const id = await save(next.status, null, { quiet: true });
    if (!id) { setAssignError(lastError.current || "Arbetsordern kunde inte tilldelas."); return false; }
    announce(`${member.name} är ansvarig för arbetsordern.`);
    if (more.length) router.push(subPageHref(bookPeopleHref(id, [responsibleId, ...more])));
    return true;
  }
  // Arbetsordern styr (2026-10-26): a task's customer and project are its work order's and shown locked; its place is
  // chosen among that customer's places. A work order's customer follows its project's, as before.
  const inOrder = kind !== "WORK_ORDER";
  // A draft without a work order (2026-10-27) chooses its customer like a work order; once linked it takes the order's.
  const linkedToOrder = inOrder && Boolean(task.workOrderId);
  const customerLocked = linkedToOrder || Boolean(selectedProject?.customerId);
  useCustomerReference(selectedProject?.customerId ?? task.customerId, !local && !preview);
  const lockedCustomerId = linkedToOrder ? task.customerId : selectedProject?.customerId;
  // Facilities of the task's customer (decision 11); a paused facility stays selectable only when already linked.
  const facilityCustomerId = (customerLocked ? lockedCustomerId : task.customerId) ?? "";
  const customerPlaces = customers.find((customer) => customer.id === facilityCustomerId)?.facilities ?? [];
  // Plats (2026-10-04): one field that searches the whole way; picking a place of another customer (without a
  // project) chooses that customer too, and a new place can be added right in the field.
  // The place only helps find the installation (2026-10-11, replaces "Plats as the source" 2026-10-07 for protocols):
  // choosing one fills "Projekt / anläggning" only while that field is empty or still holds a place's way or the project's
  // name; a text typed by hand stays, and the place is still linked (Bilkostnad, place history).
  const choosePlace = (placeId: string | null, owner: string | null) => setTask((current) => {
    const facility: FormPrefill[] = placeFieldTyped(current) ? [] : ["facility"];
    if (!customerLocked && owner && owner !== current.customerId) {
      const customer = customers.find((item) => item.id === owner);
      const withCustomer = prefilled({ ...current, customerId: owner, facilityId: placeId }, ["customer", "contact", "email", ...facility], true);
      return customer ? withCustomer : current;
    }
    return facility.length ? prefilled({ ...current, facilityId: placeId }, facility, true) : { ...current, facilityId: placeId };
  });
  // A field filled from the place is read-only with "Ändra plats" opening the picker; a typed text stays free text.
  const [placeOpenRequest, setPlaceOpenRequest] = useState(0);
  const linkedPlace = task.facilityId ? customerPlaces.find((place) => place.id === task.facilityId) ?? null : null;
  // Bilkostnad (2026-10-08): the task's place with its own or inherited position, and every place with a position
  // the person may read (the customers' places) as a possible start.
  // Without a linked place the job's temporary place (2026-10-08) is the destination when it has a pin.
  const tempPlace = tempPlaceOf(task.data);
  const tempPosition = tempPlacePosition(tempPlace);
  const carCostDestination: CarCostDestination | null = linkedPlace ? { label: placePath(customerPlaces, linkedPlace.id, customers.find((customer) => customer.id === facilityCustomerId)?.name), position: placePosition(customerPlaces, linkedPlace.id) }
    : tempPosition ? { label: `Tillfällig plats: ${tempPlaceLabel(tempPlace)}`, position: tempPosition } : null;
  // Ring och Navigera (2026-10-12): the customer's numbers and the way to the job's place (its own or inherited position and
  // address; without a place the temporary place, else the customer's address). Only what is filled in; data the person already reads.
  const jobCustomer = customers.find((customer) => customer.id === facilityCustomerId) ?? null;
  const jobDestination = linkedPlace ? { ...placeAddress(customerPlaces, linkedPlace.id), latitude: placePosition(customerPlaces, linkedPlace.id)?.latitude, longitude: placePosition(customerPlaces, linkedPlace.id)?.longitude }
    : !tempPlaceIsEmpty(tempPlace) ? { address: tempPlace?.address, postalCode: tempPlace?.postalCode, city: tempPlace?.city, latitude: tempPosition?.latitude, longitude: tempPosition?.longitude }
    : jobCustomer ? { address: jobCustomer.address, postalCode: jobCustomer.postalCode, city: jobCustomer.city } : null;
  const contactActions = task.id ? (native: boolean) => <ContactActions native={native} name={jobCustomer?.name} phone={jobCustomer?.phone} mobile={jobCustomer?.mobile} destination={jobDestination} testId={native ? "native-job-contact" : "job-contact"} /> : () => null;
  const carCostStarts: CarCostStartPlace[] = useMemo(() => customers.flatMap((customer) => (customer.facilities ?? []).flatMap((place) => {
    if (!place.isActive || typeof place.latitude !== "number" || typeof place.longitude !== "number") return [];
    return [{ id: place.id, label: placePath(customer.facilities ?? [], place.id, customerTitle(customer)), position: { latitude: place.latitude, longitude: place.longitude } }];
  })), [customers]);
  // A new protocol with a place shows the place's way in that field, also when it was typed before the place was linked.
  // A saved protocol is never rewritten just by being opened (QA 2026-10-10: opening it changed its title and saved a
  // new version); choosing a place (choosePlace) still fills the field.
  // A text typed by hand there is never replaced by a place chosen by itself (MEMORY 2026-10-08; customer-place.ts).
  const automaticPlaceTexts = useMemo(() => [...customers.flatMap((customer) => (customer.facilities ?? []).map((place) => placeLabel(customer.facilities ?? [], place.id))), ...projects.map((project) => project.name)], [customers, projects]);
  const placeTextOf = (record: WorkflowTaskRecord) => {
    if (record.data.kind !== "FORM") return "";
    const block = formLeafBlocks(record.data.details.document).find((item) => item.type === "field" && item.prefill === "facility");
    return block && "key" in block ? String(record.data.details.values.fields[block.key] ?? "") : "";
  };
  const placeFieldTyped = (record: WorkflowTaskRecord) => !placeFieldFollowsPlace(placeTextOf(record), automaticPlaceTexts);
  const linkedPlaceId = linkedPlace?.id ?? null;
  useEffect(() => {
    if (!linkedPlaceId || contentLocked || preview || latestTask.current.id) return;
    setTask((current) => current.facilityId === linkedPlaceId && !placeFieldTyped(current) ? prefilled(current, ["facility"], true) : current);
  }, [linkedPlaceId, contentLocked]); // eslint-disable-line react-hooks/exhaustive-deps
  // The control's own Grunduppgifter (inline layout) has the place field on its own; the task panel uses CustomerField.
  const placeHint = placeChoiceHint(customerPlaces, facilityCustomerId || null, task.facilityId ?? null);
  const placeField = () => <div className="space-y-1"><PlacePicker id="task-place-inline" customers={customers} customerId={facilityCustomerId || null} openRequest={placeOpenRequest}
    value={task.facilityId ?? null} onChange={choosePlace} disabled={task.status === "COMPLETED" || frozen || Boolean(preview)}
    savePlace={preview ? undefined : local ? local.savePlace : canCreatePlaces ? cloudSavePlace : undefined} />
    {placeHint ? <p className="text-xs text-muted-foreground" data-testid="place-choice-hint">{placeHint}</p> : null}</div>;
  const dueDateError = selectedProject ? taskDueDateError(task.dueDate, selectedProject) : null;

  // The signer's name shown prefilled (the person's own, WorkOrderFields) counts as filled in (kundresan 2026-11-07, M7: the card said
  // "Ange namn" beside the name); Färdigställ writes it into the order before saving.
  const completion = workflowTaskCompletion(withShownSigner(task, userName));
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
  // "Upprepa kontrollen" (2026-10-06): a completed protocol becomes a round in Driftronder. Offered to those who may plan
  // rounds – Cloud asks the server (the demo answers no, it has no rounds), Local's file owner always may; the server
  // checks again when the round is saved.
  const [canRepeat, setCanRepeat] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const repeatable = isForm && task.status === "COMPLETED" && Boolean(task.id) && !preview;
  useEffect(() => {
    if (!repeatable || local) return;
    let active = true;
    api<{ canPlan?: boolean }>(`/api/form-schedules?canPlan=1${form?.templateId ? `&templateId=${encodeURIComponent(form.templateId)}` : ""}`).then((result) => { if (active) setCanRepeat(result.canPlan === true); }).catch(() => undefined);
    return () => { active = false; };
  }, [repeatable, Boolean(local), Boolean(local?.rounds), form?.templateId]); // eslint-disable-line react-hooks/exhaustive-deps
  const docWord = isForm ? "Protokollet" : task.kind === "WORK_ORDER" ? "Arbetsordern" : "Riskbedömningen";
  // A completed KFID protocol cannot be reopened (Spara som continues it instead); every other kind can (Återöppna
  // in the header below, same condition).
  const reopenable = task.formArea !== "kfid";
  // Like the control, time starts once the field the title follows is filled in, so the protocol gets its name when it is saved.
  const titleField = inlineTask && task.data.kind === "FORM" && task.data.details.document.task.titleKey ? formLeafBlocks(task.data.details.document).find((block) => block.type === "field" && block.key === (task.data.kind === "FORM" ? task.data.details.document.task.titleKey : "")) : undefined;
  const titleFieldEmpty = Boolean(titleField && task.data.kind === "FORM" && !String(task.data.details.values.fields[titleField.type === "field" ? titleField.key : ""] ?? "").trim());
  // Why a control cannot be used yet, as visible text and as a toast when it is pressed (2026-10-08: phones have no hover).
  const completedReason = task.status === "COMPLETED" ? `${docWord} är ${isForm ? "färdigställt" : "färdigställd"} och låst.` : "";
  // Återkommande underhåll (2026-10-30): a plan's vilande work order is planned and moved, but not started until its day or Aktivera.
  const dormantReason = !local && task.kind === "WORK_ORDER" && isDormant({ maintenancePlanId: task.maintenancePlanId ?? null, maintenanceDue: task.maintenanceDue ?? null, maintenanceActivatedAt: task.maintenanceActivatedAt ?? null, status: task.status }, swedishDayKey(new Date()))
    ? `Arbetsordern vilar till ${task.maintenanceDue}. Aktivera den eller vänta till dagen.` : "";
  const frozenReason = cancelled ? `${docWord} har utgått. Återuppta ${isForm ? "det" : "den"} för att arbeta vidare.` : frozen ? `Projektet är ${selectedProject?.archivedAt ? "arkiverat" : "avslutat"}, så uppgiften kan inte ändras.` : "";
  // Help instead of a ban (UX-granskningen avsnitt 6, punkt 7): "Skriv en rubrik så kan du spara.", never "Ange en rubrik först.".
  const titleLabel = titleField && "label" in titleField ? titleField.label : undefined;
  const titleMissing = titleFieldEmpty || !task.title.trim();
  const titleReason = titleMissing ? titleHelpText("spara", titleLabel) : "";
  const titleTimerReason = titleMissing ? titleHelpText("starta tiden", titleLabel) : "";
  const titleTarget = titleField ? `form-${titleField.id}` : "task-title";
  const unsavedReason = !task.id ? "Spara uppgiften först." : "";
  // Spara looks inactive only when nothing may be changed; without a title it leads to the title (punkt 7).
  const saveReason = completedReason || frozenReason;
  // The same fact row as the control's header (2026-09-27): what the task holds, who and when.
  const overdue = isLateTask(task, swedishDayKey(new Date()));
  const openItems = task.data.kind === "WORK_ORDER" ? orderItems.filter((item) => item.status === "OPEN") : [];
  const priority = highestPriority(openItems.map((item) => item.priority));
  const itemFault = openItems.map((item) => item.fault.trim()).find(Boolean) ?? "";
  const riskClass = !preview ? work.context?.riskClass ?? null : null;
  // Nivå 1 på mobil (2026-10-09): a saved job on a phone at level 1 is a menu of rows – Uppdraget, the steps and
  // Mer – and each row opens its own screen (`&step=` in the address, so links and the browser's back work) with the same
  // panels and fields as the page. Saving, autosave and the unsaved-work guard stay the editor's own.
  const native = useNativeMode();
  // Fakturaunderlag (2026-11-05): the button among the page's buttons, the status under Historik. Level 1 has its own row.
  const taskInvoice = useTaskInvoiceBasis({ taskId: task.id, completed: task.status === "COMPLETED", enabled: Boolean(invoiceBases && moduleIsOn("invoicing") && task.id && !local && !preview && !task.workOrderId && !native), onSummary: (summary) => setInvoiced(summary.marked.invoiced.length > 0) });
  const nativeJob = native && !preview && Boolean(task.id) && !unavailable;
  // A new job at level 1 (2026-10-09): a form screen of its own with Avbryt and Skapa in the top bar – the job's
  // basic fields (a protocol: the form's first part). Once created it is the job's menu of rows. Not in Local.
  const nativeNew = native && !preview && !task.id && !taskId && !unavailable && !local;
  // What Skapa said last time ("Skriv en rubrik så kan du skapa jobbet."): taken away once the job is created (QA 2026-10-10).
  const createReason = useRef("");
  const askTitle = (text: string) => { announce(text, true); focusTarget(titleTarget); };
  const createNew = () => {
    const reason = titleMissing ? titleHelpText(`skapa ${task.data.kind === "FORM" ? "protokollet" : "jobbet"}`, titleLabel) : "";
    if (reason) { createReason.current = reason; askTitle(reason); return; }
    // Off the browser-back entry first, so the created job takes the form's own entry in the history.
    void save().then((id) => { if (id && createReason.current) { withdrawAnnouncement(createReason.current); createReason.current = ""; } });
  };
  const screen = nativeJob ? parseJobScreen(searchParams.get("step")) : null;
  // Ett formulär på nivå 1 (2026-10-09): Ifyllnad shows one of the form's parts (its sections) per screen,
  // `&part=` in the address so the browser's back goes to the previous part. One part means no paging.
  const nativeForm = (nativeJob || nativeNew) && task.data.kind === "FORM" ? task.data.details : null;
  const parts = useMemo(() => nativeForm ? formParts(nativeForm.document, nativeForm.values) : [], [nativeForm]);
  const paged = parts.length > 1;
  const part = paged && screen === "formular" ? parseFormPart(searchParams.get("part"), parts.length) : 1;
  // A material row's own screen (`&item=`) belongs to the Material screen: leaving that screen never keeps it.
  const jobUrl = (step: JobScreen | null, toPart?: number | null) => { const params = new URLSearchParams(searchParams.toString()); if (step) params.set("step", step); else params.delete("step"); if (step === "formular" && toPart && toPart > 1) params.set("part", String(toPart)); else params.delete("part"); if (step !== "material") params.delete("item"); return `/?${params.toString()}`; };
  const openScreen = (step: JobScreen, toPart?: number | null) => router.push(jobUrl(step, toPart));
  // Tillbaka is a step back when the menu is where the person came from, so the menu keeps its place.
  // The job's other screens on the way (a form's parts, Nästa from step to step) are stepped past, not stacked on.
  const closeScreen = () => returnToWork(jobUrl(null), (href) => router.push(href), (url) => isScreenOf(url, jobUrl(null)));
  // What a screen held when it opened, for Avbryt (asks when something changed, `cancelScreen`): its fields go back, and autosave saves that again.
  // The latest flush (set by an effect after every render), for what runs before it is defined.
  const flushRef = useRef<(options?: { leaving?: boolean }) => Promise<boolean>>(() => Promise.resolve(true));
  const screenStart = useRef<PersonFields | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  useEffect(() => { screenStart.current = screen ? personFields(latestTask.current) : null; }, [screen, task.id]);
  // A material row's screen (`&item=`, QA 2026-10-10): Avbryt there puts back only that row as it was when it was opened
  // – a new row is dropped – and leads back to the list; rows finished with Klar before stay.
  const openItemId = screen === "material" ? searchParams.get("item") : null;
  const itemStart = useRef<{ id: string; row: Material | null } | null>(null);
  useEffect(() => {
    if (!openItemId || itemStart.current?.id === openItemId) return;
    const now = latestTask.current.data;
    itemStart.current = { id: openItemId, row: now.kind === "WORK_ORDER" ? now.details.materials.find((row) => row.id === openItemId) ?? null : null };
  }, [openItemId]);
  // Leaving a new row's screen any other way (Bakåt, a tab, a link) with nothing written lets the row go, like Avbryt.
  const lastItem = useRef<string | null>(null);
  useEffect(() => {
    const before = lastItem.current;
    lastItem.current = openItemId;
    if (!before || before === openItemId) return;
    if (savedRowIds(savedKeyRef.current).has(before)) return;
    setTask((current) => current.data.kind !== "WORK_ORDER" || !current.data.details.materials.some((row) => row.id === before && isBlankMaterialRow(row)) ? current
      : { ...current, data: { ...current.data, details: { ...current.data.details, materials: current.data.details.materials.filter((row) => row.id !== before) } } });
  }, [openItemId]);
  const itemScreenUrl = (id: string | null) => { const params = new URLSearchParams(searchParams.toString()); if (id) params.set("item", id); else params.delete("item"); return `/?${params.toString()}`; };
  // Nivå 1 (QA 2026-10-10): a new screen starts at its top and without the previous screen's messages ("Uppgiften är
  // sparad." on every step, an upload error carried to Signering). Back to the menu keeps the menu's place, except right
  // after Skapa, when the menu is new.
  const nativeView = nativeNew ? "new" : nativeJob ? `${screen ?? "menu"}|${screen === "formular" ? part : ""}|${openItemId ?? ""}` : "";
  const lastNativeView = useRef(nativeView);
  // A jump the editor makes itself to show what the message is about (the scanned point at Ifyllnad) keeps the message:
  // otherwise "Skannat: …" was cleared by the very screen change it caused (place-qr 2026-10-23).
  const keepMessageOnJump = useRef(false);
  useEffect(() => {
    const before = lastNativeView.current;
    if (before === nativeView) return;
    lastNativeView.current = nativeView;
    if (!before || !nativeView) return;
    if (keepMessageOnJump.current) keepMessageOnJump.current = false;
    else { setMessage(""); setError(""); }
    if (!nativeView.startsWith("menu|") || before === "new") window.scrollTo({ top: 0 });
  }, [nativeView]);
  // Avbryt on a step's screen with something changed since it opened asks first (2026-10-12: filled-in measurement
  // rows were thrown away without a question; a tab kept the draft). Never the browser's own box.
  const discardQuestion: ConfirmOptions = { title: "Kasta ändringarna?", message: "Det du har fyllt i sedan skärmen öppnades tas bort.", confirmLabel: "Kasta", cancelLabel: "Fortsätt redigera", tone: "danger" };
  const changedSince = (start: PersonFields) => taskKey(savable(latestTask.current)) !== taskKey(savable({ ...latestTask.current, ...start }));
  // A deviation logged from a row that is then removed, or thrown away with Kasta, must not stay in the log without its
  // row (2026-10-12): the entry is withdrawn – taken out while it is still untouched, marked otherwise (withdraw_deviation).
  const formRowIds = (data: TaskData) => new Set(data.kind === "FORM" ? Object.values(data.details.values.tables).flat().map((row) => row.id) : []);
  const withdrawRowDeviations = (before: TaskData, after: TaskData) => {
    const logged = work.context?.deviations ?? [];
    if (!logged.length || before.kind !== "FORM" || after.kind !== "FORM") return;
    const kept = formRowIds(after);
    const gone = [...formRowIds(before)].filter((id) => !kept.has(id));
    const entries = logged.filter((entry) => entry.rowId && gone.includes(entry.rowId));
    if (!entries.length) return;
    void Promise.all(entries.map((entry) => work.act({ action: "withdraw_deviation", id: entry.id })))
      .then(() => announce(entries.length === 1 ? "Avvikelsen från den borttagna raden är återkallad i avvikelseloggen." : "Avvikelserna från de borttagna raderna är återkallade i avvikelseloggen."))
      .catch((issue) => announce((issue as Error).message, true));
  };
  const cancelScreen = async () => {
    const start = screenStart.current;
    if (start && changedSince(start)) {
      // Autosave waits while the question is open, and a save under way ends first, so nothing is written behind the answer (KTR-01).
      setDiscardOpen(true);
      while (inFlight.current) await inFlight.current.catch(() => undefined);
      const keep = !(await confirm(discardQuestion));
      setDiscardOpen(false);
      if (keep) return;
    }
    if (start) {
      withdrawRowDeviations(latestTask.current.data, start.data);
      const restored = { ...latestTask.current, ...start };
      latestTask.current = restored; setTask(restored);
      // What was thrown away is also put back on the server at once (the leaving field may already have saved it).
      void flushRef.current();
    }
    closeScreen();
  };
  const cancelItem = async (id: string) => {
    const start = itemStart.current?.id === id ? itemStart.current.row : null;
    const now = latestTask.current.data;
    const row = now.kind === "WORK_ORDER" ? now.details.materials.find((item) => item.id === id) : undefined;
    const changed = row ? (start ? stableJson(row) !== stableJson(start) : !isBlankMaterialRow(row)) : false;
    if (changed && !(await confirm(discardQuestion))) return;
    setTask((current) => current.data.kind !== "WORK_ORDER" ? current : { ...current, data: { ...current.data, details: { ...current.data.details,
      materials: start ? current.data.details.materials.map((row) => row.id === id ? start : row) : current.data.details.materials.filter((row) => row.id !== id) } } });
    itemStart.current = null;
    returnToWork(itemScreenUrl(null), (href) => router.push(href));
  };
  // A requirement or the risk step on another screen opens that screen first, then leads to the field.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    window.requestAnimationFrame(() => { focusTarget(target); });
  }, [screen, part]);
  // A new part starts at its top.
  useEffect(() => { if (screen === "formular" && paged) window.scrollTo({ top: 0 }); }, [screen, part, paged]);
  // A link inside the form (the summary's rows that are not approved, Gå till raden) to a field in another part opens it.
  useEffect(() => {
    if (screen !== "formular" || !paged) return;
    return setMissingTargetHandler((target) => {
      const toPart = formPartForTarget(target, parts);
      if (!toPart || toPart === part) return false;
      pendingFocus.current = target;
      router.push(jobUrl("formular", toPart));
      return true;
    });
  }, [screen, paged, part, parts, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps -- jobUrl and router follow searchParams
  const nativeGo = (target: string, message?: string) => {
    if (!nativeJob) return false;
    const next = screenForTarget(target, task.data.kind);
    if (!next) return false;
    if (message) announce(message, true);
    // A field in another part of the form opens that part first.
    const toPart = next === "formular" && paged ? formPartForTarget(target, parts) ?? (screen === "formular" ? part : 1) : null;
    if (next === screen && (!toPart || toPart === part)) focusTarget(target);
    else { pendingFocus.current = target; openScreen(next, toPart); }
    return true;
  };
  // Back from a finished work order (`&row=`, 2026-10-06): once the protocol is read, the row it was made from
  // is shown and marked, and a toast says what to do. On a
  // phone at level 1 the row lives on the Ifyllnad screen, in one part of the form: that screen and part open first
  // (simulation 2026-10-10, telefon fynd 3: "Följ upp raden" showed the job's menu).
  const rowOpened = useRef("");
  useEffect(() => {
    const key = `${taskId}:${rowParam}`;
    if (!rowParam || !taskId || task.id !== taskId || rowFocused.current === key) return;
    const blockId = nativeJob && task.data.kind === "FORM" ? formTargetBlockId(task.data.details.document, task.data.details.values, rowParam) : null;
    const toPart = blockId && paged ? formPartForTarget(`form-${blockId}`, parts) ?? 1 : 1;
    if (blockId && (screen !== "formular" || (paged && part !== toPart))) {
      // Once: a person who then leaves the screen is not taken back.
      if (rowOpened.current !== key) { rowOpened.current = key; router.replace(jobUrl("formular", toPart)); }
      return;
    }
    rowFocused.current = key;
    return rowFocusEffect();
  }, [rowParam, taskId, task.id, nativeJob, screen, part]); // eslint-disable-line react-hooks/exhaustive-deps -- jobUrl, parts and router follow these
  // The scanned point (QR at the object): on a phone in the app the job opens at Ifyllnad and the part that holds the point
  // first (2026-10-22: the scan landed on the job's menu), then the point is marked (`data-scanned`) and shown.
  const scanOpened = useRef("");
  const scanMarked = useRef("");
  useEffect(() => {
    if (!scanFocus || !task.id) return;
    const key = `${task.id}:${scanFocus.blockId}:${scanFocus.point}`;
    if (scanMarked.current === key) return;
    const toPart = paged ? formPartForTarget(`form-${scanFocus.blockId}`, parts) ?? 1 : 1;
    if (nativeJob && (screen !== "formular" || (paged && part !== toPart))) {
      // Once: a person who then leaves the screen is not taken back.
      if (scanOpened.current !== key) { scanOpened.current = key; keepMessageOnJump.current = true; router.replace(jobUrl("formular", toPart)); }
      return;
    }
    scanMarked.current = key;
    const { point } = scanFocus;
    window.setTimeout(() => {
      const target = [...window.document.querySelectorAll<HTMLElement>("[data-testid='form-checklist-item'], [data-testid='form-card'], tr")].find((element) => element.textContent?.includes(point));
      if (!target) return;
      target.setAttribute("data-scanned", "true");
      target.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded-lg");
      // Levels 1–2 fold every panel but the current step's: a scanned point in a folded panel opens it first (QA 2026-10-15:
      // on a phone at level 2 the point was marked but out of sight).
      const toggle = target.getClientRects().length ? null : target.closest("section.app-panel")?.querySelector<HTMLElement>(":scope > .panel-header [role='button'][aria-expanded='false']");
      toggle?.click();
      window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), toggle ? 150 : 0);
    }, 400);
  }, [scanFocus, task.id, nativeJob, screen, part]); // eslint-disable-line react-hooks/exhaustive-deps -- jobUrl, parts and router follow these
  // Riskbedömning som steg (2026-10-08): before the work, never in the builder's preview.
  const riskStep = useRiskStep({ task, local, preview: Boolean(preview) });
  const riskApplies = !preview && riskStep.state.applies;
  const riskBlock = riskApplies ? riskStepRefusal(riskStep.state, "start") : null;
  // Arbetsordern som hållare (2026-10-30): a linked task shows and edits its work order's Grunduppgifter and
  // Riskbedömning – the same data as on the work order's page. Saved to the work order; the task is read again after, so
  // its inherited fields and its risk step follow (the server copies them to every open task of the order).
  const holderShown = inOrder && !preview && Boolean(task.workOrderId);
  const holder = useHolderWorkOrder({ workOrderId: task.workOrderId ?? null, enabled: holderShown,
    local: local ? { tasks: local.tasks, members: local.members, save: (record) => local.save(record) } : undefined,
    onSaved: () => { if (!local) void load(); void riskStep.refresh(); } });
  const holderRecord = holder.record;
  const holderRef = useRef<typeof holder | null>(null);
  useEffect(() => { holderRef.current = holder; });
  // The task follows its work order at once when a shared field CHANGES here (Ansvarig, Start, Klart senast …), so the level
  // check and the save see the same responsible as the server will give it. Only a changed field is copied: on opening, the
  // task keeps what it has (a new protocol's place chosen from the customer's only place, guided-flow).
  const holderShared = holderRecord ? [holderRecord.projectId, holderRecord.customerId, holderRecord.facilityId, holderRecord.assignedToUserId, holderRecord.assignedToName, holderRecord.plannedStartDate, holderRecord.dueDate, holderRecord.roundScheduleId].join("|") : "";
  const holderSeen = useRef<{ id: string; record: WorkflowTaskRecord } | null>(null);
  useEffect(() => {
    if (!holderRecord || task.workOrderId !== holderRecord.id) return;
    const before = holderSeen.current?.id === holderRecord.id ? holderSeen.current.record : null;
    holderSeen.current = { id: holderRecord.id, record: holderRecord };
    if (!before) return;
    const keys = ["projectId", "customerId", "facilityId", "assignedToUserId", "assignedToName", "plannedStartDate", "dueDate"] as const;
    const changed = keys.filter((key) => (before[key] ?? "") !== (holderRecord[key] ?? ""));
    if (!changed.length) return;
    const inherited = inheritFromWorkOrder({ ...task, facilityId: task.facilityId ?? null }, holderRecord, { isNew: !task.id });
    // A changed customer takes the order's place with it (inheritFromWorkOrder clears a place without a customer).
    const copied = changed.includes("customerId") ? [...changed, "facilityId" as const] : changed;
    setTask((current) => ({ ...current, ...Object.fromEntries(copied.map((key) => [key, inherited[key]])) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- holderShared names the fields read
  }, [holderShared, task.workOrderId]);
  const holderClosed = holderRecord ? holderRecord.status === "COMPLETED" || isTaskCancelled(holderRecord.status) : false;
  const holderLocked = !holderRecord || !canEditWorkOrders || holderClosed || task.status === "COMPLETED" || frozen;
  const holderRiskTask = useMemo(() => holderRecord ?? { id: "", kind: "WORK_ORDER", status: "PLANNED", title: "", data: {} as unknown, workOrderId: null }, [holderRecord]);
  const holderRisk = useRiskStep({ task: holderRiskTask, local, preview: !holderRecord });
  // Säkerhetsavstämning inför rondtillfället (2026-10-27, punkt 4): a protocol started in a round's work order (a new
  // one gets the check when it is saved, so it shows from the start); Starta tid and Färdigställ wait until it is done.
  // A new protocol started from a round always lands in the round's work order (the server picks it when the address has none).
  const safetyData = task.id || !roundOfProtocolValues(task.data) ? task.data : { ...task.data, roundSafetyStep: true };
  const safetyApplies = !preview && roundSafetyRequired({ kind: task.kind, data: safetyData });
  const safetyState = roundSafetyState({ ...task, data: safetyData }, riskStep.roundRisk);
  const safetyBlock = safetyApplies ? roundSafetyRefusal(safetyState, "start") : null;
  // The protocol's fields wait for the check too; a phone's first screen for a new protocol has no room for it, so it stays open.
  const safetyLocksFill = Boolean(safetyBlock) && !nativeNew;
  // A scan shows its point at once. It joins the protocol when the check is done: the server refuses a scan before that, and the
  // save of the check must not carry one.
  useEffect(() => {
    if (!scanPlace || scanDone.current === scanPlace || task.data.kind !== "FORM" || !task.data.details.values.round) return;
    if (!task.id) return;
    const owner = customers.find((customer) => customer.facilities?.some((facility) => facility.id === scanPlace));
    if (!owner && !customers.length) return;
    const places = owner?.facilities ?? [];
    const place = places.find((facility) => facility.id === scanPlace);
    const where = place ? placePath(places, place.id) : "Platsen";
    const found = scanPoint(task.data.details.document, task.data.details.values, place);
    const point = found?.point ?? "";
    const waiting = Boolean(safetyBlock);
    if (waiting && scanShown.current === scanPlace) return;
    scanShown.current = scanPlace;
    setMessage(`Skannat: ${where}${point ? ` – punkten ”${point}”` : ""}. ${waiting ? "Skanningen noteras när säkerhetsavstämningen är klar." : "Skanningen noteras i protokollet."}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one of the editor's data effects (see the note at the prefill effect)
    if (found) setScanFocus(found);
    if (waiting) return;
    scanDone.current = scanPlace;
    const at = new Date().toISOString();
    setTask((current) => {
      if (current.data.kind !== "FORM" || !current.data.details.values.round) return current;
      const round = current.data.details.values.round;
      // The same place scanned again within a minute is one confirmation.
      if (round.scans.some((scan) => scan.placeId === scanPlace && Date.parse(at) - Date.parse(scan.at) < 60_000)) return current;
      const scans = [...round.scans, { placeId: scanPlace, place: where.slice(0, 400), point: point.slice(0, 300), at, by: (userName ?? "").slice(0, 200) }].slice(-500);
      return { ...current, data: { ...current.data, details: { ...current.data.details, values: { ...current.data.details.values, round: { ...round, scans } } } } };
    });
    // A scan is something the person did, not just an opened page: the protocol is saved with it (R2-KTR-01 only stops a bare opening).
    setTouchedFor(touchKey);
  }, [scanPlace, task, customers, taskId, safetyBlock]); // eslint-disable-line react-hooks/exhaustive-deps
  const [riskNotice, setRiskNotice] = useState("");
  // Once the risk step is done, the refusal said before is taken back – its toast too (simulation 2026-10-10: the red
  // "Gör riskbedömningen…" stayed after the risk assessment was confirmed).
  useEffect(() => {
    if (!riskNotice || riskBlock) return;
    withdrawAnnouncement(riskNotice);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the notice is gone with its reason
    setRiskNotice("");
  }, [riskNotice, riskBlock]);
  const showRiskStep = (text: string) => { setRiskNotice(text); if (!nativeGo(RISK_STEP_TARGET, text)) focusTarget(RISK_STEP_TARGET, text); };
  const headerFacts: EditorFact[] = [
    // The level the task type requires (2026-10-07, "Krävd nivå" since 2026-10-09): amber for 2, red for 3; Workflow's proposal says so.
    // The lowest level as Workflow's proposal says nothing anyone needs to know, so it is left out, as on a new job (2026-10-12;
    // resa 2026-11-06: "Kräver nivå 1 (förslag)" on every new work order puzzled a new company and a technician).
    ...(riskClass && !(riskClass.suggested && riskClass.value === 1) ? [{ icon: UserCheck, label: `Kräver nivå ${riskClass.value}${riskClass.suggested ? " (förslag)" : ""}`, title: `Krävd nivå för den som utför uppgiften: ${RISK_CLASS_TEXTS[riskClass.value]}.${riskClass.suggested ? " Förslag tills företaget sätter en egen." : ""}`, keep: true }] : []),
    // The highest priority of the order's open maintenance items first; Akut in red (Underhåll, 2026-10-06).
    ...(priority ? [{ icon: Siren, label: `Prioritet: ${MAINTENANCE_PRIORITY_LABELS[priority]}`, keep: true, ...(priority === "URGENT" ? { tone: "danger" as const } : priority === "HIGH" ? { tone: "warning" as const } : {}) }] : []),
    ...(task.data.kind === "WORK_ORDER" ? [{ icon: Package, label: `${task.data.details.materials.filter((row) => !isExpenseRow(row)).length} material${task.data.details.materials.some(isExpenseRow) ? ` · ${countOf(task.data.details.materials.filter(isExpenseRow).length, "utgift", "utgifter")}` : ""}` }] : []),
    ...(task.data.kind === "RISK_ASSESSMENT" ? [{ icon: ShieldAlert, label: `${task.data.details.risks.length} ${task.data.details.risks.length === 1 ? "risk" : "risker"}` }] : []),
    ...(task.data.kind === "FORM" ? formHeaderFacts(task.data.details.document, task.data.details.values, task.data.details.publisherName, task.data.details.templateVersion) : []),
    { icon: Paperclip, label: countOf(task.attachments?.length ?? 0, "bilaga", "bilagor"), iconClassName: "text-sky-600" },
    // Where the task belongs, as links back (the guided flow, 2026-09-30).
    ...(selectedProject && task.id && !preview ? [{ icon: FolderKanban, label: selectedProject.name, href: `/?view=project&projectId=${encodeURIComponent(selectedProject.id)}`, iconClassName: "text-muted-foreground" }] : []),
    // The links to where the order came from and to its log entries stay at level 1 too (a phone on its side, where the
    // job is the page and not the menu of rows; 2026-10-11).
    ...(task.data.kind === "WORK_ORDER" && task.data.details.source?.kind && !preview ? [{ icon: Undo2, label: `Från ${task.data.details.source.title || "uppgiften"}`, href: `/?view=workflow_task&taskId=${encodeURIComponent(task.data.details.source.taskId)}&taskType=${task.data.details.source.kind}`, iconClassName: "text-muted-foreground", keep: true }] : []),
    // Avvikelse ↔ arbetsorder (2026-10-10): the log entries this order fixes, for those who may read them.
    ...(task.data.kind === "WORK_ORDER" && !preview ? deviationFacts(work.context) : []),
    // Tid på jobbet (Fas 2): where the task's time lands, with a link to the work order.
    ...(task.workOrderId && !preview ? [{ icon: ClipboardList, // A new task linked from the order's page has only the order's id until it is saved: no "(utan rubrik)" then (QA 2026-10-10).
      label: !task.workOrder ? "Tiden räknas på arbetsordern" : task.workOrder.readable === false ? "Tiden räknas på en arbetsorder" : timeOnWorkOrderLabel(task.workOrder.title ?? ""), keep: true, iconClassName: "text-muted-foreground", ...(task.workOrder?.readable !== false ? { href: workflowTaskHref({ id: task.workOrderId, kind: "WORK_ORDER" }) } : {}) }] : []),
    // Every job has Ansvarig since 2026-10-10 (a protocol drawn like the control too), so an empty one is said.
    // The name from the members when the order has only the id (kundresan 2026-11-07, L26: "Ingen ansvarig" beside a chosen one).
    { icon: UserRound, label: task.assignedToName || (task.assignedToUserId ? members.find((member) => member.id === task.assignedToUserId)?.name : "") || "Ingen ansvarig", iconClassName: "text-muted-foreground" },
    // The reported time (the timer itself is in the work order's Utförande, 2026-10-30).
    ...(task.id && !preview ? [{ icon: Clock3, label: `${formatTimerDuration(task.totalDurationSec)} rapporterad${inOrder ? " på arbetsordern" : ""}`, iconClassName: "text-muted-foreground" }] : []),
    ...(task.dueDate ? [{ icon: CalendarClock, label: `${overdue ? "Förfallen" : "Klart senast"} ${task.dueDate}`, keep: true, tone: overdue ? "danger" as const : undefined, iconClassName: overdue ? "text-current" : "text-muted-foreground" }] : []),
  ];
  // The job's status as the lists, Översikt and Sök say it (simulation 2026-10-10: a protocol said "Utkast" here and
  // "Pågår" there): the stored status by the same rule for every kind.
  const taskStatusText = task.data.kind === "WORK_ORDER" ? workOrderStatusLabel(task.status, task.data.details, statusLabels[task.status]) : statusLabels[task.status];
  // Leads to the field and marks it light red (2026-10-01); a panel's own field when the id is a section.
  // With a message it is also shown as a toast, so it is seen where the person is (2026-10-01).
  const focusRequirement = (field: string, message?: string) => { if (!nativeGo(field, message)) focusTarget(field, message); };

  // A finished task is locked (its fields cannot change), so it never asks "Lämna …?" – a late server reply settling
  // after Färdigställ must not stop the person on their way out (2026-10-09).
  // The saved status is read from the saved key (status is its third field), not from the baseline ref.
  const lockedFinished = task.status === "COMPLETED" && savedKey !== null && (JSON.parse(savedKey) as unknown[])[PERSON_FIELDS.indexOf("status")] === "COMPLETED";
  const dirty = !preview && !lockedFinished && savedKey !== null && taskKey(savableTask(task, savedKey)) !== savedKey;
  // With autosave a link saves first instead of asking (the flush is defined below; the guard calls it later).
  // flushRef holds the latest flush, set by an effect after every render, before anything can call it.
  const guardFlush = !preview && !local && !nativeNew && task.status !== "COMPLETED" && !frozen && Boolean(task.title.trim()) && !titleFieldEmpty ? () => flushRef.current() : undefined;
  // A new job not yet created: the browser's and the phone's Bakåt ask too (2026-10-13).
  const releaseBack = useUnsavedGuard(dirty, confirm, guardFlush, { browserBack: !taskId });
  const leavePage = useLeavePage();
  // Samband (2026-10-26, lib/workflow/return-link.ts): a job opened as a sub-page (Ny uppgift from a work order)
  // keeps the way back, also once it is created; "Tillbaka till arbetsordern" returns there with the job marked.
  const way = useReturnTo();
  const subPageHref = useSubPageHref();
  // The bottom menu's Save and the "unsaved" guard follow this page (2026-10-02).
  // The floating navigation (2026-10-27) uses the same Spara, the header's Avbryt (a job not created yet) and its
  // "Tillbaka till …" (a job opened as a sub-page), never logic of its own.
  useRegisterEditorActions({
    // The page "kan inte visas" offers no Spara (kundresan 2026-11-07, L36).
    save: () => { void save(); }, canSave: !preview && task.status !== "COMPLETED" && !frozen && !(taskId && !local && unavailable),
    busy, dirty,
    cancel: !native && !preview && !task.id && !taskId && !unavailable ? () => { void cancelNew(); } : undefined,
    back: !native && !preview && task.id && way ? { label: way.label, run: () => { void returnWithJob(); } } : undefined,
  });
  // One save at a time: a manual save waits for an autosave under way, so both never send the same version.
  const inFlight = useRef<Promise<unknown> | null>(null);
  /** The next autosave goes at once (a risk answer), not after the pause. */
  const saveSoon = useRef(false);
  const syncAfterSave = useRef<TaskChange | null>(null);
  const [autoState, setAutoState] = useState<AutosaveState>("idle");
  const [autoError, setAutoError] = useState("");
  // An autosave's failure is told once per reason as a toast (it does not push the page); the status says "Inte sparat".
  const announcedError = useRef("");
  // The state an autosave failed on (a missing field, no connection): it is not retried until the person changes something.
  const [autoFailedKey, setAutoFailedKey] = useState<string | null>(null);
  /** `quiet`: the save is a step of something else (Starta tid), so "Uppgiften är sparad." is not said (2026-10-12). */
  async function save(status = task.status, time: CompletionTime | null = null, options: { auto?: boolean; quiet?: boolean; leaving?: boolean } = {}): Promise<string | false> {
    while (inFlight.current) await inFlight.current.catch(() => undefined);
    // A job not created yet: off the browser-back entry first, so the created job takes the form's own entry and the
    // guard never steps back from the new address (2026-10-13 natt: Local's first Spara lost the taskId).
    if (!latestTask.current.id) await releaseBack();
    // The work order's changes made here first: the server gives the task its order's responsible and dates.
    if (holderRef.current?.dirty) await holderRef.current.flush();
    const run = saveNow(status, time, options);
    inFlight.current = run;
    try { return await run; } finally {
      if (inFlight.current === run) inFlight.current = null;
      const pending = syncAfterSave.current;
      syncAfterSave.current = null;
      if (pending && !isOwnEcho(pending, userId, baseline.current?.version)) void syncFromServer(pending);
    }
  }
  /** A command that changes the task on the server (the timer) waits for the saves in flight, and no save starts until it is done. */
  async function inSaveQueue<T>(work: () => Promise<T>): Promise<T> {
    while (inFlight.current) await inFlight.current.catch(() => undefined);
    const run = work();
    inFlight.current = run;
    try { return await run; } finally { if (inFlight.current === run) inFlight.current = null; }
  }
  async function saveNow(requested: WorkflowTaskStatus, time: CompletionTime | null, { auto = false, retried = false, quiet = false, leaving = false }: { auto?: boolean; retried?: boolean; quiet?: boolean; leaving?: boolean }): Promise<string | false> {
    // The newest state, also after waiting for an autosave (the render's `task` may be older), without new blank rows.
    const task = savable(latestTask.current);
    const status = auto ? task.status : requested;
    const completion = workflowTaskCompletion(task);
    const fail = (text: string) => {
      if (auto) {
        setAutoError(text); setAutoState("error"); setAutoFailedKey(taskKey(task));
        if (announcedError.current !== text) { announcedError.current = text; announce(`Sparas inte automatiskt: ${text}`, true); }
      }
      else { lastError.current = text; setError(text); setMessage(""); }
      return false as const;
    };
    // Where a new protocol may be used follows its form (decision 2); the server checks the same.
    const usageProblem = !task.id && kind === "FORM" && form ? (task.projectId && form.allowInProject === false ? `${form.name} kan inte kopplas till ett projekt.` : !task.projectId && form.allowStandalone === false ? `${form.name} måste kopplas till ett projekt. Välj projekt.` : "") : "";
    if (usageProblem) return fail(usageProblem);
    if (preview) { setError(""); setMessage(PREVIEW_MESSAGE); return false; }
    if (status === "COMPLETED" && !completion.ready) {
      // Said once, in the toast; the page's own list shows the rest (2026-10-01: no extra box at the top).
      setError("");
      setMessage("");
      focusRequirement(completion.issues[0].field, `Kvar före färdigställande: ${completion.issues[0].message}`);
      return false;
    }
    if (auto) setAutoState("saving"); else { setBusy(true); setError(""); setMessage(""); setRemoteNotice(""); }
    const previousBase = baseline.current;
    try {
      // A round's work order (2026-10-27): "Avser driftrond" ticked without a round chosen saves no round.
      const payload = { ...task, id: task.id || undefined, status, customerId: selectedProject?.customerId ?? task.customerId, ...(task.roundScheduleId === "" ? { roundScheduleId: null } : {}) } as WorkflowTaskRecord;
      // Time written when completing is registered first, while the task can still take time (Local in the same change).
      // A retry after a refused save never registers the time again (it was registered before the first try).
      if (time && !local && !retried) await api("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "save", entry: { taskId: task.id, ...time } }) });
      const result: { id: string; version: number; stopped?: StoppedTimer[] } = local ? await local.save(payload, time ? { time } : undefined) : await (() => {
        const body = JSON.stringify({ action: "save", task: payload, ...(auto ? { autosave: true } : {}) });
        // Leaving the page (pagehide, the tab hidden): the request outlives the page when it is small enough for keepalive (64 kB).
        return api<{ id: string; version: number; stopped?: StoppedTimer[] }>("/api/workflow-tasks", { method: "POST", body, ...(leaving && body.length < 60_000 ? { keepalive: true } : {}) });
      })();
      if (status === "COMPLETED") announceTimerChange(result.stopped ?? []);
      // What the person just saved, so a colleague's change there in the next minutes is announced.
      const now = new Date().getTime();
      if (previousBase) recentSaves.current = [...recentSaves.current.filter((entry) => now - entry.at < 120_000), ...changedPaths(personFields(previousBase), personFields(payload)).map((path) => ({ path, at: now }))];
      // What was sent is the baseline for the reply; edits made meanwhile stay (the data is not reset to what was sent).
      baseline.current = { ...payload, id: result.id, version: result.version, status };
      setSavedKey(taskKey(baseline.current));
      // The saved status is the person's own now (Local too), so the reply that follows never reads it as an edit.
      setTask((current) => local ? { ...current, status } : { ...current, id: result.id, version: result.version, status });
      // At once, not at the next render: a save waiting in line (Spara pressed during an autosave) reads latestTask right
      // after this one ends. With the old id and version it made a second new job, or a 409 on its own save (2026-10-31,
      // customer-journey under a full run's load).
      latestTask.current = local ? { ...latestTask.current, status } : { ...latestTask.current, id: result.id, version: result.version, status };
      setSavedAt(formatSwedish(new Date(), { timeStyle: "short" }));
      if (!local && task.data.kind === "WORK_ORDER") void purchaseQuickPick.syncAfterSave(result.id, task.data.details.materials);
      setAutoError(""); setAutoState("idle"); setAutoFailedKey(null); announcedError.current = "";
      // The work order is called so (kundresan 2026-11-07, L26: "Uppgiften är sparad" on a work order).
      const word = kind === "WORK_ORDER" ? "arbetsordern" : "uppgiften";
      if (!auto && !quiet) setMessage(status === "COMPLETED" ? `${time ? `Tiden är registrerad och ${word}` : word[0].toUpperCase() + word.slice(1)} är färdigställd.` : `${word[0].toUpperCase() + word.slice(1)} är sparad.`);
      if (!task.id) {
        setCreatedHere(result.id);
        forgetDraft(draftKeyFor(""));
        setDraftRestored(false);
        // The page stays where the person is (an autosave of a new task scrolled it to the top, 2026-10-05).
        // A round started from a scan keeps the scanned place, so the protocol records it and opens at its point (svar 10).
        const created = `/?view=workflow_task&taskId=${encodeURIComponent(result.id)}&taskType=${kind}${scanStartPlace ? `&scanPlace=${encodeURIComponent(scanStartPlace)}` : ""}`;
        router.replace(way ? way.pass(created) : created, { scroll: false });
      }
      // A new task is read back by its new id at once: load() still has the address without it, so the server's own
      // additions (the risk step) would otherwise wait until the address has changed (flow-guide, 2026-10-18/19).
      // A failed read here is not a failed save: the address change reads the task again.
      if (!local) { if (auto && task.id) await refreshTask(result.id); else if (!task.id) await refreshTask(result.id).catch(() => undefined); else await load(); }
      return result.id;
    } catch (issue) {
      const problem = issue as Error & { status?: number };
      // Someone else saved in between (2026-10-04): read their version, merge it with this one and save again,
      // once. The server's version check stays, so nothing is ever written over in silence. A field both changed keeps
      // what is saved and the person is told (F3, 2026-10-28); a manual save then stops so they can look first.
      if (problem.status === 409 && /har ändrats/i.test(problem.message) && task.id && !local && !retried) {
        if (auto) setAutoState("idle"); else setBusy(false);
        const outcome = await mergeRefusedSave(task.id, previousBase).catch(() => null);
        if (!outcome) return fail(problem.message);
        if (outcome.conflicted && !auto) return false;
        if (auto && !outcome.remaining) return task.id;
        return saveNow(requested, time, { auto, retried: true, quiet, leaving });
      }
      // A lost connection comes from api() as status 0 (features/kfid/api.ts, 2026-10-28), a raw fetch failure as TypeError.
      const offline = problem.status === 0 || problem instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
      return fail(offline ? "Ingen anslutning. Ändringarna sparas när anslutningen är tillbaka." : problem.message);
    } finally { if (!auto) setBusy(false); }
  }
  // Only the task itself, after an autosave: the page's lists (members, places) do not change with it.
  async function refreshTask(id: string, from?: TaskChange) {
    const fresh = (await api<{ tasks: WorkflowTaskRecord[] }>(`/api/workflow-tasks?id=${encodeURIComponent(id)}`)).tasks.find((item) => item.id === id);
    if (fresh) applyServer(fresh, from);
  }
  /**
   * After a refused save (409): read what is saved and merge it with the page at once (latestTask too, so the retry
   * sends the merged task with the new version). Fields only one side changed merge as in live sync; a field both
   * changed keeps the saved value, and the person's own value goes to the conflict notice (F3, 2026-10-28).
   */
  async function mergeRefusedSave(id: string, base: WorkflowTaskRecord | null): Promise<{ conflicted: boolean; remaining: boolean }> {
    const fresh = (await api<{ tasks: WorkflowTaskRecord[] }>(`/api/workflow-tasks?id=${encodeURIComponent(id)}`)).tasks.find((item) => item.id === id);
    if (!fresh) throw new Error("Uppgiften kunde inte hämtas.");
    const mine = latestTask.current;
    const server = base && base.id === fresh.id ? { ...fresh, ...keepSentText(personFields(base), personFields(fresh)) } : fresh;
    const { value, conflicts } = base ? mergeKeepingSaved(personFields(base), personFields(mine), personFields(server)) : { value: personFields(server), conflicts: [] };
    const next = { ...server, ...value } as WorkflowTaskRecord;
    baseline.current = server;
    setSavedKey(taskKey(server));
    latestTask.current = next;
    setTask(next);
    if (conflicts.length) {
      const fields = conflicts.map(({ path, mine: own }) => ({ key: pathKey(path), path, label: taskPathLabel(server, path), mine: own }));
      const others = live.editors.filter((editor) => editor.userId !== userId);
      const who = others.length === 1 ? others[0].name : "Någon annan";
      const text = `${who} ändrade också ${listNames([...new Set(fields.map((field) => field.label))])} samtidigt som du. Din ändring sparades inte – det som visas nu är det som är sparat.`;
      // An earlier conflict's own values stay offered, unless the same field conflicted again (then the newest counts).
      setSaveConflict((previous) => ({ text, fields: [...(previous?.fields.filter((field) => !fields.some((entry) => entry.key === field.key)) ?? []), ...fields] }));
      announce(text, true);
    }
    return { conflicted: conflicts.length > 0, remaining: taskKey(savable(next)) !== taskKey(server) };
  }
  /** "Använd min text": the person's own values from the conflict are put back and saved on purpose, with the current version. */
  function applyMine() {
    const conflict = saveConflict;
    if (!conflict) return;
    const current = latestTask.current;
    const fields = conflict.fields.reduce((record, field) => withValueAt(record, field.path, field.mine), personFields(current));
    const next = { ...current, ...fields } as WorkflowTaskRecord;
    latestTask.current = next;
    setTask(next);
    setSaveConflict(null); setShowMine(false);
    void save(next.status);
  }
  // A colleague saved (or the person in another tab): read the new version and merge it with what is on screen.
  async function syncFromServer(from?: TaskChange) {
    const id = latestTask.current.id;
    if (!id || local || preview) return;
    try { await refreshTask(id, from); } catch { /* the next event or save tries again */ }
  }
  const live = useTaskLive(task.id || undefined, !local && !preview, (change) => {
    if (change.reason === "delete") { if (change.byUserId !== userId) setError(`${change.byName} har tagit bort uppgiften.`); return; }
    // The person's own save in this tab is already applied; its echo often arrives before the save's own reply.
    if (isOwnEcho(change, userId, baseline.current?.version)) return;
    if (inFlight.current) { syncAfterSave.current = change; return; }
    void syncFromServer(change);
  });
  const otherEditors = live.editors.filter((editor) => editor.userId !== userId);
  // Autosave a few seconds after the last change (always on since 2026-10-07, no longer a personal choice); never a
  // completed or frozen task, and a
  // new one first when it has its title (the control waits for its project/plant field the same way).
  // A new job at level 1 is created with Skapa only (QA 2026-10-10: autosave created it while the title was typed, so
  // Avbryt could no longer let it go).
  // R2-KTR-01: opening a new task never creates it. Prefilled fields and the form's name as title make it "dirty" at
  // once, so a new task is first autosaved after the person has typed, picked or tapped something.
  // Kept per task address and kind, so "Ny" to another type starts untouched without an effect resetting it.
  const touchedNew = touchedFor === touchKey;
  useEffect(() => {
    if (taskId || touchedNew || preview) return;
    const touch = (event: Event) => {
      if (!event.isTrusted) return;
      if (event.type === "keydown") { const key = (event as KeyboardEvent).key; if (key === "Tab" || key === "Shift" || key === "Escape") return; }
      if (event.type === "click" && !(event.target as HTMLElement | null)?.closest?.("button, select, label, [role=option], [role=checkbox], [role=radio], [role=switch]")) return;
      // After the event is handled: a re-render in the middle of the first input event (paste, dictation, autofill) would
      // put the controlled field back to its old value before React's own onChange has read the new one.
      setTimeout(() => setTouchedFor(touchKey), 0);
    };
    const types = ["input", "change", "keydown", "click"] as const;
    for (const type of types) document.addEventListener(type, touch, true);
    return () => { for (const type of types) document.removeEventListener(type, touch, true); };
  }, [taskId, touchedNew, preview, touchKey]);
  // Starta ronden after a scan (svar 10): the new round protocol is saved once, as soon as its form is there.
  useEffect(() => {
    if (!scanStartPlace || scanStarted.current || task.id || task.data.kind !== "FORM" || !task.data.details.values.round || !task.title.trim()) return;
    scanStarted.current = true;
    void save(task.status, null, { quiet: true });
  }, [scanStartPlace, task]); // eslint-disable-line react-hooks/exhaustive-deps -- save reads the newest task itself
  // A new work order waits for its first Spara (2026-11-07, kundresan M5: it was created after a few seconds, Avbryt became
  // Ta bort and a second Spara made a duplicate). Avbryt lets it go; after the first save it autosaves as before.
  const newWorkOrderWaits = kind === "WORK_ORDER" && !task.id && !taskId;
  const autosaveOn = !preview && !nativeNew && !newWorkOrderWaits && task.status !== "COMPLETED" && !frozen && Boolean(task.title.trim()) && !titleFieldEmpty && (Boolean(task.id) || Boolean(taskId) || touchedNew || draftRestored || Boolean(local));
  // The pause is counted from the last change only (it restarted on every render before, also on a colleague's presence).
  useEffect(() => {
    if (!autosaveOn || !dirty || busy || discardOpen || autoState === "saving" || autoFailedKey === taskKey(savable(task))) return;
    // A risk answer is saved at once instead of after the pause (kundresan 2026-11-07, M3: lost when the phone closed early).
    const timer = setTimeout(() => { saveSoon.current = false; void save(task.status, null, { auto: true }); }, saveSoon.current ? 0 : AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [task, autosaveOn, dirty, busy, discardOpen, autoState, autoFailedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Saved at once, like V1 never lost a value (2026-10-05): on leaving a field, when the tab is hidden or the
  // page is left, and before an in-app link is followed. Resolves whether nothing unsaved is left.
  const flushState = useRef({ autosaveOn, failedKey: autoFailedKey });
  useEffect(() => { flushState.current = { autosaveOn, failedKey: autoFailedKey }; });
  const flush = async ({ leaving = false }: { leaving?: boolean } = {}): Promise<boolean> => {
    if (preview) return true;
    // A save under way may already carry everything; only what is still unsaved after it is sent.
    while (inFlight.current) await inFlight.current.catch(() => undefined);
    const key = taskKey(savable(latestTask.current));
    if (savedKeyRef.current === null || key === savedKeyRef.current) return true;
    const { autosaveOn: on, failedKey } = flushState.current;
    if (!on || failedKey === key) return false;
    return Boolean(await save(latestTask.current.status, null, { auto: true, leaving }));
  };
  useEffect(() => { flushRef.current = flush; });
  // Leaving the page any way the guards do not see (the phone's or the browser's own Bakåt, which an autosaving editor lets
  // through) saves what is left (användartest 2026-10-31, fel 5: ticks in Visuell kontroll were lost after Bakåt while
  // the header said "Sparat"). Not after the person chose Kasta, and never a job not yet created (Avbryt drops it).
  useEffect(() => () => {
    if (preview || local || leavingWithoutAsking() || !latestTask.current.id) return;
    void flushRef.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on leaving; the refs hold the newest task and flush
  useEffect(() => {
    if (preview || local) return;
    const hidden = () => { if (document.visibilityState === "hidden") void flushRef.current({ leaving: true }); };
    const leaving = () => { void flushRef.current({ leaving: true }); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leaving); };
  }, [preview, local]);
  // "Sparat" says when (simulation 2026-10-10: a job opened from elsewhere said only "Sparat"): this visit's last save, else
  // the newest version in the history – today its time, another day its date.
  const lastRevisionAt = (task.revisions ?? []).reduce((latest, revision) => revision.createdAt > latest ? revision.createdAt : latest, "");
  const savedWhen = savedAt || (lastRevisionAt ? formatSwedish(lastRevisionAt, swedishDayKey(new Date(lastRevisionAt)) === swedishDayKey(new Date()) ? { timeStyle: "short" } : { day: "numeric", month: "short" }) : "");
  // "Sparar…" from the first change until the server has answered, "Sparat" only when all is saved (2026-11-01).
  const indicator = saveIndicator({ state: autoState, dirty, autosave: autosaveOn, savedAt: savedWhen });
  // The version is the history's own count (simulation 2026-10-10: "Version 26" beside "9 sparade versioner"); the
  // number the server counts for every change, also of the timer, stays internal.
  const versionNumber = task.revisionCount ?? task.revisions?.length ?? task.version;
  // Back online, or signed in again: try again what could not be saved.
  useEffect(() => {
    const retry = () => { announcedError.current = ""; setAutoFailedKey(null); };
    window.addEventListener("online", retry);
    window.addEventListener(SESSION_BACK_EVENT, retry);
    return () => { window.removeEventListener("online", retry); window.removeEventListener(SESSION_BACK_EVENT, retry); };
  }, []);
  // The browser draft follows every unsaved change and is removed once the server has it.
  const draftKey = draftKeyFor(task.id);
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (dirty) localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), version: task.version, base: baseline.current ? personFields(baseline.current) : null, task: personFields(savable(task)) } satisfies TaskDraft));
      else if (savedKey !== null && task.id) localStorage.removeItem(draftKey);
    } catch { /* storage full or blocked: autosave still covers the server */ }
  }, [draftKey, dirty, task, savedKey]);
  async function timer(command: "START" | "PAUSE", alreadyAsked = false) {
    if (preview) { setMessage(PREVIEW_MESSAGE); return; }
    // Roller med nivå (2026-10-07): starting the time is starting the work; it is explained, never a dead button.
    if (command === "START" && startBlock) { announce(startBlock, true); return; }
    if (command === "START" && riskBlock) { showRiskStep(riskBlock); return; }
    if (command === "START" && safetyBlock) { announce(safetyBlock, true); if (!nativeGo(ROUND_SAFETY_TARGET)) focusTarget(ROUND_SAFETY_TARGET); return; }
    // A finished or frozen job cannot take time (the server says so too): said at once, before any question about the time
    // running on another job – "Stoppa och byt" there stopped nothing and started nothing.
    if (command === "START" && (completedReason || frozenReason)) { announce(completedReason || frozenReason, true); return; }
    // Cloud saves first, also a new task (2026-09-27: start time directly); Local saves inside its timer call.
    if (local && !task.id) { setError("Spara uppgiften innan tidrapporteringen startas."); return; }
    // Time running on another job is never stopped silently (2026-10-12): the person is asked first, and under a minute
    // the Spara ändå / Släng choice goes with the START command (`keepShort`).
    // Pausa tid under a minute asks the same question as a stop elsewhere (beslut 4, 2026-10-18): never silently discarded.
    // A task's time runs on its work order (Arbetsordern styr, 2026-10-26): the running timer and the question are about it.
    const ownerId = task.id ? timeOwnerId({ id: task.id, kind: task.kind, workOrderId: task.workOrderId }) : "";
    const runningHere = timerSource?.timers.find((item) => item.taskId === ownerId);
    const choice = command === "START" ? await allowStart({ taskId: ownerId, title: inOrder ? `arbetsordern ${task.workOrder?.title || task.title}` : task.title }) : runningHere && !alreadyAsked ? await allowStop(runningHere.startedAt, timerSource?.clockOffsetMs ?? 0) : { keepShort: false, short: false };
    if (!choice) return;
    // The save before Starta tid is a step of starting the time, so it says nothing of its own (2026-10-12: "Uppgiften är
    // sparad." stood on the Tid screen after Starta tid); the running timer's card and the top bar's clock show that the time runs.
    lastError.current = "";
    const id = local ? task.id : await save(task.status, null, { quiet: true });
    if (!id) { if (lastError.current) announce(`${command === "START" ? "Tiden startade inte" : "Tiden stoppades inte"}: ${lastError.current}`, true); return; }
    setBusy(true);
    try {
      // The timer joins the save queue (2026-11-01): an answer is saved as soon as its field is left, so pressing Starta tid
      // started an autosave beside the timer and one of them met a newer version ("Uppgiften har ändrats"). It waits for the
      // saves in flight and no save starts until it and the reload are done.
      const stopped = (await inSaveQueue(async () => {
        const result = local ? await local.timer(id, command, task, { keepShort: choice.keepShort }) : (await api<{ stopped?: StoppedTimer[] }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "timer", id, command, keepShort: choice.keepShort }) })).stopped;
        if (!local) await load();
        return result;
      })) ?? undefined;
      // The top bar shows the running timer in every tab; a long entry that just stopped gets a warning.
      announceTimerChange(stopped ?? []);
      // Said only when an entry was saved: Släng (stopped: []) and the card's own Spara ändå stop have their own words.
      if (command === "PAUSE" && stopped?.length) announce("Tiden stoppad och sparad");
      else if (command === "PAUSE" && choice.short && !choice.keepShort) announce(stopMessage(choice));
      // Personalliggare, steg 0 (2026-10-08): a short, non-blocking reminder to check in on site. Steg 1 (2026-10-09):
      // when the register is kept in Workflow and the person is not checked in, the toast checks them in with one tap.
      const project = command === "START" ? projects.find((item) => item.id === task.projectId) : undefined;
      const reminder = moduleIsOn("staff_register") ? staffRegisterReminder(project) : null;
      if (reminder && project && keepsWorkflowRegister(project) && !local) {
        if ((await staffRegisterOnSite(project.id)) === false) announce(reminder, false, [{ label: "Checka in", run: () => void checkInFromTimer(project.id).then((result) => announce(result.text, result.error)) }]);
      } else if (reminder) announce(reminder);
    }
    // Said where the person looks too (kundresan 2026-11-07, M4: a refused start went unnoticed on the phone): the time did not start.
    catch (issue) { const text = (issue as Error).message; setError(text); announce(`${command === "START" ? "Tiden startade inte" : "Tiden stoppades inte"}: ${text}`, true); } finally { setBusy(false); }
  }
  async function reopen() {
    if (!task.id) return;
    setBusy(true); setError(""); setMessage("");
    try { if (local?.reopen) await local.reopen(task.id); else await api("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "reopen", id: task.id }) }); if (!local) await load(); setMessage("Uppgiften är återöppnad och kan redigeras igen."); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  // Rapportera hinder and Lös hindret (plan 1M): unsaved changes are saved first. Cloud and the demo use the tasks route's own
  // actions (rights, notices); a Local file applies the same rule to the job and saves it.
  async function changeObstacle(input: ObstacleInput | null) {
    if (!task.id) return false;
    if (dirty && !(await save())) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      if (local) {
        const current = latestTask.current;
        const applied = input
          ? reportObstacle({ kind: current.kind, status: current.status, data: current.data }, input, new Date(), "")
          : resolveObstacle({ kind: current.kind, status: current.status, data: current.data });
        latestTask.current = { ...current, status: applied.status as WorkflowTaskStatus, data: applied.data };
        setTask(latestTask.current);
        await save(applied.status as WorkflowTaskStatus);
      } else {
        await api("/api/workflow-tasks", { method: "POST", body: JSON.stringify(input ? { action: "obstacle", id: task.id, obstacle: input } : { action: "resolve_obstacle", id: task.id }) });
        await load();
      }
      setMessage(input ? "Hindret är rapporterat." : "Hindret är löst.");
      return true;
    } catch (issue) { setError((issue as Error).message); return false; } finally { setBusy(false); }
  }
  // Utgår and Återuppta (2026-10-09): unsaved changes are saved first; the server stops running time on Utgår.
  async function cancelJob(reason: string) {
    if (!task.id) return false;
    // Running time under a minute is never dropped silently (R2-PRJ-01): the same question as at a stop, before anything changes.
    const runningHere = timerSource?.timers.find((item) => item.taskId === task.id);
    const choice = runningHere ? await allowStop(runningHere.startedAt, timerSource?.clockOffsetMs ?? 0) : { keepShort: false, short: false };
    if (!choice) return false;
    if (dirty && !(await save())) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      if (local?.cancel) await local.cancel(task.id, { cancel: true, reason, keepShort: choice.keepShort });
      else { const result = await api<{ stopped?: StoppedTimer[] }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "cancel", id: task.id, reason, keepShort: choice.keepShort }) }); announceTimerChange(result.stopped ?? []); }
      if (!local) await load();
      setMessage(`${docWord} är satt till Utgår.`);
      return true;
    } catch (issue) { setError((issue as Error).message); return false; } finally { setBusy(false); }
  }
  async function restoreJob() {
    if (!task.id) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (local?.cancel) await local.cancel(task.id, { cancel: false });
      else await api("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "restore", id: task.id }) });
      if (!local) await load();
      setMessage(`${docWord} är återupptagen och kan redigeras igen.`);
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  // Several files at once, like the control's Lägg till fil; each becomes an attachment of the saved task.
  async function upload(files: File[], receipt = false) {
    if (!task.id || preview) return;
    setBusy(true); setError("");
    try { for (const file of files) { if (local?.upload) await local.upload(task.id, file, { receipt }); else { const form = new FormData(); form.set("taskId", task.id); form.set("file", file); if (receipt) form.set("receipt", "true"); await api("/api/workflow-task-files", { method: "POST", body: form }); } } if (!local) await load(); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  // Kvitto (2026-11-04): a receipt picture is left out of the report when "Visa priser" is off.
  async function markReceipt(attachmentId: string, receipt: boolean) {
    if (!task.id || preview) return;
    setBusy(true); setError("");
    try { if (local?.setReceipt) await local.setReceipt(task.id, attachmentId, receipt); else await api(`/api/workflow-task-files/${encodeURIComponent(attachmentId)}`, { method: "PATCH", body: JSON.stringify({ receipt }) }); if (!local) await load(); }
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
  async function exportReport(options: WorkflowReportOptions, _selected?: unknown, variant: ReportVariant = "pdf", show = false, keep = false) {
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
      // "Spara i rapportarkivet" (2026-10-07): a copy of the PDF or Excel is kept, never of a preview.
      const payload = JSON.stringify({ task: { ...snapshotTask, id: task.id || undefined }, format: excel ? "xlsx" : "pdf", inline: show, sections, archive: keep && !show && !local });
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
        // The name the answer gives (the demo puts "demo-" first, 2026-11-07); the same name is made here if none is given.
        await saveResponse(response, `${snapshotTask.title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")}${excel ? ".xlsx" : "-rapport.pdf"}`);
        if (keep) announceArchiveResult(response.headers, () => router.push("/?view=report_archive"));
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


  const protocolField = (kind: FormPrefill) => task.data.kind === "FORM" ? formLeafBlocks(task.data.details.document).find((block) => block.type === "field" && block.prefill === kind) : undefined;
  const fieldText = (kind: FormPrefill) => { const block = protocolField(kind); return block && "key" in block && task.data.kind === "FORM" ? String(task.data.details.values.fields[block.key] ?? "") : ""; };
  // "Kontrollerat av" starts from an older choice of inspector, else from the responsible person when that person has a role that
  // inspects and is not the one filling in (the supervisor of someone under supervision); only when the field is empty.
  const responsibleLevel = work.context && task.assignedToUserId && task.assignedToUserId !== userId ? work.context.levels.people.find((person) => person.personId === task.assignedToUserId) : undefined;
  const roleInspector = work.context?.effective.inspectorName || (responsibleLevel?.inspects ? responsibleLevel.name || task.assignedToName : "");
  useEffect(() => {
    if (!roleInspector || contentLocked) return;
    applyDerived((current) => {
      if (current.data.kind !== "FORM" || current.status === "COMPLETED") return current;
      const values = applyFormPrefill(current.data.details.document, current.data.details.values, { inspector: roleInspector }, { kinds: ["inspector"] });
      return values === current.data.details.values ? current : { ...current, data: { ...current.data, details: { ...current.data.details, values } } };
    });
  }, [roleInspector, contentLocked]); // eslint-disable-line react-hooks/exhaustive-deps -- applyDerived reads the newest task itself
  // The control's moments from the project's planning protocol (2026-10-07): a new control starts with the moments
  // that "Kontroller som ska göras" selects switched on – once, and only while no moment is chosen, so a choice the
  // technician makes is never replaced. A suggestion: the technician changes the moments as usual. A saved control is not touched.
  const planningScope = work.context?.planning ?? null;
  const planningApplied = useRef("");
  const planningSections = planningScope?.sections.join(",") ?? "";
  // A protocol created on this page counts as new too (2026-10-12: at level 1 Skapa comes first, and a protocol made
  // from a work order gets its project – and with it the planning – only from the save; the moments then stayed unticked).
  // A control opened later is still never touched.
  const freshHere = (record: WorkflowTaskRecord) => !record.id || record.id === createdHere;
  useEffect(() => {
    if (!planningScope || contentLocked || planningApplied.current === planningScope.taskId) return;
    const now = latestTask.current;
    if (!freshHere(now) || now.data.kind !== "FORM" || now.status === "COMPLETED" || !momentsNotChosen(now.data.details.document, now.data.details.values)) return;
    planningApplied.current = planningScope.taskId;
    const sections = planningScope.sections;
    setTask((current) => {
      if (!freshHere(current) || current.data.kind !== "FORM" || current.status === "COMPLETED") return current;
      const values = applyPlanningMoments(current.data.details.document, current.data.details.values, sections);
      return values === current.data.details.values ? current : { ...current, data: { ...current.data, details: { ...current.data.details, values } } };
    });
  }, [planningScope?.taskId, planningSections, contentLocked, createdHere]); // eslint-disable-line react-hooks/exhaustive-deps
  // A protocol's facility field typed by hand (no place linked) is never replaced by a place chosen by itself (2026-10-08).
  const facilityTyped = placeFieldTyped(task);
  // A new task that starts with a customer (from the customer card, a project or a link) gets the customer's only place
  // once the customer lists have arrived (2026-10-08); a place the person removed afterwards is not put back.
  const autoPlaced = useRef<string | null>(null);
  useEffect(() => {
    if (task.id || preview || contentLocked || !task.customerId || task.facilityId || autoPlaced.current === task.customerId) return;
    const owner = customers.find((customer) => customer.id === task.customerId);
    if (!owner) return;
    autoPlaced.current = owner.id;
    // The customer's only place is chosen also when the place field was typed by hand; the text then stays (fynd 4).
    const placeId = placeAfterCustomerChange(owner.facilities, owner.id, null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one of the editor's data effects (see the note at the prefill effect)
    if (placeId) setTask((current) => current.id || current.customerId !== owner.id || current.facilityId ? current : prefilled({ ...current, facilityId: placeId }, placeFieldTyped(current) ? [] : ["facility"], true));
  }, [customers, task.customerId, task.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new task opened with only its work order's id (a link, a reload, Ny uppgift from the work order): the order is read
  // once, so the locked line names it and the task takes its project, customer and place (Arbetsordern styr, svar 4b;
  // 2026-10-27: the line said "Arbetsorder (utan rubrik)").
  const hasWorkOrder = Boolean(task.workOrder);
  // Koppla till arbetsorder (2026-10-27; 2026-10-30): a saved draft comes back from the choice with the work order in its
  // address. The work order's Grunduppgifter then apply to it, so where they differ from the draft's the page shows the
  // difference first and the person may cancel; then it is linked here like a new task, and saved with the next save.
  const linkParam = preview || !inOrder ? null : searchParams.get("workOrderId")?.slice(0, 100) || null;
  // The words of a shared field in the difference shown before linking (Koppla till arbetsorder).
  const basicText = (key: SharedBasicShown, record: Pick<WorkflowTaskRecord, "projectId" | "customerId" | "facilityId" | "assignedToName" | "plannedStartDate" | "dueDate">) =>
    key === "projectId" ? projects.find((project) => project.id === record.projectId)?.name || "inget"
      : key === "customerId" ? customers.find((customer) => customer.id === record.customerId)?.name || "ingen"
      : key === "facilityId" ? placeLabel(customers.find((customer) => customer.id === record.customerId)?.facilities ?? [], record.facilityId ?? null) || "ingen"
      : key === "assignedToUserId" ? record.assignedToName?.trim() || "ingen"
      : key === "plannedStartDate" ? record.plannedStartDate || "inget" : record.dueDate || "inget";
  const linkAsked = useRef("");
  useEffect(() => {
    if (!task.id || task.workOrderId || !linkParam || task.status === "COMPLETED" || linkAsked.current === `${task.id}|${linkParam}`) return;
    linkAsked.current = `${task.id}|${linkParam}`;
    void (async () => {
      let option: WorkOrderOption | undefined;
      if (local) {
        const item = local.tasks.find((candidate) => candidate.id === linkParam && candidate.kind === "WORK_ORDER");
        option = item ? { id: item.id, kind: item.kind, title: item.title, status: item.status, projectId: item.projectId, customerId: item.customerId, facilityId: item.facilityId ?? null, assignedToUserId: item.assignedToUserId, assignedToName: item.assignedToName, plannedStartDate: item.plannedStartDate ?? "", dueDate: item.dueDate, roundScheduleId: item.roundScheduleId ?? null } : undefined;
      } else {
        try { option = (await api<{ options: WorkOrderOption[] }>(`/api/workflow-tasks/work-order-links?include=${encodeURIComponent(linkParam)}`)).options.find((item) => item.id === linkParam); }
        catch { option = undefined; }
      }
      const current = latestTask.current;
      const forget = () => router.replace(withParam(`/?${searchParams.toString()}`, "workOrderId", ""), { scroll: false });
      if (!option) { announce("Arbetsordern hittades inte, eller så saknar du behörighet till den.", true); forget(); return; }
      const differs = sharedBasicsDifference(current, option);
      if (differs.length && !(await confirm({ title: "Koppla till arbetsordern?", confirmLabel: "Koppla",
        message: `Arbetsorderns grunduppgifter gäller sedan för uppgiften. Det ändras: ${differs.map((key) => `${SHARED_BASIC_LABELS[key]} ${basicText(key, current)} → ${basicText(key, inheritFromWorkOrder({ ...current, workOrderId: option.id }, option, { isNew: false }))}`).join("; ")}.` }))) { forget(); return; }
      setTask((now) => now.id && !now.workOrderId ? { ...now, workOrderId: option.id, workOrder: null } : now);
    })();
  }, [task.id, task.workOrderId, task.status, linkParam]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = task.workOrderId;
    if ((task.id && linkParam !== id) || preview || !inOrder || !id || hasWorkOrder) return;
    let active = true;
    const take = (option: WorkOrderOption | undefined) => {
      if (!active || !option) return;
      setTask((current) => {
        if ((current.id && linkParam !== option.id) || current.workOrderId !== option.id || current.workOrder) return current;
        const linked = inheritFromWorkOrder({ ...current, facilityId: current.facilityId ?? null }, option, { isNew: !current.id });
        const workOrder = { id: option.id, title: option.title, status: option.status, readable: true };
        // Nothing of the order's changes the task (the address carried it): only the name is taken, so the form's filled-in
        // fields stay as they are (this closure's lists can be older than the ones that filled them).
        if (linked.projectId === current.projectId && linked.customerId === current.customerId && (linked.facilityId ?? null) === (current.facilityId ?? null)) return { ...current, workOrder };
        const project = !current.projectId && linked.projectId ? projects.find((item) => item.id === linked.projectId) : undefined;
        return prefilled({ ...(project ? inherit(linked, project) : linked), workOrder }, ["project", "facility", "customer", "contact", "email"], true);
      });
    };
    if (local) {
      const item = local.tasks.find((candidate) => candidate.id === id && candidate.kind === "WORK_ORDER");
      take(item ? { id: item.id, kind: item.kind, title: item.title, status: item.status, projectId: item.projectId, customerId: item.customerId, facilityId: item.facilityId ?? null, projectName: "", customerName: "" } : undefined);
    } else {
      api<{ options: WorkOrderOption[] }>(`/api/workflow-tasks/work-order-links?include=${encodeURIComponent(id)}`)
        .then((result) => take(result.options.find((option) => option.id === id)))
        .catch(() => undefined);
    }
    return () => { active = false; };
  }, [task.id, task.workOrderId, hasWorkOrder, projects, linkParam]); // eslint-disable-line react-hooks/exhaustive-deps
  // A screen's top bar (Nivå 1 på mobil): its title; on a screen where the person types, Avbryt and Spara. Bakåt leads
  // back to the job's menu (each screen is its own visit, `&step=`).
  const jobLabel = task.data.kind === "WORK_ORDER" ? "Arbetsorder" : task.data.kind === "RISK_ASSESSMENT" ? "Riskbedömning" : "Protokoll";
  // Every step of the flow has the same top bar, Avbryt and Spara (2026-10-12, M3); the risk step's screen had Tillbaka only
  // (2026-10-11), which made the steps look different. Its own action is still Bekräfta riskbedömningen in the panel.
  // The Material screen is a list (2026-10-14): no Avbryt/Spara in its bar – a row's own screen has them, and the list goes
  // back to the job like any other screen (a change made from the list, a car cost, is saved by the leave guard).
  const listScreen = screen === "material" && !openItemId;
  const screenEditable = Boolean(screen && EDITING_SCREENS.has(screen) && !listScreen && task.status !== "COMPLETED" && !frozen);
  // Vem redigerar och sparstatus i appvyn (2026-10-22: "en liten bricka eller notis"): the page's save status and
  // presence, the same data and rules, as a small line under the bar's title on the job's menu and every screen.
  const barStatus = nativeJob ? {
    save: indicator.label, state: indicator.state, unsaved: dirty,
    error: indicator.tone === "error" ? { reason: autoError, onClick: () => announce(`Sparas inte automatiskt: ${autoError}`, true) } : null,
    presence: otherEditors.length ? `${listNames(otherEditors.map((editor) => editor.name))} har jobbet öppet` : "",
  } : null;
  useNativeTopBar(nativeJob && screen ? {
    status: barStatus,
    // An expense row's own screen is Utgift, a material row's Material (simulation 2026-10-10).
    title: screen === "formular" && paged ? formPartLabel(part, parts.length) : openItemId && task.data.kind === "WORK_ORDER" && task.data.details.materials.some((row) => row.id === openItemId && isExpenseRow(row)) ? "Utgift" : JOB_SCREEN_TITLE[screen],
    ...(screenEditable && openItemId ? {
      cancel: { onClick: () => { void cancelItem(openItemId); } },
      save: { busy, onClick: () => { void save().then((id) => { if (id) { itemStart.current = null; returnToWork(itemScreenUrl(null), (href) => router.push(href)); } }); } },
    } : screenEditable ? {
      cancel: { onClick: () => { void cancelScreen(); } },
      save: { busy, onClick: () => { void save().then((id) => { if (id) closeScreen(); }); } },
    } : { back: { label: "Jobbet" } }),
  } : nativeJob ? {
    // The job's menu: the bar names the kind of job (the large title under it is the job's own name), back goes to the list.
    title: jobLabel,
    status: barStatus,
  } : nativeNew ? {
    // While a protocol's form is read, or when it cannot be opened (no longer published), the bar says Nytt protokoll and
    // offers no Skapa (the objective analysis 2026-10-24: a round with an unpublished form showed Ny riskbedömning and Skapa).
    title: task.data.kind === "FORM" ? task.data.details.document.task.newTitle || "Nytt protokoll" : kind === "FORM" ? "Nytt protokoll" : kind === "WORK_ORDER" ? "Ny arbetsorder" : "Ny riskbedömning",
    // Avbryt asks when something is filled in (2026-10-13), lets the browser draft go and never leaves Workflow.
    cancel: { onClick: () => void (async () => {
      if (dirty && !(await confirm(DISCARD_QUESTION))) return;
      forgetDraft(draftKeyFor(""));
      leaveWithoutAsking();
      leavePage(kind === "WORK_ORDER" ? "/?view=work_orders" : "/?view=tasks");
    })() },
    save: kind === "FORM" && task.data.kind !== "FORM" ? null : { label: "Skapa", busy, onClick: () => createNew() },
  } : null);
  if (taskId && !local && unavailable) return <Panel title={kind === "WORK_ORDER" ? "Arbetsordern kan inte visas" : "Uppgiften kan inte visas"}>
    <h1 className="sr-only">{kind === "WORK_ORDER" ? "Arbetsorder" : "Uppgift"}</h1>
    <p role="alert" className="text-sm text-muted-foreground">{unavailable}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => router.push(kind === "WORK_ORDER" ? "/?view=work_orders" : "/?view=tasks")}>{kind === "WORK_ORDER" ? "Till Arbetsordrar" : "Till Uppgifter"}</Button>
      <Button variant="ghost" onClick={() => void load()}>Försök igen</Button>
    </div>
  </Panel>;
  // A saved task is shown first when it has been read (2026-10-09): an empty, editable form while it loads let people
  // type or press Färdigställ, and what they typed was replaced when the task arrived.
  if (taskId && !local && !preview && task.id !== taskId && !error) return <Panel title="Uppgiften">
    <h1 className="sr-only">{kind === "WORK_ORDER" ? "Arbetsorder" : "Uppgift"}</h1>
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="task-loading"><LoaderCircle className="size-4 animate-spin" />Hämtar uppgiften…</p>
  </Panel>;
  // The page keeps an h1 while the form is read or cannot be opened (a round whose form is no longer published; the
  // objective analysis 2026-10-24); the panel's title is the visible one.
  if (kind === "FORM" && !taskId && task.data.kind !== "FORM") {
    const body = <>
      <h1 className="sr-only">Nytt protokoll</h1>
      <p role={formError ? "alert" : "status"} className={formError ? "text-sm text-destructive" : "text-sm text-muted-foreground"} data-testid="form-load-state">{formError || (formId ? "Hämtar formuläret…" : "Välj formuläret under Ny uppgift.")}</p>
      {formError || !formId ? <Button variant="outline" className="mt-4" onClick={() => router.push("/?view=new_task")}>Till Ny uppgift</Button> : null}
    </>;
    // In the app view a panel is drawn as a row to open; the message is shown at once instead.
    // The panel is "Formuläret", so the page has one heading "Nytt protokoll" (2026-10-27: h1 and the panel's h2 said the same).
    return native ? <div className="px-4 py-6" data-testid="form-load-native">{body}</div> : <Panel title="Formuläret">{body}</Panel>;
  }
  const customerName = customerTitle(customers.find((customer) => customer.id === (customerLocked ? lockedCustomerId : task.customerId)));
  const lockedReasonText = inOrder ? "följer arbetsordern" : "följer projektet";
  // Kund och plats (2026-10-08): a new customer never keeps the old one's place, and its only place is chosen at once
  // (lib/workflow/customer-place.ts). The protocol's customer, contact and e-mail follow the customer, the facility field the place.
  const setCustomerAndPlace = (customer: CustomerItem | null, facilityId: string | null) => { autoPlaced.current = customer?.id ?? null; setTask((current) => {
    const next = { ...current, customerId: customer?.id ?? null, facilityId };
    if (next.data.kind !== "FORM") return next;
    const source: FormPrefillSource = customerPrefill(customer, projects.find((project) => project.id === next.projectId));
    if (facilityId) source.facility = placeLabel(customer?.facilities ?? [], facilityId);
    // The place chosen with the customer fills the place field only while that field follows the place (fynd 4).
    const kinds: FormPrefill[] = facilityId && source.facility && !placeFieldTyped(current) ? ["customer", "contact", "email", "facility"] : ["customer", "contact", "email"];
    const values = applyFormPrefill(next.data.details.document, next.data.details.values, source, { kinds, overwrite: true });
    return titled({ ...next, data: { ...next.data, details: { ...next.data.details, values } } });
  }); };
  // The same rule as the work order (lib/workflow/customer-place.ts): the customer's only place is chosen at once.
  // The picker's hit may come without the customer's places (a search reply): the page's own list has them.
  const chooseCustomer = (picked: CustomerItem | null) => {
    const known = picked ? customers.find((item) => item.id === picked.id) : undefined;
    const customer = picked && known?.facilities?.length && !picked.facilities?.length ? { ...picked, facilities: known.facilities } : picked;
    setCustomerAndPlace(customer, placeAfterCustomerChange(customer?.facilities, customer?.id ?? null, task.facilityId));
  };
  // Lägg till kund / Redigera kund (2026-10-08): Local writes the open file, Cloud and the demo the register's API.
  const customerQuick = preview ? undefined : local ? (local.saveCustomer ? { save: local.saveCustomer, canCreate: true, canEdit: true } : undefined)
    : customerLinks && (customerLinks.canCreate || customerLinks.canEdit) ? { save: cloudSaveCustomer, read: cloudReadCustomer, ...customerLinks, register: true } : undefined;
  const source = customerPlaceSource({ customerId: task.customerId, facilityId: task.facilityId ?? null }, selectedProject);
  const tempPlaceField = <TempPlaceField value={tempPlace} disabled={task.status === "COMPLETED" || frozen || Boolean(preview)}
    onChange={(place) => setTask((current) => ({ ...current, data: withTempPlace(current.data, place) }))} />;
  // Hör till arbetsorder (Fas 2): choosing an order lets the task take its project (a new task), customer and place it
  // lacks, like the server does; the order's own rules are checked again when saving.
  const chooseWorkOrder = (option: WorkOrderOption | null) => {
    if (!option) { setTask({ ...task, workOrderId: null, workOrder: null }); return; }
    const linked = inheritFromWorkOrder({ ...task, workOrderId: option.id, facilityId: task.facilityId ?? null }, option, { isNew: !task.id });
    const project = !task.projectId && linked.projectId ? projects.find((item) => item.id === linked.projectId) : undefined;
    const next = { ...(project ? inherit(linked, project) : linked), workOrder: { id: option.id, title: option.title, status: option.status, readable: true } };
    setTask(prefilled(next, ["project", "facility", "customer", "contact", "email"], true));
  };
  const localWorkOrders: WorkOrderOption[] | undefined = local ? local.tasks.filter((item) => item.kind === "WORK_ORDER").map((item) => ({ id: item.id, kind: item.kind, title: item.title, status: item.status, projectId: item.projectId, customerId: item.customerId, facilityId: item.facilityId ?? null,
    projectName: projects.find((project) => project.id === item.projectId)?.name ?? "", customerName: customerTitle(customers.find((customer) => customer.id === item.customerId)) })) : undefined;
  const workOrderField = kind === "WORK_ORDER" || preview ? null : <WorkOrderField id="task" task={{ id: task.id, kind, projectId: task.projectId, customerId: (customerLocked ? lockedCustomerId : task.customerId) ?? null, facilityId: task.facilityId ?? null, workOrderId: task.workOrderId ?? null }}
    current={task.workOrder ?? null} local={localWorkOrders} disabled={task.status === "COMPLETED" || frozen} onChange={chooseWorkOrder} />;
  // The locked line at the top of a task's Grunduppgifter: its work order, customer and project, with the way to the order.
  const workOrderTitle = task.workOrder?.title || (!task.id || linkParam === task.workOrderId ? searchParams.get("workOrderTitle")?.trim() : "") || "";
  /**
   * Skapa arbetsorder from a draft (2026-10-30, punkt 3): a new work order with the draft's Grunduppgifter (rubrik,
   * beskrivning, kund, plats, projekt, ansvarig, datum, tillfällig plats) and its Riskbedömning; the draft is then linked to it
   * the same way as Koppla till arbetsorder (nothing differs, so nothing is asked) and saved with the next save.
   */
  async function createWorkOrderFromDraft() {
    if (preview || task.workOrderId || busy) return;
    if (titleMissing) { askTitle(titleHelpText("skapa arbetsordern", titleLabel)); return; }
    const id = !task.id || dirty ? await save() : task.id;
    if (!id) return;
    const draft = latestTask.current;
    const check = riskCheckOf(draft.data);
    const order = { id: undefined, version: 0, kind: "WORK_ORDER", title: draft.title.slice(0, 200), description: draft.description, status: "PLANNED", progress: 0,
      projectId: draft.projectId, customerId: draft.customerId, facilityId: draft.facilityId ?? null, assignedToUserId: draft.assignedToUserId, assignedToName: draft.assignedToName,
      plannedStartDate: draft.plannedStartDate ?? "", dueDate: draft.dueDate,
      data: withTempPlace({ kind: "WORK_ORDER", details: emptyData("WORK_ORDER", null).details, ...(check ? { riskCheck: check } : {}) } as TaskData, tempPlaceOf(draft.data)), totalDurationSec: 0, timerRunning: false } as unknown as WorkflowTaskRecord;
    setBusy(true); setError("");
    try {
      const made = local ? await local.save(order) : await api<{ id: string }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "save", task: order }) });
      // The draft is linked and saved before the receipt (kundresan 2026-11-07, M3: "Arbetsordern är skapad" came first, and a page
      // closed within a second left a loose work order and a draft without it). Nothing differs from the new order, so nothing is asked.
      const linked = { ...latestTask.current, workOrderId: made.id, workOrder: { id: made.id, title: order.title, status: "PLANNED", readable: true } } as WorkflowTaskRecord;
      latestTask.current = linked;
      setTask(linked);
      setBusy(false);
      lastError.current = "";
      const saved = await save(linked.status, null, { quiet: true });
      // The draft's own address (also right after its first save) with the new work order: a link that did not save is taken by the
      // link effect above and saved with the next save, so the order is never left without it.
      const params = new URLSearchParams(window.location.search);
      params.set("view", "workflow_task"); params.set("taskId", id); params.set("taskType", kind);
      params.set("workOrderId", made.id); params.set("workOrderTitle", order.title.slice(0, 120));
      router.replace(`/?${params.toString()}`, { scroll: false });
      if (saved) announce(WORK_ORDER_CREATED_FROM_DRAFT);
      else announce(`Arbetsordern är skapad men uppgiften är inte kopplad än: ${lastError.current || "försök spara igen."}`, true);
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  // Saknar arbetsorder (2026-10-27): a draft says so where its work order would stand, with Koppla till arbetsorder –
  // an open work order of its own (or one the person is responsible for) or Ny arbetsorder, then back here.
  const chooseOrderHref = withParam(`/?${searchParams.toString()}`, "chooseWorkOrder", "1");
  const draftNotice = inOrder && !preview && !task.workOrderId && task.status !== "COMPLETED" ? <div id="task-work-order-missing" tabIndex={-1} className="notice flex flex-wrap items-center justify-between gap-2" role="status" data-testid="task-work-order-missing">
    <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm"><Badge variant="outline" className={indicatorBadge("warning")}>{WORK_ORDER_MISSING_LABEL}</Badge>{cancelled ? "Uppgiften har utgått utan arbetsorder." : "Uppgiften är ett utkast. Koppla den till en arbetsorder innan arbetet påbörjas."}</span>
    {cancelled ? null : <span className="flex flex-wrap gap-2">
      {/* Skapa arbetsorder (2026-10-30): the draft's Grunduppgifter and Riskbedömning move to a new work order. */}
      {canCreateWorkOrders ? <Button type="button" size="sm" disabled={busy} onClick={() => void createWorkOrderFromDraft()} data-testid="task-create-work-order"><Plus />Skapa arbetsorder</Button> : null}
      <Button asChild size="sm" variant={canCreateWorkOrders ? "outline" : "default"}><Link href={chooseOrderHref} data-stays-on-page="" data-testid="task-link-work-order"><Link2 />Koppla till arbetsorder</Link></Button>
    </span>}
  </div> : null;
  const workOrderLine = !inOrder || preview || !task.workOrderId ? null : <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm" data-testid="task-work-order-line">
    <ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="min-w-0 flex-1">{workOrderLockedLine({ workOrderTitle: task.workOrder?.readable === false ? "" : workOrderTitle, customerName, projectName: selectedProject?.name })}</span>
    {task.workOrder?.readable !== false ? <Link href={workflowTaskHref({ id: task.workOrderId, kind: "WORK_ORDER" })} className="text-xs font-medium text-primary hover:underline" data-testid="task-work-order-open">Öppna arbetsordern</Link> : null}
  </p>;
  // Ansvarig, Start, Klart senast and Uppskattad tid (simulation 2026-10-10, fynd 1): every job has them – the work
  // order's Grunduppgifter and a protocol drawn like the control alike – so any job can be given to someone and planned.
  // Ansvarig lists the people who may read the job's type; the server refuses anyone else (lib/workflow/assignee-access.ts).
  const assignable = members.filter((member) => member.canRead !== false || member.id === task.assignedToUserId);
  const someoneLeftOut = members.some((member) => member.canRead === false);
  const assigneeField = members.length ? <label className="space-y-2 text-xs font-medium text-muted-foreground">Ansvarig<select id="task-assignee" className="form-select" value={task.assignedToUserId ?? ""} aria-describedby={someoneLeftOut ? "task-assignee-hint" : undefined} onChange={(e) => chooseResponsible(e.target.value)}><option value="">Inte tilldelad</option>{assignable.map((member) => <option key={member.id} value={member.id}>{member.name}{member.canRead === false ? " – får inte läsa jobbet" : work.context && assignBlock(work.context, { id: member.id, name: member.name }) ? " – når inte krävd nivå" : ""}</option>)}</select>{assigneeBlock ? <span role="note" data-testid="task-assignee-level" className="block text-xs font-normal text-amber-800 dark:text-amber-200">{assigneeBlock}</span> : null}{someoneLeftOut ? <span id="task-assignee-hint" className="block font-normal">Listan visar de som får läsa jobbet.</span> : null}</label>
    : <label className="space-y-2 text-xs font-medium text-muted-foreground">Ansvarig<Input id="task-assignee" value={task.assignedToName} onChange={(e) => { const name = e.target.value; setTask((current) => prefilled({ ...current, assignedToName: name, assignedToUserId: null }, ["assignee"])); }} /></label>;
  const dueDateField = <label className="space-y-2 text-xs font-medium text-muted-foreground">Klart senast<Input id="task-due-date" type="date" value={task.dueDate} min={selectedProject?.startDate || undefined} max={selectedProject?.startDate ? selectedProject.dueDate || undefined : undefined} aria-invalid={dueDateError ? true : undefined} aria-describedby={dueDateError ? "task-due-date-error" : undefined} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} />{dueDateError ? <span id="task-due-date-error" className="block font-normal text-destructive">{dueDateError}</span> : null}</label>;
  const planningFields = <>
    {assigneeField}
    {/* Tidplan (projektförslaget steg 2): Start, then Klart senast, then Uppskattad tid – the job's period and effort. */}
    <TaskScheduleFields part="start" task={task} frame={selectedProject} onChange={(values) => setTask((current) => ({ ...current, ...values }))} />
    {dueDateField}
    <TaskScheduleFields part="estimate" task={task} frame={selectedProject} onChange={(values) => setTask((current) => ({ ...current, ...values }))} />
    {/* Etapp (plan 1M): groups the project's jobs in the list and the Tidplan; only for a job in a project. */}
    {task.projectId ? <TaskScheduleFields part="stage" task={task} stageOptions={stageOptions} onChange={(values) => setTask((current) => ({ ...current, ...values }))} /> : null}
  </>;
  // A task's own planning fields (svar 4b): Ansvarig and Klart senast; different tasks of one work order can have different ones.
  const taskOwnFields = inOrder ? <>{assigneeField}{dueDateField}</> : planningFields;
  // A new protocol's screen at level 1 (2026-10-12) asks only what creating it needs: the link (project, work order) unless
  // it already follows from the job it was opened from, and the place; Ansvarig and the planning come with the saved job (Plats).
  const linkFollows = nativeNew && Boolean(task.workOrderId || task.projectId);
  const inlineSlots: FormTaskInline | undefined = inlineTask ? {
    // Arbetsordern styr (2026-10-26): the work order as a locked line (customer and project come from it) and the choice to move the task.
    // Arbetsordern som hållare (2026-10-30): on the page the shared Grunduppgifter panel above the form holds the work order,
    // its place, responsible person and dates; only the phone's create screen keeps them in the form's own first section.
    top: nativeNew && (workOrderLine || (workOrderField && !linkFollows && task.workOrderId)) ? <div className="grid gap-3">{workOrderLine}{linkFollows || !task.workOrderId ? null : workOrderField}</div> : null,
    beside: { contact: !moduleIsOn("customers") ? undefined : <>
      <IconButton label="Välj eller skapa kund" title={customerLocked ? `Kopplad kund: ${customerName || "ingen"} (${lockedReasonText})` : task.customerId ? `Kopplad kund: ${customerName}` : "Välj eller skapa kund"} variant="outline" size="icon-lg" className="customer-link-button shrink-0" disabledReason={completedReason || (customerLocked ? `Kopplad kund: ${customerName || "ingen"} (${lockedReasonText})` : "")} onClick={() => setCustomerPicker(true)}><Users /></IconButton>
      {task.customerId && !customerLocked && task.status !== "COMPLETED" ? <Button type="button" variant="outline" size="icon" className="customer-link-button size-[var(--control-h)] shrink-0" aria-label="Ta bort kundkoppling" onClick={() => chooseCustomer(null)}><Trash2 /></Button> : null}
    </> },
    after: !nativeNew || (linkFollows && task.facilityId) ? null : <div className="field-group grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
      <div className="sm:col-span-2">{placeField()}</div>
      <div className="sm:col-span-2">{tempPlaceField}</div>
      {/* Ansvarig and Klart senast (Arbetsordern styr, svar 4b): the task's own fields; Start and Uppskattad tid are the work order's. */}
      {nativeNew ? null : taskOwnFields}
    </div>,
  } : undefined;
  // The task's pictures and documents exactly like the control's panel (2026-09-28): cards with the picture, the
  // file name and its size; Lägg till fil in the header from the moment the task is saved; before the summary when the
  // form has one, like the control's, otherwise after the form.
  const attachments = task.attachments ?? [];
  const attachReason = completedReason || (unsavedReason ? "Lägg till fil när uppgiften är sparad." : "");
  // One line on the phone (2026-10-12); the page's fuller wording stays in visning 2–3.
  // Kommentarer (beslut 14, 2026-11-01): the work order's thread, in Cloud and on a saved order. Local has one user.
  const commentPanel = task.id && task.kind === "WORK_ORDER" && !local && !preview ? <CommentThread parentType="WORK_ORDER" parentId={task.id} disabled={Boolean(selectedProject?.archivedAt)} /> : null;
  const attachmentsPanel = <Panel icon={Images} title="Bilder och dokument" description={native ? `Högst ${workflowTaskAttachmentLimit(task.kind)} filer, max 10 MB per fil.` : `Högst ${workflowTaskAttachmentLimit(task.kind)} bilder eller dokument. Max 10 MB per fil.${task.kind === "FORM" && !inlineTask ? " Bilder som tas i formuläret hamnar också här." : ""}`}
    actions={native ? undefined : <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || Boolean(preview)} disabledReason={attachReason} aria-describedby={attachReason ? "task-attach-reason" : undefined} onClick={() => attachmentInput.current?.click()}><Upload />Lägg till fil</Button><Button type="button" variant="outline" disabled={busy || Boolean(preview)} disabledReason={attachReason} aria-describedby={attachReason ? "task-attach-reason" : undefined} onClick={() => receiptInput.current?.click()} data-testid="task-attach-receipt"><Receipt />Lägg till kvitto</Button></div>}>
    {/* Nivå 1 på mobil (QA 2026-10-10): the phone's camera or a file, as rows with words over the list. */}
    {native ? <div className="mb-3"><NativeActions testId="native-attach-actions">
      <Button type="button" variant="ghost" disabled={busy || Boolean(preview) || Boolean(attachReason)} onClick={() => cameraInput.current?.click()} data-testid="native-attach-camera"><Camera />Ta foto</Button>
      <Button type="button" variant="ghost" disabled={busy || Boolean(preview) || Boolean(attachReason)} onClick={() => attachmentInput.current?.click()} data-testid="native-attach-file"><Upload />Välj fil</Button>
      <Button type="button" variant="ghost" disabled={busy || Boolean(preview) || Boolean(attachReason)} onClick={() => receiptInput.current?.click()} data-testid="native-attach-receipt"><Receipt />Lägg till kvitto</Button>
    </NativeActions></div> : null}
    {native ? <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Ta foto" disabled={busy || task.status === "COMPLETED" || !task.id} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void upload(files); }} /> : null}
    {preview ? null : <DisabledReason id="task-attach-reason" reason={attachReason} className="mb-3" />}
    <input ref={receiptInput} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Ladda upp kvitto" data-testid="task-receipt-input" disabled={busy || task.status === "COMPLETED" || !task.id} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void upload(files, true); }} />
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
            {attachment.mimeType.startsWith("image/") ? <label className="mt-2 flex min-h-10 items-center gap-2.5 text-sm"><Checkbox checked={attachment.receipt === true} disabled={busy || Boolean(preview)} onCheckedChange={(checked) => void markReceipt(attachment.id, checked === true)} aria-label={`Kvitto: ${attachment.filename}`} data-testid="attachment-receipt" />Kvitto</label> : null}
          </div>
          <RemoveButton label={`Ta bort ${attachment.filename}`} disabled={busy || task.status === "COMPLETED"} onClick={() => void removeAttachment(attachment.id)} />
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
    if (startBlock) { announce(startBlock, true); return; }
    if (safetyApplies && task.status !== "COMPLETED" && !safetyState.done) { announce(roundSafetyRefusal(safetyState, "complete") ?? safetyState.hint, true); if (!nativeGo(ROUND_SAFETY_TARGET)) focusTarget(ROUND_SAFETY_TARGET); return; }
    // The signer's name is shown prefilled with the person's own (WorkOrderFields) but not stored until used; pressing Färdigställ
    // writes it, so the field is never marked red while it shows a name (2026-10-12; kundresan 2026-11-07, M7).
    const signed = withShownSigner(latestTask.current, userName);
    if (signed !== latestTask.current) { latestTask.current = signed; setTask(signed); }
    if (!completion.ready) {
      const issue = completion.issues[0];
      // Said once, in the toast, while the page moves to the field; the list under Slutför shows all that is left.
      setMessage(""); setError("");
      focusRequirement(issue.field, `Kvar före färdigställande: ${issue.message}${completion.issues.length > 1 ? ` (och ${completion.issues.length - 1} till)` : ""}`);
      return;
    }
    // Riskbedömning som steg (2026-10-08): the same order as the server – the requirements, then the risk step.
    const riskRefusal = riskApplies ? riskStepRefusal(riskStep.state, "complete") : null;
    if (riskRefusal) { showRiskStep(riskRefusal); return; }
    if (!task.id && !(await save())) return;
    setOpenTasksText(await openTasksOfOrder());
    setCompleteOpen(true);
  };
  /** Kundresan 2026-11-07 (M6): a work order's tasks that are not done, as the dialog's warning; nothing when it cannot be read (the order is still completed as before). */
  const openTasksOfOrder = async () => {
    const id = latestTask.current.id;
    if (kind !== "WORK_ORDER" || !id || preview) return "";
    try {
      if (local) return openTasksWarning(local.tasks.filter((item) => item.workOrderId === id));
      const linked = await api<{ tasks: LinkedTaskRow[]; hasMore: boolean }>(`/api/workflow-tasks/work-order-links?linked=${encodeURIComponent(id)}`);
      return openTasksWarning(linked.tasks, linked.hasMore);
    } catch { return ""; }
  };
  const completeWith = async (time: CompletionTime | null): Promise<boolean | string> => {
    lastError.current = "";
    if (!(await save("COMPLETED", time))) return lastError.current || "Uppgiften kunde inte färdigställas.";
    // Avvikelse ↔ arbetsorder (2026-10-10): the linked log entries are Åtgärdad now; read them again.
    if (work.context?.orderDeviations?.length) void work.reload();
    // Nivå 1 (QA 2026-10-10): a finished job leaves its step's screen (Signering, Färdigställ) for the job's menu, where
    // Nästa steg says once that it is finished.
    if (nativeJob && screen) closeScreen();
    // On a computer the page goes up to the finished header and Nästa steg (resa 2026-11-06: it stayed down at Utförande).
    else if (!nativeJob) window.setTimeout(() => window.scrollTo({ top: 0 }), 0);
    return true;
  };
  // Rows of a protocol that are meant to be followed up as work orders but have none yet, named in the dialog.
  const rowsWithoutOrder = task.data.kind === "FORM" ? formRowsWithoutOrder(task.data.details.document, task.data.details.values) : 0;
  // Workflow AI's proposed measures for a risk assessment form (2026-10-02): the table with a hazard and a measure column.
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
      projectId: task.projectId, customerId: selectedProject?.customerId ?? task.customerId, facilityId: task.facilityId ?? null,
      assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, dueDate: "", data: withTempPlace({ kind: "WORK_ORDER", details: { ...(emptyData("WORK_ORDER", null).details as object), source: { taskId: task.id, title: task.title.slice(0, 200), kind: task.kind } } }, tempPlace), totalDurationSec: 0, timerRunning: false } as unknown as WorkflowTaskRecord;
    setBusy(true); setError("");
    try {
      const result = local ? await local.save(order) : await api<{ id: string }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "save", task: order }) });
      router.push(withReturn(`/?view=workflow_task&taskId=${encodeURIComponent(result.id)}&taskType=WORK_ORDER`, `${location.pathname}${location.search}`));
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  // Historik and Färdigställ: at the foot of the form's own Sammanfattning when it has one, otherwise in the foot panel.
  // A completed task in the Färdigställ panel already says so above the buttons; elsewhere the line says it.
  const completeReason = completedReason && !(inlineSlots && formHasSummary) ? "" : completedReason || frozenReason;
  const nativeEnd = nativeJob && screen !== "fardigstall";
  // A task in a work order is finished with "Uppgiften klar"; the work order itself with Färdigställ in its Utförande (
  // 2026-10-30, punkt 4) – on a computer there, beside Starta tid, Rapportera hinder and Utgår; on a phone at its last step.
  const doneWord = inOrder ? "Uppgiften klar" : "Färdigställ";
  const completeButton = <Button id="task-complete" type="button" disabled={busy} disabledReason={completedReason || frozenReason || dormantReason} aria-describedby={completeReason ? "task-complete-reason" : undefined} className={completion.ready && !linkBlock ? undefined : "opacity-60"} aria-disabled={completion.ready && !linkBlock ? undefined : true} title={startBlock ? startBlock : completion.ready ? `${inOrder ? "Markera uppgiften klar och lås" : "Färdigställ och lås"} ${docWord.toLowerCase()}` : `Klicka för att se vad som saknas: ${completion.issues[0]?.message ?? ""}`} onClick={() => void complete()}><CheckCircle2 />{doneWord}</Button>;
  const completeInExecution = kind === "WORK_ORDER" && !native && !preview;
  const completeRow = <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
    <Button type="button" variant="outline" disabled={busy} disabledReason={unsavedReason ? "Historiken finns när uppgiften är sparad." : ""} aria-describedby={unsavedReason ? "task-history-reason" : undefined} onClick={() => setHistoryOpen(true)}><History />Historik</Button>
    {nativeEnd || completeInExecution ? null : completeButton}
    <DisabledReason id="task-history-reason" reason={unsavedReason ? "Historiken finns när uppgiften är sparad." : ""} className="w-full" />
    {nativeEnd || completeInExecution ? null : <DisabledReason id="task-complete-reason" reason={completeReason} className="w-full text-right" />}
    {taskInvoice.status}
  </div>;
  const summaryFoot = Boolean(inlineSlots) && formHasSummary;
  // Not on the create screen (level 1): the attachments wait for the saved job and Historik/Färdigställ have nothing to do yet.
  if (inlineSlots && !nativeNew) {
    inlineSlots.beforeSummary = formHasSummary ? attachmentsPanel : undefined;
    inlineSlots.summaryFooter = completeRow;
  }
  // A control without its own Sammanfattning gets the same completion card and buttons in a panel of their own.
  // A work order's or risk assessment's own completion (workflowTaskCompletion) is adapted to the card's shape; a
  // protocol keeps using the form's own, richer one (its totals and switched-off sections read the same as always).
  // The rubrik is no share of the work (weight 0): counted only while it is missing, so "N av M krav" and the percentage agree (M7).
  const genericCompletion: CompletionCardSummary = { requirements: completion.requirements.filter((item) => item.weight > 0 || !item.met).map((item) => ({ blockId: item.field, message: item.message, met: item.met })), issues: completion.issues.map((item) => ({ blockId: item.field, message: item.message, met: false })), ready: completion.ready, percent: completion.progress };
  const completePanel = controlFoot && !summaryFoot ? <Panel icon={CheckCircle2} title="Färdigställ" description={`Se vad som återstår innan du färdigställer.`}>
    {task.status === "COMPLETED" ? <p className="text-sm text-muted-foreground">{docWord} är {isForm ? "färdigställt" : "färdigställd"} och låst.{reopenable ? ` Öppna ${isForm ? "det" : "den"} igen med Återöppna om ${isForm ? "det" : "den"} behöver ändras.` : " Fortsätt i en kopia med Spara som."}</p> : <CompletionCard completion={task.data.kind === "FORM" ? formCompletionShown(task.data.details.document, task.data.details.values) : genericCompletion} onFocusIssue={(blockId) => focusRequirement(isForm ? `form-${blockId}` : blockId)} />}
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
  // The protocol's limits: the facility's, the company's (Värden och referenser) or the form's, with their source.
  const limitsFirst = task.data.kind === "FORM" && formJudgesByLimits(task.data.details.document);
  const limitsPanel = task.data.kind === "FORM" ? <FormLimitsPanel document={task.data.details.document} values={task.data.details.values} templateId={task.data.details.templateId} facilityId={task.facilityId ?? null}
    facilityName={task.facilityId ? placePath(customerPlaces, task.facilityId) : ""} readOnly={task.status === "COMPLETED" || contentLocked || safetyLocksFill || Boolean(preview)} local={local?.limits} hidden={!limitsFirst}
    onValues={(values) => applyDerived((current) => current.data.kind === "FORM" ? { ...current, data: { ...current.data, details: { ...current.data.details, values } } } : current)} /> : null;
  const sendReason = local ? "Kan inte skicka i lokalt läge. Exportera rapporten och skicka den själv." : titleMissing ? titleHelpText("skicka", titleLabel) : "";
  const reportButtons = <>
      <ReportOptionsButton kind={task.kind} disabled={busy} onExport={exportReport} archivable={!local && !preview} prices={prices.visible} />
      <Button type="button" variant="outline" data-testid="task-send-mail" disabled={busy} disabledReason={sendReason} aria-describedby={sendReason ? "task-send-reason" : undefined} onClick={openSend}><Send />Skicka med e-post</Button>
      <DisabledReason id="task-send-reason" reason={sendReason} className="w-full" />
    </>;
  const reportNote = local ? "Rapporter skapas på den här datorn. Ett osparat protokoll sparas när rapporten skapas. Tomma mallar kan tas ut när som helst." : "Tomma mallar kan tas ut när som helst.";
  const reportPanel = controlFoot ? <Panel icon={FileText} key="report" title="Rapport och hantering" description={`Rapport, export${isForm ? ", tomma mallar" : ""} och utskick av ${docWord.toLowerCase()}.`} className="report-panel" collapsible defaultCollapsed
    persistentContent={<div className="flex flex-wrap items-center gap-2">{reportButtons}</div>}>
    <p className="text-xs leading-5 text-muted-foreground">{reportNote}</p>
  </Panel> : null;
  const formDocument = task.data.kind === "FORM" ? task.data.details.document : null;
  // Egenkontroll (etapp 2–3, 2026-10-06): the roles for this task, who inspects in the protocol, deviations to the
  // programme's log and the instrument register. Only a help beside the protocol; it never blocks anything.
  const selfInspectionActions: Partial<FormActions> = work.context?.hasProgram ? {
    instruments: work.context.instruments,
    fieldNotes: (field) => field.prefill === "inspector" && work.context && fieldText("inspector").trim()
      ? assignmentWarnings(work.context, { performerName: fieldText("user"), inspectorName: fieldText("inspector"), activityType: work.context.effective.activityType }) : [],
    loggedDeviation: (targetId) => work.context?.deviations.find((item) => item.rowId === targetId),
    logDeviation: async ({ title, description, targetId }) => {
      if (!task.id) return null;
      try {
        // The entry links to the protocol (`source`), so the text does not say "Från <protokollet>." too (2026-10-11).
        await work.act({ action: "save_deviation", deviation: { kind: "DEVIATION", title, description: description.slice(0, 4000), category: "ROUTINE",
          source: { taskId: task.id, title: task.title.slice(0, 200), rowId: targetId } } });
        announce("Avvikelsen finns nu i avvikelseloggen.");
        return 1;
      } catch (issue) { announce((issue as Error).message, true); return null; }
    },
  } : work.context ? { instruments: work.context.instruments } : {};
  // What the planning protocol says about the moments, under them (2026-10-07).
  const momentsNote = !preview && planningScope && task.data.kind === "FORM" ? planningNote(task.data.details.document, task.data.details.values, planningScope) : "";
  // A deviation row becomes a work order in the same project and customer (2026-09-28); the row keeps its id.
  const formActions: FormActions | undefined = preview ? undefined : {
    ...selfInspectionActions,
    fieldLock: (field) => field.prefill === "facility" && linkedPlace && !facilityTyped ? { note: "Fylls i från platsen", action: task.status === "COMPLETED" || frozen ? undefined : { label: "Ändra plats", onClick: () => setPlaceOpenRequest((current) => current + 1) } } : undefined,
    ...(momentsNote ? { momentsNote } : {}),
    // Kundresan 2026-11-07 (H3): a draft's table shows its add button grey with the reason and the way to link it.
    ...(linkBlock && !cancelled ? { lockedAdd: { reason: "Koppla till en arbetsorder först.", action: { label: "Koppla till arbetsorder", href: chooseOrderHref } } } : {}),
    openWorkOrder: (id) => router.push(`/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=WORK_ORDER`),
    workOrderStatus: (id) => linkedOrders[id] ? { status: linkedOrders[id].status, label: statusLabels[linkedOrders[id].status as WorkflowTaskStatus] ?? linkedOrders[id].status } : undefined,
    canCreateWorkOrder: Boolean(task.id),
    createWorkOrder: async ({ title, description, assignedToName = "", dueDate = "", deviation, targetId }) => {
      // The work order links back to a saved protocol (2026-10-02: the button waits for the first save, so no order is
      // left without its link and a second press cannot make a duplicate), and its Nästa steg leads back here.
      const protocolId = task.id;
      if (!protocolId) return null;
      const base = emptyData("WORK_ORDER", null);
      const member = members.find((item) => item.name.trim().toLowerCase() === assignedToName.trim().toLowerCase());
      // The description is the row's own; where it came from is the source link in the order's facts (simulation 2026-10-10).
      const order = { id: undefined, version: 0, kind: "WORK_ORDER", title, description: (description.trim() || deviation?.fault?.trim() || "").slice(0, 5000), status: "PLANNED", progress: 0,
        projectId: task.projectId, customerId: selectedProject?.customerId ?? task.customerId, facilityId: task.facilityId ?? null,
        assignedToUserId: member?.id ?? null, assignedToName: member?.name ?? assignedToName, dueDate, data: { ...(tempPlace ? { tempPlace } : {}), kind: "WORK_ORDER", details: { ...(base.details as object), source: { taskId: protocolId, title: task.title.slice(0, 200), kind: "FORM", ...(targetId ? { rowId: targetId } : {}) } } }, totalDurationSec: 0, timerRunning: false } as unknown as WorkflowTaskRecord;
      // Underhåll (2026-10-30): when the protocol is on a machine part the server gives the order a maintenance item –
      // avhjälpande, the deviation as its fault and the priority from the row's severity or the one the form gave.
      const maintenance = maintenanceFromDeviation({ ...deviation, fault: deviation?.fault ?? description });
      try {
        const result = local ? await local.save(order) : await api<{ id: string }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "save", task: order, maintenance }) });
        setMessage("Arbetsordern är skapad och kopplad till raden. Spara protokollet så sparas kopplingen.");
        return result.id;
      } catch (issue) { setError((issue as Error).message); return null; }
    },
  };
  // Riskbedömning som steg (2026-10-08): its own dot on the line, before the work, when the job has the step.
  const riskFlowInput = riskApplies ? { met: riskStep.state.done, hint: riskStep.state.hint } : undefined;
  // One tap: the extended risk assessment is created with the job's project, customer and place, linked here, and opened.
  async function createRiskAssessment() {
    // A new job without a title cannot be saved, so the extended assessment could not be linked (2026-10-24: Skapa
    // did nothing). Before asking, lead to the title with help instead of a ban (punkt 7).
    if (!task.id && titleMissing) { askTitle(titleHelpText("skapa en utökad riskbedömning", titleLabel)); return; }
    // R2-KTR-01: never a second task without asking.
    if (!(await confirm({ title: "Gör utökad riskbedömning?", message: task.id ? "En ny uppgift skapas och kopplas hit." : "Uppgiften sparas och en ny riskbedömning skapas och kopplas hit.", confirmLabel: "Skapa" }))) return;
    const id = task.id || await save();
    if (!id) return;
    setBusy(true); setError("");
    try {
      const made = await createExtendedAssessment({ job: { ...latestTask.current, id }, forms: !local, prepare: (record) => prefilled(record as unknown as WorkflowTaskRecord) as unknown as Record<string, unknown>,
        save: (record) => local ? local.save(record as unknown as WorkflowTaskRecord) : api<{ id: string }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "save", task: record }) }) });
      const now = latestTask.current;
      const next = { ...now, data: withRiskCheck(now.data, { ...(riskCheckOf(now.data) ?? emptyRiskCheck()), level: "extended", extendedTaskId: made.id, confirmedAt: null, confirmedBy: "" }) };
      latestTask.current = next; setTask(next);
      setBusy(false);
      // The extended assessment leads back to this job (samband, 2026-10-26).
      if (await save()) router.push(withReturn(`/?view=workflow_task&taskId=${encodeURIComponent(made.id)}&taskType=${made.kind}`, `${location.pathname}${location.search}`));
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  /** Gör utökad riskbedömning from a task's shared Riskbedömning (2026-10-30): made in the work order, linked to its step. */
  async function createHolderRiskAssessment() {
    if (!holderRecord) return;
    if (!(await confirm({ title: "Gör utökad riskbedömning?", message: "En ny riskbedömning skapas i arbetsordern och kopplas till dess riskbedömning.", confirmLabel: "Skapa" }))) return;
    setBusy(true); setError("");
    try {
      const made = await createExtendedAssessment({ job: holderRecord, forms: !local,
        save: (record) => local ? local.save(record as unknown as WorkflowTaskRecord) : api<{ id: string }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "save", task: record }) }) });
      holder.patch({ data: (data) => withRiskCheck(data, { ...(riskCheckOf(data) ?? emptyRiskCheck()), level: "extended", extendedTaskId: made.id, confirmedAt: null, confirmedBy: "" }) });
      await holder.flush();
      router.push(withReturn(`/?view=workflow_task&taskId=${encodeURIComponent(made.id)}&taskType=${made.kind}`, `${location.pathname}${location.search}`));
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  // The progress line (2026-10-01): the steps of this kind of task, from the same rules as progress and Slutför.
  const flow = task.data.kind === "WORK_ORDER"
    ? workOrderFlow({ saved: Boolean(task.id), title: task.title, status: task.status, assigned: Boolean(task.assignedToUserId || task.assignedToName.trim()), dueDate: task.dueDate, timerRunning: task.timerRunning, totalDurationSec: task.totalDurationSec, executionNotes: task.data.details.executionNotes, signatureName: task.data.details.signature.name, signatureConfirmed: task.data.details.signature.confirmed, riskStep: riskFlowInput, fromQuote: workOrderFromQuote(task.data.details) })
    : task.data.kind === "RISK_ASSESSMENT"
      ? riskFlow({ saved: Boolean(task.id), title: task.title, status: task.status, risks: task.data.details.risks, approvalName: task.data.details.approval.name, approvalConfirmed: task.data.details.approval.confirmed })
      : formFlow({ saved: Boolean(task.id), title: titleFieldEmpty ? "" : task.title, status: task.status, issues: completion.issues, requirements: completion.requirements, signatureBlocks: formLeafBlocks(task.data.details.document).filter((block) => block.type === "signature").map((block) => block.id), titleFieldLabel: titleField && "label" in titleField ? titleField.label : undefined, titleFieldTarget: titleField ? `form-${titleField.id}` : undefined,
        moments: formMoments(task.data.details.document, task.data.details.values), riskStep: riskFlowInput,
        ...(linkBlock && !cancelled ? { linkFirst: { hint: "Koppla till en arbetsorder först.", target: "task-work-order-missing" } } : {}),
        // One percentage (simulation 2026-10-10): the page's header says "N % klart"; a phone at level 1 has no header, so
        // its Ifyllnad row says the same number.
        progress: nativeJob ? workflowTaskProgress(task) : undefined });
  const nextLine = preview ? null : nextStepLine({ flow, issues: completion.issues, pendingText: completion.pendingText, riskRefusal: riskApplies ? riskStepRefusal(riskStep.state, "complete") : null, blocked: frozen ? null : startBlock });
  // "Nästa steg" som huvudknapp (UX-granskningen avsnitt 6, punkt 7): on a saved job that can be worked on, the primary
  // button names the next step from the same line ("Gör riskbedömningen", "Fyll i protokollet") and leads there; Spara
  // stays beside it (autosave does the rest). A new job, a missing title or a block keep Spara as the primary.
  const nextLabel = task.id && !titleMissing && task.status !== "COMPLETED" && !cancelled && !frozen && (nextLine?.target || nextLine?.key === "complete") ? nextStepAction(nextLine, task.data.kind) : null;
  const goNext = (next: NonNullable<typeof nextLine>) => {
    if (next.key === "complete") void complete();
    else if (next.kind === "risk") { if (!nativeGo(RISK_STEP_TARGET)) focusTarget(RISK_STEP_TARGET); }
    else focusRequirement(next.target ?? "task-complete");
  };
  const nextAction = nextLabel && nextLine ? <Button type="button" disabled={busy} onClick={() => goNext(nextLine)} title={nextLine.text} data-testid="task-next-step" data-next-key={nextLine.key}>{nextLabel}</Button> : null;
  /**
   * Avbryt and "Tillbaka till …" top right (samband, 2026-10-26): a job not created yet has Avbryt – one step back, asking
   * first when something is filled in – and a job opened as a sub-page has "Tillbaka till arbetsordern", which saves what is
   * changed and returns with the job marked for the page it came from. Level 1 has them in its top bar.
   */
  const cancelNew = async () => {
    if (dirty && !(await confirm(DISCARD_QUESTION))) return;
    forgetDraft(draftKeyFor(""));
    // Off the entry the back guard keeps, so the step back lands on the page before.
    await releaseBack();
    leaveWithoutAsking();
    if (way) way.cancel(); else leavePage(kind === "WORK_ORDER" ? "/?view=work_orders" : "/?view=tasks");
  };
  const returnWithJob = async () => {
    if (!way) return;
    if (dirty && !(await save())) return;
    leaveWithoutAsking();
    // The job is marked for a work order's Uppgifter, and a new work order for the choice it was made from (Ny uppgift's
    // "Vilken arbetsorder?", 2026-10-26); another page just comes back as it was.
    if (way.word === "arbetsordern" || kind === "WORK_ORDER") way.done("Task", latestTask.current.id || task.id); else way.done();
  };
  // Ta bort arbetsorder (svar 2b): the confirmation lists the tasks that go with it; a completed or signed protocol stops it,
  // and the work order is completed or set to Utgår instead (history is kept).
  const removeWorkOrder = async () => {
    if (!task.id) return;
    const inside = local ? local.tasks.filter((item) => item.workOrderId === task.id).map((item) => ({ id: item.id, kind: item.kind, title: item.title, status: item.status, signed: taskIsSigned(item.data) })) : null;
    let check: { refusal: string | null; summary: string };
    try {
      check = inside ? { refusal: workOrderRemovalRefusal(inside), summary: workOrderRemovalSummary(inside) }
        : await api<{ refusal: string | null; summary: string }>(`/api/workflow-tasks?removalFor=${encodeURIComponent(task.id)}`);
    } catch (issue) { announce((issue as Error).message, true); return; }
    if (check.refusal) { await confirm({ title: "Arbetsordern kan inte tas bort", message: check.refusal, confirmLabel: "Stäng", cancelLabel: "Avbryt" }); return; }
    if (!(await confirm({ title: "Ta bort arbetsordern?", message: `${check.summary} Det går inte att ångra.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    setBusy(true);
    try {
      if (local?.removeWorkOrder) await local.removeWorkOrder(task.id);
      else await api(`/api/workflow-tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
      leaveWithoutAsking();
      announce("Arbetsordern är borttagen.");
      leavePage("/?view=work_orders");
    } catch (issue) { announce((issue as Error).message, true); }
    finally { setBusy(false); }
  };
  const removeShown = kind === "WORK_ORDER" && Boolean(task.id) && !preview && task.status !== "COMPLETED" && (local ? Boolean(local.removeWorkOrder) : canRemove);
  const cancelAction = native || preview ? null
    : !task.id ? (taskId || unavailable ? null : <Button type="button" variant="outline" disabled={busy} onClick={() => void cancelNew()} data-testid="task-new-cancel">Avbryt</Button>)
    : way ? <Button type="button" variant="outline" disabled={busy} onClick={() => void returnWithJob()} data-testid="return-to-origin"><Undo2 />{way.label}</Button> : null;
  const saveButton = (variant?: "outline") => <Button variant={variant} disabled={busy} disabledReason={saveReason} aria-describedby={saveReason || titleMissing ? EDITOR_PRIMARY_REASON_ID : undefined}
    onClick={() => { if (!task.title.trim()) askTitle(titleReason); else void save(); }} busy={busy} busyLabel="Arbetar…"><Save />Spara</Button>;
  const flowGuide = <FlowGuide flow={flow} page={task.id || `new-${kind}`} missing={completion.issues.map((issue) => issue.message)}
    pageLabel={task.data.kind === "FORM" ? task.data.details.templateName : kind === "WORK_ORDER" ? "Arbetsorder" : "Riskbedömning"}
    advisor={preview ? undefined : {
      kind: task.data.kind, currentTaskId: task.id, saved: Boolean(task.id), completed: task.status === "COMPLETED", today: swedishDayKey(new Date()), dueDate: task.dueDate,
      unsavedNew: !task.id && Boolean(task.title.trim()) && !titleFieldEmpty, timerAvailable: kind === "WORK_ORDER", timerRunning: task.timerRunning, totalDurationSec: task.totalDurationSec,
      deviationsNoted: task.data.kind === "WORK_ORDER" && Boolean(task.data.details.deviations.trim()), rowsWithoutOrder, pendingText: completion.pendingText,
      highResidualRisks: task.data.kind === "RISK_ASSESSMENT" ? task.data.details.risks.filter((risk) => risk.residualLikelihood * risk.residualConsequence >= 10).length : 0,
    }}
    handlers={{ startTimer: () => void timer("START"), complete: () => void complete(), save: () => void save() }}
    // Varför kan jag inte gå vidare? (Fas 4B): the same order as Färdigställ – the block, the line, the requirements, the risk step.
    nextStep={nextLine}
    onNextStep={(next) => { if (next.kind === "blocked") announce(next.text, true); else if (next.kind === "risk") showRiskStep(next.text); else focusRequirement(next.target ?? "task-complete", next.text); }} />;
  // Leaving a field saves what was typed there at once (only while autosave applies; see flush).
  const saveOnLeave = (event: React.FocusEvent<HTMLDivElement>) => {
    // Moving to Avbryt does not save what Avbryt may throw away (KTR-01); Kasta then puts the old state back.
    if ((event.relatedTarget as HTMLElement | null)?.closest?.("[data-testid=native-top-cancel]")) return;
    if (!preview && !local && event.target.matches(LEAVE_SAVES)) void flushRef.current();
  };
  // Om projektet and Grunduppgifter: the planning of the task. Before the work, or after it for the responsible person
  // on a phone or tablet at level 1–2 (Utförande först, 2026-10-08).
  const projectFactsPanel = selectedProject && projectFactRows(selectedProject, customers).length ? <Panel icon={Info} key={`project-facts-${detailLevel}`} collapsible defaultCollapsed={detailLevel < 3} title="Om projektet" description={`Från projektet ${selectedProject.name}. Ändras i projektet och skrivs ut i rapporten.`} actions={preview ? undefined : <Button asChild variant="outline"><Link href={`/?view=project&projectId=${encodeURIComponent(selectedProject.id)}`} data-testid="task-open-project"><FolderKanban />Öppna projektet</Link></Button>}><dl data-testid="task-project-fields" className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">{projectFactRows(selectedProject, customers).map(([label, value]) => <div key={label} className={label === "Arbetsbeskrivning" ? "sm:col-span-2 xl:col-span-4" : undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl></Panel> : null;
  const titleInput = <label className="space-y-2 text-xs font-medium text-muted-foreground">Rubrik<Input id="task-title" value={task.title} maxLength={200} onChange={(e) => setTask({ ...task, title: e.target.value })} /></label>;
  // A job that already stands in a project keeps the field; nothing new is tied to Projekt while it is off.
  const projectField = !moduleIsOn("projects") && !task.projectId ? null : <label className="space-y-2 text-xs font-medium text-muted-foreground" title={task.id ? "Flytta arbetsordern via projektet." : undefined}>Projekt (valfritt){task.id ? <span className="ml-1 font-normal">· flyttas via projektet</span> : null}<select className="form-select" value={task.projectId ?? ""} disabled={Boolean(task.id) || (kind === "FORM" && form?.allowInProject === false)} onChange={(e) => { const next = projects.find((project) => project.id === e.target.value); setTask(prefilled(task.id ? { ...task, projectId: next?.id ?? null, customerId: next?.customerId ?? task.customerId } : inherit({ ...task, dueDate: "" }, next), ["project", "facility", "customer", "contact", "email"], true)); }}><option value="">Inget projekt</option>{projects.filter((project) => (!project.archivedAt && !project.closedAt) || project.id === task.projectId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>;
  // Kund och plats (2026-10-08): the customer first, then one of its places; in a project both follow the project.
  const customerField = <CustomerField id="task" customers={customers} customerId={(customerLocked ? lockedCustomerId : task.customerId) ?? null} facilityId={task.facilityId ?? null}
          locked={customerLocked} lockedNote={inOrder ? "Kunden följer arbetsordern." : source.customer} placeNote={source.place} disabled={task.status === "COMPLETED" || frozen || Boolean(preview)}
          savePlace={preview ? undefined : local ? local.savePlace : canCreatePlaces ? cloudSavePlace : undefined} quick={customerQuick} search={!local && !preview}
          placeOpenRequest={placeOpenRequest}
          onChange={(next) => next.changed === "place" ? choosePlace(next.facilityId, next.customerId) : setCustomerAndPlace(next.customer, next.facilityId)} />;
  // Avser driftrond (punkt 3): the round a work order holds and its period (Start – Klart senast); a round chosen fills in
  // what the new work order lacks – its name with the period and the responsible person. The customer, place and project are
  // the work order's own (2026-10-27 kväll); a round from before then that stored a customer and place suggests them.
  const fillFromRound = (round: RoundChoice) => setTask((current) => {
    if (current.id) return current;
    const legacy = !current.customerId && !current.facilityId ? round.legacyPlace ?? null : null;
    return { ...current, title: current.title.trim() ? current.title : roundHolderTitle(round, { from: current.plannedStartDate ?? "", to: current.dueDate }),
      ...(legacy?.customerId ? { customerId: legacy.customerId, facilityId: legacy.facilityId ?? null } : {}),
      assignedToUserId: current.assignedToUserId ?? round.assignedToUserId ?? null, assignedToName: current.assignedToUserId ? current.assignedToName : round.assignedToName ?? "" };
  });
  const roundField = task.data.kind === "WORK_ORDER" && !preview && (moduleIsOn("rounds") || task.roundScheduleId) ? <RoundHolderField value={task.roundScheduleId ?? null} period={{ from: task.plannedStartDate ?? "", to: task.dueDate }}
    disabled={task.status === "COMPLETED" || contentLocked} locked={Boolean(task.roundOccurrence)} rounds={local?.rounds} fillOnLoad={!task.id && Boolean(roundOrderParam)}
    onChange={(roundScheduleId) => setTask((current) => ({ ...current, roundScheduleId }))}
    onPeriod={(period) => setTask((current) => ({ ...current, plannedStartDate: period.from, dueDate: period.to }))} onRound={fillFromRound} /> : null;
  const statusField = task.data.kind === "WORK_ORDER"
          // A work order's status follows the maintenance method (2026-10-06): Pausad can say what it waits for.
          ? <label className="space-y-2 text-xs font-medium text-muted-foreground">Status<select id="task-status" aria-label="Status" aria-describedby="task-status-hint" className="form-select" value={task.status === "PAUSED" && waitingReasonOf(task.status, task.data.details) ? `PAUSED:${waitingReasonOf(task.status, task.data.details)}` : task.status} disabled={task.status === "COMPLETED"}
            onChange={(e) => { const [status, waiting = ""] = e.target.value.split(":") as [WorkflowTaskStatus, WaitingReason | ""]; setTask((current) => current.data.kind !== "WORK_ORDER" ? current : !waiting && !current.data.details.waitingOn ? { ...current, status }
              : { ...current, status, data: { ...current.data, details: { ...current.data.details, waitingOn: waiting } } }); }}>
            {statusOptions(task.status)}
            {WAITING_REASONS.map((reason) => <option key={reason} value={`PAUSED:${reason}`}>{WAITING_REASON_LABELS[reason]}</option>)}
          </select>{moduleIsOn("time") ? statusHint : null}</label>
          // Pågår and Pausad follow the time (2026-10-08); the list offers what time does not drive.
          : <label className="space-y-2 text-xs font-medium text-muted-foreground">Status<select id="task-status" aria-label="Status" aria-describedby="task-status-hint" className="form-select" value={task.status} disabled={task.status === "COMPLETED"} onChange={(e) => setTask({ ...task, status: e.target.value as WorkflowTaskStatus })}>{statusOptions(task.status)}</select>{moduleIsOn("time") ? statusHint : null}</label>;
  const descriptionField = <label className="block space-y-2 text-xs font-medium text-muted-foreground">Beskrivning<textarea aria-label="Beskrivning" className="form-textarea" value={task.description} maxLength={5000} onChange={(e) => setTask({ ...task, description: e.target.value })} /></label>;
  // What is filled in under the fold, as one line while it is folded.
  const moreSummary = [selectedProject?.name, task.assignedToName || members.find((member) => member.id === task.assignedToUserId)?.name, task.dueDate ? `Klart senast ${task.dueDate}` : ""].filter(Boolean).join(" · ");
  // Grunduppgifter är gemensamma (2026-10-30; replaces svar 4b's own Ansvarig, Klart senast and Plats): one component
  // (features/workflow/shared-basics.tsx) on the page's own job – the work order, or a draft without one – and, in a task of
  // a work order, on the work order itself with the line "Hör till arbetsorder X – ändras på båda ställena".
  const ownBasicsHandlers = {
    onTitle: (title: string) => setTask((current) => ({ ...current, title })),
    onDescription: (description: string) => setTask((current) => ({ ...current, description })),
    onCustomer: (change: CustomerPlaceChange) => change.changed === "place" ? choosePlace(change.facilityId, change.customerId) : setCustomerAndPlace(change.customer, change.facilityId),
    onResponsible: (id: string, name?: string) => { if (id || name === undefined) chooseResponsible(id); else setTask((current) => prefilled({ ...current, assignedToName: name, assignedToUserId: null }, ["assignee"])); },
    onSchedule: (values: { plannedStartDate?: string; estimatedMinutes?: number | null; stage?: string }) => setTask((current) => ({ ...current, ...values })),
    onDueDate: (dueDate: string) => setTask((current) => ({ ...current, dueDate })),
    memberNote: (member: { id: string; name: string }) => work.context && assignBlock(work.context, { id: member.id, name: member.name }) ? " – når inte krävd nivå" : "",
    assigneeNote: assigneeBlock ? <span role="note" data-testid="task-assignee-level" className="block text-xs font-normal text-amber-800 dark:text-amber-200">{assigneeBlock}</span> : null,
    customer: { locked: customerLocked, lockedNote: source.customer, placeNote: source.place, savePlace: preview ? undefined : local ? local.savePlace : canCreatePlaces ? cloudSavePlace : undefined, quick: customerQuick, search: !local && !preview, placeOpenRequest },
  };
  const holderProject = projects.find((project) => project.id === holderRecord?.projectId);
  const holderBasicsPanel = holderShown && task.workOrderId ? <SharedBasicsPanel holder={{ id: task.workOrderId, title: holderRecord?.title || workOrderTitle }} holderReadable={holder.readable && task.workOrder?.readable !== false}
    description={holderRecord && !canEditWorkOrders ? "Du kan läsa men inte ändra arbetsordern." : undefined} testId="task-holder-basics">
    {holderRecord ? <SharedBasicsFields idPrefix="holder" titleLabel="Arbetsorderns rubrik" value={holderRecord} customers={customers} projects={projects} members={holder.members} disabled={holderLocked}
      onTitle={(title) => holder.patch({ title })} onDescription={(description) => holder.patch({ description })}
      onCustomer={(change) => holder.patch({ customerId: change.customerId, facilityId: change.facilityId })}
      onResponsible={(id, name) => { const member = holder.members.find((item) => item.id === id); holder.patch(member ? { assignedToUserId: member.id, assignedToName: member.name } : { assignedToUserId: null, assignedToName: name ?? "" }); }}
      onSchedule={(values) => { if (values.plannedStartDate !== undefined) holder.patch({ plannedStartDate: values.plannedStartDate }); }}
      onDueDate={(dueDate) => holder.patch({ dueDate })}
      afterGrid={<TempPlaceField value={tempPlaceOf(holderRecord.data)} disabled={holderLocked} onChange={(place) => holder.patch({ data: (data) => withTempPlace(data, place) })} />}
      customer={{ locked: Boolean(holderProject?.customerId), lockedNote: holderProject?.customerId ? "Kunden följer projektet." : undefined, search: !local, savePlace: local ? local.savePlace : canCreatePlaces ? cloudSavePlace : undefined }} />
      : <p className="text-sm text-muted-foreground" data-testid="task-holder-loading">{holder.readable ? "Hämtar arbetsordern…" : "Du saknar behörighet att läsa arbetsordern."}</p>}
    {/* The task's own name, apart from the work order's rubrik (användartest 2026-10-31, fel 1: a control's name was typed in
        the work order's and renamed it). A protocol drawn like the control takes it from its own field, which is said here. */}
    {inlineTask ? <p className="text-sm text-muted-foreground" data-testid="task-own-name">Uppgiftens namn: <strong className="font-medium text-foreground">{task.title.trim() || "(inte ifyllt)"}</strong>{titleLabel ? ` – följer fältet ${titleLabel} i protokollet` : ""}</p> : <label className="space-y-2 text-xs font-medium text-muted-foreground">Uppgiftens namn<Input id="task-title" value={task.title} maxLength={200} onChange={(e) => setTask({ ...task, title: e.target.value })} /></label>}
    {workOrderField && task.id ? <CollapsibleSection title="Flytta till annan arbetsorder" summary={workOrderTitle || "Arbetsorder"} open={moreOpen} onOpenChange={setMoreOpen} testId="task-move-work-order">{workOrderField}</CollapsibleSection> : null}
  </SharedBasicsPanel> : null;
  // Ett utkast (2026-10-30, punkt 3): its Grunduppgifter are filled in on the draft and move to the work order made
  // with Skapa arbetsorder; Koppla till arbetsorder shows the difference first (the Saknar arbetsorder notice above).
  const draftBasicsPanel = inOrder && !preview && !task.workOrderId ? <SharedBasicsPanel description="Följer med till arbetsordern när den skapas." testId="task-draft-basics">
    <SharedBasicsFields value={task} customers={customers} projects={projects} members={members} hideTitle={inlineTask} disabled={task.status === "COMPLETED" || frozen} {...ownBasicsHandlers} afterGrid={tempPlaceField} />
  </SharedBasicsPanel> : null;
  const taskSharedPanel = holderBasicsPanel ?? draftBasicsPanel;
  const basicsPanel = inlineTask && nativeNew ? null : inOrder ? taskSharedPanel : nativeNew ? <Panel icon={FileText} title="Grunduppgifter">
      {/* Ny arbetsorder on the phone (2026-10-14): only what creating it needs – Rubrik, Kund, Plats and Beskrivning (
          2026-10-15: visible at once, what is to be done is usually written there); Projekt, Ansvarig, the dates, Uppskattad
          tid and Status under a folded "Fler uppgifter" (level 1 is for the work out there). */}
      <div className="grid gap-4">
        {titleInput}
        {customerField}
        {tempPlaceField}
        {descriptionField}
        <CollapsibleSection title="Fler uppgifter" summary={moreSummary || "Projekt, ansvarig, datum och status"} open={moreOpen} onOpenChange={setMoreOpen} testId="native-new-more">
          {projectField}
          {workOrderField}
          {planningFields}
          {statusField}
          {roundField}
        </CollapsibleSection>
      </div>
    </Panel> : <SharedBasicsPanel description="Gäller arbetsordern och alla uppgifter i den.">
      {/* The work order's own Grunduppgifter: the same component its tasks show (2026-10-30). */}
      <SharedBasicsFields value={task} customers={customers} projects={projects} members={members} {...ownBasicsHandlers}
        projectSlot={projectField}
        planningExtras={<>
          <TaskScheduleFields part="estimate" task={task} frame={selectedProject} onChange={(values) => setTask((current) => ({ ...current, ...values }))} />
          {task.projectId ? <TaskScheduleFields part="stage" task={task} stageOptions={stageOptions} onChange={(values) => setTask((current) => ({ ...current, ...values }))} /> : null}
        </>}
        extras={<>{statusField}{roundField}</>} afterGrid={tempPlaceField} />
    </SharedBasicsPanel>;
  const planningPanels = <>{projectFactsPanel}{basicsPanel}</>;
  const customerPickerDialog = inlineTask ? <CustomerPicker open={customerPicker} onOpenChange={setCustomerPicker} onSelect={(customer) => { chooseCustomer(customer); setCustomerPicker(false); }} localCustomers={local || preview ? customers : undefined}
    onCreateLocal={local?.saveCustomer ? (data) => local.saveCustomer!({ ...blankCustomerForm, ...data }, null) : undefined} /> : null;
  const jobCheckInShown = !local && !preview && Boolean(task.id) && selectedProject && moduleIsOn("staff_register");
  // Högst fyra knappar (2026-11-14): as a list, so the shared header moves what does not fit under Mer; the native page shows them all.
  const reopenLabel = "Återöppna";
  const copyAs = () => { if (task.id) router.push(`/?view=workflow_task&taskType=FORM&formId=${encodeURIComponent(task.data.kind === "FORM" ? task.data.details.templateId : "")}&copyOf=${encodeURIComponent(task.id)}`); else void save(); };
  const headerActionList: MaybeHeaderAction[] = [
    // Checka in här / Checka ut (2026-10-12): level 2–3 in the header, level 1 as the first row of Uppdraget.
    jobCheckInShown && !native ? { key: "check-in", node: <JobCheckIn project={selectedProject!} variant="button" /> } : null,
    taskInvoice.button ? { key: "invoice", node: taskInvoice.button } : null,
    // A completed control is never reopened; it is continued with Spara som (2026-09-27).
    task.status === "COMPLETED" && task.formArea !== "kfid" ? { key: "reopen", node: <Button variant="outline" disabled={busy} onClick={() => void reopen()}><RotateCcw />{reopenLabel}</Button>,
      menu: { label: reopenLabel, icon: RotateCcw, disabled: busy, onSelect: () => void reopen() } } : null,
    // Starta tid, Rapportera hinder, Färdigställ and Utgår live only in the work order’s Utförande (2026-10-30, punkt 4);
    // a task has only "Uppgiften klar". Återuppta is in the Utgått notice, Lös hindret in the hinder notice.
    // Only as the follow-up of a deviation (Fas 4A); named for what it does (kundresa 2026-11-07, M21).
    !preview && headerWorkOrderShown(task) ? { key: "follow-up", keep: true, node: <Button variant="outline" disabled={busy} onClick={() => void createFollowUp()} title="Ny arbetsorder för avvikelserna, med uppgiftens projekt, kund och plats. Protokollet stannar där det är." data-testid="task-follow-up-work-order"><ClipboardList />{FOLLOW_UP_ORDER_LABEL}</Button>,
      menu: { label: FOLLOW_UP_ORDER_LABEL, icon: ClipboardList, disabled: busy, onSelect: () => void createFollowUp(), testId: "task-follow-up-work-order" } } : null,
    // Workflow AI words a work order from the saved task’s deviations; nothing is created until the person confirms.
    task.id && !preview && !local && WorkOrderProposal ? { key: "ai-work-order", node: <WorkOrderProposal taskId={task.id} task={task as unknown as Record<string, unknown>} disabled={busy} /> } : null,
    // Granska med AI: a second pair of eyes on a saved protocol with results; it changes nothing.
    task.id && task.data.kind === "FORM" && !preview && !local && ProtocolReview && formHasContent(task.data.details.values) ? { key: "ai-review", node: <ProtocolReview taskId={task.id} disabled={busy} /> } : null,
    // … and a measure for each risk of a risk assessment form that has none yet.
    riskTable && !preview && !local && task.status !== "COMPLETED" && RiskMeasuresAssist ? { key: "ai-risk", node: <RiskMeasuresAssist title={task.title} taskId={task.id || undefined} risks={risksWithoutMeasure} onApply={applyRiskMeasures} disabled={busy} /> } : null,
    // Spara som copies a saved protocol; the control’s header shows it from the start, so an unsaved one just saves.
    task.data.kind === "FORM" && (task.id || inlineTask) ? { key: "copy-as", node: <Button variant="outline" disabled={busy} onClick={copyAs}><Copy />Spara som</Button>,
      menu: { label: "Spara som", icon: Copy, disabled: busy, onSelect: copyAs } } : null,
  ];
  const messageBlock = <>
    {(error || message) && <p role={error ? "alert" : "status"} className={error ? "notice text-destructive" : "notice"}>{error || message}{draftRestored && !error ? <Button type="button" size="sm" variant="outline" className="ml-3" data-testid="task-discard-draft" onClick={() => { forgetDraft(draftKeyFor("")); setDraftRestored(false); setMessage(""); const fresh = prefilled(blankTask()); setSavedKey(taskKey(fresh)); setTask(fresh); }}>Kasta utkastet</Button> : null}</p>}
    {/* A colleague's change in a field the person also changed (2026-10-04): said clearly, until dismissed. */}
    {remoteNotice ? <div role="alert" className="notice flex flex-wrap items-center justify-between gap-2" data-testid="task-remote-notice"><span className="text-sm">{remoteNotice}</span><Button type="button" size="sm" variant="outline" onClick={() => setRemoteNotice("")}>OK</Button></div> : null}
    {/* A save that met someone else's change in the same field (F3, 2026-10-28): what is saved is shown, the own text is offered. */}
    {saveConflict ? <div role="alert" className="notice space-y-2" data-testid="task-save-conflict">
      <p className="text-sm">{saveConflict.text}</p>
      {showMine ? <div className="space-y-2" data-testid="task-save-conflict-mine">{saveConflict.fields.map((field) => <div key={field.key}>
        <p className="text-xs font-medium">Din text i {field.label}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{conflictText(field.mine)}</p>
      </div>)}</div> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" aria-expanded={showMine} onClick={() => setShowMine((open) => !open)}>{showMine ? "Dölj min text" : "Visa min text"}</Button>
        {task.status !== "COMPLETED" && !frozen ? <Button type="button" size="sm" disabled={busy} onClick={applyMine}>Använd min text</Button> : null}
        <Button type="button" size="sm" variant="outline" onClick={() => { setSaveConflict(null); setShowMine(false); }}>OK</Button>
      </div>
    </div> : null}
    {error && /har ändrats/i.test(error) && task.id && !local ? <div className="notice space-y-2" data-testid="task-conflict">
      <p className="text-sm">Din version är kvar tills du läser in den senaste. Kopiera det du skrivit först.</p>
      <div className="flex flex-wrap gap-2"><CopyButton size="sm" value={() => JSON.stringify(task.data.details, null, 2)} label="Kopiera min version" onCopied={() => setMessage("Din version är kopierad.")} /><Button type="button" size="sm" onClick={() => { baseline.current = null; setError(""); void load(); }}>Läs in senaste</Button></div>
    </div> : null}
  </>;
  // Fakturaunderlag first in Nästa steg on a finished order (2026-11-06), for those who may make one; level 1 moves its row here.
  const invoiceRowShown = Boolean(invoiceBases && moduleIsOn("invoicing") && !local && !task.workOrderId && task.id);
  const nextStepsLead = native ? (invoiceRowShown ? <InvoiceBasisNativeRow taskId={task.id} completed button onSummary={(summary) => setInvoiced(summary.marked.invoiced.length > 0)} /> : null)
    : taskInvoice.open ? <Button type="button" onClick={taskInvoice.open} data-testid="next-step-invoice"><Receipt />Fakturaunderlag</Button> : null;
  const nextStepsBlock = task.status === "COMPLETED" && task.id && !preview ? <NextSteps task={task} projectName={selectedProject?.name} source={task.data.kind === "WORK_ORDER" ? task.data.details.source ?? null : null} lead={nextStepsLead}
    localTasks={local?.tasks} onCreateWorkOrder={task.kind !== "WORK_ORDER" ? () => void createFollowUp() : undefined} onRepeat={repeatable && (local ? Boolean(local.rounds) : canRepeat) ? () => setRepeatOpen(true) : undefined} /> : null;
  const flowDialogs = <>
    {repeatOpen && task.data.kind === "FORM" ? <ScheduleDialog schedule={null} heading="Upprepa kontrollen" initial={repeatScheduleDraft({ ...task, data: task.data }, swedishDayKey(new Date()))}
      backend={(() => { const rounds = local?.rounds ?? cloudRoundsBackend; const name = task.data.details.templateName ?? ""; return { ...rounds, save: (input, templateName) => rounds.save(input, templateName || name) }; })()}
      onClose={() => setRepeatOpen(false)}
      onSaved={() => { setRepeatOpen(false); announce("Kontrollen är planerad som rond. Tillfällena syns under Driftronder."); }} /> : null}
    {/* The job's booking line is read again when the dialog closes: Färdigställ may have removed the coming bookings. */}
    <CompleteTaskDialog open={completeOpen} onOpenChange={(open) => { setCompleteOpen(open); if (!open) setBookingsRead((value) => value + 1); }} title={inOrder ? "Uppgiften klar" : `Färdigställ ${docWord.toLowerCase()}`}
      lockText={`${completion.pendingText ? `${completion.pendingText[0].toUpperCase()}${completion.pendingText.slice(1)} (Ej bedömd). ` : ""}${isForm ? "Protokollet låses för ändringar. Du kan senare skapa en kopia med Spara som." :`${docWord} låses för ändringar och sparas i historiken.${reopenable ? " Återöppna den vid behov." : ""}`}${rowsWithoutOrder ? ` ${rowsWithoutOrder === 1 ? "En rad" : `${rowsWithoutOrder} rader`} som kan följas upp saknar arbetsorder. Skapa den på raden först om den behövs.` : ""}`}
      totalDurationSec={task.totalDurationSec} timerRunning={task.timerRunning} timerOnWorkOrder={inOrder && Boolean(task.workOrderId)} canReportTime={!preview && !inOrder} onComplete={completeWith}
      taskId={!local && !preview && task.id ? task.id : undefined} openTasks={openTasksText} />
  </>;
  // The obstacle notice stands on the job's menu (and the ordinary page), not over every step at level 1 (2026-10-14).
  const obstacleNotice = obstacle && task.id && !cancelled && task.status !== "COMPLETED" ? <ObstacleNotice obstacle={obstacle} canResolve={!preview && !projectFrozen} busy={busy} onResolve={() => void changeObstacle(null)} /> : null;
  const canBookHere = task.kind === "WORK_ORDER" && isTaskOpen(task.status) && !projectFrozen && Boolean(canBookJob?.(task.projectId ?? null));
  // S4: an order made by a machine alarm says so, and offers "Jag tar den" while nobody is responsible.
  const alarmOrderOpen = !local && !preview && Boolean(task.id) && isAlarmWorkOrder(task) && !cancelled && task.status !== "COMPLETED";
  // Tilldela (2026-11-07): beside Jag tar den, for whoever may edit work orders; grey with the reason for the others.
  const assignReason = assignRefusal({ canEdit: canEditWorkOrders, projectFrozen });
  const assignFromBell = searchParams.get("assign") === "1" && Boolean(task.id) && assignAskHandled !== task.id;
  const machineAlarmNotice = alarmOrderOpen && task.id
    ? <AutomaticOrderNotice taskId={task.id} fault={isFaultWorkOrder(task)} canClaim={!task.assignedToUserId && !projectFrozen} onClaimed={() => void load()}
      canCreateDeviation={!projectFrozen && Boolean(work.context) && !work.context?.orderDeviations?.length} onDeviation={() => void work.reload()}
      assign={members.length ? <AssignButton disabledReason={assignReason} onClick={() => { setAssignError(""); setAssignOpen(true); }} /> : null} /> : null;
  const lockNotices = <>
    {linkBlock ? draftNotice : null}
    {cancelled && task.id ? <TaskCancelledNotice docWord={docWord} reason={task.cancelReason ?? ""} at={task.cancelledAt} canRestore={!preview && !projectFrozen && (!local || Boolean(local.cancel))} busy={busy} onRestore={() => void restoreJob()} /> : null}
    {projectFrozen ? <div className="notice" data-testid="task-project-frozen">Projektet {selectedProject?.archivedAt ? "är arkiverat" : "är avslutat"}, så uppgiften är skrivskyddad. Återställ eller återöppna projektet för att arbeta vidare.</div> : null}
    {/* Riskbedömning som steg: a refused Starta tid or Färdigställ says why and leads to the step (never a dead button). */}
    {riskNotice && riskBlock ? <div className="notice flex flex-wrap items-center justify-between gap-2" role="status" data-testid="risk-step-notice">
      <span className="text-sm">{riskNotice}</span><Button type="button" size="sm" onClick={() => { if (!nativeGo(RISK_STEP_TARGET)) focusTarget(RISK_STEP_TARGET); }}>Gör riskbedömningen</Button>
    </div> : null}
    {levelBlock && !frozen ? <div className="notice" role="status" data-testid="task-level-blocked">
      <p className="font-medium">Du kan läsa uppgiften men inte arbeta i den.</p>
      <p className="mt-1 text-sm">{levelBlock}</p>
      <p className="mt-1 text-xs text-muted-foreground">Ansvarig, datum och planering går att ändra. Roller ges under <Link className="underline underline-offset-2" href="/?view=self_inspection&tab=roles">Egenkontroll</Link>.</p>
      {members.length ? <label className="mt-3 grid max-w-sm gap-1.5 text-xs font-medium text-muted-foreground">Ansvarig (handledare)
        <select className="form-select" data-testid="task-level-supervisor" value={task.assignedToUserId ?? ""} onChange={(event) => chooseResponsible(event.target.value)}>
          <option value="">Inte tilldelad</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select></label> : null}
    </div> : null}
  </>;
  const footModals = <>
    {controlFoot ? <DialogPage pageKey="versionshistorik" size="page" width="wide" panelTitle="Versioner" open={historyOpen} onOpenChange={setHistoryOpen} title="Versionshistorik">{task.id ? <TaskHistory key={task.id} bare taskId={task.id} revisions={task.revisions ?? []} total={task.revisionCount ?? task.revisions?.length ?? 0} local={Boolean(local)} /> : null}</DialogPage> : null}
    {task.id && !preview ? <ObstacleDialog open={obstacleOpen} onOpenChange={setObstacleOpen} docWord={docWord} busy={busy} onConfirm={changeObstacle} /> : null}
    {alarmOrderOpen && !assignReason && members.length ? <AssignWorkOrderDialog key={task.assignedToUserId ?? ""} open={assignOpen || assignFromBell} onOpenChange={(open) => {
      setAssignOpen(open);
      if (open) return;
      setAssignAskHandled(task.id);
      // The bell's `assign=1` leaves the address once the dialog is closed, so a reload does not open it again (kundresan 2026-11-07, M26).
      if (searchParams.get("assign") === "1") { const params = new URLSearchParams(searchParams.toString()); params.delete("assign"); router.replace(`/?${params.toString()}`, { scroll: false }); }
    }} members={assignable} currentId={task.assignedToUserId}
      note={(member) => member.canRead === false ? " – får inte läsa jobbet" : work.context && assignBlock(work.context, { id: member.id, name: member.name }) ? " – når inte krävd nivå" : ""}
      canBookMore={canBookHere && moduleIsOn("planning")} busy={busy} error={assignError} onConfirm={assignTo} /> : null}
    {task.id && !preview ? <TaskCancelDialog open={cancelOpen} onOpenChange={setCancelOpen} docWord={docWord} busy={busy} onConfirm={cancelJob} /> : null}
    {controlFoot ? <Modal open={sendOpen} onOpenChange={setSendOpen} title="Skicka med e-post" size="form">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Mottagarens e-post<Input id="task-send-email" type="email" required maxLength={254} value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Meddelande (valfritt)<textarea aria-label="Meddelande" className="form-textarea" maxLength={2000} value={sendNote} onChange={(event) => setSendNote(event.target.value)} /></label>
        <p className="page-description">Protokollet sparas och rapporten skickas som PDF. {task.status === "COMPLETED" ? "" : "Protokollet är inte färdigställt; rapporten märks som ej färdigställd."}</p>
        <DialogActions cancel={{ onClick: () => setSendOpen(false) }} primary={{ label: "Skicka", type: "submit", icon: <Send />, disabled: !recipient.trim(), busy, testId: "task-send-submit" }} />
      </form>
    </Modal> : null}
  </>;
  const taskBrief = <TaskBrief description={task.id ? task.description : ""} place={task.id ? placeLabel(customers.find((item) => item.id === facilityCustomerId)?.facilities ?? [], task.facilityId) : ""}
    tempPlace={task.id ? tempPlaceLabel(tempPlace) : ""}
    fault={task.id ? itemFault : ""} requirements={work.context?.customerRequirements}  />;
  // Steg 1 (2026-10-09): the job says when it is booked and for whom, or that it has no booking (Cloud and the demo).
  // Boka beside it on an open work order (2026-11-02). A protocol's or a risk assessment's page keeps the read-only line: a booking lands on the work order.
  const bookingLine = !local && !preview && task.id && moduleIsOn("planning") ? <TaskBookingLine taskId={task.id} refreshKey={bookingsRead} bookHref={canBookHere ? subPageHref(bookJobHref(task.id)) : null} /> : null;
  const staffRegisterPanel = !local && task.id && task.projectId && moduleIsOn("staff_register") && keepsWorkflowRegister(projects.find((project) => project.id === task.projectId)) ? <StaffRegisterPanel key={`register-${task.projectId}`} projectId={task.projectId} keepOpen /> : null;
  // Utförande (2026-10-30, punkt 4): the work order's work buttons in one row to the LEFT, in a fixed order – Starta tid,
  // Rapportera hinder, Färdigställ, Utgår. The page's own buttons (Spara, Avbryt, Ta bort) keep their place top right. A phone
  // at level 1 has Starta tid on its Tid screen and Färdigställ at the last step, as before.
  const timerReason = completedReason || frozenReason || dormantReason || (local && !task.id ? "Spara arbetsordern så kan du starta tiden." : "");
  const workReason = completeReason || dormantReason || (task.status === "COMPLETED" || cancelled ? "" : riskBlock || (completion.ready ? "" : `Kvar före färdigställande: ${completion.issues[0]?.message ?? ""}`));
  const orderLocked = busy || task.status === "COMPLETED" || frozen || Boolean(startBlock);
  const activateDormant = async () => {
    try { await api("/api/maintenance", { method: "POST", body: JSON.stringify({ action: "activate_order", id: task.id }) }); announce("Arbetsordern är aktiv."); await load(); }
    catch (cause) { announce((cause as Error).message, true); }
  };
  const workButtons = kind === "WORK_ORDER" && !preview ? <div className="mb-4 space-y-1.5" data-testid="work-order-work-buttons">
    {dormantReason ? <p className="notice flex flex-wrap items-center gap-2 text-sm" data-testid="work-order-dormant"><span className="min-w-0 flex-1">Vilande till {task.maintenanceDue}. Den hör till en underhållsplan och blir aktiv på sin dag.</span>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void activateDormant()} data-testid="work-order-activate"><Play />Aktivera nu</Button></p> : null}
    {/* The app's Utförande screen (användartest 2026-10-31, F3): Rapportera hinder gives way to the hinder itself with Lös hindret,
        so the person sees that it is open. A computer shows the same notice at the top of the page. */}
    {nativeJob ? obstacleNotice : null}
    <div className="flex flex-wrap items-center justify-start gap-2">
      {native || (!moduleIsOn("time") && !task.timerRunning) ? null : <Button type="button" variant="outline" disabled={busy} disabledReason={timerReason} aria-pressed={task.timerRunning} className={task.timerRunning ? "border-emerald-300 text-emerald-800 dark:text-emerald-200" : undefined}
        onClick={() => { if (!task.timerRunning && titleTimerReason) askTitle(titleTimerReason); else void timer(task.timerRunning ? "PAUSE" : "START"); }} data-testid="work-order-timer">{task.timerRunning ? <Pause /> : <Play />}{task.timerRunning ? "Pausa tid" : "Starta tid"}</Button>}
      {task.id && !obstacle && task.status !== "COMPLETED" && !cancelled && !projectFrozen ? <Button type="button" variant="outline" disabled={busy} onClick={() => setObstacleOpen(true)} data-testid="task-obstacle-report"><OctagonAlert />Rapportera hinder</Button> : null}
      {native ? null : completeButton}
      {task.id && task.status !== "COMPLETED" && !cancelled && !projectFrozen && (!local || local.cancel) ? <Button type="button" variant="outline" disabled={busy} onClick={() => setCancelOpen(true)} data-testid="task-cancel"><Ban />Utgår</Button> : null}
    </div>
    {native ? null : <DisabledReason id="task-complete-reason" reason={workReason} />}
  </div> : null;
  // Riskbedömningen är gemensam (2026-10-30): in a task of a work order the same questions on the work order's data,
  // saved to the work order; without the right to read it, the link to the work order as before. A draft answers on itself
  // and the answers move to the work order made from it.
  const holderRiskPanel = holderShown && holderRecord && holderRisk.state.applies ? <RiskStepPanel holder={{ id: holderRecord.id, title: holderRecord.title }} state={holderRisk.state} context={holderRisk.context}
    check={riskCheckOf(holderRecord.data)} userName={userName} busy={busy || holder.saving} disabled={holderLocked} paged={nativeJob}
    // Each answer is saved at once (kundresan 2026-11-07, M3: answers were lost when the phone closed within a few seconds).
    exceptionAllowed={holderRisk.exceptionAllowed} onChange={(check) => holder.patch({ data: (data) => withRiskCheck(data, check) }, { now: true })}
    onCreateExtended={() => void createHolderRiskAssessment()} /> : null;
  const roundSafetyPanel = safetyApplies ? <RoundSafetyPanel state={safetyState} check={roundSafetyOf(task.data)} risk={riskStep.roundRisk} busy={busy}
    workOrder={task.workOrderId ? { id: task.workOrderId, title: task.workOrder?.title || workOrderTitle } : null}
    disabled={task.status === "COMPLETED" || frozen || Boolean(levelBlock)} onChange={(check) => setTask((current) => ({ ...current, data: { ...current.data, roundSafety: check } }))} /> : null;
  const riskStepPanel = riskApplies || safetyApplies ? <>{riskApplies ? holderRiskPanel ?? <RiskStepPanel state={riskStep.state} context={riskStep.context} check={riskCheckOf(task.data)} userName={userName} busy={busy} exceptionAllowed={riskStep.exceptionAllowed}
    disabled={task.status === "COMPLETED" || frozen || Boolean(levelBlock)} onChange={(check) => { saveSoon.current = true; setTask((current) => ({ ...current, data: withRiskCheck(current.data, check) })); }}
    onCreateExtended={() => { if (taskNeedsWorkOrder(task)) announce("Skapa eller koppla arbetsordern först. Den utökade riskbedömningen görs i arbetsordern.", true); else void createRiskAssessment(); }} paged={nativeJob}
    workOrder={inOrder && task.workOrderId ? { id: task.workOrderId, title: task.workOrder?.title || workOrderTitle } : null} /> : null}
    {roundSafetyPanel}</> : null;
  // A protocol's risk step sits in the form's own order on the page (after Grunduppgifter and the moments, like the
  // progress line); a phone at level 1 has it on its own screen.
  const newFormKeys = (() => {
    if (task.data.kind !== "FORM") return [];
    const sections = task.data.details.document.blocks.filter((block) => block.type === "section").map((block) => block.id);
    return (parts[0]?.keys ?? []).filter((key) => !sections.includes(key) || key === sections[0]);
  })();
  // Låsta fält i ett utkast (kundresa 2026-11-07, M20): each locked section says why, with the way to the work order. A link,
  // since the locked fieldset disables every button inside it.
  const sectionLock = linkBlock && !levelBlock && draftNotice ? <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="form-section-locked">
    <span>Fälten låses upp när uppgiften hör till en arbetsorder.</span>
    <a href="#task-work-order-missing" className="font-medium text-primary hover:underline" onClick={(event) => { event.preventDefault(); const notice = globalThis.document?.getElementById("task-work-order-missing"); notice?.scrollIntoView({ block: "center" }); notice?.focus({ preventScroll: true }); }}>{canCreateWorkOrders ? "Skapa eller koppla arbetsorder" : "Koppla till arbetsorder"}</a>
  </p> : null;
  const formRenderer = task.data.kind === "FORM" ? <FormRenderer panels actions={formActions} lockedNote={sectionLock} inline={inlineSlots} afterBasics={nativeJob || nativeNew || linkBlock ? undefined : riskStepPanel} title={task.data.details.templateName} document={task.data.details.document} values={task.data.details.values} attachments={task.attachments} media={formMedia} rowOptions={rowParam ? { ...rowOptions, focusRow: rowParam } : rowOptions}
    // A new protocol's screen (level 1) shows the first section only – what is needed to create it; the rest comes part by part once
    // it is saved (2026-10-12: the create screen ran to 3 200 px with the summary, Historik and the attachments).
    part={nativeNew ? { keys: newFormKeys, first: true, last: false } : screen === "formular" && paged ? { keys: parts[part - 1].keys, first: part === 1, last: part === parts.length } : undefined} readOnly={task.status === "COMPLETED" || contentLocked || safetyLocksFill}
    onChange={(values) => { preview?.onValuesChange?.(values); const before = latestTask.current.data; if (before.kind === "FORM" && !preview) withdrawRowDeviations(before, { ...before, details: { ...before.details, values } }); setTask((current) => current.data.kind === "FORM" ? titled({ ...current, data: { ...current.data, details: { ...current.data.details, values } } }) : current); }} /> : null;
  const linkedTasksPanel = task.data.kind === "WORK_ORDER" && task.id && !preview ? <LinkedTasksPanel workOrder={{ id: task.id, title: task.title, status: task.status, projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId ?? null, roundScheduleId: task.roundScheduleId || null, roundOccurrence: task.roundOccurrence ?? null, plannedStartDate: task.plannedStartDate ?? "", dueDate: task.dueDate }} refreshKey={task.version} localRounds={local?.rounds}
    local={local ? local.tasks.filter((item) => item.workOrderId === task.id).map((item) => ({ id: item.id, kind: item.kind, title: item.title, status: item.status, progress: workflowTaskProgress(item), dueDate: item.dueDate, assignedToName: item.assignedToName, ...(roundOfProtocolValues(item.data) ? { occurrence: roundOfProtocolValues(item.data)!.occurrence } : {}) })) : undefined} /> : null;
  // Underhåll (2026-10-30): the maintenance items the work order holds like its tasks – type, priority, fault and
  // downtime are the items' (the old Underhåll panel on the order is gone). Cloud only: Local has no maintenance module, so
  // a Local work order shows neither the panel nor the phone's Underhåll row; the component draws nothing when the server says no.
  const maintenanceItemsPanel = task.data.kind === "WORK_ORDER" && task.id && !preview && !local && moduleIsOn("upkeep") ? <WorkOrderMaintenanceItems workOrderId={task.id} onItems={readItems} lockedReason={completedReason || frozenReason} /> : null;
  const assignmentPanel = !preview && task.id && moduleIsOn("self_inspection") ? <AssignmentPanel work={work} target={{ kind: "task", id: task.id }} canEdit={!frozen} responsible={{ id: task.assignedToUserId, name: task.assignedToName }} /> : null;
  // The job's cards in its kind's colour (UX-punkt 6); the risk form is a risk assessment (orange), not a protocol.
  const taskArea = panelAreaOfTask({ kind: task.data.kind, formArea: task.formArea ?? form?.area, data: task.data });
  // ---- Nivå 1 på mobil (2026-10-09): a new job's form screen ----
  if (nativeNew) {
    // A new job asks nothing about the level a technician cannot choose: the lowest, suggested level is left out (2026-10-12).
    const keepFacts = headerFacts.filter((fact) => fact.keep && !(riskClass?.suggested && riskClass.value === 1 && fact.label.startsWith("Kräver nivå")));
    return <PanelAreaProvider area={taskArea}><div className="min-w-0" data-testid="native-job-new">
      {confirmCard}{startTimerGuard}{shortStopGuard}
      {customerPickerDialog}
      <div className="native-page native-screen space-y-4 pb-4">
        {keepFacts.length ? <div className="flex flex-wrap gap-1.5" data-testid="native-job-facts">{keepFacts.map((fact) => <span key={fact.label} className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", fact.tone ? indicatorBadge(fact.tone) : "bg-card text-muted-foreground")}><fact.icon aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{fact.label}</span></span>)}</div> : null}
        {messageBlock}
        {lockNotices}
        <TaskPageFold.Provider value={false}>
          <fieldset disabled={busy} className="min-w-0"><div className="min-w-0 space-y-4">
            {basicsPanel ? <NativeLead>{basicsPanel}</NativeLead> : formRenderer}
          </div></fieldset>
        </TaskPageFold.Provider>
        <p className="px-1 text-xs leading-5 text-muted-foreground">{task.data.kind === "WORK_ORDER" ? "Utförande, material och signering fylls i när arbetsordern är skapad." : task.data.kind === "RISK_ASSESSMENT" ? "Riskerna och godkännandet fylls i när riskbedömningen är skapad." : "Resten av formuläret fylls i del för del när protokollet är skapat."}</p>
      </div>
    </div></PanelAreaProvider>;
  }
  // ---- Nivå 1 på mobil (2026-10-09): the job as a menu of rows, and each row's screen ----
  if (nativeJob) {
    const steps = jobStepRows({ kind: task.data.kind, flow,
      materials: task.data.kind === "WORK_ORDER" ? task.data.details.materials.filter((row) => !isExpenseRow(row)).length : 0,
      risks: task.data.kind === "RISK_ASSESSMENT" ? task.data.details.risks.length : 0,
      riskLevel: riskApplies && riskStep.state.done ? (riskStep.state.exception ? "exception" : riskStep.state.via === "extended" ? "extended" : "simplified") : null });
    const placeText = placeLabel(customerPlaces, task.facilityId ?? null) || (tempPlace ? `Tillfällig: ${tempPlaceLabel(tempPlace)}` : "");
    const statusText = taskStatusText;
    const briefLine = task.description.trim().split("\n")[0] || itemFault || placeText || "Beskrivning, plats och kundens krav";
    const keepFacts = headerFacts.filter((fact) => fact.keep);
    // A protocol finishes in its own Sammanfattning: Färdigställ opens the part that holds it.
    const summaryPart = paged ? (parts.findIndex((item) => item.summary) + 1 || parts.length) : null;
    // The first step still left in the menu's order (Uppdraget → Ifyllnad → Färdigställ). Material is optional, and a protocol is finished
    // at the end of Ifyllnad, so the form comes before Färdigställ (it used to jump straight to "Nästa: Färdigställ").
    const onward = cancelled || task.status === "COMPLETED" ? null : steps.rows.find((row) => row.screen !== "fardigstall" && row.screen !== "material" && row.tone !== "done")
      ?? steps.rows.find((row) => row.screen === "formular") ?? steps.next ?? null;
    const openStep = (step: JobScreen) => { if (step === "fardigstall" && summaryFoot) openScreen("formular", summaryPart); else openScreen(step); };
    const content = (() => {
      // Each screen shows the page's own panels for its step, open (TaskPageFold off), with the page's locks.
      const working = (children: React.ReactNode) => <fieldset disabled={busy || task.status === "COMPLETED" || frozen} className="min-w-0"><div className="min-w-0 space-y-4">{children}</div></fieldset>;
      const inContent = (children: React.ReactNode) => working(<fieldset disabled={Boolean(startBlock)} className="min-w-0" data-testid="task-content"><div className="min-w-0 space-y-4">{children}</div></fieldset>);
      const workOrder = task.data.kind === "WORK_ORDER" ? task.data : null;
      const risk = task.data.kind === "RISK_ASSESSMENT" ? task.data : null;
      // The app's Utförande screen has Rapportera hinder and Utgår (Starta tid is on Tid, Färdigställ at the last step).
      const workOrderPart = (part: "execution" | "material" | "signing") => workOrder ? <WorkOrderFields workButtons={part === "execution" ? workButtons : undefined} docName={task.title.trim() ? `Arbetsorder ${task.title.trim()}` : "Ny arbetsorder"} part={part} onOpenItem={(id, row) => { itemStart.current = { id, row }; }} data={workOrder} onChange={(data) => setTask((current) => ({ ...current, data }))} destination={carCostDestination} startPlaces={carCostStarts} local={Boolean(local)} prices={prices} signerName={task.status !== "COMPLETED" && !frozen && !preview ? userName : undefined} quoteable={task.status !== "COMPLETED" && !invoiced} purchase={purchaseQuickPick} /> : null;
      const riskPart = (part: "risks" | "approval") => risk ? <RiskFields part={part} data={risk} onChange={(data) => setTask((current) => ({ ...current, data }))} title={task.title} taskId={task.id || undefined} assist={!local && task.status !== "COMPLETED"} /> : null;
      switch (screen) {
        case "uppdraget": {
          // Uppdraget as rows of facts (the same as the page's box); the customer's special requirements in a group of
          // their own, marked – safety is never folded away by a level.
          const facts = [["Beskrivning", task.description, "task-brief-description"], ["Plats", placeLabel(customers.find((item) => item.id === facilityCustomerId)?.facilities ?? [], task.facilityId), "task-brief-place"],
            ["Tillfällig plats", tempPlaceLabel(tempPlace), "task-brief-temp-place"], ["Fel eller symptom", itemFault, "task-brief-fault"]].filter(([, value]) => value?.trim());
          const requirements = work.context?.customerRequirements?.trim();
          return <>
            {jobCheckInShown ? <JobCheckIn project={selectedProject!} variant="row" /> : null}
            <ListGroup testId="task-brief">{facts.length ? facts.map(([label, value, testId]) => <ListFact key={label} label={label} testId={testId}>{value}</ListFact>)
              : <ListRow title="Ingen beskrivning ännu" subtitle="Den skrivs under Plats" onClick={() => openScreen("plats")} />}</ListGroup>
            {requirements ? <ListGroup title="Kundens särskilda krav"><ListFact label="Gäller alla jobb hos kunden" tone="warning" testId="self-inspection-customer-requirements">{requirements}</ListFact></ListGroup> : null}
            {bookingLine}{staffRegisterPanel}
            {/* Uppdraget is the first screen of the job: a clear way on to the first step that is left (2026-10-12). */}
            {onward ? <Button type="button" className="mt-4 h-12 w-full text-base" onClick={() => openStep(onward.screen)} data-testid="native-job-onward"><span className="truncate">Nästa: {onward.label}</span></Button> : null}
          </>;
        }
        case "risk": return <>{working(riskStepPanel ? <NativeLead>{riskStepPanel}</NativeLead> : <p className="notice">Jobbet har inget eget steg för riskbedömning.</p>)}</>;
        case "utforande": return task.data.kind === "WORK_ORDER" ? inContent(<NativeLead>{workOrderPart("execution")}</NativeLead>) : inContent(formRenderer);
        case "material": return inContent(<NativeLead>{workOrderPart("material")}</NativeLead>);
        case "signering": return <>{inContent(<NativeLead>{workOrderPart("signing")}</NativeLead>)}{completePanel}</>;
        case "formular": {
          // The check comes before the work: first on the screen where the work is, on every part, until it is done.
          const safetyFirst = safetyLocksFill ? working(<NativeLead>{roundSafetyPanel}</NativeLead>) : null;
          if (!paged) return <>{safetyFirst}{limitsFirst ? limitsPanel : null}{inContent(formRenderer)}{limitsFirst ? null : limitsPanel}{summaryFoot ? null : completePanel}</>;
          // One part per screen (the grouped parts, a few bigger steps); the bottom row is the flow's (NativeFlowBar).
          const last = part === parts.length;
          return <>
            {safetyFirst}
            {part === 1 && limitsFirst ? limitsPanel : null}
            {inContent(formRenderer)}
            {last && !limitsFirst ? limitsPanel : null}
            {last && !summaryFoot ? completePanel : null}
          </>;
        }
        case "risker": return inContent(riskPart("risks"));
        case "godkannande": return <>{inContent(<NativeLead>{riskPart("approval")}</NativeLead>)}{completePanel}</>;
        case "fardigstall": return completePanel ? <NativeLead>{completePanel}</NativeLead> : <ListGroup footer="Färdigställ står längst ned i formuläret, under Sammanfattning.">
          <ListRow type="project" icon={CheckCircle2} title="Gå till Sammanfattning" onClick={() => openScreen("formular", summaryPart)} testId="native-job-to-summary" />
        </ListGroup>;
        case "tid": return <>
          <ListGroup testId="native-job-time">
            <ListRow type="time" title={inOrder ? "Rapporterad tid på arbetsordern" : "Rapporterad tid"} value={formatDurationSeconds(task.totalDurationSec)} />
          </ListGroup>
          {/* One timer look in the Tid list, the top bar's pill and here; Stoppa stops and saves (2026-10-12). */}
          {task.timerRunning ? <ListGroup className="native-timer-group"><div role="listitem" className="native-group"><NativeJobTimerCard taskId={timeOwnerId({ id: task.id, kind: task.kind, workOrderId: task.workOrderId })} title={inOrder ? task.workOrder?.title || "Arbetsordern" : task.title || "Jobbet"} busy={busy} onStop={() => void timer("PAUSE", true)} stopTestId="native-job-timer" /></div></ListGroup>
            : <div className="px-4 pt-3">
              {/* A finished or locked job: the button looks off (aria-disabled, dimmed) with the reason under it, and a tap still
                  says why (never a dead button; 2026-10-13). */}
              <Button type="button" className="w-full" disabled={busy} disabledReason={completedReason || frozenReason || null}
                aria-describedby={completedReason || frozenReason || titleTimerReason ? "native-job-timer-reason" : undefined} onClick={() => { if (titleTimerReason) askTitle(titleTimerReason); else void timer("START"); }} data-testid="native-job-timer" busy={busy} busyLabel="Arbetar…"><Play />{inOrder ? "Starta tid på arbetsordern" : "Starta tid"}</Button>
              <DisabledReason id="native-job-timer-reason" reason={completedReason || frozenReason || titleTimerReason} className="px-1 pt-1.5" />
            </div>}
          <ListGroup><ListRow type="time" title="Visa i Tidrapport" href={`/?view=time&timeTaskId=${encodeURIComponent(timeOwnerId({ id: task.id, kind: task.kind, workOrderId: task.workOrderId }))}`} /></ListGroup>
        </>;
        case "projekt": return selectedProject ? <>
          <ListGroup testId="native-job-project">
            <ListRow type="project" title={selectedProject.name} subtitle="Öppna projektet" href={`/?view=project&projectId=${encodeURIComponent(selectedProject.id)}`} testId="task-open-project" />
          </ListGroup>
          {projectFactRows(selectedProject, customers).length ? <ListGroup title="Om projektet" footer="Från projektet. Ändras i projektet och skrivs ut i rapporten." testId="task-project-fields">
            {projectFactRows(selectedProject, customers).map(([label, value]) => <ListFact key={label} label={label}>{value}</ListFact>)}
          </ListGroup> : null}
        </> : <p className="notice">Jobbet hör inte till något projekt.</p>;
        case "plats": return <>{working(basicsPanel ? <NativeLead>{basicsPanel}</NativeLead> : <div className="space-y-4">{placeField()}{tempPlaceField}<div className="grid gap-4">{planningFields}</div></div>)}{assignmentPanel}</>;
        case "underhall": return <NativeLead>{maintenanceItemsPanel}</NativeLead>;
        case "bilagor": return <NativeLead>{attachmentsPanel}</NativeLead>;
        case "kopplade": return <NativeLead>{linkedTasksPanel}</NativeLead>;
        case "kommentarer": return commentPanel ? <NativeLead>{commentPanel}</NativeLead> : null;
        // Rapport och hantering: the page's own buttons as rows (their menus and dialogs are unchanged).
        case "rapport": return <>
          {/* The screen is called Rapport (resa 2026-11-06: "Rapport och hantering" was cut at 390 px), so its first group needs no heading. */}
          {reportPanel ? <NativeActions footer={reportNote} testId="native-job-report">{reportButtons}</NativeActions> : null}
          <HeaderActionNodes items={headerActionList} wrap={(nodes) => <NativeActions title="Hantering" testId="native-job-actions">{nodes}</NativeActions>} />
        </>;
        default: return null;
      }
    })();
    const attachments = task.attachments?.length ?? 0;
    const rowBar = steps.rows.map((row) => (row.tone === "done" ? "done" as const : row.tone === "next" ? "current" as const : "todo" as const));
    const tileRows = steps.rows.filter((row) => row.screen !== "fardigstall").slice(0, 2);
    const restRows = steps.rows.filter((row) => !tileRows.includes(row));
    // The bottom row of every screen in the flow (M3): Föregående / Nästa: <name> / Klar on the last; the risk step's Nästa
    // waits for the confirmed risk assessment. A material row's own screen is no step.
    const flowSteps = jobFlowSteps(steps.rows, parts);
    const flowAt = screen && !openItemId ? jobFlowIndex(flowSteps, screen, part) : -1;
    const goStep = (step: (typeof flowSteps)[number] | undefined, back = false) => { if (!step) return; if (back) returnToWork(jobUrl(step.screen, step.part), (href) => router.push(href)); else openScreen(step.screen, step.part); };
    const riskWaits = screen === "risk" && riskApplies && !riskStep.state.done;
    // ONE end button (2026-10-12): Färdigställ on the last step, in the bottom row only. It stays clickable (it leads to
    // the first missing field and says what, never a dead button) but looks muted while something is missing, with the reason in words.
    const finishable = task.status !== "COMPLETED" && !cancelled && !frozen;
    const finishHint = finishable ? startBlock || (completion.ready ? undefined : `Kvar före färdigställande: ${completion.issues[0]?.message ?? ""}${completion.issues.length > 1 ? ` (och ${completion.issues.length - 1} till)` : ""}`) : undefined;
    const flowBar = flowAt >= 0 ? <NativeFlowBar steps={flowSteps} index={flowAt} onPrevious={() => goStep(flowSteps[flowAt - 1], true)} onNext={() => goStep(flowSteps[flowAt + 1])}
      finish={finishable ? { label: doneWord, busy, onClick: () => void complete(), busyLabel: "Arbetar…" } : { label: "Till jobbet", busy, onClick: closeScreen }}
      nextDisabled={riskWaits} nextHint={riskWaits ? "Bekräfta riskbedömningen för att gå vidare." : flowAt === flowSteps.length - 1 ? finishHint : undefined} /> : null;
    return <PanelAreaProvider area={taskArea}><div onBlur={saveOnLeave} className="min-w-0" data-testid="native-job" data-screen={screen ?? "menu"}>
      {confirmCard}{startTimerGuard}{shortStopGuard}
      {customerPickerDialog}
      {flowDialogs}
      {footModals}
      {screen ? <div className="native-page native-screen space-y-4 pb-4">
        {messageBlock}
        {lockNotices}
        <TaskPageFold.Provider value={false}>{content}</TaskPageFold.Provider>
        {flowBar ? <div className={finishable && !completion.ready ? "[&_[data-testid=native-flow-finish]]:opacity-60" : undefined} data-testid="native-job-end">{flowBar}</div> : null}
      </div> : <NativePage>
        {/* The top bar names the kind of job; the form's own name opens the line under the title (no eyebrow, 2026-10-30). */}
        <NativeLargeTitle subtitle={<>{task.data.kind === "FORM" ? <span data-testid="native-job-form">{task.data.details.templateName} · </span> : null}<span data-testid="native-job-state">{statusText}</span></>}><span className="text-2xl">{task.title || jobLabel}</span></NativeLargeTitle>
        {/* Uppdrag och säkerhet are never hidden by a level: the required level, the priority and Klart senast/Förfallen. */}
        {keepFacts.length ? <div className="flex flex-wrap gap-1.5 pb-1" data-testid="native-job-facts">{keepFacts.map((fact) => {
          const Icon = fact.icon;
          const chip = <><Icon aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{fact.label}</span></>;
          const className = cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", fact.tone ? indicatorBadge(fact.tone) : "bg-card text-muted-foreground");
          return fact.href ? <Link key={fact.label} href={fact.href} className={className}>{chip}</Link> : <span key={fact.label} className={className}>{chip}</span>;
        })}</div> : null}
        {/* One stroke per step row of the menu (a risk assessment has two), with the count in words (2026-10-12). */}
        {cancelled ? null : <><StepBar steps={rowBar} label={`${rowBar.filter((item) => item === "done").length} av ${rowBar.length} steg klara`} /><p className="-mt-1 px-1 text-xs text-muted-foreground" data-testid="native-job-progress">{rowBar.filter((item) => item === "done").length} av {rowBar.length} steg klara</p></>}
        {/* "Nästa steg" som huvudknapp (punkt 7): the first step left, in words of what to do, as on a computer. */}
        {onward && !startBlock ? <Button type="button" className="h-12 w-full text-base" onClick={() => openStep(onward.screen)} data-testid="native-job-next" data-next-screen={onward.screen}><span className="truncate">{jobRowAction(onward)}</span></Button> : null}
        {/* The phone's quickest step (2026-11-01): Starta tid on the job's first screen, not under Mer; the same guarded start as
            on the Tid screen. A running time shows on the row under Mer and in the top bar. A task's time is its work order's. */}
        {!inOrder && !cancelled && !task.timerRunning && !completedReason && !frozenReason && moduleIsOn("time") ? <Button type="button" variant={onward && !startBlock ? "outline" : "default"} className="h-12 w-full text-base" disabled={busy} busy={busy} busyLabel="Arbetar…"
          onClick={() => { if (titleTimerReason) askTitle(titleTimerReason); else void timer("START"); }} data-testid="native-job-start-time"><Play />Starta tid</Button> : null}
        <div className="space-y-3 pt-1">{messageBlock}{machineAlarmNotice}{obstacleNotice}{lockNotices}{nextStepsBlock}</div>
        <ListGroup testId="native-job-brief">
          <ListRow title="Uppdraget" subtitle={briefLine} onClick={() => openScreen("uppdraget")} testId="native-row-uppdraget" />
          <NativeDeviationRows context={work.context} />
        </ListGroup>
        {contactActions(true)}
        {/* M2: the two first steps as big tiles (Riskbedömning and Utförande), the rest as rows under them. Only the primary
            button above points to the next step (svar 2, 2026-10-24): the rows say where the job is, with no marking of their own. */}
        <TileGrid testId="native-job-steps">
          {tileRows.map((row) => <Tile key={row.screen} type={row.type} icon={STEP_ICON[row.icon]} wide={tileRows.length === 1} title={row.label} subtitle={cancelled && row.tone === "next" ? "Utgått" : row.state}
            onClick={() => openStep(row.screen)} testId={`native-row-${row.screen}`} />)}
        </TileGrid>
        {restRows.length ? <ListGroup testId="native-job-steps-more">
          {restRows.map((row) => <ListRow key={row.screen} type={row.tone === "done" ? "round" : row.type} icon={STEP_ICON[row.icon]} title={row.label} subtitle={cancelled && row.tone === "next" ? "Utgått" : row.state}
            value={row.value} onClick={() => openStep(row.screen)} testId={`native-row-${row.screen}`} />)}
        </ListGroup> : null}
        <ListGroup title="Mer" testId="native-job-more">
          {/* Tid is the work order's (2026-10-30, punkt 4): a task shows no timer of its own. */}
          {inOrder || (!moduleIsOn("time") && !task.timerRunning) ? null : <ListRow type="time" title="Tid" value={formatDurationSeconds(task.totalDurationSec)} subtitle={task.timerRunning ? "Tiden går" : undefined} subtitleTone={task.timerRunning ? "primary" : undefined} onClick={() => openScreen("tid")} testId="native-row-tid" />}
          {selectedProject ? <ListRow type="project" title="Projekt" value={selectedProject.name} onClick={() => openScreen("projekt")} testId="native-row-projekt" /> : null}
          {/* The row says the place only (telefon fynd 34); Klart senast is under the title, Ansvarig on the screen. */}
          <ListRow type="customer" icon={MapPin} title="Plats" subtitle={placeText || customerName || "Ingen plats"} onClick={() => openScreen("plats")} testId="native-row-plats" />
          {maintenanceItemsPanel ? <ListRow type="work-order" icon={Hammer} title="Underhåll" value={orderItems.length ? String(orderItems.length) : undefined} subtitle="Underhållsposter på maskindelar" onClick={() => openScreen("underhall")} testId="native-row-underhall" /> : null}
          {summaryFoot ? null : <ListRow type="neutral" icon={Paperclip} title="Bilder och dokument" value={String(attachments)} onClick={() => openScreen("bilagor")} testId="native-row-bilagor" />}
          {linkedTasksPanel ? <ListRow type="control" icon={Link2} title="Kopplade uppgifter" onClick={() => openScreen("kopplade")} testId="native-row-kopplade" /> : null}
          {commentPanel ? <ListRow type="neutral" icon={MessageSquare} title="Kommentarer" onClick={() => openScreen("kommentarer")} testId="native-row-kommentarer" /> : null}
          <ListRow type="neutral" icon={FileText} title="Rapport och hantering" subtitle="PDF, e-post och fler åtgärder" onClick={() => openScreen("rapport")} testId="native-row-rapport" />
          {/* Fakturaunderlag (2026-10-10): features/invoice-basis; the server decides who sees it. */}
          {invoiceRowShown && task.status !== "COMPLETED" ? <InvoiceBasisNativeRow taskId={task.id} completed={false} onSummary={(summary) => setInvoiced(summary.marked.invoiced.length > 0)} /> : null}
        </ListGroup>
      </NativePage>}
    </div></PanelAreaProvider>;
  }
  return <PanelAreaProvider area={taskArea}><div className={cn("space-y-6", STANDARD_PAGE_WIDTH)} data-standard-page="" onBlur={saveOnLeave}>
    {confirmCard}{startTimerGuard}{shortStopGuard}
    {customerPickerDialog}
    <EditorHeader
      destructiveAction={removeShown ? { key: "remove", node: <Button variant="outline" className="text-destructive" disabled={busy} onClick={() => void removeWorkOrder()} data-testid="work-order-remove"><Trash2 />Ta bort</Button>,
        menu: { label: "Ta bort", icon: Trash2, disabled: busy, onSelect: () => void removeWorkOrder(), testId: "work-order-remove" } } : undefined}
      // A control or risk assessment made as a form reads as what it is, not as "Formulär" (2026-09-27); the
      // heading of a new protocol, the status and the line under it follow the form, exactly like the originals (2026-09-28).
      // The form's name stands first under the title (no eyebrow, 2026-10-30); a work order's and a risk
      // assessment's title already says what it is.
      kind={task.data.kind === "FORM" ? `${(task.formArea ?? form?.area ?? "forms") === "forms" ? "Formulär · " : ""}${task.data.details.templateName}` : undefined}
      title={task.id ? task.title : formDocument ? formDocument.task.newTitle || `Nytt protokoll: ${task.data.kind === "FORM" ? task.data.details.templateName : ""}` : kind === "WORK_ORDER" ? "Ny arbetsorder" : "Ny riskbedömning"}
      status={task.status}
      statusLabel={taskStatusText}
      progress={cancelled ? undefined : workflowTaskProgress(task)}
      detail={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* One status of fixed width that never moves the page (2026-10-05); the reason of a failure and the
            latest colleague's change are its tooltip, and the failure was told once as a toast. */}
        <span data-testid="task-save-state" className="inline-flex items-center gap-x-1.5">{task.id ? <>
          <span className="tabular-nums">Version {versionNumber || task.version}</span><span aria-hidden="true">·</span>
          {indicator.tone === "error"
            ? <button type="button" data-testid="task-save-indicator" data-state={indicator.state} data-unsaved={dirty || undefined} title={autoError} onClick={() => announce(`Sparas inte automatiskt: ${autoError}`, true)}
              className="inline-block w-[12.5ch] truncate whitespace-nowrap text-left font-medium text-destructive underline decoration-dotted underline-offset-2">{indicator.label}</button>
            : <span data-testid="task-save-indicator" data-state={indicator.state} data-unsaved={dirty || undefined} title={liveNote || undefined} className="inline-block w-[12.5ch] truncate whitespace-nowrap tabular-nums">{indicator.label}</span>}
        </> : formDocument?.task.tagline || (inOrder ? "Uppgiften läggs i arbetsordern." : "Arbetsordern kan ligga i ett projekt eller stå för sig.")}</span>
        {/* Who else has the task open (2026-10-04: "Erik redigerar också"). */}
        {otherEditors.length ? <span data-testid="task-presence" className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"><Users className="size-3.5" aria-hidden="true" />{listNames(otherEditors.map((editor) => editor.name))} redigerar också</span> : null}
        <span className="sr-only" role="status" data-testid="task-live-note">{liveNote}</span>
      </span>}
      facts={headerFacts}
      actions={headerActionList}
      cancelAction={cancelAction}
      primaryAction={nextAction ? <>{saveButton("outline")}{nextAction}</> : saveButton()}
      // One short line under the buttons: why Spara cannot be used, or what to write so it can (it is never greyed out for that).
      primaryReason={saveReason || titleReason}
      // Utgått (2026-10-09): no progress line and no "Nästa: …"; the Utgått notice says what applies.
      flow={cancelled ? undefined : flowGuide}
    />
    {messageBlock}
    {nextStepsBlock}
    {flowDialogs}
    {/* The content sits in an ordinary block inside the fieldset: Chromium sometimes left the form renderer (a container
        query container) without layout when it was a direct child of the fieldset's anonymous content box – an empty
        form after starting a round (2026-09-29, tmp repro 3 of 30). */}
    {machineAlarmNotice}
    {obstacleNotice}
    {lockNotices}
    {/* Uppdraget (2026-10-08): the job and the customer's requirements, never folded away by a display level. */}
    {taskBrief}{contactActions(false)}{bookingLine}
    {/* Personalliggare, steg 1 (2026-10-09): the job in a project that keeps the register in Workflow gets the
        same Checka in / Checka ut button as the project page, never folded away by a display level. */}
    {staffRegisterPanel}
    {/* Högerställd sammanfattning (2026-10-16): a work order's Färdigställ – what remains and the button – beside
        the panels on a wide screen at level 3; in its usual place everywhere else and for the other task types. */}
    <EditorAsideLayout className="[--aside-step:1.5rem]" testId="task-layout">
    <fieldset disabled={busy || task.status === "COMPLETED" || frozen} className="min-w-0">
    <div className="min-w-0 space-y-6">
    {workFirst ? null : planningPanels}
    {task.data.kind === "FORM" && !linkBlock ? null : riskStepPanel}
    {/* Earlier protocols and trends inform; visningsnivå 1 leaves them out on a phone or tablet. */}
    {task.data.kind === "FORM" ? <div data-detail-min="2" className="empty:hidden"><FormHistory taskId={task.id} templateId={task.data.details.templateId} customerId={(selectedProject?.customerId ?? task.customerId) || null} facilityId={task.facilityId ?? null} local={preview ? [] : local?.tasks} /></div> : null}
    {/* Gränsvärden before the form where numbers are judged against them (the rounds), after it where they only fill in
        the rows' own limits (Kontroll före idrifttagning, 2026-10-06), so the control's view starts as before. */}
    {limitsFirst ? limitsPanel : null}
    {task.data.kind === "FORM" && !preview ? <div data-detail-min="2" className="empty:hidden"><FormTrendPanel document={task.data.details.document} values={task.data.details.values} templateId={task.data.details.templateId} templateVersion={task.data.details.templateVersion} taskId={task.id}
      facilityId={task.facilityId ?? null} customerId={(selectedProject?.customerId ?? task.customerId) || null} local={local?.tasks} /></div> : null}
    {task.data.kind === "WORK_ORDER" ? null : <fieldset disabled={Boolean(startBlock)} className="min-w-0" data-testid="task-content">
    <div className="min-w-0 space-y-6">
    {task.data.kind === "FORM" ? formRenderer : <RiskFields data={task.data} onChange={(data) => setTask((current) => ({ ...current, data }))} title={task.title} taskId={task.id || undefined} assist={!local && !preview && task.status !== "COMPLETED"} />}
    </div>
    </fieldset>}
    {limitsFirst ? null : limitsPanel}
    {/* Utförande först: the planning panels after the work, for the responsible person on a phone or tablet. */}
    {workFirst && task.data.kind !== "WORK_ORDER" ? planningPanels : null}
    </div>
    </fieldset>
    {/* Arbetsordern som hållare (2026-10-30): Grunduppgifter → Riskbedömning → Uppgifter → Utförande → Signering → Bilder →
        Rapport. The work order's tasks (with Lägg till uppgift) come right after its Riskbedömning. */}
    {linkedTasksPanel}
    {/* Underhållsposter: held by the work order like its tasks, so right after Uppgifter. */}
    {maintenanceItemsPanel}
    {/* Not one fieldset around it: the work buttons in Utförande keep saying why they cannot be used (a finished, cancelled
        or blocked job), so only the fields are locked (contentDisabled). */}
    {task.data.kind === "WORK_ORDER" ? <div className="min-w-0 space-y-6">
      <WorkOrderFields docName={task.title.trim() ? `Arbetsorder ${task.title.trim()}` : "Ny arbetsorder"} data={task.data} onChange={(data) => setTask((current) => ({ ...current, data }))} destination={carCostDestination} startPlaces={carCostStarts} local={Boolean(local)} prices={prices} signerName={task.status !== "COMPLETED" && !frozen && !preview ? userName : undefined} quoteable={task.status !== "COMPLETED" && !invoiced} purchase={purchaseQuickPick} workButtons={workButtons} contentDisabled={orderLocked} />
      {workFirst ? <fieldset disabled={busy || task.status === "COMPLETED" || frozen} className="min-w-0"><div className="min-w-0 space-y-6">{planningPanels}</div></fieldset> : null}
    </div> : null}
    {summaryFoot ? null : attachmentsPanel}
    {commentPanel}
    {assignmentPanel}
    {completePanel && kind === "WORK_ORDER" ? <EditorAside label="Färdigställ arbetsordern" testId="task-aside">{completePanel}</EditorAside> : completePanel}
    {reportPanel}
    </EditorAsideLayout>
    {footModals}
  </div></PanelAreaProvider>;
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
  return <Panel icon={History} title="Tidigare protokoll" description={`Samma formulär för ${facilityId ? "anläggningen" : "kunden"}, senaste först.`} collapsible defaultCollapsed count={items.length} foldKey="form-history">
    <ol className="divide-y rounded-lg border" data-testid="form-history">{items.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
      <a className="min-w-0 flex-1 truncate font-medium text-primary hover:underline" href={`/?view=workflow_task&taskId=${encodeURIComponent(item.id)}&taskType=FORM`}>{item.title}</a>
      <span className="text-xs text-muted-foreground">{item.date ? `${formatSwedish(item.date, { dateStyle: "medium" })} · ` : ""}{statusLabels[item.status as WorkflowTaskStatus] ?? item.status}</span>
      {/* The same result as the protocol's summary and PDF; nothing filled in is "Ej ifyllt" in grey (kundresa 2026-11-07, M15). */}
      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${indicatorBadge(item.deviations ? "danger" : item.filled === false ? "neutral" : "success")}`} data-testid="form-history-result">{formResultText({ deviations: item.deviations, filled: item.filled !== false })}</span>
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
  const description = count ? `${count} ${count === 1 ? "sparad version" : "sparade versioner"}, senaste först. Äldre versioner är skrivskyddade.` : "Tidigare versioner är skrivskyddade.";
  const body = <>
    {/* Numbered by their place in the history, newest = the count (simulation 2026-10-10: the header and the list said
        "Version 26" beside "9 sparade versioner"; the server's own counter also counts the timer and merged autosaves). */}
    {ordered.length ? <div className="space-y-2">{ordered.map((revision, index) => {
      const snapshot = revision.snapshot;
      return <details key={revision.id} className="group rounded-xl border bg-card open:bg-muted/15">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><History className="size-3.5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Version {count - index}</span><span className="block text-xs text-muted-foreground">{formatSwedish(revision.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>{snapshot.note ? <span className="block text-xs font-medium" data-testid="task-history-note">{snapshot.note}</span> : null}</span>
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
  return <Panel icon={History} title="Historik" description={description}>{body}</Panel>;
}

/** The facts the originals show in the header: control points and approved (the control), or the number of objects ("2 risker"). */
function formHeaderFacts(document: FormDocument, values: FormValues, publisher: string | undefined, version: number): EditorFact[] {
  const facts: EditorFact[] = [];
  const blocks = formLeafBlocks(document);
  // Ja/nej-kontrollpunkter count as well (kundresa 2026-11-07, M18): a Nej is not "godkänd".
  if (formJudgedYesNo(document, values).length || blocks.some((block) => (block.type === "table" && block.columns.some((column) => column.input === "assessment")) || (block.type === "checklist" && block.mode === "check"))) {
    const totals = formApprovalTotals(document, values);
    facts.push({ icon: Zap, label: countOf(totals.reduce((sum, item) => sum + item.total, 0), "kontrollpunkt", "kontrollpunkter") }, { icon: ShieldCheck, label: countOf(totals.reduce((sum, item) => sum + item.ok, 0), "godkänd", "godkända"), iconClassName: "text-emerald-600" });
  } else for (const block of blocks) if (block.type === "table" && block.itemLabelPlural) {
    const count = (values.tables[block.key] ?? []).filter((row) => !row.example).length;
    facts.push({ icon: ShieldAlert, label: `${count} ${count === 1 ? (block.itemLabel || "objekt").toLowerCase() : block.itemLabelPlural}` });
    break;
  }
  if (publisher && publisher !== "HINTEK") facts.push({ icon: FileText, label: `Formulär från ${publisher} · version ${version}`, iconClassName: "text-muted-foreground" });
  return facts;
}

/**
 * The count under Utfört arbete and Avvikelser (A2, review 2026-10-20): the field stops at the server's limit, and the
 * count shows only near it, so an ordinary report looks as before ("9 200/10 000 tecken", as the form builder's count).
 */
function NotesLength({ value, testId }: { value: string; testId: string }) {
  if (value.length < WORK_ORDER_NOTES_MAX * 0.9) return null;
  const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return <span className="block text-[11px] font-normal tabular-nums" aria-live="polite" data-testid={testId}>{group(value.length)}/{group(WORK_ORDER_NOTES_MAX)} tecken{value.length >= WORK_ORDER_NOTES_MAX ? ". Längre text får inte plats." : ""}</span>;
}

function HistoryText({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm">{value || "Inte angivet"}</p></div>;
}

function WorkOrderFields({ data, onChange, destination, startPlaces, local = false, prices = { visible: false, markupPercent: "" }, part, onOpenItem, signerName, quoteable = true, purchase, docName, workButtons, contentDisabled }: {
  /** The page's lock of the content (a level that does not reach the job): the fields only, never the work buttons. */
  contentDisabled?: boolean;
  /** Utförande's work buttons (Starta tid, Rapportera hinder, Färdigställ, Utgår), first in the panel, to the left (2026-10-30). */
  workButtons?: React.ReactNode;
  /** The work order's name, said on "Lägg till artiklar" so it is clear where the rows go. */
  docName?: string;
  /** Inköp (2026-10-16): rows picked into a purchase before 2026-10-26 follow it on save; no new question is asked here. */
  purchase?: { dialog: React.ReactNode };
  data: Extract<TaskData, { kind: "WORK_ORDER" }>; onChange: (data: Extract<TaskData, { kind: "WORK_ORDER" }>) => void;
  /** Nivå 1 på mobil: one step's part on its own screen (Utförande, Material, Signering); the page shows all of them. */
  part?: "execution" | "material" | "signing";
  /** Nivå 1: a row's screen opens – the row as it was then (null for a new row), so Avbryt can put back only that row. */
  onOpenItem?: (id: string, row: Material | null) => void;
  /** Bilkostnad (2026-10-08): the task's place with its position, and the places a trip can start from. */
  destination: CarCostDestination | null; startPlaces: CarCostStartPlace[];
  /** Artiklar och priser (2026-10-08) is Cloud only; a Local file's picker says so. */
  local?: boolean;
  /** Priser på materialraden (2026-10-09): à-pris, påslag and sums only for someone who may see prices. */
  prices?: { visible: boolean; markupPercent: string };
  /** Signering (2026-10-11): the signed-in person's name, filled in while the name is empty; it can be changed. */
  signerName?: string;
  /** "Skapa offert av materialet" is not offered on a finished or invoiced order. */
  quoteable?: boolean;
}) {
  const details = data.details;
  // The signer's name is only SHOWN prefilled (the person may change it); nothing is written to the job until the person types or
  // confirms, so opening a page never counts as a change, never makes a draft and never asks "Lämna utan att spara?" (2026-10-11).
  const shownSignerName = details.signature.name || (details.signature.confirmed ? "" : signerName ?? "");
  const [carCostOpen, setCarCostOpen] = useState(false);
  const unitListId = useId();
  const rows = details.materials;
  const setRows = (materials: Material[]) => onChange({ ...data, details: { ...details, materials } });
  const patchRow = (id: string, patch: Partial<Material>) => setRows(rows.map((item) => {
    if (item.id !== id) return item;
    let next = { ...item, ...patch };
    // An expense row's amount follows quantity × unit price while both read as numbers; the amount itself stays editable.
    if (isExpenseRow(next) && ("quantity" in patch || "unitPrice" in patch)) { const amount = rowAmount(next); if (amount !== null) next.amount = formatSek(amount); }
    // A material row that gets its first price takes a copy of the company's markup (steg A); it stays the row's own.
    if (!isExpenseRow(next) && "unitPrice" in patch) next = withCompanyMarkup(next, prices.markupPercent);
    return next;
  }));
  /**
   * Lägg till artiklar (2026-10-16): each article added in the shared search becomes a new material row with the
   * company's markup. Samband (2026-10-26): the search knows it was opened from the work order and only puts the
   * article on it – no question about a purchase (a purchase is made under Inköp, or from the order's rows with Till grossist).
   */
  const [browsing, setBrowsing] = useState(false);
  // Företagets moduler (0.39.0): with Inköp och artiklar off a material row is plain text; rows with a chosen article stay as they are.
  const moduleIsOn = useModules();
  const articlesOn = moduleIsOn("purchasing") && !local;
  const addArticle = ({ row }: ArticleAdd) => {
    const next: Material = prices.visible ? withCompanyMarkup({ ...row, id: crypto.randomUUID() }, prices.markupPercent) : { ...row, id: crypto.randomUUID() };
    const { data: current, onChange: emit } = latest.current;
    emit({ ...current, details: { ...current.details, materials: [...current.details.materials, next] } });
    return next.id;
  };
  /** The justerare on a search card (decision 13, R2-ART-01): the added row's antal, or the row taken away at 0. */
  const adjustArticle = (rowId: string, quantity: string | null) => {
    const { data: now, onChange: save } = latest.current;
    const kept = quantity === null ? now.details.materials.filter((item) => item.id !== rowId) : now.details.materials.map((item) => item.id === rowId ? { ...item, quantity } : item);
    save({ ...now, details: { ...now.details, materials: kept } });
  };
  const totals = workOrderTotals(rows);
  const materials = rows.filter((item) => !isExpenseRow(item));
  const expenses = rows.filter(isExpenseRow);
  const total = expenseTotal(rows);
  const carCosts = rows.filter(isCarCostRow);
  const addRow = (kind: "material" | "expense") => { const id = crypto.randomUUID(); setRows([...rows, kind === "expense" ? { id, kind, name: "", quantity: "", unit: "", unitPrice: "", amount: "" } : { id, name: "", quantity: "", unit: "" }]); return id; };
  // Nivå 1 på mobil: Material is a list of rows; a row opens its fields on a screen of its own (`&item=` in the address).
  const nativeRows = useNativeMode() && part === "material";
  const router = useRouter();
  const params = useSearchParams();
  const itemUrl = (id: string | null) => { const next = new URLSearchParams(params.toString()); if (id) next.set("item", id); else next.delete("item"); return `/?${next.toString()}`; };
  const openItem = (id: string, row: Material | null) => { onOpenItem?.(id, row); router.push(itemUrl(id)); };
  const closeItem = () => returnToWork(itemUrl(null), (href) => router.push(href));
  // Ångra (2026-10-11, the same mechanism as the quote's and the invoice basis's lines): a removed row goes at once and the
  // toast's Ångra – or Ctrl/Cmd+Z – puts it back in its place with everything it held. This replaces the question before removal.
  const latest = useRef({ data, onChange });
  useEffect(() => { latest.current = { data, onChange }; });
  const undoRemove = useUndoRemove<Material>((update) => { const { data: current, onChange: emit } = latest.current; emit({ ...current, details: { ...current.details, materials: update(current.details.materials) } }); });
  // Inköp → arbetsorder (2026-10-16): ?purchaseId= adds the purchase's lines this order does not have yet, once; the
  // order is saved as usual (the autosave too), so every check of an ordinary save applies.
  const purchaseToAdd = params.get("purchaseId");
  const purchaseAdded = useRef<string | null>(null);
  useEffect(() => {
    if (!purchaseToAdd || local || purchaseAdded.current === purchaseToAdd) return;
    purchaseAdded.current = purchaseToAdd;
    void readPurchase(purchaseToAdd).then(({ purchase: bought, markupPercent }) => {
      const { data: current, onChange: emit } = latest.current;
      const added = materialRowsFromPurchase(bought, current.details.materials, () => crypto.randomUUID(), prices.visible ? prices.markupPercent || markupPercent : "");
      if (added.length) emit({ ...current, details: { ...current.details, materials: [...current.details.materials, ...added] } });
      announce(added.length ? `${added.length} ${added.length === 1 ? "rad" : "rader"} från inköp ${bought.label} är tillagda som material.` : `Arbetsordern har redan raderna från inköp ${bought.label}.`);
      const next = new URLSearchParams(params.toString()); next.delete("purchaseId");
      router.replace(`/?${next.toString()}`, { scroll: false });
    }).catch((cause: Error) => announce(cause.message, true));
  }, [purchaseToAdd, local, prices.visible, prices.markupPercent, params, router]);
  /** Removes a row (with Ångra, unless `quiet`: a blank row cleaned away when its screen closes). True when the row went. */
  const removeRow = (id: string, quiet = false) => {
    const row = rows.find((item) => item.id === id);
    if (!row) return false;
    undoRemove(rows, id, { quiet, text: isExpenseRow(row) ? "Utgiften är borttagen." : "Materialet är borttaget." });
    return true;
  };
  const textField = "space-y-2 text-xs font-medium text-muted-foreground";
  const executionFields = <div className="grid gap-4 lg:grid-cols-2">
      <label className={textField}>Utfört arbete<textarea aria-label="Utfört arbete" id="task-execution" className="form-textarea min-h-28" maxLength={WORK_ORDER_NOTES_MAX} value={details.executionNotes} onChange={(e) => onChange({ ...data, details: { ...details, executionNotes: e.target.value } })} /><NotesLength value={details.executionNotes} testId="execution-notes-length" /></label>
      <label className={textField}>Avvikelser<textarea aria-label="Avvikelser" className="form-textarea min-h-28" maxLength={WORK_ORDER_NOTES_MAX} value={details.deviations} onChange={(e) => onChange({ ...data, details: { ...details, deviations: e.target.value } })} /><NotesLength value={details.deviations} testId="deviations-length" /></label>
    </div>;
  const expenseSum = <p className="mt-2 text-right text-sm" data-testid="expense-total">Summa utgifter: <span className="font-semibold tabular-nums">{formatSek(total.total)} kr</span> <span className="text-muted-foreground">exkl. moms{total.missing ? ` · ${total.missing} rad${total.missing === 1 ? "" : "er"} utan läsbart belopp` : ""}</span></p>;
  const grandTotal = prices.visible && (materials.length || expenses.length) ? <p className="mt-3 flex flex-wrap items-baseline justify-end gap-x-2 border-t pt-3 text-sm" data-testid="work-order-total">
      <span>Totalt exkl. moms (material med påslag och utgifter):</span><span className="font-semibold tabular-nums">{formatSek(totals.total)} kr</span>
    </p> : null;
  const carCostDialog = <CarCostDialog open={carCostOpen} onOpenChange={setCarCostOpen} destination={destination} startPlaces={startPlaces} existing={carCosts}
      onAdd={(row) => setRows([...rows, row])} onUpdate={(row) => setRows(rows.map((item) => item.id === row.id ? row : item))} />;
  // Grossistexport (2026-10-12): the material rows to a wholesaler; what the person enters for a row is saved on the row.
  const wholesaleSource = useMemo(() => fromMaterialRows(rows), [rows]);
  const wholesaleButton = (variant: "outline" | "ghost") => <WholesaleExport source={wholesaleSource} label="Arbetsorder" variant={variant} testId="work-order-wholesale"
    onSaveRow={(id, wholesale) => patchRow(id, { wholesale })} />;
  const materialSection = <>
    {purchase?.dialog}
    {articlesOn ? <ArticleBrowserDialog open={browsing} onOpenChange={setBrowsing} onAdd={addArticle} onAdjust={adjustArticle} docWord="arbetsordern" docName={docName} /> : null}
    {/* Material och utgifter (2026-10-08): the buttons stay where they are; new rows appear under them. */}
    <div className={part ? "flex flex-wrap items-center justify-between gap-2" : "mt-5 flex flex-wrap items-center justify-between gap-2"}>
      {part ? null : <h3 className="text-sm font-semibold">Material och utgifter</h3>}
      <div className="flex flex-wrap gap-2">
        {articlesOn ? <Button onClick={() => setBrowsing(true)} data-testid="work-order-add-articles"><Search />Lägg till artiklar</Button> : null}
        <Button variant="outline" onClick={() => addRow("material")}><Plus />Lägg till material</Button>
        <Button variant="outline" onClick={() => addRow("expense")}><Plus />Lägg till utgift</Button>
        <Button variant="outline" onClick={() => setCarCostOpen(true)} data-testid="car-cost-open"><Car />Bilkostnad</Button>
        {wholesaleButton("outline")}
      </div>
    </div>
    <datalist id={unitListId}>{MATERIAL_UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>
    <div className="mt-3 space-y-2" data-testid="material-rows">
      {/* Benämning, Antal, Enhet (2026-10-09). On a phone: Benämning full width, Antal and Enhet side by side,
          then the article search and remove; from 640 px one row. The stored keys stay name, quantity and unit. */}
      {/* Materialsökningen (2026-10-09): Benämning is the search field; the hits fold out under it, and a name
          not in the catalogue is kept as typed. Artikelnummer with its source and the manufacturer's number below. */}
      {materials.map((material) => materialEditor(material))}
    </div>
    {prices.visible && materials.length ? <MaterialTotals totals={totals} /> : null}
    {prices.visible && !local && quoteable && moduleIsOn("quotes") ? <QuoteFromWorkOrder rows={rows} /> : null}
    {expenses.length ? <div className="mt-4" data-testid="expense-rows">
      <h4 className="text-xs font-medium text-muted-foreground">Utgifter (belopp i kr exkl. moms)</h4>
      <div className="mt-2 space-y-2">
        {expenses.map((expense) => expenseEditor(expense))}
      </div>
      {expenseSum}
    </div> : null}
    {grandTotal}
    {carCostDialog}
  </>;
  /**
   * Labels above the fields everywhere (simulation 2026-10-10: the page's dense row had placeholders only, "Enhet" was cut
   * to "Enhe" and À-pris was 78 px wide, so "1250,50" showed as "250,50"). A <label> holds its field, so a screen reader
   * reads the name; Benämning keeps its own name on the search field (its hits are a list inside the box).
   */
  function labelled(label: string, field: React.ReactNode, className?: string) {
    return <label className={cn("space-y-1.5 text-xs font-medium text-muted-foreground", className)}><span className="block">{label}</span>{field}</label>;
  }
  function materialEditor(material: Material) {
    // Uttag ur förrådet (2026-10-30): a row the store wrote is locked; its antal changes through the store.
    if (material.storeRef) return <StoreMaterialRow key={material.id} row={material} canReturn={!local}
      priceFields={prices.visible ? <MaterialPriceFields material={material} onPatch={(patch) => patchRow(material.id, patch)} /> : null} />;
    return <div key={material.id} className="grid grid-cols-2 items-end gap-x-2 gap-y-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]" data-testid="material-row">
        <div className="col-span-2 space-y-1.5 text-xs font-medium text-muted-foreground sm:col-span-1"><span className="block" aria-hidden="true">Benämning</span><Input aria-label="Benämning" title={material.name} value={material.name} maxLength={300} placeholder="Benämning" onChange={(event) => patchRow(material.id, { name: event.target.value })} /></div>
        {labelled("Antal", <Input aria-label="Antal" inputMode="decimal" value={material.quantity} onChange={(e) => patchRow(material.id, { quantity: e.target.value })} />)}
        {labelled("Enhet", <Input aria-label="Enhet" list={unitListId} autoComplete="off" value={material.unit} onChange={(e) => patchRow(material.id, { unit: e.target.value })} />)}
        <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
          <RemoveButton label="Ta bort material" onClick={() => removeRow(material.id)} />
        </div>
        <ArticleNumberFields articleNo={material.articleNo} articleSource={material.articleSource} manufacturerArticleNo={material.manufacturerArticleNo} onPatch={(patch) => patchRow(material.id, patch)} />
        {/* Priser på materialraden (2026-10-09, steg A): à-pris and påslag as a tinted group under the row, with the
            row's amount; only for someone who may see prices. Others see Benämning, Antal and Enhet. */}
        {prices.visible ? <MaterialPriceFields material={material} onPatch={(patch) => patchRow(material.id, patch)} /> : null}
        {material.pickedArticleId && !prices.visible ? <p className="col-span-full text-xs text-muted-foreground" data-testid="material-price-pending">Artikeln är vald. Priset sparas på raden när arbetsordern sparas.</p> : null}
        {material.product ? <RowProduct info={material.product} /> : null}
        {material.catalogue ? <CopiedPrice snapshot={material.catalogue} unitPrice={material.unitPrice} showPrice={!prices.visible} onClear={() => setRows(rows.map((item) => { if (item.id !== material.id) return item; const next = { ...item }; delete next.catalogue; delete next.unitPrice; delete next.markupPercent; return next; }))} /> : null}
      </div>;
  }
  function expenseEditor(expense: Material) {
    return <div key={expense.id} className="grid grid-cols-2 items-end gap-x-2 gap-y-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_5.5rem_6rem_7.5rem_7.5rem_auto]" data-testid="expense-row" data-car-cost={expense.carCost ? "true" : undefined}>
          {labelled("Utgift", <Input aria-label="Utgift" value={expense.name} onChange={(e) => patchRow(expense.id, { name: e.target.value })} />, "col-span-2 md:col-span-1")}
          {labelled("Antal", <Input aria-label="Antal" inputMode="decimal" value={expense.quantity} onChange={(e) => patchRow(expense.id, { quantity: e.target.value })} />)}
          {labelled("Enhet", <Input aria-label="Enhet" list={unitListId} autoComplete="off" value={expense.unit} onChange={(e) => patchRow(expense.id, { unit: e.target.value })} />)}
          {labelled("À-pris (kr)", <Input aria-label="À-pris (kr)" inputMode="decimal" value={expense.unitPrice ?? ""} onChange={(e) => patchRow(expense.id, { unitPrice: e.target.value })} />)}
          {labelled("Belopp (kr)", <Input aria-label="Belopp (kr)" inputMode="decimal" value={expense.amount ?? ""} aria-invalid={(expense.amount ?? "").trim() && parseAmount(expense.amount) === null ? true : undefined} onChange={(e) => patchRow(expense.id, { amount: e.target.value })} />)}
          <div className="col-span-2 flex items-center justify-end md:col-span-1"><RemoveButton label="Ta bort utgift" onClick={() => removeRow(expense.id)} /></div>
        </div>;
  }
  const signingPanel = <Panel icon={PenLine} keepOpen title="Signering och avslut" description="Signeringen ingår i arbetsorderns slutdokumentation."><div className="grid gap-4 lg:grid-cols-2"><label className="space-y-2 text-xs font-medium text-muted-foreground">Namn på den som signerar<Input id="task-signature-name" value={shownSignerName} onChange={(e) => onChange({ ...data, details: { ...details, signature: { ...details.signature, name: e.target.value } } })} /></label><label className="flex h-10 items-center gap-2.5 self-end text-sm"><Checkbox id="task-signature-confirmed" checked={details.signature.confirmed} onCheckedChange={(checked) => onChange({ ...data, details: { ...details, signature: { ...details.signature, name: details.signature.name || (checked === true ? shownSignerName : ""), confirmed: checked === true } } })} />Jag intygar att dokumentationen är granskad</label></div><label className="mt-4 block space-y-2 text-xs font-medium text-muted-foreground">Avslutande kommentar<textarea aria-label="Avslutande kommentar" className="form-textarea" value={details.closeNotes} onChange={(e) => onChange({ ...data, details: { ...details, closeNotes: e.target.value } })} /></label><label className="mt-4 block space-y-2 text-xs font-medium text-muted-foreground">Kundens kvittens, namn<Input id="task-customer-receipt" maxLength={160} value={details.customerReceipt?.name ?? ""} onChange={(e) => onChange({ ...data, details: { ...details, customerReceipt: { name: e.target.value, at: null } } })} data-testid="task-customer-receipt" /><span className="block font-normal">{details.customerReceipt?.at ? `Kvitterat ${formatSwedish(details.customerReceipt.at, { dateStyle: "short", timeStyle: "short" })}` : "Kunden skriver sitt namn. Tiden sätts när du sparar."}</span></label></Panel>;
  if (part === "execution") return <Panel icon={Wrench} title="Utförande" description="Dokumentera utfört arbete och avvikelser.">{workButtons}{executionFields}</Panel>;
  if (nativeRows) {
    const open = rows.find((item) => item.id === params.get("item"));
    const unitList = <datalist id={unitListId}>{MATERIAL_UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>;
    if (open) return <div className="space-y-3" data-testid="native-material-item">
      {unitList}
      <div className="native-group p-3 [&>[data-testid]]:border-0 [&>[data-testid]]:p-0 [&_button[aria-label^='Ta_bort']]:hidden">{isExpenseRow(open) ? expenseEditor(open) : materialEditor(open)}</div>
      {open.storeRef ? null : <NativeActions><Button type="button" variant="ghost" onClick={() => { if (removeRow(open.id)) closeItem(); }} data-testid="native-material-remove"><Trash2 />{isExpenseRow(open) ? "Ta bort utgiften" : "Ta bort materialet"}</Button></NativeActions>}
      {/* Klar on a row with nothing in it lets the row go: an empty row is never saved (simulation 2026-10-10). */}
      <Button type="button" className="h-12 w-full text-base" onClick={() => { if (isBlankMaterialRow(open)) removeRow(open.id, true); closeItem(); }} data-testid="native-material-done">Klar</Button>
    </div>;
    const line = (item: Material) => [[item.quantity, item.unit].filter((value) => value?.trim()).join(" "), item.articleNo ? `Art.nr ${item.articleNo}` : "", storeRowLabel(item)].filter(Boolean).join(" · ");
    return <div className="space-y-1" data-testid="native-material-list">
      <NativeActions testId="native-material-add">
        {articlesOn ? <Button type="button" variant="ghost" onClick={() => setBrowsing(true)} data-testid="work-order-add-articles"><Search />Lägg till artiklar</Button> : null}
        <Button type="button" variant="ghost" onClick={() => openItem(addRow("material"), null)}><Plus />Lägg till material</Button>
        <Button type="button" variant="ghost" onClick={() => openItem(addRow("expense"), null)}><Plus />Lägg till utgift</Button>
        <Button type="button" variant="ghost" onClick={() => setCarCostOpen(true)} data-testid="car-cost-open"><Car />Bilkostnad</Button>
        {wholesaleButton("ghost")}
      </NativeActions>
      {/* No heading of its own: the top bar says Material. */}
      <ListGroup testId="material-rows">
        {materials.length ? materials.map((item) => { const sale = materialRowPrice(item).sale; return <ListRow key={item.id} type="quote" icon={Package} title={item.name.trim() || "Nytt material"} subtitle={line(item) || "Antal saknas"}
          value={prices.visible && sale !== null ? `${formatSek(sale)} kr` : undefined} onClick={() => openItem(item.id, item)} testId="native-material-row" />; }) : <ListEmpty>Inget material än.</ListEmpty>}
      </ListGroup>
      {prices.visible && materials.length ? <div className="px-1"><MaterialTotals totals={totals} /></div> : null}
      {expenses.length ? <ListGroup title="Utgifter" testId="expense-rows">
        {expenses.map((item) => <ListRow key={item.id} type="neutral" icon={item.carCost ? Car : Receipt} title={item.name.trim() || "Ny utgift"} subtitle={line(item) || undefined}
          value={(item.amount ?? "").trim() ? `${item.amount} kr` : undefined} onClick={() => openItem(item.id, item)} testId="native-expense-row" />)}
      </ListGroup> : null}
      {expenses.length ? <div className="px-1">{expenseSum}</div> : null}
      {grandTotal}
      {prices.visible && !local ? <div className="pt-2"><QuoteFromWorkOrder rows={rows} /></div> : null}
      {carCostDialog}
    </div>;
  }
  if (part === "material") return <Panel icon={Package} title="Material och utgifter" description="Material, utgifter och bilkostnad på arbetsordern.">{materialSection}</Panel>;
  if (part === "signing") return signingPanel;
  // The work buttons stay outside the content's lock, so a blocked Starta tid or Färdigställ still says why (never a dead button).
  const locked = (children: React.ReactNode) => contentDisabled === undefined ? children : <fieldset disabled={contentDisabled} className="min-w-0" data-testid="task-content"><div className="min-w-0 space-y-6">{children}</div></fieldset>;
  return <><Panel icon={Wrench} title="Utförande" description="Dokumentera utfört arbete, material, utgifter, anteckningar och avvikelser.">
    {workButtons}
    {locked(<>{executionFields}{materialSection}</>)}
  </Panel>{locked(signingPanel)}</>;
}

/** À-pris and påslag of one material row, with the row's amount (antal × à-pris, and with the markup). */
function MaterialPriceFields({ material, onPatch }: { material: Material; onPatch: (patch: Partial<Material>) => void }) {
  const price = materialRowPrice(material);
  const badPrice = Boolean((material.unitPrice ?? "").trim()) && parseAmount(material.unitPrice) === null;
  const badMarkup = Boolean((material.markupPercent ?? "").trim()) && parsePercent(material.markupPercent) === null;
  return <div className="field-group col-span-full grid grid-cols-2 items-end gap-2 rounded-md border p-2 sm:grid-cols-[8rem_7rem_minmax(0,1fr)]" data-testid="material-price-fields">
    <label className="space-y-1.5 text-xs font-medium text-muted-foreground">À-pris (kr)
      <span className="relative block"><Input aria-label="À-pris (kr)" placeholder="À-pris" inputMode="decimal" value={material.unitPrice ?? ""} aria-invalid={badPrice || undefined} onChange={(e) => onPatch({ unitPrice: e.target.value })} /><PriceMark snapshot={material.catalogue} unitPrice={material.unitPrice} /></span>
    </label>
    <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Påslag (%)
      <Input aria-label="Påslag (%)" placeholder="Påslag" inputMode="decimal" value={material.markupPercent ?? ""} aria-invalid={badMarkup || undefined} onChange={(e) => onPatch({ markupPercent: e.target.value })} />
    </label>
    <p className="col-span-2 flex min-h-10 flex-wrap items-center gap-x-2 text-sm sm:col-span-1 sm:justify-end" data-testid="material-row-amount">
      {price.sale === null ? <span className="text-muted-foreground">{(material.unitPrice ?? "").trim() ? "Antal och à-pris behöver vara tal" : "Inget pris"}</span> : <>
        <span className="font-semibold tabular-nums">{formatSek(price.sale)} kr</span>
        {price.markup ? <span className="text-xs text-muted-foreground tabular-nums">inköp {formatSek(price.purchase ?? 0)} kr</span> : null}
      </>}
    </p>
  </div>;
}

/** The work order's material sums for someone who may see prices: purchase, with markup, and rows without a price. */
function MaterialTotals({ totals }: { totals: ReturnType<typeof workOrderTotals> }) {
  return <p className="mt-2 flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1 text-right text-sm" data-testid="material-total">
    <span>Summa material: <span className="font-semibold tabular-nums">{formatSek(totals.material.sale)} kr</span></span>
    {totals.material.sale !== totals.material.purchase ? <span className="text-muted-foreground tabular-nums">inköp {formatSek(totals.material.purchase)} kr</span> : null}
    <span className="text-muted-foreground">exkl. moms{totals.material.unpriced ? ` · ${unpricedText(totals.material.unpriced)}` : ""}</span>
  </p>;
}

function RiskFields({ data, onChange, title = "", taskId, assist = false, part }: { data: Extract<TaskData, { kind: "RISK_ASSESSMENT" }>; onChange: (data: Extract<TaskData, { kind: "RISK_ASSESSMENT" }>) => void; title?: string; taskId?: string; assist?: boolean;
  /** Nivå 1 på mobil: Risker (the help and the risks) or Godkännande on a screen of its own; the page shows both. */
  part?: "risks" | "approval" }) {
  const details = data.details;
  // Workflow AI's proposed measures are put in after the person has read them, and may be undone later: both work on
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
  const approvalPanel = <Panel icon={ListChecks} keepOpen title="Gemensamma åtgärder och godkännande" description="Sammanfatta skydden. Ansvarig granskar innan arbetet startar.">
      <label className="block space-y-2 text-xs font-medium text-muted-foreground">Gemensamma skyddsåtgärder<textarea aria-label="Gemensamma skyddsåtgärder" className="form-textarea" placeholder="Exempel: arbetsberedning, avspärrning, personlig skyddsutrustning och kontroll före start" value={details.generalMeasures} onChange={(e) => onChange({ ...data, details: { ...details, generalMeasures: e.target.value } })} /></label>
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><label className="space-y-2 text-xs font-medium text-muted-foreground">Godkänd av<Input id="task-approval-name" placeholder="För- och efternamn" value={details.approval.name} onChange={(e) => onChange({ ...data, details: { ...details, approval: { ...details.approval, name: e.target.value } } })} /></label><label className="flex h-10 items-center gap-2.5 self-end text-sm"><Checkbox id="task-approval-confirmed" checked={details.approval.confirmed} onCheckedChange={(checked) => onChange({ ...data, details: { ...details, approval: { ...details.approval, confirmed: checked === true } } })} />Jag har granskat riskerna, åtgärderna och den kvarvarande risknivån</label></div>
    </Panel>;
  if (part === "approval") return approvalPanel;
  return <>
    <Panel icon={Lightbulb} title="Bedömningsstöd" description="Femgradig skala och riskmatris. Samma skala används före och efter skyddsåtgärderna." collapsible defaultCollapsed foldKey="risk-assessment-help">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-3 self-start sm:grid-cols-2">
          <ScaleHelp title="Sannolikhet" items={likelihoodOptions} />
          <ScaleHelp title="Konsekvens" items={consequenceOptions} />
          <div className="notice sm:col-span-2"><strong>Så bedöms risken:</strong> sannolikhet gånger konsekvens. Skriv en skyddsåtgärd och bedöm risken igen. Hög risk bör åtgärdas innan arbetet startar.</div>
        </div>
        <RiskMatrix />
      </div>
    </Panel>
    <Panel icon={ShieldAlert} keepOpen title="Identifierade risker" description="Beskriv faran och skyddsåtgärden och bedöm risken före och efter åtgärden." actions={details.risks.length ? <>{assist && RiskMeasuresAssist ? <RiskMeasuresAssist title={title} taskId={taskId} risks={withoutMeasure} onApply={applyMeasures} /> : null}<Button id="task-add-risk" size="sm" variant="outline" onClick={addRisk}><Plus />Lägg till risk</Button></> : undefined}>
      <div className="space-y-3">{details.risks.length ? details.risks.map((risk, index) => {
        const initial = riskAssessment(risk.likelihood * risk.consequence);
        const residual = riskAssessment(risk.residualLikelihood * risk.residualConsequence);
        return <article key={risk.id} className="rounded-xl border bg-card p-3 transition-colors focus-within:border-primary/40 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground" aria-hidden="true">{index + 1}</span>Risk {index + 1}</h3><div className="flex flex-wrap items-center gap-1.5"><RiskBadge label="Före" score={initial.score} /><span className="text-muted-foreground" aria-hidden="true">→</span><RiskBadge label="Efter" score={residual.score} /><RemoveButton label={`Ta bort risk ${index + 1}`} onClick={() => onChange({ ...data, details: { ...details, risks: details.risks.filter((item) => item.id !== risk.id) } })} /></div></div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2"><label className="space-y-1 text-xs font-medium text-muted-foreground">Risk eller fara<textarea aria-label="Risk eller fara" id={`task-risk-${index}-hazard`} rows={2} className="form-textarea min-h-16" placeholder="Exempel: fall från stege, spänningssatt del eller tunga lyft" value={risk.hazard} onChange={(e) => update(risk.id, { hazard: e.target.value })} /></label><label className="space-y-1 text-xs font-medium text-muted-foreground">Skyddsåtgärd<textarea aria-label="Skyddsåtgärd" id={`task-risk-${index}-measure`} rows={2} className="form-textarea min-h-16" placeholder="Vad ska göras, av vem och före vilket moment" value={risk.protectiveMeasure} onChange={(e) => update(risk.id, { protectiveMeasure: e.target.value })} /></label></div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <RiskRating id={`task-risk-${index}-before`} title="Före skyddsåtgärd" likelihood={risk.likelihood} consequence={risk.consequence} onLikelihood={(value) => update(risk.id, { likelihood: value })} onConsequence={(value) => update(risk.id, { consequence: value })} />
            <RiskRating id={`task-risk-${index}-after`} title="Kvarvarande risk efter åtgärd" likelihood={risk.residualLikelihood} consequence={risk.residualConsequence} onLikelihood={(value) => update(risk.id, { residualLikelihood: value })} onConsequence={(value) => update(risk.id, { residualConsequence: value })} />
          </div>
        </article>;
      }) : <div className="rounded-xl border border-dashed bg-muted/20 px-5 py-8 text-center"><ShieldAlert className="mx-auto size-7 text-primary" /><p className="mt-3 text-sm font-semibold">Inga risker identifierade ännu</p><p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted-foreground">Gå igenom arbetsmoment, arbetsplats, verktyg, energi och lyft. Lägg till varje fara som en egen risk.</p><Button id="task-add-risk" className="mt-4" size="sm" onClick={addRisk}><Plus />Lägg till första risken</Button></div>}</div>
    </Panel>
    {part === "risks" ? null : approvalPanel}
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
  return <fieldset id={id} tabIndex={-1} className="field-group min-w-0 rounded-lg border px-3 pb-3 pt-1"><legend className="px-1 text-xs font-semibold text-foreground">{title}</legend><div className="grid grid-cols-2 gap-2"><label className="space-y-1 text-[11px] font-medium text-muted-foreground">Sannolikhet<select className="form-select" value={likelihood} onChange={(event) => onLikelihood(Number(event.target.value))}>{likelihoodOptions.map((label, index) => <option key={label} value={index + 1}>{index + 1} · {label}</option>)}</select></label><label className="space-y-1 text-[11px] font-medium text-muted-foreground">Konsekvens<select className="form-select" value={consequence} onChange={(event) => onConsequence(Number(event.target.value))}>{consequenceOptions.map((label, index) => <option key={label} value={index + 1}>{index + 1} · {label}</option>)}</select></label></div><p className="sr-only">Risknivå {level.score}, {level.label} ({likelihood} × {consequence})</p></fieldset>;
}

/** The moments a form asks the person to pick (the control's Isolation, Kontinuitet …), as a step on the progress line. */
/** Om projektet (2026-10-07): the project's facts for a task, with the place's whole way from the customer's places when they are known. */
function projectFactRows(project: ProjectItem | undefined, customers: CustomerItem[]) {
  if (!project) return [];
  const places = customers.find((item) => item.id === project.customerId)?.facilities ?? [];
  return projectFieldRows({ ...project, customer: customers.find((item) => item.id === project.customerId) ?? null }).map(([label, value]) => [label, label === "Plats" && project.facilityId ? placeLabel(places, project.facilityId) || value : value] as const);
}

function formMoments(document: FormDocument, values: FormValues) {
  const optional = formOptionalSections(document);
  if (!document.moments.requireOne || !optional.length) return undefined;
  const label = /^moment$/i.test(document.moments.label.trim()) ? "Moment" : document.moments.label.trim() || "Moment";
  return { label: label === "Moment" ? "Kontrollmoment" : label, met: optional.some((section) => formSectionActive(section, values)), target: `form-${optional[0].id}` };
}

/** A task page: on display levels 1 and 2 its panels start folded except the current step's (see TaskPageFold). */
export function WorkflowTaskEditor({ canCreateWorkOrders = true, ...props }: React.ComponentProps<typeof WorkflowTaskEditorBody>) {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Uppgifter får skapas först (2026-10-27, replaces 2026-10-26's "Vilken arbetsorder?" first): a new task opens at
  // once and may be saved as a draft; Koppla till arbetsorder (`chooseWorkOrder=1`) asks which – an open work order or Ny
  // arbetsorder – and comes back with it. A round's protocol gets the round's work order; a copy keeps the original's.
  const choosing = props.kind !== "WORK_ORDER" && !props.preview && searchParams.get("chooseWorkOrder") === "1";
  if (choosing) {
    const local = props.local ? props.local.tasks.filter((item) => item.kind === "WORK_ORDER").map((item) => ({ id: item.id, kind: item.kind, title: item.title, status: item.status, projectId: item.projectId, customerId: item.customerId, facilityId: item.facilityId ?? null,
      projectName: props.projects.find((project) => project.id === item.projectId)?.name ?? "", customerName: customerTitle(props.customers.find((customer) => customer.id === item.customerId)), createdAt: item.createdAt })) : undefined;
    const back = new URLSearchParams(searchParams.toString());
    back.delete("chooseWorkOrder");
    return <WorkOrderChoice context={{ projectId: searchParams.get("projectId") ?? props.projectId ?? null, customerId: searchParams.get("customerId") ?? props.customerId ?? null, facilityId: searchParams.get("facilityId") }} local={local} canCreateWorkOrder={canCreateWorkOrders}
      title="Koppla till arbetsorder" onChoose={(option) => router.replace(withChosenWorkOrder(`/?${back.toString()}`, option), { scroll: false })} />;
  }
  // The job's cards in its kind's colour (UX-punkt 6): a work order red, a risk assessment orange, a protocol violet.
  return <PanelAreaProvider area={typeOfTaskKind(props.kind)}><TaskPageFold.Provider value><WorkflowTaskEditorBody {...props} canCreateWorkOrders={canCreateWorkOrders} /></TaskPageFold.Provider></PanelAreaProvider>;
}

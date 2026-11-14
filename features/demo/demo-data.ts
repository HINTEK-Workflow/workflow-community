import type { MaterialRow } from "@/lib/workflow/expenses";
import { DEMO_COMPANY } from "@/lib/demo";
import { inheritFromWorkOrder } from "@/lib/workflow/work-order-link";
import type { FacilityItem } from "@/lib/workflow/customer-facility";
import { addSwedishDays, swedishDate, swedishDayKey, swedishMonday, swedishParts } from "@/lib/swedish-time";
import { defaultWorkflowPermissionProfile, workflowPermissionPresets, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { withWorkProfile, type WorkProfile } from "@/lib/workflow/work-profile";
import { workflowTaskProgress, type FormTaskDetails, type WorkflowTaskKind, type WorkflowTaskStatus } from "@/lib/workflow/task-model";
import type { CustomerItem } from "@/features/kfid/types";
import type { StaffRegister } from "@/lib/workflow/staff-register";
import { initialFormValues, type FormDocument, type FormValues } from "@/lib/workflow/form-document";
import type { CompanyValue } from "@/lib/workflow/company-values";
import { repeatScheduleDraft, type FormSchedule } from "@/lib/workflow/form-schedule";
import { highestPriority, type MaintenancePriority, type MaintenanceType, type WaitingReason, type WorkOrderSummary } from "@/lib/workflow/maintenance";
import { ampacityKey } from "@/lib/calculators/company-data";
import { BUILTIN_FORMS } from "@/lib/workflow/builtin-forms";
import { ROUND_FORMS } from "@/lib/workflow/builtin-rounds";
import { kfidForm } from "@/lib/workflow/builtin-kfid-form";
import { planningForm } from "@/lib/workflow/builtin-planning-form";
import { riskForm } from "@/lib/workflow/builtin-risk-form";
import type { CompanyGoals } from "@/lib/workflow/company-goals";
import type { Absence } from "@/lib/workflow/absence";
import type { TimeTypePolicies, TimeTypeView } from "@/lib/workflow/time-types";

/**
 * Invented demo company for the public /demo (2026-09-26, approved proposal
 * docs/DEMO_DATA_PROPOSAL_20260926.md; renamed 2026-11-07 so no real company is shown): "Exempel El & Automation AB" with four invented users, three customers with
 * facilities, four projects in different states and all three task types. Everything lives in the visitor's browser
 * memory, is dated relative to today's Swedish date and disappears on reload. No real person, company, address or
 * e-mail address is used (all addresses end in .invalid).
 */
export type DemoUserId = "demo-elin" | "demo-elis" | "demo-elon" | "demo-elna";
export type DemoUser = { id: DemoUserId; name: string; email: string; title: string; role: "ADMIN" | "MEMBER"; permissions: WorkflowPermissionProfile; weeklyWorkMinutes: number | null;
  /** Ingen fast arbetstid (2026-10-30): no expected time, no capacity. */ noFixedHours?: boolean };
export type DemoTaskData = { kind: "WORK_ORDER"; details: { executionNotes: string; deviations: string; materials: MaterialRow[]; signature: { name: string; confirmed: boolean; signedAt: string | null }; closeNotes: string;
    source?: { taskId: string; title: string; kind?: WorkflowTaskKind; rowId?: string }; waitingOn?: WaitingReason | "" } }
  | { kind: "RISK_ASSESSMENT"; details: { risks: { id: string; hazard: string; likelihood: number; consequence: number; protectiveMeasure: string; residualLikelihood: number; residualConsequence: number }[]; generalMeasures: string; approval: { name: string; confirmed: boolean; approvedAt: string | null } } }
  | { kind: "FORM"; details: FormTaskDetails };
export type DemoRevision = { id: string; version: number; snapshot: Record<string, unknown>; createdAt: string };
export type DemoTask = {
  id: string; kind: WorkflowTaskKind; title: string; description: string; status: WorkflowTaskStatus; projectId: string | null; customerId: string | null;
  assignedToUserId: string | null; assignedToName: string; dueDate: string; data: DemoTaskData; facilityId?: string | null;
  /** Arbetsordern styr (2026-10-26): the work order every task is in (required for all but a work order); its time is recorded there. */
  workOrderId?: string | null;
  /** Driftrond i arbetsordern (2026-10-27): the round a work order holds for its period (Start – Klart senast); 0.24.0 also had one per day (roundOccurrence). */
  roundScheduleId?: string | null; roundOccurrence?: string | null;
  /** Utgår (2026-10-09): when, by whom, why and the status before, as the server keeps them. */
  cancelledAt?: string | null; cancelledBy?: string | null; cancelReason?: string; cancelledFromStatus?: string | null;
  /** Tidplan (Gantt v1, 2026-10-09): planned start ("" = utan datum) and estimated work time in minutes. */
  plannedStartDate?: string; estimatedMinutes?: number | null;
  /** Etapp (plan 1M): the label that groups a project's jobs; "" or left out = none. */
  stage?: string;
  /** Börjar efter (steg 4): jobs in the same project this one starts after (finish-to-start). */
  predecessorIds?: string[];
  version: number; startedAt: string | null; completedAt: string | null; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; revisions: DemoRevision[];
};
export type DemoProjectEvent = { id: string; kind: string; summary: string; taskId: string | null; actorName: string; createdAt: string };
export type DemoProject = {
  id: string; name: string; description: string; dueDate: string; customerId: string | null; responsibleUserId: string | null; responsibleName: string;
  timeBudgetMinutes: number; archivedAt: string | null; closedAt?: string | null;
  startDate?: string; client?: string; contactPerson?: string; reference?: string; workSite?: string; taskTypes: ("WORK_ORDER" | "RISK_ASSESSMENT" | "COMMISSIONING_CONTROL")[];
  workMoments: ("START_TIME" | "EXECUTION" | "SIGN_REPORT" | "CLOSE_ORDER")[]; createdAt: string; updatedAt: string; events: DemoProjectEvent[];
  decisions?: DemoProjectDecision[];
  facilityId?: string | null;
  /** Personalliggare, steg 0 (2026-10-08). */
  staffRegister?: StaffRegister;
  /** Ställföreträdare för bokningar (2026-10-09), as Project.planningDelegateUserId. */
  planningDelegateUserId?: string | null;
};
export type DemoFacility = FacilityItem & { version: number };
export type DemoProjectDecision = { id: string; decidedOn: string; text: string; decidedBy: string; actorName: string; createdAt: string };
/** `taskId` is the task's id. */
/** A time entry on a work order (`taskId`) or, Projekttid since 2026-10-26, on a project itself (`projectId`, taskId null). */
// `sourceTaskId` (2026-10-27): the task in the work order the time was reported from (a round occurrence keeps its own time).
// `timeTypeId` (Tidstyper, 2026-10-29): null or missing = the company's standard type, as in Cloud.
export type DemoTimeEntry = { id: string; taskId: string | null; projectId?: string | null; sourceTaskId?: string | null; userId: string; startedAt: string; endedAt: string | null; durationSec: number; note: string; createdAt: string; updatedAt: string; timeTypeId?: string | null };
export type DemoTimeEvent = { id: string; entryId: string; userId: string; action: "CREATED" | "UPDATED" | "DELETED"; previous: unknown; next: unknown; reason: string; actorUserId: string; actorName: string; createdAt: string };
export type DemoAssignment = { userId: string; plannedMinutes: number | null; startsAt: string | null; endsAt: string | null };
export type DemoActivity = {
  id: string; version: number; title: string; description: string; kind: "TASK" | "MEETING" | "DEADLINE" | "OTHER"; status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  startsAt: string; endsAt: string; projectId: string | null; workflowTaskId: string | null; assignedToName: string; assignments: DemoAssignment[];
  deletedAt: string | null; events: { id: string; kind: string; summary: string; actorName: string; createdAt: string }[];
};
/**
 * Underhåll (2026-10-30): a work order's maintenance items, as the work order's list of them reads them. The demo has
 * no machine tree or store; the items only show the priority, fault and downtime that moved off the work order.
 */
export type DemoMaintenanceItem = {
  id: string; partId: string; partName: string; workOrderId: string; status: "OPEN" | "DONE" | "CANCELLED"; source: "MANUAL"; type: MaintenanceType | ""; priority: MaintenancePriority | "";
  fault: string; reportedAt: string | null; stoppedAt: string | null; restoredAt: string | null; createdAt: string;
};
/** A work order's items in the demo. */
export const demoItemsOf = (db: Pick<DemoDatabase, "maintenanceItems">, workOrderId: string) => (db.maintenanceItems ?? []).filter((item) => item.workOrderId === workOrderId);
/** The lists' summary of a work order, as Cloud reads it: the highest priority of its open items and what the paused order waits for. */
export function demoOrderSummary(db: Pick<DemoDatabase, "maintenanceItems">, task: { id: string; data: unknown }): WorkOrderSummary {
  const waitingOn = (task.data as { details?: { waitingOn?: string } } | null)?.details?.waitingOn ?? "";
  return { priority: highestPriority(demoItemsOf(db, task.id).filter((item) => item.status === "OPEN").map((item) => item.priority)), waitingOn };
}
export type DemoAdminEvent = { id: string; action: string; detail: string; createdAt: string };
export type DemoTimePeriod = { userId: string; period: string; status: "SUBMITTED" | "APPROVED" | "RETURNED"; note: string; submittedAt: string | null; decidedAt: string | null; decidedById: string | null };
export type DemoDatabase = {
  organization: { id: string; name: string; slug: string; domain: null; storageMode: "HINTEK_CLOUD"; weeklyWorkMinutes: number;
    /** Arbetstid (2026-10-30): the workday as minutes after midnight (only a suggestion), and how long absence is kept. */
    workdayStartMinutes: number; workdayEndMinutes: number; absenceRetentionMonths: number };
  users: DemoUser[]; customers: CustomerItem[]; projects: DemoProject[]; tasks: DemoTask[]; timeEntries: DemoTimeEntry[]; timeEvents: DemoTimeEvent[];
  activities: DemoActivity[]; adminEvents: DemoAdminEvent[]; preferences: Record<string, Record<string, unknown>>;
  /** Frånvaro (2026-10-29): in memory like everything else in the demo. */
  absences: Absence[];
  /** Tidstyper (2026-10-29): the company's list – the starting list with invented example codes. */
  timeTypes: TimeTypeView[];
  /** What the company has decided per type of time (beslut 8, 2026-11-01). */
  timeTypePolicies?: TimeTypePolicies;
  /** Tidsperiod (2026-10-30): sent-in and approved months (features/demo/demo-time-periods.ts); none at the start = all open. */
  timePeriods?: DemoTimePeriod[];
  /** Påminn in the demo: who was reminded about which month, and which Swedish day. */
  timeReminders?: { userId: string; period: string; day: string }[];
  facilities: DemoFacility[];
  /** Underhållsposter (2026-10-30) held by the demo's work orders; optional so an older demo state in the browser still opens. */
  maintenanceItems?: DemoMaintenanceItem[];
  /** Published forms from Workflow (the form builder); the demo cannot build or publish its own. */
  forms: { id: string; version: number; name: string; description: string; color: string; icon: string; category: string; allowStandalone: boolean; allowInProject: boolean; document: FormDocument }[];
  /** Värden och referenser (2026-10-06): invented values, marked as such, kept in memory like everything else. */
  companyValues: CompanyValue[];
  /** Driftronder (2026-10-06): invented round schedules, read-only, so Driftronder and Planering show rounds in the demo. */
  schedules: FormSchedule[];
  settings: { riskException?: boolean; companyName: string; contactEmail: string; logoPath: null; themePrimary: null; reportPrimary: string; reportAccent: string; reportSoft: string; suggestions: Record<string, string[]>; maintenance?: boolean; goals?: CompanyGoals };
  sequence: number;
};

export { DEMO_COMPANY };
/** Företagsuppgifter in the demo (invented): the company form, the seller on a demo invoice and what the documents would say. */
export const DEMO_COMPANY_DETAILS = { organizationNumber: "556000-0000", vatNumber: "SE556000000001", fSkatt: true, address: "Exempelgatan 1", postalCode: "123 45", city: "Exempelstad", contactName: "Elin Bergström", email: "info@exempelel.invalid", phone: "010-000 00 00", billingEmail: "faktura@exempelel.invalid", registeredOffice: "Exempelstad", bankgiro: "000-0000", plusgiro: "" };
export const DEMO_ADMIN_ID: DemoUserId = "demo-elin";
const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
const readAndReport = workflowPermissionPresets.find((preset) => preset.id === "report")!.profile;

export function createDemoDatabase(now = new Date()): DemoDatabase {
  let sequence = 0;
  const id = (prefix: string) => `demo-${prefix}-${++sequence}`;
  const monday = swedishMonday(now);
  const todayIndex = swedishParts(now).weekday;
  // A Swedish wall-clock time `day` days from this week's Monday, and `offset` days from today.
  const at = (day: number, hour: number, minute = 0) => { const parts = swedishParts(addSwedishDays(monday, day)); return swedishDate(parts.year, parts.month, parts.day, hour, minute).toISOString(); };
  const rel = (offset: number, hour: number, minute = 0) => at(todayIndex + offset, hour, minute);
  const dayKey = (offset: number) => swedishDayKey(addSwedishDays(now, offset));
  const weekday = (offset: number) => swedishParts(addSwedishDays(now, offset)).weekday;
  /** The first workday after today (Friday → Monday). */
  const nextWorkday = [1, 2, 3].find((offset) => weekday(offset) <= 4) ?? 1;

  // Yrkesprofiler (2026-11-04): the demo's people have the profile an administrator would give them, so menus, Ny and Hem read as in Cloud.
  const profiled = (permissions: WorkflowPermissionProfile, profile: WorkProfile) => withWorkProfile(permissions, { profile, setAt: "2026-01-01T09:00:00.000Z" }) as WorkflowPermissionProfile;
  // Elna leads the work (Arbetsledning): she reads and reports, and sees Teamet like a supervisor does (resa 4, 2026-11-06: she had no Teamet).
  const users: DemoUser[] = [
    { id: "demo-elin", name: "Elin Bergström", email: "elin.bergstrom@exempelel.invalid", title: "Företagsadministratör och projektledare", role: "ADMIN", permissions: profiled(defaultWorkflowPermissionProfile(), "project_manager"), weeklyWorkMinutes: null },
    { id: "demo-elis", name: "Elis Hammarström", email: "elis.hammarstrom@exempelel.invalid", title: "Elektriker", role: "MEMBER", permissions: profiled(field, "electrician"), weeklyWorkMinutes: null },
    { id: "demo-elon", name: "Elon Strömberg", email: "elon.stromberg@exempelel.invalid", title: "Elektriker och kontrollant, 80 procent", role: "MEMBER", permissions: profiled(field, "electrician"), weeklyWorkMinutes: 32 * 60 },
    { id: "demo-elna", name: "Elna Lindqvist", email: "elna.lindqvist@exempelel.invalid", title: "Arbetsledare, läser och rapporterar", role: "MEMBER", permissions: profiled({ version: 1, grants: [...readAndReport.grants, "team:read"] }, "work_lead"), weeklyWorkMinutes: null },
  ];
  const name = (userId: string) => users.find((user) => user.id === userId)?.name ?? "";

  const customer = (key: string, values: Partial<CustomerItem>): CustomerItem => ({ id: `demo-customer-${key}`, name: "", company: "", address: "", postalCode: "", city: "Elstad", email: "", phone: "", mobile: "", lat: null, lng: null, notes: "", customerType: "COMPANY", version: 1, deletedAt: null, ...values });
  const customers = [
    customer("kopparlunden", { name: "Brf Kopparlunden", company: "Brf Kopparlunden", address: "Elvägen 4", postalCode: "123 41", phone: "08-555 01 04", mobile: "070-555 01 05", email: "styrelsen@kopparlunden.invalid", notes: "Kontakt via styrelsen. Nyckel till garaget kvitteras hos fastighetsskötaren." }),
    customer("stromkraft", { name: "Strömkraft Fastigheter AB", company: "Strömkraft Fastigheter AB", address: "Strömgatan 18", postalCode: "123 42", phone: "08-555 01 18", email: "drift@stromkraft.invalid", notes: "Kontorsfastighet i fyra plan och eget ställverk. Arbete i ställverket bokas med driftavdelningen.",
      // Särskilda krav (2026-10-07): invented, shown on the customer card and in the customer's projects and tasks.
      specialRequirements: "Mätprotokollen lämnas som PDF till driftavdelningen innan uppgiften avslutas.\nArbete i ställverket får bara utföras av personer som driftavdelningen har godkänt." }),
    // Kundtyp (2026-10-10): the villa is a private person, so a new quote for it starts as Privatperson.
    customer("voltberg", { name: "Villa Voltberg", company: "Privatkund", customerType: "PRIVATE", address: "Spänningsvägen 7", postalCode: "123 47", mobile: "070-555 01 07", email: "villa.voltberg@exempel.invalid" }),
  ];
  const [kopparlunden, stromkraft, voltberg] = customers;
  const facility = (key: string, customerId: string, values: Partial<DemoFacility>): DemoFacility => ({ id: `demo-facility-${key}`, customerId, name: "", address: "", postalCode: "", city: "Elstad", description: "", isActive: true, version: 1, ...values });
  const facilities = [
    facility("garage", kopparlunden.id, { name: "Garage Elvägen 4", address: "Elvägen 4", postalCode: "123 41", description: "Garage i två plan med 24 platser." }),
    facility("undercentral", kopparlunden.id, { name: "Undercentral hus B", address: "Elvägen 6", postalCode: "123 41" }),
    facility("kontorshuset", stromkraft.id, { name: "Kontorshuset Strömgatan 18", address: "Strömgatan 18", postalCode: "123 42", description: "Kontor plan 1–4." }),
    facility("stallverk", stromkraft.id, { name: "Ställverk S1", address: "Strömgatan 18", postalCode: "123 42", description: "Mellanspänningsställverk i källaren. Tillträde endast med driftavdelningen.",
      // Underhåll (2026-10-06): invented object data, shown when the company turns the module on.
      objectType: "Ställverk", operatingState: "IN_SERVICE", installedOn: "2014-05-20", attributes: [{ label: "Märkspänning", value: "10 kV" }] }),
    facility("villan", voltberg.id, { name: "Villan Spänningsvägen 7", address: "Spänningsvägen 7", postalCode: "123 47" }),
    // Adress och objekt (2026-10-14): the objects under the office building's address.
    facility("huvudcentral", stromkraft.id, { parentId: "demo-facility-kontorshuset", kind: "OBJECT", name: "Huvudcentral", address: "", postalCode: "", city: "", description: "Huvudcentral i källaren." }),
    facility("central-e12", stromkraft.id, { parentId: "demo-facility-kontorshuset", kind: "OBJECT", name: "Elcentral plan 2", address: "", postalCode: "", city: "", description: "Gruppcentral för belysning plan 2.",
      objectType: "Elcentral", operatingState: "IN_SERVICE", manufacturer: "Demotillverkaren", model: "GC-24", serialNumber: "DEMO-0012", installedOn: "2019-03-11" }),
    facility("garage-central", kopparlunden.id, { parentId: "demo-facility-garage", kind: "OBJECT", name: "Laddcentral", address: "", postalCode: "", city: "", objectType: "Laddcentral", operatingState: "IN_SERVICE" }),
    // Underobjekt i flera nivåer (2026-10-15): the tree shows three levels in the demo.
    facility("matarskap", stromkraft.id, { parentId: "demo-facility-huvudcentral", kind: "OBJECT", name: "Mätarskåp", address: "", postalCode: "", city: "", description: "Elmätare för fastigheten.", objectType: "Mätarskåp" }),
    facility("overspanning", stromkraft.id, { parentId: "demo-facility-huvudcentral", kind: "OBJECT", name: "Överspänningsskydd", address: "", postalCode: "", city: "", description: "Typ 1+2 i huvudcentralen." }),
    facility("grupp-belysning", stromkraft.id, { parentId: "demo-facility-central-e12", kind: "OBJECT", name: "Grupp belysning", address: "", postalCode: "", city: "", description: "Belysning korridor plan 2." }),
    facility("laddbox-1", kopparlunden.id, { parentId: "demo-facility-garage-central", kind: "OBJECT", name: "Laddbox", address: "", postalCode: "", city: "", objectType: "Laddbox", description: "Plats 1–2." }),
  ];
  const [garage, , kontorshuset, stallverket, villan] = facilities;

  const project = (key: string, created: number, values: Omit<DemoProject, "id" | "archivedAt" | "taskTypes" | "workMoments" | "createdAt" | "updatedAt" | "events" | "responsibleName">): DemoProject => ({
    id: `demo-project-${key}`, archivedAt: null, taskTypes: [], workMoments: [], createdAt: rel(created, 8), updatedAt: rel(Math.max(created, -1), 9),
    responsibleName: name(values.responsibleUserId ?? ""), events: [{ id: id("event"), kind: "CREATED", summary: "Projektet skapades", taskId: null, actorName: name("demo-elin"), createdAt: rel(created, 8) }], ...values,
  });
  const projects = [
    // Pågår and follows its frame: all three task types, planning inside the frame, reported time and two decisions.
    project("laddplatser", -22, { name: "Laddplatser i garaget", description: "Tolv laddplatser med lastbalansering, ny matarkabel och egen central i garaget.", startDate: dayKey(-21), dueDate: dayKey(21), customerId: kopparlunden.id, facilityId: garage.id, responsibleUserId: "demo-elin", timeBudgetMinutes: 80 * 60,
      client: "Brf Kopparlunden", contactPerson: "Styrelsens ordförande", reference: "BRF-2026-014", workSite: "Garage plan –1, Elvägen 4",
      staffRegister: { required: true, inWorkflow: false, siteId: "DEMO1234", builder: "Brf Kopparlunden", system: "Byggherrens incheckning vid garageinfarten" }, decisions: [
        { id: id("decision"), decidedOn: dayKey(-18), text: "Laddboxar med lastbalansering väljs framför fast effektbegränsning.", decidedBy: "Brf Kopparlundens styrelse", actorName: name("demo-elin"), createdAt: rel(-18, 16) },
        { id: id("decision"), decidedOn: dayKey(-6), text: "Etapp 2 (plats 7–12) utförs efter byggmötet, när garaget är tömt på bilar.", decidedBy: "Elin Bergström och styrelsen", actorName: name("demo-elin"), createdAt: rel(-6, 15) },
      ] }),
    // Försenat: the end date has passed, a little over budget (two people for a month, about 375–410 h against 360 h, 2026-11-06:
    // 36 h gave "404 h av 36 h"), one work order needs action and time reported after the end.
    project("belysning", -36, { name: "Belysningsbyte kontor", description: "Byte till LED-armaturer med närvarostyrning på plan 2.", startDate: dayKey(-35), dueDate: dayKey(-3), customerId: stromkraft.id, facilityId: kontorshuset.id, responsibleUserId: "demo-elin", timeBudgetMinutes: 360 * 60,
      client: "Strömkraft Fastigheter AB", contactPerson: "Driftchef", reference: "SK-4711", workSite: "Plan 2, Strömgatan 18" }),
    // Ligger efter: little is done while most of the frame has passed; the control protocol is under way.
    project("stallverk", -29, { name: "Revision ställverk S1", description: "Byte av brytare i fack 3 och kontroll före idrifttagning av ställverket.", startDate: dayKey(-28), dueDate: dayKey(14), customerId: stromkraft.id, facilityId: stallverket.id, responsibleUserId: "demo-elin", timeBudgetMinutes: 40 * 60,
      client: "Strömkraft Fastigheter AB", contactPerson: "Driftchef", reference: "SK-4730", workSite: "Ställverk S1, källaren" }),
    // Klar att avsluta: every task is completed and no planning is active.
    project("elcentral", -29, { name: "Ny elcentral", description: "Byte av gammal proppcentral till ny central med jordfelsbrytare och överspänningsskydd.", startDate: dayKey(-28), dueDate: dayKey(-7), customerId: voltberg.id, facilityId: villan.id, responsibleUserId: "demo-elis", timeBudgetMinutes: 16 * 60,
      client: "Villa Voltberg", workSite: "Tvättstugan, Spänningsvägen 7" }),
  ];
  const [laddplatser, belysning, stallverk, elcentral] = projects;

  const workOrder = (details: Partial<Extract<DemoTaskData, { kind: "WORK_ORDER" }>["details"]>): Extract<DemoTaskData, { kind: "WORK_ORDER" }> => ({ kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "", ...details } });
  const risk = (hazard: string, likelihood: number, consequence: number, protectiveMeasure: string, residualLikelihood: number, residualConsequence: number) => ({ id: crypto.randomUUID(), hazard, likelihood, consequence, protectiveMeasure, residualLikelihood, residualConsequence });
  const riskAssessment = (risks: ReturnType<typeof risk>[], approval = { name: "", confirmed: false, approvedAt: null as string | null }, generalMeasures = ""): DemoTaskData => ({ kind: "RISK_ASSESSMENT", details: { risks, generalMeasures, approval } });
  // À-pris and påslag on some finished jobs (2026-10-10), so a fakturaunderlag in the demo has priced lines to show.
  const material = (materialName: string, quantity: string, unit: string, unitPrice?: string, markupPercent?: string) => ({ id: crypto.randomUUID(), name: materialName, quantity, unit, ...(unitPrice ? { unitPrice, markupPercent: markupPercent ?? "" } : {}) });
  type TaskValues = Omit<DemoTask, "id" | "version" | "revisions" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "startedAt" | "completedAt" | "assignedToName" | "description" | "customerId" | "facilityId"> & { description?: string; created?: number; updated?: number; completed?: number; customerId?: string | null; facilityId?: string | null };
  const task = (key: string, values: TaskValues): DemoTask => {
    const { created = -10, updated = -1, completed, ...rest } = values;
    const owner = projects.find((entry) => entry.id === rest.projectId);
    const record: DemoTask = {
      description: "", customerId: owner?.customerId ?? null, facilityId: owner?.facilityId ?? null,
      ...rest, id: `demo-task-${key}`, version: 1, assignedToName: name(rest.assignedToUserId ?? ""),
      startedAt: rest.status === "PLANNED" ? null : rel(created, 8), completedAt: rest.status === "COMPLETED" ? rel(completed ?? updated, 15) : null,
      createdBy: "demo-elin", updatedBy: rest.assignedToUserId ?? "demo-elin", createdAt: rel(created, 8), updatedAt: rest.status === "COMPLETED" ? rel(completed ?? updated, 15) : rel(updated, 14), revisions: [],
    };
    record.revisions = [{ id: id("revision"), version: 1, createdAt: record.updatedAt, snapshot: { ...record, revisions: undefined, progress: workflowTaskProgress(record) } }];
    return record;
  };
  const signed = (userId: string, offset: number) => ({ name: name(userId), confirmed: true, signedAt: rel(offset, 15) });
  const tasks: DemoTask[] = [
    task("garage-risk", { kind: "RISK_ASSESSMENT", title: "Arbete i garage med trafik", status: "COMPLETED", projectId: laddplatser.id, assignedToUserId: "demo-elin", dueDate: dayKey(-17), created: -20, completed: -17,
      data: riskAssessment([
        risk("Fordon i rörelse i garaget under arbetet", 3, 4, "Avspärrning med koner och varselkläder, arbete i etapper per plan", 1, 3),
        risk("Arbete på stege vid kabelstegar i tak", 3, 3, "Plattformsstege, två personer vid tunga kabeldragningar", 2, 2),
        risk("Anslutning i spänningssatt fördelningscentral", 2, 5, "Frånkoppling, låsning och spänningsprovning före arbete", 1, 4),
      ], { name: "Elin Bergström", confirmed: true, approvedAt: rel(-17, 15) }, "Arbetet samordnas med fastighetsskötaren. Informationslapp i trapphusen dagen före.") }),
    task("garage-matare", { kind: "WORK_ORDER", title: "Dragning av matarkabel", status: "COMPLETED", projectId: laddplatser.id, assignedToUserId: "demo-elis", dueDate: dayKey(-8), created: -16, completed: -8,
      data: workOrder({ executionNotes: "Matarkabel EKKJ 4x95/50 dragen från fastighetens huvudcentral till ny garagecentral, 64 m på kabelstege. Isolationsmätt och märkt i båda ändar.", materials: [material("EKKJ 4x95/50", "64", "m"), material("Kabelstege 300 mm", "18", "m"), material("Kabelskor 95 mm²", "8", "st")], signature: signed("demo-elis", -8), closeNotes: "Klart för anslutning av laddboxar." }) }),
    task("garage-laddboxar", { kind: "WORK_ORDER", title: "Installation av laddboxar plan –1", status: "IN_PROGRESS", projectId: laddplatser.id, assignedToUserId: "demo-elis", dueDate: dayKey(14), created: -7,
      description: "Montera och anslut tolv laddboxar med lastbalansering. Konfiguration av appen görs av leverantören.",
      data: workOrder({ executionNotes: "Plats 1–6 monterade och anslutna. Lastbalanseringsmätaren installerad i garagecentralen.", materials: [material("Laddbox 11 kW", "6", "st"), material("Kabel EQLQ 5G6", "84", "m")] }) }),
    task("kontor-led", { kind: "WORK_ORDER", title: "LED-armaturer plan 2", status: "NEEDS_ACTION", projectId: belysning.id, assignedToUserId: "demo-elis", dueDate: dayKey(-4), created: -30,
      data: workOrder({ executionNotes: "32 av 40 armaturer bytta. Närvarogivare monterade i korridor och mötesrum.", deviations: "Åtta armaturer i undertaket saknar fästen som passar. Nya fästen är beställda och leveransen väntas.", materials: [material("LED-panel 600x600", "32", "st"), material("Närvarogivare", "6", "st")] }) }),
    // Belongs to the LED work order (Fas 2): its time is recorded on the order.
    task("kontor-risk", { kind: "RISK_ASSESSMENT", title: "Arbete på stege och i undertak", status: "IN_PROGRESS", projectId: belysning.id, workOrderId: "demo-task-kontor-led", assignedToUserId: "demo-elon", dueDate: dayKey(-25), created: -30,
      data: riskAssessment([risk("Fall från stege vid arbete i undertak", 3, 3, "Plattformsstege och arbete två och två", 2, 2), risk("Damm och fibrer från undertaksplattor", 3, 2, "", 3, 2)]) }),
    task("stallverk-brytare", { kind: "WORK_ORDER", title: "Byte av brytare fack 3", status: "PLANNED", projectId: stallverk.id, assignedToUserId: "demo-elis", dueDate: dayKey(12), created: -20,
      description: "Byte av effektbrytare i fack 3 under planerat avbrott. Driftavdelningen kopplar från och jordar.", data: workOrder({ materials: [material("Effektbrytare 630 A", "1", "st")] }) }),
    task("villa-central", { kind: "WORK_ORDER", title: "Byte av central med jordfelsbrytare", status: "COMPLETED", projectId: elcentral.id, assignedToUserId: "demo-elis", dueDate: dayKey(-12), created: -26, completed: -12,
      description: "Ersätt proppcentral med ny central, jordfelsbrytare typ A och överspänningsskydd.",
      data: workOrder({ executionNotes: "Ny central monterad i tvättstugan. Alla grupper flyttade och märkta. Överspänningsskydd installerat.", materials: [material("Normcentral 36 moduler", "1", "st", "2450", "15"), material("Jordfelsbrytare 40 A typ A", "2", "st", "690", "15"), material("Överspänningsskydd typ 2", "1", "st", "1190", "15")], signature: signed("demo-elis", -12), closeNotes: "Kunden informerad om provning av jordfelsbrytare två gånger per år." }) }),
    task("villa-risk", { kind: "RISK_ASSESSMENT", title: "Byte av central i bostad", status: "COMPLETED", projectId: elcentral.id, assignedToUserId: "demo-elon", dueDate: dayKey(-14), created: -26, completed: -14,
      data: riskAssessment([risk("Arbete nära spänningsförande delar vid omkoppling", 2, 5, "Huvudbrytare frånslagen, spänningsprovning och låsning", 1, 4), risk("Boende i huset under arbetet", 2, 2, "Avspärrning av tvättstugan och information till kunden", 1, 1)],
        { name: "Elon Strömberg", confirmed: true, approvedAt: rel(-14, 15) }) }),
    // Standalone work: not every job is a project.
    task("service-jordfel", { kind: "WORK_ORDER", title: "Felsökning jordfelsbrytare, Villa Voltberg", status: "PLANNED", projectId: null, customerId: voltberg.id, facilityId: villan.id, assignedToUserId: "demo-elon", dueDate: dayKey(4), created: -2,
      description: "Jordfelsbrytaren löser ut sporadiskt på kvällarna. Kunden misstänker utebelysningen.", data: workOrder({}) }),
    // Elin's own jobs (2026-10-14): the demo opens as Elin, and Mina jobb was empty for her.
    task("service-kopparlunden-trapphus", { kind: "WORK_ORDER", title: "Felsökning av trapphusbelysning, Brf Kopparlunden", status: "IN_PROGRESS", projectId: null, customerId: kopparlunden.id, facilityId: null, assignedToUserId: "demo-elin", dueDate: dayKey(1), created: -1,
      description: "Belysningen i trapphus A släcks slumpvis på kvällarna. Kontrollera skymningsrelä och tidur.", data: workOrder({ executionNotes: "Skymningsreläet är utbytt. Tiduret återstår att kontrollera.", materials: [material("Skymningsrelä", "1", "st", "485", "15")] }) }),
    task("service-voltberg-laddbox", { kind: "WORK_ORDER", title: "Installation av laddbox, Villa Voltberg", status: "PLANNED", projectId: null, customerId: voltberg.id, facilityId: villan.id, assignedToUserId: "demo-elin", dueDate: dayKey(6), created: -3,
      description: "Montera laddbox 11 kW på garagets yttervägg med ny grupp från centralen.", data: workOrder({ materials: [material("Laddbox 11 kW", "1", "st"), material("Kabel EQLQ 5G6", "18", "m")] }) }),
    task("garage-etapp2-risk", { kind: "RISK_ASSESSMENT", title: "Etapp 2 i garaget, plats 7–12", status: "IN_PROGRESS", projectId: null, customerId: kopparlunden.id, assignedToUserId: "demo-elin", dueDate: dayKey(5), created: -2,
      data: riskAssessment([risk("Fordon i rörelse under etapp 2", 3, 4, "Avspärrning av plats 7–12 och information i trapphusen dagen före", 1, 3)]) }),
    task("service-trapphus", { kind: "WORK_ORDER", title: "Byte av trasig armatur i trapphus", status: "COMPLETED", projectId: null, customerId: kopparlunden.id, facilityId: null, assignedToUserId: "demo-elis", dueDate: dayKey(-9), created: -11, completed: -10,
      data: workOrder({ executionNotes: "Armaturen i trapphus B plan 3 bytt mot LED med rörelsevakt.", materials: [material("LED-armatur med rörelsevakt", "1", "st", "895", "15"), { id: crypto.randomUUID(), kind: "expense" as const, name: "Parkering vid fastigheten", quantity: "1", unit: "st", unitPrice: "80", amount: "80,00" }], signature: signed("demo-elis", -10) }) }),
  ];
  // Kontroll före idrifttagning as protocols of Workflow's form (2026-10-06: the older control editor is gone), with
  // real measurement rows so the shared rules compute their progression.
  const kfidDemo = kfidForm.meta.displayName || kfidForm.meta.name;
  const kfid = (key: string, values: { title: string; projectId: string; assignedToUserId: DemoUserId; date: number; status: WorkflowTaskStatus; created: number; updated?: number; completed?: number;
    moments: string[]; rows: Record<string, Record<string, string | number | boolean>[]>; checks?: string[]; controlledBy?: string }): DemoTask => {
    const owner = projects.find((entry) => entry.id === values.projectId)!;
    const client = customers.find((entry) => entry.id === owner.customerId)!;
    const answers: FormValues = initialFormValues(kfidForm.document);
    // The protocol's title follows its Projekt / anläggning field (the form's titleKey), so the two agree from the start: a
    // differing field renamed the protocol at its first change, and the log then named it after the project and place
    // (simulation 2026-10-10).
    answers.fields = { ...answers.fields, proj: values.title, perf: name(values.assignedToUserId), date: dayKey(values.date),
      client: client.name, addr: client.email, ctrl: values.controlledBy ?? "", instr: "Installationstestare IT-200", sn: "DEMO-200-01", cal: dayKey(-120) };
    for (const moment of ["iso", "cont", "volt", "rcd", "zs", "vis"]) answers.sections[`kfid-${moment}`] = values.moments.includes(moment);
    for (const [table, rows] of Object.entries(values.rows)) answers.tables[table] = rows.map((cells, index) => ({ id: `${key}-${table}-${index + 1}`, label: "", cells }));
    if (values.checks) answers.checklists.vis = Object.fromEntries(values.checks.map((item) => [item, { state: "OK" as const, comment: "" }]));
    return task(key, { kind: "FORM", title: values.title, status: values.status, projectId: values.projectId, assignedToUserId: values.assignedToUserId, dueDate: dayKey(values.date),
      created: values.created, updated: values.updated, completed: values.completed,
      data: { kind: "FORM", details: { templateId: kfidForm.id, templateVersion: 1, templateName: kfidDemo, document: kfidForm.document, values: answers } } });
  };
  const allVisualChecks = ["markning", "dok", "mek", "ip", "beroring", "funktion"];
  const rcdRow = (place: string, t1: number) => ({ place, std: "EN 61008 / EN 61009", type: "A", uclim: "≤ 50", idn: "30", idp: 21, idn_measured: 22, t1p: t1, t1n: t1 + 2, t5p: 12, t5n: 14, uc: 2, ntrip05: true, btnok: true });
  tasks.push(
    // Every requirement is met but it is not completed yet, so the 95 % cap is visible.
    kfid("kfid-garage", { title: "Kontroll före idrifttagning, garagecentral", projectId: laddplatser.id, assignedToUserId: "demo-elon", date: -1, status: "IN_PROGRESS", created: -3, updated: -1,
      moments: ["iso", "cont", "rcd", "vis"], checks: allVisualChecks, rows: {
        iso: [{ objekt: "Matarkabel garagecentral", u: "500 V", mohm: 250, limit: 1 }, { objekt: "Laddgrupp plats 1–6", u: "500 V", mohm: 180, limit: 1 }],
        cont: [{ name: "PE garagecentral – huvudcentral", ohm: 0.12, limit: 0.5 }],
        rcd: [1, 2, 3].map((place) => rcdRow(`Laddbox plats ${place}`, 24 + place)),
      } }),
    // Under way with measurements left to do, in a project that is behind its frame.
    kfid("kfid-stallverk", { title: "Kontroll före idrifttagning, fack 3", projectId: stallverk.id, assignedToUserId: "demo-elon", date: -3, status: "IN_PROGRESS", created: -5, updated: -3,
      moments: ["iso", "cont", "volt", "vis"], rows: {
        iso: [{ objekt: "Fack 3 utgående kabel", u: "1000 V", limit: 1 }],
        volt: [{ name: "Fack 3 samlingsskena", status: "Ej mätt", rotation: "Ej mätt" }],
      } }),
    kfid("kfid-villa", { title: "Kontroll före idrifttagning, ny central", projectId: elcentral.id, assignedToUserId: "demo-elon", date: -11, status: "COMPLETED", created: -12, completed: -11,
      moments: ["iso", "cont", "volt", "rcd", "vis"], checks: allVisualChecks, controlledBy: "Elin Bergström", rows: {
        iso: [{ objekt: "Samtliga grupper", u: "500 V", mohm: 120, limit: 1 }],
        cont: [{ name: "Skyddsledare huvudjordskena", ohm: 0.08, limit: 0.5 }],
        volt: [{ name: "Inkommande matning", status: "400 Vac", rotation: "Höger" }],
        rcd: [rcdRow("JFB 1 bostad", 22)],
      } }),
  );

  // v0.4.19–0.4.20 in the demo (2026-10-07): protocols of other Workflow forms, filled in like a person would.
  const formById = (formId: string) => [...BUILTIN_FORMS, ...ROUND_FORMS, planningForm].find((form) => form.id === formId)!;
  const protocol = (key: string, formId: string, values: Omit<TaskValues, "kind" | "data">, fill: (answers: FormValues) => void): DemoTask => {
    const form = formById(formId);
    const answers = initialFormValues(form.document);
    fill(answers);
    return task(key, { ...values, kind: "FORM", data: { kind: "FORM", details: { templateId: form.id, templateVersion: 1, templateName: form.meta.displayName || form.meta.name, document: form.document, values: answers } } });
  };
  const okAll = (prefix: string, count: number, except: Record<string, { state: "NOT_OK" | "NA"; comment: string }> = {}) =>
    Object.fromEntries(Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`).map((item) => [item, except[item] ? { ...except[item], images: undefined } : { state: "OK" as const, comment: "" }]));
  // Underhållsposter (2026-10-30): the maintenance facts of the work orders below, on invented machine parts.
  const maintenanceItems: DemoMaintenanceItem[] = [];
  const item = (taskKey: string, partName: string, values: Partial<DemoMaintenanceItem>) => maintenanceItems.push({
    id: `demo-maintenance-${taskKey}`, partId: `demo-part-${taskKey}`, partName, workOrderId: `demo-task-${taskKey}`, status: "OPEN", source: "MANUAL", type: "CORRECTIVE", priority: "",
    fault: "", reportedAt: null, stoppedAt: null, restoredAt: null, createdAt: values.reportedAt ?? now.toISOString(), ...values,
  });

  // Planering och kravbestämning in the switchgear project; its "Kontroller som ska göras" are the moments the project's
  // Kontroll före idrifttagning has on, so the control says "Förvalt från planeringen".
  tasks.push(protocol("planering-stallverk", planningForm.id, { title: "Planering och kravbestämning, fack 3", status: "COMPLETED", projectId: stallverk.id, assignedToUserId: "demo-elna", dueDate: dayKey(-26), created: -27, completed: -26 }, (answers) => {
    answers.fields = { ...answers.fields, uppdrag: "Byte av brytare i fack 3 och kontroll före idrifttagning", anlaggning: stallverket.name, datum: dayKey(-26), typ: "Ändring eller utökning",
      verksamhetstyp: "Övriga anläggningar för användning av el", planerare: name("demo-elna"), beskrivning: "Effektbrytaren i fack 3 byts under ett planerat avbrott. Driftavdelningen kopplar från och jordar.",
      kontakt: "Driftchefen hos kunden", krav: "Kundens särskilda krav gäller: mätprotokollen lämnas som PDF och arbete i ställverket utförs bara av personer som driftavdelningen har godkänt.",
      utfors_av: name("demo-elis"), kontrolleras_av: name("demo-elon") };
    answers.checklists.moment = Object.fromEntries(["moment-1", "moment-2", "moment-3", "moment-6"].map((item) => [item, { state: "OK" as const, comment: "" }]));
    answers.signatures.signatur = signed("demo-elna", -26);
  }));

  // Fortlöpande kontroll in the office building: completed, one remark became a work order with a way back to the row,
  // and "Upprepa kontrollen" made it a round every six months (the schedule below).
  const remarkRow = "fortlopande-kontor-anm-1";
  const remarkOrder = "demo-task-ao-lucka-e12";
  const recurring = protocol("fortlopande-kontor", "hintek-fortlopande-kontroll", { title: "Fortlöpande kontroll, kontorshuset", status: "COMPLETED", projectId: null, customerId: stromkraft.id, facilityId: kontorshuset.id,
    assignedToUserId: "demo-elon", dueDate: dayKey(-5), created: -6, completed: -5 }, (answers) => {
    answers.fields = { ...answers.fields, kontrolldatum: dayKey(-5), intervall: 6, omfattning: "Hela anläggningen", sammanfattning: "Anläggningen i gott skick. En lucka saknas på elcentralen på plan 2; arbetsorder skapad." };
    answers.checklists.kontrollpunkter = okAll("kontrollpunkter", 10, { "kontrollpunkter-2": { state: "NOT_OK", comment: "Lucka saknas på elcentral E12, plan 2." } });
    answers.tables.anmarkningar = [{ id: remarkRow, label: "", source: { checklist: "kontrollpunkter", item: "kontrollpunkter-2" }, workOrderId: remarkOrder,
      cells: { beskrivning: "Lucka saknas på elcentral E12", plats: "Plan 2, elcentral E12", klass: "Åtgärdas snarast", atgard: "Montera en ny lucka med lås.", klart: dayKey(9) } }];
    answers.deviationComment = "Saknad lucka på elcentral E12. Arbetsorder skapad, kunden informerad.";
    answers.signatures.kontrollant = signed("demo-elon", -5);
  });
  tasks.push(recurring);

  // The latest weekly standby round, done, so Planering and Driftronder show a done occasion beside the coming ones.
  const lastMonday = todayIndex === 0 ? -7 : -todayIndex;
  tasks.push(protocol("rond-reservkraft", "hintek-reservkraft", { title: "Veckotillsyn reservkraft", status: "COMPLETED", projectId: null, customerId: stromkraft.id, facilityId: stallverket.id,
    assignedToUserId: "demo-elon", dueDate: dayKey(lastMonday), created: lastMonday, completed: lastMonday }, (answers) => {
    answers.fields = { ...answers.fields, datum: dayKey(lastMonday), aggregat: `Reservkraftaggregat, ${stallverket.name}`, provtyp: "Veckotillsyn (utan last)", kontrollant: name("demo-elon"), bransle: 85, laddspanning: 27.2 };
    answers.checklists.motor = okAll("motor", 5);
    answers.tables.avvikelser = [];
    answers.signatures.sign = signed("demo-elon", lastMonday);
    answers.round = { scheduleId: "demo-schedule-reservkraft", occurrence: dayKey(lastMonday), scans: [] };
  }));
  // Säkerhetsavstämning (2026-10-27, punkt 4): the occurrence's short check against the work order's risk assessment.
  Object.assign(tasks[tasks.length - 1].data, { roundSafetyStep: true, roundSafety: { answers: { stillValid: "yes", changed: "no", newRisks: "no" }, confirmedBy: name("demo-elon"), confirmedAt: rel(lastMonday, 7),
    riskRef: { workOrderId: "demo-task-rond-reservkraft-ar", riskConfirmedAt: rel(-60, 8), extendedTaskId: null } } });

  // Arbetsordrar med underhållsposter (v0.4.19; the facts on items since 2026-10-30): an urgent open one, one paused for
  // material, one from the remark above.
  tasks.push(
    task("ao-laddcentral", { kind: "WORK_ORDER", title: "Laddcentral LC1 utan spänning", status: "PLANNED", projectId: null, customerId: kopparlunden.id, facilityId: "demo-facility-garage-central",
      assignedToUserId: "demo-elon", dueDate: dayKey(0), created: -1, updated: -1,
      description: "Alla laddplatser i garaget är utan ström. Fastighetsskötaren har inte kunnat återställa.",
      // Created after the risk step exists (QA 2026-10-10): the job has its Riskbedömning step, like every new job.
      data: { ...workOrder({}), riskStep: true } as DemoTaskData }),
    task("ao-undercentral", { kind: "WORK_ORDER", title: "Byte av kontaktor, cirkulationspump P2", status: "PAUSED", projectId: null, customerId: kopparlunden.id, facilityId: "demo-facility-undercentral",
      assignedToUserId: "demo-elis", dueDate: dayKey(8), created: -4, updated: -3,
      data: workOrder({ executionNotes: "Felsökning klar: kontaktorn till pump P2 har brända kontakter. Reservpumpen går tills vidare.", materials: [material("Kontaktor 3-polig 25 A", "1", "st")], waitingOn: "MATERIAL" }) }),
    task("ao-lucka-e12", { kind: "WORK_ORDER", title: "Åtgärda: Lucka saknas på elcentral E12", status: "PLANNED", projectId: null, customerId: stromkraft.id, facilityId: "demo-facility-central-e12",
      assignedToUserId: "demo-elis", dueDate: dayKey(9), created: -5, updated: -5, description: "Lucka saknas på elcentral E12. Plats: Plan 2, elcentral E12.",
      data: { ...workOrder({ source: { taskId: recurring.id, title: recurring.title, kind: "FORM", rowId: remarkRow } }), riskStep: true } as DemoTaskData }),
  );
  item("ao-laddcentral", "Laddcentral LC1", { priority: "URGENT", fault: "Laddcentralen LC1 saknar spänning, alla laddplatser är ur drift.", reportedAt: rel(-1, 17, 40), stoppedAt: rel(-1, 17, 15) });
  item("ao-undercentral", "Cirkulationspump P2", { priority: "HIGH", fault: "Cirkulationspump P2 startar inte.", reportedAt: rel(-4, 9), stoppedAt: rel(-4, 8, 30) });
  item("ao-lucka-e12", "Elcentral E12", { priority: "HIGH", fault: "Lucka saknas på elcentral E12, plan 2.", reportedAt: rel(-5, 15) });
  // Arbetsordern styr (2026-10-26): every task is in a work order. The project's tasks go into the project's work
  // orders, the others into work orders of their own. The standby round is held by its work order for a year (
  // 2026-10-27, punkt 3): the latest occurrence is registered in it, with the risk assessment made on the work order.
  tasks.push(
    task("ao-etapp2", { kind: "WORK_ORDER", title: "Etapp 2 i garaget, plats 7–12", status: "IN_PROGRESS", projectId: null, customerId: kopparlunden.id, assignedToUserId: "demo-elin", dueDate: dayKey(5), created: -2,
      description: "Förberedelser för laddplatserna 7–12 i garaget.", data: { ...workOrder({}), riskStep: true, riskCheck: { level: "extended", answers: { deenergized: "yes", competence: "yes", height: "yes", others: "no", special: "yes" }, confirmedBy: name("demo-elin"), confirmedAt: rel(-2, 9), extendedTaskId: "demo-task-garage-etapp2-risk" } } as DemoTaskData }),
    task("ao-fortlopande-kontor", { kind: "WORK_ORDER", title: "Fortlöpande kontroll, kontorshuset", status: "COMPLETED", projectId: null, customerId: stromkraft.id, facilityId: kontorshuset.id, assignedToUserId: "demo-elon", dueDate: dayKey(-5), created: -6, completed: -5,
      data: workOrder({ executionNotes: "Fortlöpande kontroll utförd enligt protokollet.", signature: signed("demo-elon", -5) }) }),
    { ...task("rond-reservkraft-ar", { kind: "WORK_ORDER", title: `Veckotillsyn reservkraft ${dayKey(-60)}–${dayKey(304)}`, status: "IN_PROGRESS", projectId: null, customerId: stromkraft.id, facilityId: stallverket.id, assignedToUserId: "demo-elon",
      dueDate: dayKey(304), created: -60, updated: lastMonday,
      data: { ...workOrder({}), riskStep: true, riskCheck: { level: "simplified", answers: { deenergized: "yes", competence: "yes", height: "yes", others: "yes", special: "yes" }, confirmedBy: name("demo-elon"), confirmedAt: rel(-60, 8) } } as DemoTaskData }),
      plannedStartDate: dayKey(-60), roundScheduleId: "demo-schedule-reservkraft" },
  );
  const inOrder: Record<string, string> = {
    "garage-risk": "garage-matare", "kfid-garage": "garage-laddboxar", "kfid-stallverk": "stallverk-brytare", "planering-stallverk": "stallverk-brytare",
    "villa-risk": "villa-central", "kfid-villa": "villa-central", "garage-etapp2-risk": "ao-etapp2", "fortlopande-kontor": "ao-fortlopande-kontor",
    "rond-reservkraft": "rond-reservkraft-ar",
  };
  for (const item of tasks) {
    const order = inOrder[item.id.replace(/^demo-task-/, "")];
    if (order) item.workOrderId = `demo-task-${order}`;
  }
  // Grunduppgifter är gemensamma (2026-10-30): an open task has its work order's project, customer, place, responsible
  // person and dates (a round's occurrences keep their own days), as the server stores them.
  for (const item of tasks) {
    const holder = item.workOrderId ? tasks.find((candidate) => candidate.id === item.workOrderId) : undefined;
    if (!holder || item.status === "COMPLETED" || item.status === "CANCELLED") continue;
    Object.assign(item, inheritFromWorkOrder({ ...item, facilityId: item.facilityId ?? null }, { ...holder, facilityId: holder.facilityId ?? null, roundScheduleId: holder.roundScheduleId ?? null }, { isNew: false }));
  }
  // Time and bookings of a task are its work order's (2026-10-26).
  const ownerOf = (taskId: string) => tasks.find((item) => item.id === taskId)?.workOrderId ?? taskId;
  // Tidplan (Gantt v1, 2026-10-09): a few jobs with a planned start and an estimate, so the project page shows a time plan;
  // the others stay under "Utan datum". The garage control is past its Klart senast and shows as late.
  // The switchgear job starts on Monday next week, the first day of Elis' holiday, so Boka warns about the absence (planning-boka) every weekday.
  const scheduled: Record<string, [start: number, estimatedHours: number]> = {
    "garage-risk": [-20, 4], "garage-matare": [-16, 40], "garage-laddboxar": [-7, 64], "kfid-garage": [-3, 6], "stallverk-brytare": [7 - todayIndex, 16],
  };
  for (const item of tasks) {
    const plan = scheduled[item.id.replace(/^demo-task-/, "")];
    if (plan) { item.plannedStartDate = dayKey(plan[0]); item.estimatedMinutes = plan[1] * 60; }
  }
  // Etapper (plan 1M, 2026-10-11): the garage project's jobs in three stages.
  const stages: Record<string, string> = { "garage-risk": "Förberedelse", "garage-matare": "Installation", "garage-laddboxar": "Installation", "kfid-garage": "Kontroll och överlämning" };
  for (const item of tasks) {
    const stage = stages[item.id.replace(/^demo-task-/, "")];
    if (stage) item.stage = stage;
  }
  // Hinder (plan 1M): the LED job waits for material, a reported obstacle on a job that needs action.
  const waitingJob = tasks.find((item) => item.id === "demo-task-kontor-led");
  if (waitingJob) waitingJob.data = { ...waitingJob.data, obstacle: { reason: "MATERIAL", text: "Armaturerna är försenade från grossisten.", since: rel(-3, 10), byName: name("demo-elis"), previousStatus: "PLANNED" } } as unknown as DemoTaskData;
  // Börjar efter (steg 4): the charge boxes start after the feeder, the control after the charge boxes (arrows in the Tidplan).
  const predecessors: Record<string, string[]> = { "garage-laddboxar": ["garage-matare"], "kfid-garage": ["garage-laddboxar"] };
  for (const item of tasks) {
    const before = predecessors[item.id.replace(/^demo-task-/, "")];
    if (before) item.predecessorIds = before.map((key) => `demo-task-${key}`).filter((id) => tasks.some((entry) => entry.id === id && entry.projectId === item.projectId));
  }
  for (const item of tasks.filter((entry) => entry.projectId)) {
    const owner = projects.find((entry) => entry.id === item.projectId)!;
    owner.events.push({ id: id("event"), kind: "TASK_LINKED", summary: `Uppgiften ${item.title} kopplades till projektet`, taskId: item.id, actorName: name("demo-elin"), createdAt: item.createdAt });
  }

  // Reported time, never in the future: per person and task, weekdays of the last three weeks.
  const timeEntries: DemoTimeEntry[] = [];
  const timeEvents: DemoTimeEvent[] = [];
  const titleOf = (sourceId: string) => tasks.find((item) => item.id === sourceId)?.title ?? projects.find((item) => item.id === sourceId)?.name ?? "";
  // Time written in a task lands on its work order; a project id is project time (Projekttid, 2026-10-26).
  const report = (userId: string, written: string, offset: number, startHour: number, hours: number, note = "", timeTypeId: string | null = null) => {
    const startedAt = rel(offset, startHour);
    const endedAt = new Date(Date.parse(startedAt) + hours * 3600_000).toISOString();
    if (Date.parse(endedAt) > now.getTime()) return;
    const project = projects.some((item) => item.id === written);
    const sourceId = project ? written : ownerOf(written);
    const entry = { id: id("time"), taskId: project ? null : sourceId, ...(project ? { projectId: sourceId } : {}), userId, startedAt, endedAt, durationSec: Math.round(hours * 3600), note, createdAt: endedAt, updatedAt: endedAt, timeTypeId };
    timeEntries.push(entry);
    timeEvents.push({ id: id("time-event"), entryId: entry.id, userId, action: "CREATED", previous: null, next: { taskId: sourceId, taskTitle: titleOf(sourceId), ...(project ? { projectId: sourceId } : {}), startedAt, endedAt, durationSec: entry.durationSec, note }, reason: "", actorUserId: userId, actorName: name(userId), createdAt: endedAt });
  };
  report("demo-elin", "demo-task-garage-risk", -18, 8, 3, "Riskbedömning på plats med fastighetsskötaren");
  for (let offset = -21; offset <= 0; offset++) {
    if (weekday(offset) > 4) continue;
    if (offset <= -8) {
      if (offset >= -15) report("demo-elis", "demo-task-garage-matare", offset, 7, 5, "Kabeldragning");
      report("demo-elis", "demo-task-kontor-led", offset, offset >= -15 ? 12 : 7, offset >= -15 ? 3 : 6, "Plan 2");
    } else {
      report("demo-elis", "demo-task-garage-laddboxar", offset, 7, 5, "Montering laddboxar");
      if (offset % 2 === 0) report("demo-elis", "demo-task-kontor-led", offset, 13, 2, "Restarbeten plan 2");
      // Projekttid (2026-10-26): project management on the project itself, without a work order.
      report("demo-elin", laddplatser.id, offset, 8, 1.5, "Projektledning och kundkontakt");
    }
    if (offset >= -12 && offset <= -4 && offset % 3 === 0) report("demo-elon", "demo-task-kontor-risk", offset, 13, 1.5, "Riskbedömning plan 2");
  }
  // Time after the project's end date is allowed but marked "utanför ramen" (decision 6).
  report("demo-elis", "demo-task-kontor-led", -2, 13, 2.5, "Fästen monterade efter slutdatum");
  // Tidstyper (2026-10-29): some evening work and travel, so the lists and the export show more than one type.
  report("demo-elis", "demo-task-garage-laddboxar", -3, 17, 2, "Kvällsarbete laddboxar", "demo-time-type-overtid");
  report("demo-elon", "demo-task-kfid-stallverk", -3, 6, 1.5, "Resa till ställverket", "demo-time-type-restid");
  report("demo-elon", "demo-task-villa-risk", -15, 8, 1, "Riskbedömning på plats");
  report("demo-elis", "demo-task-villa-central", -13, 7, 8, "Byte av central");
  report("demo-elis", "demo-task-villa-central", -12, 7, 4, "Märkning och slutarbete");
  report("demo-elis", "demo-task-service-trapphus", -10, 13, 1.5);
  // The order Elin has under way (kundresa 2026-11-07, M12: it said 70 % with no time and no material).
  report("demo-elin", "demo-task-service-kopparlunden-trapphus", -1, 13, 2, "Felsökning, skymningsrelä bytt");
  report("demo-elon", "demo-task-kfid-villa", -11, 8, 2.5, "Mätning och protokoll");
  report("demo-elon", "demo-task-kfid-stallverk", -3, 8, 4, "Isolationsmätning påbörjad");
  report("demo-elon", "demo-task-kfid-garage", -1, 8, 3, "Mätning garagecentral");
  // Godkänd månad (2026-10-30): last month reported and approved, so Löneunderlag and PAXml (Bara godkända månader,
  // last month by default) show real rows in the demo.
  const lastMonth = dayKey(-swedishParts(now).day).slice(0, 7);
  for (let offset = -swedishParts(now).day - 31; offset < -swedishParts(now).day + 1; offset++) {
    if (dayKey(offset).slice(0, 7) !== lastMonth || weekday(offset) > 4) continue;
    report("demo-elis", "demo-task-kontor-led", offset, 7, 8, "Plan 1");
    // On the office LED job, like Elis: the villa's work order keeps only its own hours (tests/invoice-basis.browser.cjs).
    report("demo-elon", "demo-task-kontor-led", offset, 7, offset % 5 === 0 ? 6 : 8, "Plan 1, el och belysning");
    if (offset % 5 === 0) report("demo-elon", "demo-task-kfid-stallverk", offset, 6, 2, "Resa till ställverket", "demo-time-type-restid");
    if (offset % 7 === 0) report("demo-elis", "demo-task-kontor-led", offset, 16, 2, "Kvällsarbete plan 1", "demo-time-type-overtid");
    report("demo-elin", laddplatser.id, offset, 8, 2, "Projektledning och kundkontakt");
  }
  const approvedAt = rel(-swedishParts(now).day + 2, 9);
  // Elis and Elon approved by Elin; Elin's own month waits for another approver (nobody approves their own month).
  const timePeriods: DemoTimePeriod[] = [
    ...["demo-elis", "demo-elon"].map((userId) => ({ userId, period: lastMonth, status: "APPROVED" as const, note: "", submittedAt: rel(-swedishParts(now).day + 1, 16), decidedAt: approvedAt, decidedById: "demo-elin" })),
    { userId: "demo-elin", period: lastMonth, status: "SUBMITTED", note: "", submittedAt: rel(-swedishParts(now).day + 1, 17), decidedAt: null, decidedById: null },
  ];
  // Teamet – Just nu (2026-10-29): two people with their time running now, so the team's situation is a real one.
  const running = (userId: string, written: string, minutesAgo: number) => {
    const startedAt = new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    // Time in a task lands on its work order and remembers the task it was started in, as in Cloud.
    const owner = ownerOf(written);
    timeEntries.push({ id: id("time"), taskId: owner, ...(owner !== written ? { sourceTaskId: written } : {}), userId, startedAt, endedAt: null, durationSec: 0, note: "", createdAt: startedAt, updatedAt: startedAt });
  };
  running("demo-elis", "demo-task-garage-laddboxar", 75);
  running("demo-elon", "demo-task-kfid-garage", 40);

  const activity = (key: string, values: Omit<DemoActivity, "id" | "version" | "description" | "deletedAt" | "events" | "assignedToName" | "status" | "workflowTaskId"> & { description?: string; status?: DemoActivity["status"]; workflowTaskId?: string | null }): DemoActivity => ({
    description: "", status: "PLANNED", ...values, workflowTaskId: values.workflowTaskId ? ownerOf(values.workflowTaskId) : null, id: `demo-activity-${key}`, version: 1, deletedAt: null,
    assignedToName: values.assignments.map((assignment) => name(assignment.userId)).join(", "),
    events: [{ id: id("activity-event"), kind: "CREATED", summary: `Planeringen ${values.title} skapades`, actorName: name("demo-elin"), createdAt: rel(-8, 9) }],
  });
  const person = (userId: string): DemoAssignment => ({ userId, plannedMinutes: null, startsAt: null, endsAt: null });
  // The same weekly pattern this week and next, all inside the projects' frames; Elis is double-booked on Wednesdays.
  const activities: DemoActivity[] = [0, 7].flatMap((week) => [
    ...[1, 2, 3].map((day) => activity(`laddbox-${day}-${week}`, { title: week ? "Installation laddboxar, etapp 2" : "Installation laddboxar", kind: "TASK", startsAt: at(week + day, 7), endsAt: at(week + day, 16), projectId: laddplatser.id, workflowTaskId: "demo-task-garage-laddboxar", assignments: [person("demo-elis")] })),
    activity(`byggmote-${week}`, { title: "Byggmöte Brf Kopparlunden", kind: "MEETING", description: "Avstämning med styrelsen om etapp 2 och tillträde till garaget.", startsAt: at(week + 2, 10), endsAt: at(week + 2, 11), projectId: laddplatser.id, assignments: [person("demo-elin"), person("demo-elis")] }),
  ]);
  activities.push(
    activity("stallverk-kontroll", { title: "Isolationsmätning fack 3", kind: "TASK", startsAt: at(3, 8), endsAt: at(3, 12), projectId: stallverk.id, workflowTaskId: "demo-task-kfid-stallverk", assignments: [person("demo-elon")] }),
    activity("stallverk-brytare", { title: "Byte av brytare fack 3", kind: "TASK", description: "Planerat avbrott, driftavdelningen kopplar från 07:00.", startsAt: at(7, 7), endsAt: at(7, 15), projectId: stallverk.id, workflowTaskId: "demo-task-stallverk-brytare", assignments: [person("demo-elis"), { userId: "demo-elon", plannedMinutes: 120, startsAt: at(7, 7), endsAt: at(7, 9) }] }),
    activity("garage-kontroll", { title: "Slutkontroll laddplatser", kind: "TASK", startsAt: at(8, 8), endsAt: at(8, 12), projectId: laddplatser.id, workflowTaskId: "demo-task-kfid-garage", assignments: [person("demo-elon")] }),
    activity("jordfel", { title: "Felsökning jordfelsbrytare", kind: "TASK", startsAt: at(4, 8), endsAt: at(4, 10), projectId: null, workflowTaskId: "demo-task-service-jordfel", assignments: [person("demo-elon")] }),
    activity("slutbesiktning", { title: "Slutbesiktning laddplatser", kind: "DEADLINE", startsAt: at(11, 9), endsAt: at(11, 10), projectId: laddplatser.id, assignments: [person("demo-elin")] }),
    // Elin's day today (Översiktens tidslinje, 2026-10-29): a meeting, her work order in the stairwell and a check-in, so Jag
    // shows a real day.
    activity("elin-morgon", { title: "Morgonsamling", kind: "MEETING", startsAt: rel(0, 7), endsAt: rel(0, 7, 30), projectId: null, assignments: [person("demo-elin"), person("demo-elis"), person("demo-elon")] }),
    activity("elin-trapphus", { title: "Felsökning trapphusbelysning", kind: "TASK", startsAt: rel(0, 9), endsAt: rel(0, 11, 30), projectId: null, workflowTaskId: "demo-task-service-kopparlunden-trapphus", assignments: [person("demo-elin")] }),
    activity("elin-avstamning", { title: "Avstämning offert närvarostyrning", kind: "MEETING", startsAt: rel(0, 13), endsAt: rel(0, 14), projectId: null, assignments: [person("demo-elin")] }),
    // Completed planning in the past: planned against reported time on the task cards.
    activity("led-plan2", { title: "LED-byte plan 2", kind: "TASK", status: "COMPLETED", startsAt: rel(-9, 7), endsAt: rel(-9, 15), projectId: belysning.id, workflowTaskId: "demo-task-kontor-led", assignments: [person("demo-elis")] }),
    activity("central", { title: "Byte av elcentral", kind: "TASK", status: "COMPLETED", startsAt: rel(-13, 7), endsAt: rel(-13, 16), projectId: elcentral.id, workflowTaskId: "demo-task-villa-central", assignments: [person("demo-elis")] }),
  );

  return {
    organization: { id: "demo-organization", name: DEMO_COMPANY, slug: "exempel-el-automation-demo", domain: null, storageMode: "HINTEK_CLOUD", weeklyWorkMinutes: 40 * 60, workdayStartMinutes: 7 * 60, workdayEndMinutes: 16 * 60, absenceRetentionMonths: 12 },
    users, customers, projects, tasks, timeEntries, timeEvents, activities, facilities, timePeriods, maintenanceItems,
    // Tidstyper (2026-10-29): the neutral starting list; the codes are invented examples for the export.
    timeTypes: [
      { id: "demo-time-type-ordinarie", name: "Ordinarie", payrollCode: "ORD", active: true, isDefault: true, sortOrder: 0 },
      { id: "demo-time-type-overtid", name: "Övertid", payrollCode: "OVT", active: true, isDefault: false, sortOrder: 1 },
      { id: "demo-time-type-restid", name: "Restid", payrollCode: "RES", active: true, isDefault: false, sortOrder: 2 },
      { id: "demo-time-type-jour", name: "Jour", payrollCode: "", active: true, isDefault: false, sortOrder: 3 },
    ],
    // Frånvaro (2026-10-29): Elon is sick tomorrow (his booked fault-finding on Friday is touched) and Elis is on holiday
    // Monday–Tuesday next week (his bookings on the charging points are touched), so Teamet shows what to re-plan.
    absences: [
      // The next workday, never a Saturday or Sunday (resa 4, 2026-11-06: "1 borta" stood on a Saturday).
      { id: "demo-absence-elon", userId: "demo-elon", type: "SICK", note: "", from: dayKey(nextWorkday), to: dayKey(nextWorkday), hours: null, createdBy: "demo-elon", createdAt: now.toISOString(), handled: [] },
      { id: "demo-absence-elis", userId: "demo-elis", type: "VACATION", note: "", from: dayKey(7 - todayIndex), to: dayKey(8 - todayIndex), hours: null, createdBy: "demo-elin", createdAt: now.toISOString(), handled: [] },
    ],
    // Workflow's built-in inspection types, the same published forms as in Cloud and Local (2026-09-26).
    // Workflow's originals of the control and the risk assessment are published forms in the demo too (2026-09-28).
    forms: [...BUILTIN_FORMS, ...ROUND_FORMS, kfidForm, riskForm, planningForm].map((form) => ({ id: form.id, version: 1, name: form.meta.displayName || form.meta.name, description: form.meta.description, color: form.meta.color, icon: form.meta.icon, category: form.meta.category, allowStandalone: form.meta.allowStandalone, allowInProject: form.meta.allowInProject, document: form.document })),
    // Invented values (2026-10-06: "demon: påhittade värden"); the rest stay empty so the demo shows both states.
    // The RCD limits stay empty, so the page also shows "Använd förslagen".
    companyValues: [
      { key: "isolation_min", low: 2, high: null, warnLow: null, warnHigh: null, source: "Företagets egen gränsprofil", reference: "Påhittad i demon, version 2026-1", version: 1, updatedAt: rel(-30, 9), updatedByName: "Elin Bergström" },
      { key: "continuity_max", low: null, high: 0.8, warnLow: null, warnHigh: null, source: "Företagets egen gränsprofil", reference: "Påhittad i demon, version 2026-1", version: 1, updatedAt: rel(-30, 9), updatedByName: "Elin Bergström" },
      // Räkneverktyg (2026-10-07): a reactance, a limit for the voltage drop and a small current table, all invented and
      // marked as the company's own, so Kabelarea shows a result (for example 2,5 mm² copper).
      { key: "kabel.reaktans", low: null, high: 0.08, warnLow: null, warnHigh: null, source: "Företagets egna kabeldata", reference: "Påhittad i demon", version: 1, updatedAt: rel(-30, 9), updatedByName: "Elin Bergström" },
      { key: "kabel.spanningsfall_max", low: null, high: 4, warnLow: null, warnHigh: null, source: "Företagets egen gränsprofil", reference: "Påhittad i demon, version 2026-1", version: 1, updatedAt: rel(-30, 9), updatedByName: "Elin Bergström" },
      // Round, plainly invented numbers (the granskning 2026-10-31: the earlier ones lay close to a published table).
      ...([[1.5, 10], [2.5, 15], [4, 20], [6, 25], [10, 35], [16, 45], [25, 60]] as const).map(([area, amps]) => ({ key: ampacityKey(1, "cu", area), low: area, high: amps, warnLow: null, warnHigh: null,
        source: "Företagets egen tabell, kabel i rör", reference: "Påhittad i demon", version: 1, updatedAt: rel(-30, 9), updatedByName: "Elin Bergström" })),
    ].sort((a, b) => a.key.localeCompare(b.key, "sv")),
    // Driftronder are the time rules (2026-10-27 kväll): where they are done comes with the work order that holds them.
    // Veckotillsyn reservkraft is held by its work order at Ställverket for a year; Skyddsrond garaget was planned before then
    // with its own place stored (`legacyPlace`) and has no work order yet – Driftronder offers to make one, filled in from it.
    schedules: [
      { id: "demo-schedule-reservkraft", version: 1, title: "Veckotillsyn reservkraft", templateId: "hintek-reservkraft", templateName: "Reservkraft – tillsyn och prov",
        assignedToUserId: "demo-elon", assignedToName: name("demo-elon"), active: true, rule: { frequency: "WEEKLY", interval: 1, weekdays: [1], startDate: dayKey(-60), endDate: "" }, reminders: { bell: true, email: false } },
      { id: "demo-schedule-skyddsrond", version: 1, title: "Skyddsrond garaget", templateId: "hintek-skyddsrond", templateName: "Skyddsrond",
        assignedToUserId: null, assignedToName: "", active: true, rule: { frequency: "MONTHLY", interval: 1, weekdays: [], startDate: dayKey(-40), endDate: "" }, reminders: { bell: true, email: false },
        // Tillfällig plats (2026-10-08): an invented site hut during the garage's renovation, stored with the round's old place.
        legacyPlace: { customerId: kopparlunden.id, facilityId: garage.id, projectId: null, tempPlace: { address: "Arbetsbod vid infart B", postalCode: "", city: "", latitude: null, longitude: null } } },
      // "Upprepa kontrollen" used on the completed Fortlöpande kontroll: the form's interval (6 months) from the day it was done.
      { ...repeatScheduleDraft({ ...recurring, data: recurring.data as Extract<DemoTaskData, { kind: "FORM" }> }, dayKey(-5)), id: "demo-schedule-fortlopande", version: 1,
        templateName: formById("hintek-fortlopande-kontroll").meta.displayName || formById("hintek-fortlopande-kontroll").meta.name },
    ],
    adminEvents: [
      { id: id("admin"), action: "member_invite", detail: "Elna Lindqvist lades till som arbetsledare med behörigheten Läsa och rapportera, och med Teamet.", createdAt: rel(-40, 10) },
      { id: id("admin"), action: "member_invite", detail: "Elon Strömberg lades till som medarbetare med behörigheten Utföra arbete.", createdAt: rel(-41, 10) },
      { id: id("admin"), action: "member_invite", detail: "Elis Hammarström lades till som medarbetare med behörigheten Utföra arbete.", createdAt: rel(-41, 9) },
      { id: id("admin"), action: "company_save", detail: `Företagsuppgifterna för ${DEMO_COMPANY} uppdaterades.`, createdAt: rel(-42, 15) },
    ],
    preferences: {},
    settings: { companyName: DEMO_COMPANY, contactEmail: "info@exempelel.invalid", logoPath: null, themePrimary: null, reportPrimary: "#0B65C2", reportAccent: "#113351", reportSoft: "#EEF5FA", suggestions: {}, maintenance: true },
    sequence,
  };
}

import type { FacilityItem } from "@/lib/workflow/customer-facility";
import { addSwedishDays, swedishDate, swedishDayKey, swedishMonday, swedishParts } from "@/lib/swedish-time";
import { defaultWorkflowPermissionProfile, workflowPermissionPresets, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { workflowTaskProgress, type FormTaskDetails, type WorkflowTaskKind, type WorkflowTaskStatus } from "@/lib/workflow/task-model";
import { blankControl, newRow, type ControlData, type Measurement, type SectionKey } from "@/lib/kfid/model";
import type { CustomerItem } from "@/features/kfid/types";
import type { FormDocument } from "@/lib/workflow/form-document";
import { BUILTIN_FORMS } from "@/lib/workflow/builtin-forms";
import { ROUND_FORMS } from "@/lib/workflow/builtin-rounds";
import { kfidForm } from "@/lib/workflow/builtin-kfid-form";
import { riskForm } from "@/lib/workflow/builtin-risk-form";

/**
 * Invented demo company for the public /demo (2026-09-26, approved proposal
 * docs/DEMO_DATA_PROPOSAL_20260926.md): "HINTEK Power Solutions AB" with four invented users, three customers with
 * facilities, four projects in different states and all three task types. Everything lives in the visitor's browser
 * memory, is dated relative to today's Swedish date and disappears on reload. No real person, company, address or
 * e-mail address is used (all addresses end in .invalid).
 */
export type DemoUserId = "demo-elin" | "demo-elis" | "demo-elon" | "demo-elna";
export type DemoUser = { id: DemoUserId; name: string; email: string; title: string; role: "ADMIN" | "MEMBER"; permissions: WorkflowPermissionProfile; weeklyWorkMinutes: number | null };
export type DemoTaskData = { kind: "WORK_ORDER"; details: { executionNotes: string; deviations: string; materials: { id: string; name: string; quantity: string; unit: string }[]; signature: { name: string; confirmed: boolean; signedAt: string | null }; closeNotes: string } }
  | { kind: "RISK_ASSESSMENT"; details: { risks: { id: string; hazard: string; likelihood: number; consequence: number; protectiveMeasure: string; residualLikelihood: number; residualConsequence: number }[]; generalMeasures: string; approval: { name: string; confirmed: boolean; approvedAt: string | null } } }
  | { kind: "FORM"; details: FormTaskDetails };
export type DemoRevision = { id: string; version: number; snapshot: Record<string, unknown>; createdAt: string };
export type DemoTask = {
  id: string; kind: WorkflowTaskKind; title: string; description: string; status: WorkflowTaskStatus; projectId: string | null; customerId: string | null;
  siteId: string | null; departmentId: string | null; assignedToUserId: string | null; assignedToName: string; dueDate: string; data: DemoTaskData; facilityId?: string | null;
  version: number; startedAt: string | null; completedAt: string | null; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; revisions: DemoRevision[];
};
/** A control before commissioning (steg 7): read and saved in memory with the same rules and progression as Cloud. */
export type DemoControl = {
  id: string; number: number; title: string; project: string; performer: string; date: string; status: "DRAFT" | "COMPLETED"; version: number;
  deletedAt: string | null; postedAt: null; customerId: string | null; projectId: string | null; facilityId: string | null; siteId: string | null; departmentId: string | null;
  lastOpenedAt: string | null; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; data: ControlData;
  revisions: { id: string; version: number; createdAt: string; createdBy: string; data: ControlData }[];
};
export type DemoProjectEvent = { id: string; kind: string; summary: string; taskId: string | null; actorName: string; createdAt: string };
export type DemoProject = {
  id: string; name: string; description: string; dueDate: string; customerId: string | null; responsibleUserId: string | null; responsibleName: string;
  timeBudgetMinutes: number; archivedAt: string | null; closedAt?: string | null;
  startDate?: string; client?: string; contactPerson?: string; reference?: string; workSite?: string; taskTypes: ("WORK_ORDER" | "RISK_ASSESSMENT" | "COMMISSIONING_CONTROL")[];
  workMoments: ("START_TIME" | "EXECUTION" | "SIGN_REPORT" | "CLOSE_ORDER")[]; createdAt: string; updatedAt: string; events: DemoProjectEvent[];
  decisions?: DemoProjectDecision[];
  facilityId?: string | null;
};
export type DemoFacility = FacilityItem & { version: number };
export type DemoProjectDecision = { id: string; decidedOn: string; text: string; decidedBy: string; actorName: string; createdAt: string };
/** `taskId` is the task's or the control's id; controls only get manual time (decision 13). */
export type DemoTimeEntry = { id: string; taskId: string; userId: string; startedAt: string; endedAt: string | null; durationSec: number; note: string; createdAt: string; updatedAt: string };
export type DemoTimeEvent = { id: string; entryId: string; userId: string; action: "CREATED" | "UPDATED" | "DELETED"; previous: unknown; next: unknown; reason: string; actorUserId: string; actorName: string; createdAt: string };
export type DemoAssignment = { userId: string; plannedMinutes: number | null; startsAt: string | null; endsAt: string | null };
export type DemoActivity = {
  id: string; version: number; title: string; description: string; kind: "TASK" | "MEETING" | "DEADLINE" | "OTHER"; status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  startsAt: string; endsAt: string; projectId: string | null; workflowTaskId: string | null; controlId: string | null; assignedToName: string; assignments: DemoAssignment[];
  deletedAt: string | null; events: { id: string; kind: string; summary: string; actorName: string; createdAt: string }[];
};
export type DemoSite = { id: string; name: string; isActive: boolean; departments: { id: string; name: string; isActive: boolean }[] };
export type DemoAdminEvent = { id: string; action: string; detail: string; createdAt: string };
export type DemoDatabase = {
  organization: { id: string; name: string; slug: string; domain: null; storageMode: "HINTEK_CLOUD"; weeklyWorkMinutes: number };
  users: DemoUser[]; customers: CustomerItem[]; projects: DemoProject[]; tasks: DemoTask[]; controls: DemoControl[]; timeEntries: DemoTimeEntry[]; timeEvents: DemoTimeEvent[];
  activities: DemoActivity[]; sites: DemoSite[]; adminEvents: DemoAdminEvent[]; preferences: Record<string, Record<string, unknown>>;
  facilities: DemoFacility[];
  /** Published forms from HINTEK (the form builder); the demo cannot build or publish its own. */
  forms: { id: string; version: number; name: string; description: string; color: string; icon: string; category: string; allowStandalone: boolean; allowInProject: boolean; document: FormDocument }[];
  settings: { companyName: string; contactEmail: string; logoPath: null; themePrimary: null; reportPrimary: string; reportAccent: string; reportSoft: string; suggestions: Record<string, string[]> };
  sequence: number;
};

export const DEMO_COMPANY = "HINTEK Power Solutions AB";
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

  const users: DemoUser[] = [
    { id: "demo-elin", name: "Elin Bergström", email: "elin.bergstrom@hintekpower.invalid", title: "Företagsadministratör och projektledare", role: "ADMIN", permissions: defaultWorkflowPermissionProfile(), weeklyWorkMinutes: null },
    { id: "demo-elis", name: "Elis Hammarström", email: "elis.hammarstrom@hintekpower.invalid", title: "Elektriker", role: "MEMBER", permissions: field, weeklyWorkMinutes: null },
    { id: "demo-elon", name: "Elon Strömberg", email: "elon.stromberg@hintekpower.invalid", title: "Elektriker och kontrollant, 80 procent", role: "MEMBER", permissions: field, weeklyWorkMinutes: 32 * 60 },
    { id: "demo-elna", name: "Elna Bergström", email: "elna.bergstrom@hintekpower.invalid", title: "Arbetsledare, läser och rapporterar", role: "MEMBER", permissions: readAndReport, weeklyWorkMinutes: null },
  ];
  const name = (userId: string) => users.find((user) => user.id === userId)?.name ?? "";

  const customer = (key: string, values: Partial<CustomerItem>): CustomerItem => ({ id: `demo-customer-${key}`, name: "", company: "", address: "", postalCode: "", city: "Elstad", email: "", phone: "", mobile: "", lat: null, lng: null, notes: "", version: 1, deletedAt: null, ...values });
  const customers = [
    customer("kopparlunden", { name: "Brf Kopparlunden", company: "Brf Kopparlunden", address: "Elvägen 4", postalCode: "123 41", email: "styrelsen@kopparlunden.invalid", notes: "Kontakt via styrelsen. Nyckel till garaget kvitteras hos fastighetsskötaren." }),
    customer("stromkraft", { name: "Strömkraft Fastigheter AB", company: "Strömkraft Fastigheter AB", address: "Strömgatan 18", postalCode: "123 42", email: "drift@stromkraft.invalid", notes: "Kontorsfastighet i fyra plan och eget ställverk. Arbete i ställverket bokas med driftavdelningen." }),
    customer("voltberg", { name: "Villa Voltberg", company: "Privatkund", address: "Spänningsvägen 7", postalCode: "123 47", email: "villa.voltberg@exempel.invalid" }),
  ];
  const [kopparlunden, stromkraft, voltberg] = customers;
  const facility = (key: string, customerId: string, values: Partial<DemoFacility>): DemoFacility => ({ id: `demo-facility-${key}`, customerId, name: "", address: "", postalCode: "", city: "Elstad", description: "", isActive: true, version: 1, ...values });
  const facilities = [
    facility("garage", kopparlunden.id, { name: "Garage Elvägen 4", address: "Elvägen 4", postalCode: "123 41", description: "Garage i två plan med 24 platser." }),
    facility("undercentral", kopparlunden.id, { name: "Undercentral hus B", address: "Elvägen 6", postalCode: "123 41" }),
    facility("kontorshuset", stromkraft.id, { name: "Kontorshuset Strömgatan 18", address: "Strömgatan 18", postalCode: "123 42", description: "Kontor plan 1–4." }),
    facility("stallverk", stromkraft.id, { name: "Ställverk S1", address: "Strömgatan 18", postalCode: "123 42", description: "Mellanspänningsställverk i källaren. Tillträde endast med driftavdelningen." }),
    facility("villan", voltberg.id, { name: "Villan Spänningsvägen 7", address: "Spänningsvägen 7", postalCode: "123 47" }),
  ];
  const [garage, , kontorshuset, stallverket, villan] = facilities;
  const sites: DemoSite[] = [
    { id: "demo-site-elstad", name: "Elstad", isActive: true, departments: [{ id: "demo-dept-installation", name: "Installation", isActive: true }, { id: "demo-dept-service", name: "Service", isActive: true }] },
    { id: "demo-site-stromsund", name: "Strömsund", isActive: true, departments: [{ id: "demo-dept-stromsund-service", name: "Service", isActive: true }] },
  ];

  const project = (key: string, created: number, values: Omit<DemoProject, "id" | "archivedAt" | "taskTypes" | "workMoments" | "createdAt" | "updatedAt" | "events" | "responsibleName">): DemoProject => ({
    id: `demo-project-${key}`, archivedAt: null, taskTypes: [], workMoments: [], createdAt: rel(created, 8), updatedAt: rel(Math.max(created, -1), 9),
    responsibleName: name(values.responsibleUserId ?? ""), events: [{ id: id("event"), kind: "CREATED", summary: "Projektet skapades", taskId: null, actorName: name("demo-elin"), createdAt: rel(created, 8) }], ...values,
  });
  const projects = [
    // Pågår and follows its frame: all three task types, planning inside the frame, reported time and two decisions.
    project("laddplatser", -22, { name: "Laddplatser i garaget", description: "Tolv laddplatser med lastbalansering, ny matarkabel och egen central i garaget.", startDate: dayKey(-21), dueDate: dayKey(21), customerId: kopparlunden.id, facilityId: garage.id, responsibleUserId: "demo-elin", timeBudgetMinutes: 80 * 60,
      client: "Brf Kopparlunden", contactPerson: "Styrelsens ordförande", reference: "BRF-2026-014", workSite: "Garage plan –1, Elvägen 4", decisions: [
        { id: id("decision"), decidedOn: dayKey(-18), text: "Laddboxar med lastbalansering väljs framför fast effektbegränsning.", decidedBy: "Brf Kopparlundens styrelse", actorName: name("demo-elin"), createdAt: rel(-18, 16) },
        { id: id("decision"), decidedOn: dayKey(-6), text: "Etapp 2 (plats 7–12) utförs efter byggmötet, när garaget är tömt på bilar.", decidedBy: "Elin Bergström och styrelsen", actorName: name("demo-elin"), createdAt: rel(-6, 15) },
      ] }),
    // Försenat: the end date has passed, high budget usage, one work order needs action and time reported after the end.
    project("belysning", -36, { name: "Belysningsbyte kontor", description: "Byte till LED-armaturer med närvarostyrning på plan 2.", startDate: dayKey(-35), dueDate: dayKey(-3), customerId: stromkraft.id, facilityId: kontorshuset.id, responsibleUserId: "demo-elin", timeBudgetMinutes: 36 * 60,
      client: "Strömkraft Fastigheter AB", contactPerson: "Driftchef", reference: "SK-4711", workSite: "Plan 2, Strömgatan 18" }),
    // Ligger efter: little is done while most of the frame has passed; the control is under way.
    project("stallverk", -29, { name: "Revision ställverk S1", description: "Byte av brytare i fack 3 och kontroll före idrifttagning av ställverket.", startDate: dayKey(-28), dueDate: dayKey(14), customerId: stromkraft.id, facilityId: stallverket.id, responsibleUserId: "demo-elin", timeBudgetMinutes: 40 * 60,
      client: "Strömkraft Fastigheter AB", contactPerson: "Driftchef", reference: "SK-4730", workSite: "Ställverk S1, källaren" }),
    // Klar att avsluta: every task is completed and no planning is active.
    project("elcentral", -29, { name: "Ny elcentral", description: "Byte av gammal proppcentral till ny central med jordfelsbrytare och överspänningsskydd.", startDate: dayKey(-28), dueDate: dayKey(-7), customerId: voltberg.id, facilityId: villan.id, responsibleUserId: "demo-elis", timeBudgetMinutes: 16 * 60,
      client: "Villa Voltberg", workSite: "Tvättstugan, Spänningsvägen 7" }),
  ];
  const [laddplatser, belysning, stallverk, elcentral] = projects;

  const workOrder = (details: Partial<Extract<DemoTaskData, { kind: "WORK_ORDER" }>["details"]>): DemoTaskData => ({ kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "", ...details } });
  const risk = (hazard: string, likelihood: number, consequence: number, protectiveMeasure: string, residualLikelihood: number, residualConsequence: number) => ({ id: crypto.randomUUID(), hazard, likelihood, consequence, protectiveMeasure, residualLikelihood, residualConsequence });
  const riskAssessment = (risks: ReturnType<typeof risk>[], approval = { name: "", confirmed: false, approvedAt: null as string | null }, generalMeasures = ""): DemoTaskData => ({ kind: "RISK_ASSESSMENT", details: { risks, generalMeasures, approval } });
  const material = (materialName: string, quantity: string, unit: string) => ({ id: crypto.randomUUID(), name: materialName, quantity, unit });
  type TaskValues = Omit<DemoTask, "id" | "version" | "revisions" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "startedAt" | "completedAt" | "siteId" | "departmentId" | "assignedToName" | "description" | "customerId" | "facilityId"> & { description?: string; created?: number; updated?: number; completed?: number; customerId?: string | null; facilityId?: string | null };
  const task = (key: string, values: TaskValues): DemoTask => {
    const { created = -10, updated = -1, completed, ...rest } = values;
    const owner = projects.find((entry) => entry.id === rest.projectId);
    const record: DemoTask = {
      description: "", siteId: "demo-site-elstad", departmentId: rest.projectId ? "demo-dept-installation" : "demo-dept-service", customerId: owner?.customerId ?? null, facilityId: owner?.facilityId ?? null,
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
        risk("Anslutning i spänningssatt fördelningscentral", 2, 5, "Frånkoppling, spänningsprovning och låsning enligt ESA", 1, 4),
      ], { name: "Elin Bergström", confirmed: true, approvedAt: rel(-17, 15) }, "Arbetet samordnas med fastighetsskötaren. Informationslapp i trapphusen dagen före.") }),
    task("garage-matare", { kind: "WORK_ORDER", title: "Dragning av matarkabel", status: "COMPLETED", projectId: laddplatser.id, assignedToUserId: "demo-elis", dueDate: dayKey(-8), created: -16, completed: -8,
      data: workOrder({ executionNotes: "Matarkabel EKKJ 4x95/50 dragen från fastighetens huvudcentral till ny garagecentral, 64 m på kabelstege. Isolationsmätt och märkt i båda ändar.", materials: [material("EKKJ 4x95/50", "64", "m"), material("Kabelstege 300 mm", "18", "m"), material("Kabelskor 95 mm²", "8", "st")], signature: signed("demo-elis", -8), closeNotes: "Klart för anslutning av laddboxar." }) }),
    task("garage-laddboxar", { kind: "WORK_ORDER", title: "Installation av laddboxar plan –1", status: "IN_PROGRESS", projectId: laddplatser.id, assignedToUserId: "demo-elis", dueDate: dayKey(14), created: -7,
      description: "Montera och anslut tolv laddboxar med lastbalansering. Konfiguration av appen görs av leverantören.",
      data: workOrder({ executionNotes: "Plats 1–6 monterade och anslutna. Lastbalanseringsmätaren installerad i garagecentralen.", materials: [material("Laddbox 11 kW", "6", "st"), material("Kabel EQLQ 5G6", "84", "m")] }) }),
    task("kontor-led", { kind: "WORK_ORDER", title: "LED-armaturer plan 2", status: "NEEDS_ACTION", projectId: belysning.id, assignedToUserId: "demo-elis", dueDate: dayKey(-4), created: -30,
      data: workOrder({ executionNotes: "32 av 40 armaturer bytta. Närvarogivare monterade i korridor och mötesrum.", deviations: "Åtta armaturer i undertaket saknar fästen som passar. Nya fästen är beställda och leveransen väntas.", materials: [material("LED-panel 600x600", "32", "st"), material("Närvarogivare", "6", "st")] }) }),
    task("kontor-risk", { kind: "RISK_ASSESSMENT", title: "Arbete på stege och i undertak", status: "IN_PROGRESS", projectId: belysning.id, assignedToUserId: "demo-elon", dueDate: dayKey(-25), created: -30,
      data: riskAssessment([risk("Fall från stege vid arbete i undertak", 3, 3, "Plattformsstege och arbete två och två", 2, 2), risk("Damm och fibrer från undertaksplattor", 3, 2, "", 3, 2)]) }),
    task("stallverk-brytare", { kind: "WORK_ORDER", title: "Byte av brytare fack 3", status: "PLANNED", projectId: stallverk.id, assignedToUserId: "demo-elis", dueDate: dayKey(12), created: -20,
      description: "Byte av effektbrytare i fack 3 under planerat avbrott. Driftavdelningen kopplar från och jordar.", data: workOrder({ materials: [material("Effektbrytare 630 A", "1", "st")] }) }),
    task("villa-central", { kind: "WORK_ORDER", title: "Byte av central med jordfelsbrytare", status: "COMPLETED", projectId: elcentral.id, assignedToUserId: "demo-elis", dueDate: dayKey(-12), created: -26, completed: -12,
      description: "Ersätt proppcentral med ny central, jordfelsbrytare typ A och överspänningsskydd.",
      data: workOrder({ executionNotes: "Ny central monterad i tvättstugan. Alla grupper flyttade och märkta. Överspänningsskydd installerat.", materials: [material("Normcentral 36 moduler", "1", "st"), material("Jordfelsbrytare 40 A typ A", "2", "st"), material("Överspänningsskydd typ 2", "1", "st")], signature: signed("demo-elis", -12), closeNotes: "Kunden informerad om provning av jordfelsbrytare två gånger per år." }) }),
    task("villa-risk", { kind: "RISK_ASSESSMENT", title: "Byte av central i bostad", status: "COMPLETED", projectId: elcentral.id, assignedToUserId: "demo-elon", dueDate: dayKey(-14), created: -26, completed: -14,
      data: riskAssessment([risk("Arbete nära spänningsförande delar vid omkoppling", 2, 5, "Huvudbrytare frånslagen, spänningsprovning och låsning", 1, 4), risk("Boende i huset under arbetet", 2, 2, "Avspärrning av tvättstugan och information till kunden", 1, 1)],
        { name: "Elon Strömberg", confirmed: true, approvedAt: rel(-14, 15) }) }),
    // Standalone work: not every job is a project.
    task("service-jordfel", { kind: "WORK_ORDER", title: "Felsökning jordfelsbrytare, Villa Voltberg", status: "PLANNED", projectId: null, customerId: voltberg.id, facilityId: villan.id, assignedToUserId: "demo-elon", dueDate: dayKey(4), created: -2,
      description: "Jordfelsbrytaren löser ut sporadiskt på kvällarna. Kunden misstänker utebelysningen.", data: workOrder({}) }),
    task("service-trapphus", { kind: "WORK_ORDER", title: "Byte av trasig armatur i trapphus", status: "COMPLETED", projectId: null, customerId: kopparlunden.id, facilityId: null, assignedToUserId: "demo-elis", dueDate: dayKey(-9), created: -11, completed: -10,
      data: workOrder({ executionNotes: "Armaturen i trapphus B plan 3 bytt mot LED med rörelsevakt.", materials: [material("LED-armatur med rörelsevakt", "1", "st")], signature: signed("demo-elis", -10) }) }),
  ];
  for (const item of tasks.filter((entry) => entry.projectId)) {
    const owner = projects.find((entry) => entry.id === item.projectId)!;
    owner.events.push({ id: id("event"), kind: "TASK_LINKED", summary: `Uppgiften ${item.title} kopplades till projektet`, taskId: item.id, actorName: name("demo-elin"), createdAt: item.createdAt });
  }

  // Controls before commissioning, with real measurement rows so the shared rules compute their progression.
  const row = (section: SectionKey, values: Record<string, Measurement[string]>): Measurement => ({ ...newRow(section), ...values });
  const control = (key: string, number: number, values: { title: string; projectId: string; performer: DemoUserId; date: number; status: DemoControl["status"]; created: number; updated: number; data: (base: ControlData) => void }): DemoControl => {
    const owner = projects.find((entry) => entry.id === values.projectId)!;
    const client = customers.find((entry) => entry.id === owner.customerId)!;
    const data = blankControl();
    Object.assign(data.meta, { proj: `${owner.name}, ${facilities.find((entry) => entry.id === owner.facilityId)?.name ?? ""}`, perf: name(values.performer), date: dayKey(values.date), client: client.name, addr: client.email, instr: "Installationstestare IT-200", sn: "DEMO-200-01", cal: dayKey(-120), autoOn: true, name: values.title });
    values.data(data);
    const record: DemoControl = {
      id: `demo-control-${key}`, number, title: values.title, project: data.meta.proj, performer: data.meta.perf, date: data.meta.date, status: values.status, version: 1, deletedAt: null, postedAt: null,
      customerId: owner.customerId, projectId: owner.id, facilityId: owner.facilityId ?? null, siteId: "demo-site-elstad", departmentId: "demo-dept-installation", lastOpenedAt: rel(values.updated, 14),
      createdBy: values.performer, updatedBy: values.performer, createdAt: rel(values.created, 8), updatedAt: rel(values.updated, 14), data, revisions: [],
    };
    record.revisions = [{ id: id("control-revision"), version: 1, createdAt: record.updatedAt, createdBy: values.performer, data: structuredClone(data) }];
    owner.events.push({ id: id("event"), kind: "TASK_LINKED", summary: `Kontrollen ${values.title} kopplades till projektet`, taskId: record.id, actorName: name("demo-elin"), createdAt: record.createdAt });
    return record;
  };
  const allVisualChecks = { markning: true, dok: true, mek: true, ip: true };
  const controls: DemoControl[] = [
    // Every requirement is met but it is not completed yet, so the 95 % cap is visible.
    control("garage", 1, { title: "Kontroll före idrifttagning, garagecentral", projectId: laddplatser.id, performer: "demo-elon", date: -1, status: "DRAFT", created: -3, updated: -1, data: (data) => {
      data.active = { iso: true, cont: true, volt: false, rcd: true, vis: true };
      data.iso.rows = [row("iso", { objekt: "Matarkabel garagecentral", u: "500 V", mohm: 250, limit: 1 }), row("iso", { objekt: "Laddgrupp plats 1–6", u: "500 V", mohm: 180, limit: 1 })];
      data.cont.rows = [row("cont", { name: "PE garagecentral – huvudcentral", ohm: 0.12, limit: 0.5 })];
      data.rcd.rows = [1, 2, 3].map((place) => row("rcd", { place: `Laddbox plats ${place}`, std: "EN", type: "A", idn: 30, idp: 21, idn_measured: 22, t1p: 24 + place, t1n: 26 + place, t5p: 12, t5n: 14, uc: 2, ntrip05: true, btnok: true }));
      data.vis.checks = { ...allVisualChecks };
    } }),
    // Under way with measurements left to do, in a project that is behind its frame.
    control("stallverk", 2, { title: "Kontroll före idrifttagning, fack 3", projectId: stallverk.id, performer: "demo-elon", date: -3, status: "DRAFT", created: -5, updated: -3, data: (data) => {
      data.active = { iso: true, cont: true, volt: true, rcd: false, vis: true };
      data.iso.rows = [row("iso", { objekt: "Fack 3 utgående kabel", u: "1000 V", mohm: "", limit: 1 })];
      data.volt.rows = [row("volt", { name: "Fack 3 samlingsskena", status: "Ej mätt" })];
    } }),
    control("villa", 3, { title: "Kontroll före idrifttagning, ny central", projectId: elcentral.id, performer: "demo-elon", date: -11, status: "COMPLETED", created: -12, updated: -11, data: (data) => {
      data.active = { iso: true, cont: true, volt: true, rcd: true, vis: true };
      data.meta.ctrl = "Elin Bergström";
      data.iso.rows = [row("iso", { objekt: "Samtliga grupper", u: "500 V", mohm: 120, limit: 1 })];
      data.cont.rows = [row("cont", { name: "Skyddsledare huvudjordskena", ohm: 0.08, limit: 0.5 })];
      data.volt.rows = [row("volt", { name: "Inkommande matning", status: "400 Vac", rotation: "Höger" })];
      data.rcd.rows = [row("rcd", { place: "JFB 1 bostad", std: "EN", type: "A", idn: 30, idp: 20, idn_measured: 21, t1p: 22, t1n: 24, t5p: 11, t5n: 12, uc: 1, ntrip05: true, btnok: true })];
      data.vis.checks = { ...allVisualChecks };
    } }),
  ];

  // Reported time, never in the future: per person and task, weekdays of the last three weeks.
  const timeEntries: DemoTimeEntry[] = [];
  const timeEvents: DemoTimeEvent[] = [];
  const titleOf = (sourceId: string) => tasks.find((item) => item.id === sourceId)?.title ?? controls.find((item) => item.id === sourceId)?.title ?? "";
  const report = (userId: string, sourceId: string, offset: number, startHour: number, hours: number, note = "") => {
    const startedAt = rel(offset, startHour);
    const endedAt = new Date(Date.parse(startedAt) + hours * 3600_000).toISOString();
    if (Date.parse(endedAt) > now.getTime()) return;
    const entry = { id: id("time"), taskId: sourceId, userId, startedAt, endedAt, durationSec: Math.round(hours * 3600), note, createdAt: endedAt, updatedAt: endedAt };
    timeEntries.push(entry);
    timeEvents.push({ id: id("time-event"), entryId: entry.id, userId, action: "CREATED", previous: null, next: { taskId: sourceId, taskTitle: titleOf(sourceId), startedAt, endedAt, durationSec: entry.durationSec, note }, reason: "", actorUserId: userId, actorName: name(userId), createdAt: endedAt });
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
      report("demo-elin", "demo-task-garage-laddboxar", offset, 8, 1.5, "Planering och kundkontakt");
    }
    if (offset >= -12 && offset <= -4 && offset % 3 === 0) report("demo-elon", "demo-task-kontor-risk", offset, 13, 1.5, "Riskbedömning plan 2");
  }
  // Time after the project's end date is allowed but marked "utanför ramen" (decision 6).
  report("demo-elis", "demo-task-kontor-led", -2, 13, 2.5, "Fästen monterade efter slutdatum");
  report("demo-elon", "demo-task-villa-risk", -15, 8, 1, "Riskbedömning på plats");
  report("demo-elis", "demo-task-villa-central", -13, 7, 8, "Byte av central");
  report("demo-elis", "demo-task-villa-central", -12, 7, 4, "Märkning och slutarbete");
  report("demo-elis", "demo-task-service-trapphus", -10, 13, 1.5);
  // Manual time on controls (decision 13): controls have no start/pause.
  report("demo-elon", "demo-control-villa", -11, 8, 2.5, "Mätning och protokoll");
  report("demo-elon", "demo-control-stallverk", -3, 8, 4, "Isolationsmätning påbörjad");
  report("demo-elon", "demo-control-garage", -1, 8, 3, "Mätning garagecentral");

  const activity = (key: string, values: Omit<DemoActivity, "id" | "version" | "description" | "controlId" | "deletedAt" | "events" | "assignedToName" | "status" | "workflowTaskId"> & { description?: string; status?: DemoActivity["status"]; workflowTaskId?: string | null; controlId?: string | null }): DemoActivity => ({
    description: "", status: "PLANNED", workflowTaskId: null, controlId: null, ...values, id: `demo-activity-${key}`, version: 1, deletedAt: null,
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
    activity("stallverk-kontroll", { title: "Isolationsmätning fack 3", kind: "TASK", startsAt: at(3, 8), endsAt: at(3, 12), projectId: stallverk.id, controlId: "demo-control-stallverk", assignments: [person("demo-elon")] }),
    activity("stallverk-brytare", { title: "Byte av brytare fack 3", kind: "TASK", description: "Planerat avbrott, driftavdelningen kopplar från 07:00.", startsAt: at(7, 7), endsAt: at(7, 15), projectId: stallverk.id, workflowTaskId: "demo-task-stallverk-brytare", assignments: [person("demo-elis"), { userId: "demo-elon", plannedMinutes: 120, startsAt: at(7, 7), endsAt: at(7, 9) }] }),
    activity("garage-kontroll", { title: "Slutkontroll laddplatser", kind: "TASK", startsAt: at(8, 8), endsAt: at(8, 12), projectId: laddplatser.id, controlId: "demo-control-garage", assignments: [person("demo-elon")] }),
    activity("jordfel", { title: "Felsökning jordfelsbrytare", kind: "TASK", startsAt: at(4, 8), endsAt: at(4, 10), projectId: null, workflowTaskId: "demo-task-service-jordfel", assignments: [person("demo-elon")] }),
    activity("slutbesiktning", { title: "Slutbesiktning laddplatser", kind: "DEADLINE", startsAt: at(11, 9), endsAt: at(11, 10), projectId: laddplatser.id, assignments: [person("demo-elin")] }),
    // Completed planning in the past: planned against reported time on the task cards.
    activity("led-plan2", { title: "LED-byte plan 2", kind: "TASK", status: "COMPLETED", startsAt: rel(-9, 7), endsAt: rel(-9, 15), projectId: belysning.id, workflowTaskId: "demo-task-kontor-led", assignments: [person("demo-elis")] }),
    activity("central", { title: "Byte av elcentral", kind: "TASK", status: "COMPLETED", startsAt: rel(-13, 7), endsAt: rel(-13, 16), projectId: elcentral.id, workflowTaskId: "demo-task-villa-central", assignments: [person("demo-elis")] }),
  );

  return {
    organization: { id: "demo-organization", name: DEMO_COMPANY, slug: "hintek-power-solutions-demo", domain: null, storageMode: "HINTEK_CLOUD", weeklyWorkMinutes: 40 * 60 },
    users, customers, projects, tasks, controls, timeEntries, timeEvents, activities, sites, facilities,
    // HINTEK's built-in inspection types, the same published forms as in Cloud and Local (2026-09-26).
    // HINTEK's originals of the control and the risk assessment are published forms in the demo too (2026-09-28).
    forms: [...BUILTIN_FORMS, ...ROUND_FORMS, kfidForm, riskForm].map((form) => ({ id: form.id, version: 1, name: form.meta.displayName || form.meta.name, description: form.meta.description, color: form.meta.color, icon: form.meta.icon, category: form.meta.category, allowStandalone: form.meta.allowStandalone, allowInProject: form.meta.allowInProject, document: form.document })),
    adminEvents: [
      { id: id("admin"), action: "member_invite", detail: "Elna Bergström lades till som arbetsledare med behörigheten Läsa och rapportera.", createdAt: rel(-40, 10) },
      { id: id("admin"), action: "member_invite", detail: "Elon Strömberg lades till som medarbetare med behörigheten Utföra arbete.", createdAt: rel(-41, 10) },
      { id: id("admin"), action: "member_invite", detail: "Elis Hammarström lades till som medarbetare med behörigheten Utföra arbete.", createdAt: rel(-41, 9) },
      { id: id("admin"), action: "company_save", detail: `Företagsuppgifterna för ${DEMO_COMPANY} uppdaterades.`, createdAt: rel(-42, 15) },
    ],
    preferences: {},
    settings: { companyName: DEMO_COMPANY, contactEmail: "info@hintekpower.invalid", logoPath: null, themePrimary: null, reportPrimary: "#0B65C2", reportAccent: "#113351", reportSoft: "#EEF5FA", suggestions: {} },
    sequence,
  };
}

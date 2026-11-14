import { DEVIATION_TYPES, deviationType, isIncidentType } from "@/lib/self-inspection/incidents";
import { userPersonHref } from "@/lib/workflow/users-list";
import { PLACE_KIND_LABELS, placeKindOf, placeName } from "@/lib/workflow/customer-facility";
import { archiveKindLabel } from "@/lib/workflow/report-archive";
import type { SearchCandidate, SearchField, SearchState } from "./types";
import { customerContact, customerTitle } from "@/lib/kfid/customer-name";

/**
 * One description per kind of record (2026-10-05): which fields Sök looks in, how much each counts, what the
 * hit shows and where it leads. Used by the server, the Local file and the demo alike, so all three find the same.
 */
const TASK_STATUS_LABELS: Record<string, string> = { PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått", DRAFT: "Utkast", POSTED: "Skickad" };
const TASK_STATUS_KEYS: Record<string, string> = { PLANNED: "planned", IN_PROGRESS: "in_progress", PAUSED: "paused", NEEDS_ACTION: "needs_action", COMPLETED: "done", CANCELLED: "cancelled" };
export const taskStatusLabel = (status: string) => TASK_STATUS_LABELS[status] ?? "";
export function taskKindLabel(kind: string, templateName?: string | null) {
  if (kind === "WORK_ORDER") return "Arbetsorder";
  if (kind === "RISK_ASSESSMENT") return "Riskbedömning";
  return templateName?.trim() || "Protokoll";
}
const join = (...parts: (string | null | undefined | false)[]) => parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
const field = (label: string, text: string | null | undefined, weight: SearchField["weight"]): SearchField => ({ label, text: text ?? "", weight });
const e = encodeURIComponent;

export type TaskSearchInput = {
  id: string; kind: string; title: string; description?: string | null; status: string; assignedToName?: string | null;
  assignedToUserId?: string | null; createdBy?: string | null; updatedAt?: string | Date | null; templateName?: string | null;
  projectName?: string | null; customerName?: string | null; placePath?: string | null; bodyText?: string | null; guaranteed?: boolean;
  /** The task's temporary place as one line (Tillfällig plats, 2026-10-08): found like a place, also by plats:. */
  tempPlace?: string | null;
  /** Hör till arbetsorder (Fas 2): the work order's title, so the task is found by it too (Fas 4B). */
  workOrderTitle?: string | null;
};
export function taskCandidate(task: TaskSearchInput, me: string | null): SearchCandidate {
  const kind = taskKindLabel(task.kind, task.templateName);
  const done = task.status === "COMPLETED";
  return {
    type: "task", id: task.id, kind: task.kind, title: task.title,
    subtitle: join(kind, taskStatusLabel(task.status), task.assignedToName, task.projectName || task.customerName),
    href: `/?view=workflow_task&taskId=${e(task.id)}&taskType=${e(task.kind)}`,
    fields: [
      field("Rubrik", task.title, "title"), field("Typ", `${kind}${task.kind === "FORM" ? " protokoll" : ""}`, "meta"),
      field("Ansvarig", task.assignedToName, "meta"), field("Projekt", task.projectName, "meta"), field("Hör till arbetsorder", task.workOrderTitle, "meta"), field("Kund", task.customerName, "meta"),
      field("Plats", task.placePath, "path"), field("Tillfällig plats", task.tempPlace, "path"), field("Beskrivning", task.description, "body"), field("Innehåll", task.bodyText, "body"),
    ],
    updatedAt: task.updatedAt, state: done || task.status === "CANCELLED" ? "done" : "open",
    statusKeys: [TASK_STATUS_KEYS[task.status] ?? "", done || task.status === "CANCELLED" ? "" : "open"].filter(Boolean),
    mine: Boolean(me && (task.assignedToUserId === me || (!task.assignedToUserId && task.createdBy === me))),
    customerText: task.customerName ?? "", placeText: join(task.placePath, task.tempPlace), guaranteed: task.guaranteed,
  };
}

export type ProjectSearchInput = {
  id: string; name: string; description?: string | null; client?: string | null; reference?: string | null; workSite?: string | null;
  contactPerson?: string | null; responsibleName?: string | null; responsibleUserId?: string | null; createdBy?: string | null;
  archivedAt?: string | Date | null; closedAt?: string | Date | null; updatedAt?: string | Date | null; customerName?: string | null; placePath?: string | null; guaranteed?: boolean;
};
export function projectCandidate(project: ProjectSearchInput, me: string | null): SearchCandidate {
  const state: SearchState = project.archivedAt ? "archived" : project.closedAt ? "done" : "open";
  return {
    type: "project", id: project.id, title: project.name,
    subtitle: join(state === "archived" ? "Arkiverat" : state === "done" ? "Avslutat" : "Projekt", project.customerName || project.client, project.responsibleName),
    href: `/?view=project&projectId=${e(project.id)}`,
    fields: [
      field("Namn", project.name, "title"), field("Referens", project.reference, "code"), field("Kund", project.customerName, "meta"),
      field("Beställare", project.client, "meta"), field("Ansvarig", project.responsibleName, "meta"), field("Kontaktperson", project.contactPerson, "meta"),
      field("Plats", project.placePath, "path"), field("Arbetsplats", project.workSite, "path"), field("Beskrivning", project.description, "body"),
    ],
    updatedAt: project.updatedAt, state, statusKeys: [state],
    mine: Boolean(me && (project.responsibleUserId === me || (!project.responsibleUserId && project.createdBy === me))),
    customerText: [project.customerName, project.client].filter(Boolean).join(" "), placeText: [project.placePath, project.workSite].filter(Boolean).join(" "), guaranteed: project.guaranteed,
  };
}

export type QuoteSearchInput = {
  id: string; number: number; version: number; title: string; description?: string | null; status: string; validUntil?: string | null;
  customerName?: string | null; projectName?: string | null; placePath?: string | null; createdBy?: string | null; updatedAt?: string | Date | null; guaranteed?: boolean;
};
const QUOTE_STATUS_TEXT: Record<string, string> = { DRAFT: "Utkast", SENT: "Skickad", ACCEPTED: "Accepterad", DECLINED: "Avböjd", EXPIRED: "Utgången" };
/** Offert (2026-10-09): found by its title, number (O-0012), customer, project and place; opens the quote. */
export function quoteCandidate(quote: QuoteSearchInput, me: string | null): SearchCandidate {
  const number = `O-${String(quote.number).padStart(4, "0")}${quote.version > 1 ? ` v${quote.version}` : ""}`;
  const open = quote.status === "DRAFT" || quote.status === "SENT";
  return {
    type: "quote", id: quote.id, title: quote.title,
    subtitle: join(number, QUOTE_STATUS_TEXT[quote.status], quote.customerName, quote.projectName),
    href: `/?view=quote&quoteId=${e(quote.id)}`,
    fields: [
      field("Rubrik", quote.title, "title"), field("Nummer", `${number} offert ${quote.number}`, "code"), field("Typ", "offert", "meta"),
      field("Kund", quote.customerName, "meta"), field("Projekt", quote.projectName, "meta"), field("Plats", quote.placePath, "path"), field("Omfattning", quote.description, "body"),
    ],
    updatedAt: quote.updatedAt, state: open ? "open" : quote.status === "ACCEPTED" ? "done" : "archived",
    statusKeys: [open ? "open" : quote.status === "ACCEPTED" ? "done" : "archived"],
    mine: Boolean(me && quote.createdBy === me),
    customerText: quote.customerName ?? "", placeText: quote.placePath ?? "", guaranteed: quote.guaranteed,
  };
}

export type InvoiceBasisSearchInput = {
  id: string; number: number; title: string; status: string; customerName?: string | null;
  /** The job the basis is made on, or its project; the hit opens that page, where the basis is (Fakturaunderlag panel). */
  taskId?: string | null; taskKind?: string | null; taskTitle?: string | null; projectId?: string | null; projectName?: string | null;
  createdBy?: string | null; updatedAt?: string | Date | null; guaranteed?: boolean;
};
/** F-0002 (simulation 0.6.3: an invoice basis could not be found by its number). */
export const invoiceBasisNumber = (number: number) => `F-${String(number).padStart(4, "0")}`;
/** Fakturaunderlag (2026-10-10): found by its number (F-0002), title, customer, job and project; opens the job or project. */
export function invoiceBasisCandidate(basis: InvoiceBasisSearchInput, me: string | null): SearchCandidate {
  const number = invoiceBasisNumber(basis.number);
  const invoiced = basis.status === "INVOICED";
  const href = basis.taskId ? `/?view=workflow_task&taskId=${e(basis.taskId)}&taskType=${e(basis.taskKind || "WORK_ORDER")}` : `/?view=project&projectId=${e(basis.projectId ?? "")}`;
  return {
    type: "invoice_basis", id: basis.id, title: basis.title || number,
    subtitle: join(number, invoiced ? "Fakturerat" : "Utkast", basis.customerName, basis.taskTitle || basis.projectName),
    href,
    fields: [
      field("Rubrik", basis.title, "title"), field("Nummer", `${number} fakturaunderlag ${basis.number}`, "code"), field("Typ", "fakturaunderlag faktura", "meta"),
      field("Kund", basis.customerName, "meta"), field("Jobb", basis.taskTitle, "meta"), field("Projekt", basis.projectName, "meta"),
    ],
    updatedAt: basis.updatedAt, state: invoiced ? "done" : "open", statusKeys: [invoiced ? "done" : "open"],
    mine: Boolean(me && basis.createdBy === me),
    customerText: basis.customerName ?? "", guaranteed: basis.guaranteed,
  };
}

export type CustomerSearchInput = {
  id: string; name: string; company?: string | null; customerType?: string | null; address?: string | null; postalCode?: string | null; city?: string | null;
  email?: string | null; phone?: string | null; mobile?: string | null; notes?: string | null; updatedAt?: string | Date | null; guaranteed?: boolean;
};
export function customerCandidate(customer: CustomerSearchInput): SearchCandidate {
  return {
    type: "customer", id: customer.id, title: customerTitle(customer),
    subtitle: join(customerContact(customer), customer.city, customer.phone || customer.mobile || customer.email),
    href: `/?view=customers&customerId=${e(customer.id)}`,
    fields: [
      field("Namn", customer.name, "title"), field("Företag", customer.company, "title"),
      field("Telefon", [customer.phone, customer.mobile].filter(Boolean).join(" "), "code"), field("E-post", customer.email, "meta"),
      field("Adress", [customer.address, customer.postalCode, customer.city].filter(Boolean).join(" "), "path"), field("Anteckningar", customer.notes, "body"),
    ],
    updatedAt: customer.updatedAt, state: "open",
    customerText: [customer.name, customer.company].filter(Boolean).join(" "), guaranteed: customer.guaranteed,
  };
}

export type PlaceSearchInput = {
  id: string; customerId: string; name: string; kind?: string | null; description?: string | null; isActive: boolean;
  /** The way above the place, from the customer: "Kund › Anläggning › Byggnad". */
  parentPath: string; customerName?: string | null; address?: string | null; city?: string | null; updatedAt?: string | Date | null; guaranteed?: boolean;
};
/** A place: its name, and the whole way above it (Platser, 2026-10-04). In Local the customer card. */
export function placeCandidate(place: PlaceSearchInput, local: boolean): SearchCandidate {
  const title = placeName({ name: place.name });
  const kind = PLACE_KIND_LABELS[placeKindOf(place)];
  const fullPath = [place.parentPath, title].filter(Boolean).join(" › ");
  return {
    type: "place", id: place.id, title,
    subtitle: join(kind, place.parentPath, !place.isActive && "Pausad"),
    href: local ? `/?view=customers&customerId=${e(place.customerId)}` : `/?view=place&placeId=${e(place.id)}`,
    fields: [
      field("Namn", place.name, "title"), field("Väg", place.parentPath, "path"), field("Typ", kind, "meta"),
      field("Adress", [place.address, place.city].filter(Boolean).join(" "), "path"), field("Beskrivning", place.description, "body"),
    ],
    updatedAt: place.updatedAt, state: place.isActive ? "open" : "archived", statusKeys: [place.isActive ? "open" : "archived"],
    customerText: place.customerName ?? "", placeText: fullPath, guaranteed: place.guaranteed,
  };
}

export type RoundSearchInput = {
  id: string; title: string; templateName?: string | null; customerName?: string | null; placePath?: string | null; projectName?: string | null;
  assignedToName?: string | null; assignedToUserId?: string | null; active: boolean; updatedAt?: string | Date | null; guaranteed?: boolean;
};
export function roundCandidate(round: RoundSearchInput, me: string | null): SearchCandidate {
  return {
    type: "round", id: round.id, title: round.title,
    subtitle: join(round.templateName, round.placePath || round.customerName, round.assignedToName, !round.active && "Pausad"),
    href: "/?view=rounds",
    fields: [
      field("Namn", round.title, "title"), field("Formulär", round.templateName, "meta"), field("Typ", "driftrond rond", "meta"),
      field("Kund", round.customerName, "meta"), field("Projekt", round.projectName, "meta"), field("Ansvarig", round.assignedToName, "meta"), field("Plats", round.placePath, "path"),
    ],
    updatedAt: round.updatedAt, state: round.active ? "open" : "archived", statusKeys: [round.active ? "open" : "paused"],
    mine: Boolean(me && round.assignedToUserId === me),
    customerText: round.customerName ?? "", placeText: round.placePath ?? "", guaranteed: round.guaranteed,
  };
}

export type FormSearchInput = { id: string; name: string; description?: string | null; category?: string | null; publisher?: string | null };
/** A published form: opens a new protocol from it (the same as its card under Ny uppgift). */
export function formCandidate(form: FormSearchInput): SearchCandidate {
  return {
    type: "form", id: form.id, title: form.name, subtitle: join("Ny uppgift", form.publisher),
    href: `/?view=workflow_task&taskType=FORM&formId=${e(form.id)}`,
    fields: [field("Namn", form.name, "title"), field("Beskrivning", form.description, "body"), field("Utgivare", form.publisher, "meta")],
    state: "open",
  };
}

export type DeviationSearchInput = { id: string; number: number; type?: string | null; kind?: string | null; title: string; status: string; dueDate?: string | null; description?: string | null; action?: string | null; updatedAt?: string | Date | null; mine?: boolean };
/** An entry of Avvikelser (N16, 2026-11-01): opens the entry; who may read it is decided by the query (lib/search/sql.ts). */
export function deviationCandidate(entry: DeviationSearchInput): SearchCandidate {
  const type = entry.kind === "IMPROVEMENT" ? "Förbättring" : isIncidentType(entry.type) ? DEVIATION_TYPES[deviationType(entry.type)] : "Avvikelse";
  const done = entry.status === "DONE";
  return {
    type: "deviation", id: entry.id, title: entry.title,
    subtitle: join(`${type} ${entry.number}`, done ? "Åtgärdad" : entry.status === "IN_PROGRESS" ? "Pågår" : "Öppen", !done && entry.dueDate ? `Klart senast ${entry.dueDate}` : ""),
    href: `/?view=deviations&deviation=${e(entry.id)}`,
    fields: [field("Rubrik", entry.title, "title"), field("Typ", `${type} avvikelse`, "meta"), field("Nummer", String(entry.number), "code"), field("Beskrivning", entry.description, "body"), field("Åtgärd", entry.action, "body")],
    updatedAt: entry.updatedAt, mine: entry.mine, state: done ? "done" : "open", statusKeys: done ? ["done"] : entry.status === "IN_PROGRESS" ? ["open", "in_progress"] : ["open"],
  };
}

export type MachineSearchInput = { id: string; name: string; partType?: string | null; marking?: string | null; notes?: string | null; isActive?: boolean; updatedAt?: string | Date | null };
/** A machine or part in Underhåll's tree (N16, 2026-11-01): opens the part. */
export function machineCandidate(part: MachineSearchInput): SearchCandidate {
  return {
    type: "machine", id: part.id, title: part.name,
    subtitle: join(part.partType, part.marking, part.isActive === false ? "Pausad" : ""),
    href: `/?view=maintenance&part=${e(part.id)}`,
    fields: [field("Namn", part.name, "title"), field("Märkning", part.marking, "code"), field("Typ", `${part.partType ?? ""} maskin`, "meta"), field("Anteckningar", part.notes, "body")],
    updatedAt: part.updatedAt, state: part.isActive === false ? "archived" : "open", statusKeys: part.isActive === false ? ["archived"] : ["open"],
  };
}

export type PersonSearchInput = { id: string; name: string; email?: string | null; role?: string | null };
/** A colleague, for a company admin: opens the person's own page under Användare. */
export function personCandidate(person: PersonSearchInput): SearchCandidate {
  return {
    type: "person", id: person.id, title: person.name || person.email || "",
    subtitle: join(person.email !== person.name && person.email, person.role === "ADMIN" || person.role === "OWNER" ? "Administratör" : "Medarbetare"),
    href: userPersonHref(person.id),
    fields: [field("Namn", person.name, "title"), field("E-post", person.email, "code")],
    state: "open",
  };
}

export type ReportSearchInput = {
  id: string; kind: string; title: string; format: string; filename?: string | null; size?: number | null; createdAt: string | Date;
  createdByName?: string | null; customerName?: string | null; projectName?: string | null; placePath?: string | null; mine?: boolean; guaranteed?: boolean;
};
const SWEDISH_ZONE = "Europe/Stockholm";
/** A saved report's day as people write it: 2026-10-12 and 12 oktober 2026, so a date typed either way finds it. */
export function reportDateText(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const iso = new Intl.DateTimeFormat("sv-SE", { timeZone: SWEDISH_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const long = new Intl.DateTimeFormat("sv-SE", { timeZone: SWEDISH_ZONE, year: "numeric", month: "long", day: "numeric" }).format(date);
  return `${iso} ${long}`;
}
/**
 * Sparad rapport (Rapportarkivet, 2026-10-12): the PDF or Excel report somebody kept when exporting. Found by title,
 * kind (arbetsorder, riskbedömning, protokoll, projektrapport), customer, project, place and the day it was kept; the hit
 * opens the file itself (PDF in the viewer, Excel as a download). The server only lists what the person may read in the
 * Rapportarkiv; Local has no archive.
 */
export function reportCandidate(report: ReportSearchInput): SearchCandidate {
  const kind = archiveKindLabel(report.kind);
  const format = report.format === "XLSX" ? "Excel" : "PDF";
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: SWEDISH_ZONE, dateStyle: "medium" }).format(new Date(report.createdAt));
  const inline = report.format === "XLSX" ? "" : "?inline=1";
  return {
    type: "report", id: report.id, title: report.title,
    subtitle: join(`${kind}, ${format}`, report.customerName || report.projectName, `sparad ${day}`),
    href: `/api/report-archive/${e(report.id)}${inline}`,
    fields: [
      field("Rubrik", report.title, "title"), field("Typ", `${kind} rapport ${format} ${report.format === "XLSX" ? "xlsx" : "pdf"}${report.kind === "FORM" ? " protokoll" : ""}`, "meta"),
      field("Kund", report.customerName, "meta"), field("Projekt", report.projectName, "meta"), field("Sparad av", report.createdByName, "meta"),
      field("Plats", report.placePath, "path"), field("Datum", reportDateText(report.createdAt), "code"), field("Filnamn", report.filename, "body"),
    ],
    updatedAt: report.createdAt, mine: report.mine, customerText: report.customerName ?? "", placeText: report.placePath ?? "", guaranteed: report.guaranteed,
  };
}

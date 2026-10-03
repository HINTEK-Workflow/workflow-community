// The Import page's rule engine (2026-10-01: "en allmän uppladdningssida som är AI-driven … både regel- och
// AI-styrd, så den automatiskt känner av vad det är för innehåll och var det ska sparas; vid osäkerhet kommer frågor
// upp som man klickar på"). Pure functions: a file that the server has already read (a table, a text, a JSON) is
// classified by its columns and words, its columns are mapped to Workflow's fields, and the rows become the inputs of
// the same tools the API, MCP and Workflow AI use. Nothing here touches the database; the AI only refines this.

import { importColumn, importControlPoints, type ImportResult } from "@/lib/workflow/form-import";

export const IMPORT_TARGETS = ["customers", "projects", "work_orders", "planning", "control_points", "forms_file", "control_file", "hwf_file", "work_order_text", "attachment", "unknown"] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export const TARGET_LABEL: Record<ImportTarget, string> = {
  customers: "Kunder till kundregistret", projects: "Projekt", work_orders: "Arbetsordrar", planning: "Planerade aktiviteter", control_points: "Kontrollpunkter till ett formulär",
  forms_file: "Formulär (fil från Workflow)", control_file: "Kontroll före idrifttagning (JSON-fil)", hwf_file: "Lokal arbetsyta (.hwf)", work_order_text: "En arbetsorder av texten", attachment: "Bilaga på en uppgift", unknown: "Vet inte – fråga mig",
};

/** A file as the server read it: a table (headers and rows), a text, a JSON document, or something only AI or a person can read. */
export type ExtractedFile = {
  name: string; mimeType: string; size: number;
  kind: "table" | "text" | "json" | "binary";
  headers?: string[]; rows?: string[][]; sheet?: string;
  text?: string;
  /** What the AI read out of a free text (2026-10-01): control points (section, title) or work orders (title, description, date). */
  aiRows?: { section: string; title: string; description: string; date: string }[];
  json?: unknown;
};

export type FieldSpec = { key: string; label: string; required?: boolean; aliases: string[]; kind?: "date" | "datetime" | "text" };
type TableTarget = "customers" | "projects" | "work_orders" | "planning";

/** Workflow's fields per kind of import and the column names people use for them (Swedish first, English too). */
export const TARGET_FIELDS: Record<TableTarget, FieldSpec[]> = {
  customers: [
    { key: "name", label: "Namn", required: true, aliases: ["namn", "kund", "kundnamn", "kontakt", "kontaktperson", "name", "customer", "contact"] },
    { key: "company", label: "Företag", aliases: ["företag", "foretag", "bolag", "company", "organisation", "org"] },
    { key: "email", label: "E-post", aliases: ["e-post", "epost", "email", "e-mail", "mail", "mejl"] },
    { key: "phone", label: "Telefon", aliases: ["telefon", "tel", "phone", "telefonnummer"] },
    { key: "mobile", label: "Mobil", aliases: ["mobil", "mobile", "mobilnummer", "mobiltelefon"] },
    { key: "address", label: "Adress", aliases: ["adress", "gatuadress", "address", "gata", "besöksadress"] },
    { key: "postalCode", label: "Postnummer", aliases: ["postnummer", "postnr", "zip", "postal code", "postcode"] },
    { key: "city", label: "Ort", aliases: ["ort", "stad", "city", "postort"] },
    { key: "notes", label: "Anteckningar", aliases: ["anteckningar", "noteringar", "notes", "kommentar", "övrigt", "info"] },
  ],
  projects: [
    { key: "name", label: "Projektnamn", required: true, aliases: ["projekt", "projektnamn", "namn", "name", "project", "projektbenämning", "benämning", "uppdrag", "uppdragsnamn", "projektbeteckning"] },
    { key: "startDate", label: "Startdatum", kind: "date", aliases: ["start", "startdatum", "från", "fran", "start date", "påbörjas"] },
    { key: "dueDate", label: "Slutdatum", kind: "date", aliases: ["slut", "slutdatum", "klart", "klart senast", "ska vara klart", "deadline", "till", "due", "due date", "färdigt", "färdigställs"] },
    { key: "customer", label: "Kund", aliases: ["kund", "customer", "beställare", "bestallare", "kundnamn"] },
    { key: "description", label: "Beskrivning", aliases: ["beskrivning", "description", "arbetsbeskrivning", "omfattning"] },
    { key: "workSite", label: "Arbetsplats", aliases: ["arbetsplats", "plats", "anläggning", "anlaggning", "site", "adress", "objekt"] },
    { key: "reference", label: "Referens", aliases: ["referens", "ref", "ordernummer", "order", "ordernr", "projektnummer", "nr", "nummer"] },
    { key: "responsible", label: "Ansvarig", aliases: ["ansvarig", "projektledare", "projektansvarig", "responsible", "platschef", "arbetsledare"] },
  ],
  work_orders: [
    { key: "title", label: "Rubrik", required: true, aliases: ["rubrik", "titel", "arbetsorder", "uppgift", "title", "subject", "ärende", "arende", "arbete", "benämning"] },
    { key: "description", label: "Beskrivning", aliases: ["beskrivning", "description", "beställning", "bestallning", "uppdrag", "omfattning", "text"] },
    { key: "dueDate", label: "Klart senast", kind: "date", aliases: ["klart senast", "klart", "deadline", "datum", "due", "senast", "slutdatum"] },
    { key: "project", label: "Projekt", aliases: ["projekt", "project", "projektnamn"] },
    { key: "customer", label: "Kund", aliases: ["kund", "customer", "beställare", "bestallare"] },
    { key: "assignee", label: "Ansvarig", aliases: ["ansvarig", "utförare", "utforare", "tilldelad", "montör", "montor", "assignee"] },
    { key: "executionNotes", label: "Utfört arbete", aliases: ["utfört arbete", "utfort arbete", "utfört", "åtgärd", "atgard", "utförande"] },
  ],
  planning: [
    { key: "title", label: "Aktivitet", required: true, aliases: ["aktivitet", "titel", "rubrik", "title", "vad", "arbete", "uppgift", "möte"] },
    { key: "date", label: "Datum", kind: "date", aliases: ["datum", "date", "dag"] },
    { key: "startsAt", label: "Start", kind: "datetime", aliases: ["start", "starttid", "från", "fran", "börjar", "kl", "tid"] },
    { key: "endsAt", label: "Slut", kind: "datetime", aliases: ["slut", "sluttid", "till", "slutar", "stopp"] },
    { key: "project", label: "Projekt", aliases: ["projekt", "project"] },
    { key: "description", label: "Beskrivning", aliases: ["beskrivning", "description", "kommentar", "anteckning"] },
  ],
};

export type Question = { id: string; text: string; kind: "target" | "mapping" | "text"; options: { value: string; label: string }[] };
export type Candidate = { target: ImportTarget; confidence: number };
export type Detection = {
  target: ImportTarget; confidence: number; reasons: string[];
  /** Workflow field → column header (table files). */
  mapping: Record<string, string | null>;
  candidates: Candidate[];
  questions: Question[];
  rowCount: number;
};

export const normalizeHeader = (header: string) => header.toLowerCase().normalize("NFC").replace(/[*:()]/g, " ").replace(/[_\-/]+/g, " ").replace(/\s+/g, " ").trim();

/** The column a field is read from: an exact alias first, then a header that contains the alias as a whole word. */
function matchHeader(spec: FieldSpec, headers: string[], taken: Set<string>) {
  const normalized = headers.map((header) => [header, normalizeHeader(header)] as const);
  // Aliases are normalized like the headers, so "E-post" meets "e post" and "Klart senast:" meets "klart senast".
  const aliases = spec.aliases.map(normalizeHeader);
  for (const alias of aliases) {
    const exact = normalized.find(([raw, plain]) => plain === alias && !taken.has(raw));
    if (exact) return exact[0];
  }
  for (const alias of aliases) {
    if (alias.length < 4) continue;
    const partial = normalized.find(([raw, plain]) => !taken.has(raw) && new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(plain));
    if (partial) return partial[0];
  }
  return null;
}

/** Maps a target's fields to a table's headers; a header is used for one field only. */
export function mapColumns(target: TableTarget, headers: string[]): Record<string, string | null> {
  const taken = new Set<string>();
  const mapping: Record<string, string | null> = {};
  // Required fields pick first, so "namn" goes to the customer's name before anything else.
  const specs = [...TARGET_FIELDS[target]].sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)));
  for (const spec of specs) { const header = matchHeader(spec, headers, taken); mapping[spec.key] = header; if (header) taken.add(header); }
  return mapping;
}

const HINT_WORDS: Record<TableTarget | "control_points", RegExp> = {
  customers: /kund|customer|kontakt|register/i, projects: /projekt|project/i, work_orders: /arbetsorder|work ?order|uppdrag|ärende/i, planning: /planering|kalender|schema|bokning|aktivitet/i, control_points: /kontrollpunkt|checklista|rond|protokoll|punkter/i,
};

/** How well a table fits a kind of import: the required field, the share of fields found, and a hint in the file's name. */
export function scoreTarget(target: TableTarget, headers: string[], fileName = "", sheet = ""): { score: number; mapping: Record<string, string | null>; reasons: string[] } {
  const mapping = mapColumns(target, headers);
  const specs = TARGET_FIELDS[target];
  const matched = specs.filter((spec) => mapping[spec.key]);
  const required = specs.filter((spec) => spec.required).every((spec) => mapping[spec.key]);
  const reasons: string[] = [];
  let score = 0;
  if (required) { score += 0.35; reasons.push(`kolumnen ${specs.filter((spec) => spec.required).map((spec) => mapping[spec.key]).join(", ")} finns`); }
  score += 0.5 * (matched.length / specs.length);
  if (matched.length > 1) reasons.push(`${matched.length} av ${specs.length} fält känns igen (${matched.map((spec) => spec.label).join(", ")})`);
  if (HINT_WORDS[target].test(`${fileName} ${sheet}`)) { score += 0.2; reasons.push("filnamnet eller bladet antyder det"); }
  // Distinguishing columns weigh extra: dates for projects and planning, a customer's e-mail or postal code.
  if (target === "projects" && mapping.startDate && mapping.dueDate) score += 0.15;
  if (target === "planning" && (mapping.startsAt || mapping.date)) score += 0.1;
  if (target === "customers" && (mapping.email || mapping.postalCode || mapping.phone)) score += 0.15;
  if (target === "work_orders" && (mapping.executionNotes || mapping.assignee)) score += 0.1;
  return { score: Math.min(1, score), mapping, reasons };
}

const CHECK_LINE = /^\s*(\d+([.)]|\s*[-–:]\s)|[•\-–*☐□■]\s|\[\s?\]\s)/;

/** A labelled line of a report ("Kund: …", "Adress: …"): data about the report, never a point or an action. */
const LABEL_LINE = /^[\p{L} /-]{2,30}:\s*\S/u;
/** A requirement written as a sentence: "… ska …", or one starting with what to do ("Kontrollera …", "Mät …"). */
const REQUIREMENT = /^(kontrollera|kontrollmät|mät|prova|provtryck|testa|verifiera|säkerställ|granska|inspektera|bedöm|notera|dokumentera)\s|\s(ska|skall|bör|måste)\s/i;
/** A date in a line, ÅÅÅÅ-MM-DD (other ways of writing dates are left to the AI). */
const LINE_DATE = /(?<!\d)(20\d{2}-\d{2}-\d{2})(?!\d)/;

/**
 * Lines of a text that read as points of a checklist: numbered, bulleted or with a box. A report that writes its
 * points as sentences ("Centralen ska vara märkt …") is read from its requirement sentences when it has fewer than
 * three numbered points (2026-10-01: an inspection report in Word only gave "Vad innehåller filen?"). Labelled lines
 * and dated actions are never points.
 */
export function textToControlPoints(text: string): Record<string, string>[] {
  const read = (accept: (line: string) => boolean) => {
    let section = "";
    const rows: Record<string, string>[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (accept(line)) rows.push({ avsnitt_namn: section, kontrollpunkt: line.replace(CHECK_LINE, "").trim(), svarstyp: "bedomning" });
      // A short line without a full stop between points names the next section.
      else if (line.length <= 80 && !/[.!?]$/.test(line) && !LABEL_LINE.test(line)) section = line.replace(/:$/, "");
    }
    return rows.filter((row) => row.kontrollpunkt.length > 1);
  };
  const numbered = read((line) => CHECK_LINE.test(line));
  if (numbered.length >= 3) return numbered;
  const sentences = read((line) => (CHECK_LINE.test(line) || (REQUIREMENT.test(line) && /[.!]$/.test(line))) && !LABEL_LINE.test(line) && !LINE_DATE.test(line));
  return sentences.length > numbered.length ? sentences : numbered;
}

/**
 * Actions with a date in a report ("… ska bytas senast 2026-10-20."), one work order each (2026-10-01: a service
 * report's remaining work came in as one long work order). The date becomes Klart senast, the sentence without it
 * the title.
 */
export function textToWorkOrderRows(text: string): { section: string; title: string; description: string; date: string }[] {
  let section = "";
  const rows: { section: string; title: string; description: string; date: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const date = LINE_DATE.exec(line)?.[1];
    if (date && !LABEL_LINE.test(line)) {
      const title = line.replace(CHECK_LINE, "").replace(/\s*,?\s*(senast|före|innan|till)?\s*20\d{2}-\d{2}-\d{2}\.?/i, "").replace(/[.,;:]$/, "").trim();
      rows.push({ section, title: title.length > 120 ? `${title.slice(0, 117)}…` : title, description: line, date });
    } else if (line.length <= 80 && !/[.!?]$/.test(line) && !LABEL_LINE.test(line)) section = line.replace(/:$/, "");
  }
  return rows.filter((row) => row.title.length > 3);
}

const targetQuestion = (candidates: Candidate[], extra: ImportTarget[] = []): Question => {
  const seen = new Set<ImportTarget>();
  const options = [...candidates.map((item) => item.target), ...extra, "unknown" as const].filter((target) => (seen.has(target) ? false : (seen.add(target), true)));
  return { id: "target", kind: "target", text: "Vad innehåller filen?", options: options.map((target) => ({ value: target, label: TARGET_LABEL[target] })) };
};

/** Classifies a file: what it is, how sure the rules are, and the questions a person has to answer when they are not. */
export function detectImport(file: ExtractedFile): Detection {
  const base = { mapping: {}, questions: [] as Question[], rowCount: 0 };
  if (file.kind === "json") {
    const json = file.json as { format?: string; version?: unknown; schema?: unknown; forms?: unknown } | null;
    if (json && typeof json === "object" && json.format === "hintek-workflow-forms") return { ...base, target: "forms_file", confidence: 1, reasons: ["en formulärfil från HINTEK Workflow"], candidates: [{ target: "forms_file", confidence: 1 }] };
    // A single control exported as JSON (the envelope, or an older file with the control's own meta).
    const record = json && typeof json === "object" ? json as Record<string, unknown> : null;
    const meta = (value: unknown) => Boolean(value && typeof value === "object" && "meta" in (value as object) && typeof (value as { meta: unknown }).meta === "object");
    if (record && !("controls" in record) && (record.format === "KFID_CONTROL" || meta(record) || meta(record.data)))
      return { ...base, target: "control_file", confidence: 1, reasons: ["en kontroll exporterad som JSON"], candidates: [{ target: "control_file", confidence: 1 }] };
    if (/\.(hwf|kfid)$/i.test(file.name) || (json && typeof json === "object" && "schema" in json && ("controls" in json || "customers" in json)))
      return { ...base, target: "hwf_file", confidence: 1, reasons: ["en lokal Workflow-arbetsyta"], candidates: [{ target: "hwf_file", confidence: 1 }] };
    return { ...base, target: "unknown", confidence: 0, reasons: ["okänd JSON"], candidates: [], questions: [targetQuestion([], ["attachment"])] };
  }
  if (file.kind === "binary") {
    const reasons = [/pdf/i.test(file.mimeType) ? "en PDF utan läsbar text" : /image/i.test(file.mimeType) ? "en bild" : "en fil som inte kan läsas som tabell eller text"];
    return { ...base, target: "attachment", confidence: 0.8, reasons, candidates: [{ target: "attachment", confidence: 0.8 }], questions: [] };
  }
  if (file.kind === "text") {
    const text = file.text ?? "";
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const points = textToControlPoints(text);
    const checklistShare = lines.length ? points.length / lines.length : 0;
    const candidates: Candidate[] = [];
    if (points.length >= 3) candidates.push({ target: "control_points", confidence: Math.min(0.95, 0.4 + checklistShare) });
    const actions = textToWorkOrderRows(text);
    if (actions.length >= 2) candidates.push({ target: "work_order_text", confidence: Math.min(0.9, 0.6 + actions.length * 0.1) });
    else if (/arbetsorder|utför|beställning|uppdrag|åtgärd|montera|installera|byt|reparera/i.test(text)) candidates.push({ target: "work_order_text", confidence: points.length >= 3 ? 0.4 : 0.6 });
    candidates.sort((a, b) => b.confidence - a.confidence);
    const top = candidates[0];
    const sure = top && top.confidence >= 0.7 && (!candidates[1] || top.confidence - candidates[1].confidence >= 0.2);
    // A long document where only a small, incidental share of lines look like points (2026-10-02: a manufacturer's
    // manual read as "136 rader ser ut som kontrollpunkter") is a reference document, not a checklist or a report –
    // it goes straight to Bilaga without asking AI to confirm what the rules can already tell.
    if (!sure && lines.length >= 150 && (!top || top.confidence < 0.55))
      return { ...base, rowCount: points.length, target: "attachment", confidence: 0.75, reasons: ["lång löpande text utan tydlig checklista eller arbetsorder"], candidates: [{ target: "attachment", confidence: 0.75 }, ...candidates], questions: [] };
    return {
      ...base, rowCount: points.length,
      target: sure ? top.target : "unknown", confidence: top?.confidence ?? 0,
      reasons: [points.length >= 3 ? `${points.length} rader ser ut som kontrollpunkter` : "", actions.length >= 2 ? `${actions.length} åtgärder med datum` : "", /arbetsorder|uppdrag|beställning/i.test(text) ? "texten nämner ett uppdrag" : ""].filter(Boolean),
      candidates, questions: sure ? [] : [targetQuestion(candidates, ["work_order_text", "control_points", "attachment"])],
    };
  }
  // A table: which kind of list, by its columns.
  const headers = file.headers ?? [];
  const rowCount = file.rows?.length ?? 0;
  if (headers.some((header) => importColumn(header) === "kontrollpunkt"))
    return { ...base, rowCount, target: "control_points", confidence: 0.95, reasons: ["kolumnen kontrollpunkt finns"], candidates: [{ target: "control_points", confidence: 0.95 }], questions: [] };
  const scored = (Object.keys(TARGET_FIELDS) as TableTarget[]).map((target) => ({ target, ...scoreTarget(target, headers, file.name, file.sheet) })).sort((a, b) => b.score - a.score);
  const candidates: Candidate[] = scored.filter((item) => item.score >= 0.2).map((item) => ({ target: item.target, confidence: Math.round(item.score * 100) / 100 }));
  const top = scored[0];
  // The kind is only sure when its required column is found too (2026-10-01: "Uppdrag" was not read as the project's
  // name, and three rows were planned without one).
  const requiredFound = TARGET_FIELDS[top.target].filter((spec) => spec.required).every((spec) => top.mapping[spec.key]);
  const sure = requiredFound && top.score >= 0.6 && (top.score - scored[1].score >= 0.2 || top.score >= 0.9);
  return {
    rowCount, mapping: top.mapping, candidates,
    target: sure ? top.target : "unknown", confidence: Math.round(top.score * 100) / 100,
    reasons: top.score >= 0.2 ? top.reasons : ["inga kolumner känns igen"],
    questions: sure ? [] : [targetQuestion(candidates, ["customers", "projects", "work_orders", "planning", "control_points"])],
  };
}

// ---------- values ----------
const MONTHS: Record<string, number> = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, mars: 3, apr: 4, april: 4, maj: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, augusti: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12 };
const pad = (value: number) => String(value).padStart(2, "0");
const valid = (year: number, month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2100 ? `${year}-${pad(month)}-${pad(day)}` : null;

/** A date as people and spreadsheets write it → ÅÅÅÅ-MM-DD: 2026-10-01, 1/10/2026, 1.10.2026, 1 okt 2026, 20261001 and Excel's serial numbers. */
export function normalizeDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (value > 20000 && value < 80000) { const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000); return valid(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()); }
    value = String(value);
  }
  const text = value.trim();
  if (!text) return null;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (match) return valid(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (match) return valid(Number(match[3]), Number(match[2]), Number(match[1]));
  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/.exec(text);
  if (match) return valid(2000 + Number(match[3]), Number(match[2]), Number(match[1]));
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return valid(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})\.?\s+([a-zåäö]+)\.?\s+(\d{4})$/i.exec(text);
  if (match && MONTHS[match[2].toLowerCase()]) return valid(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]));
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) return normalizeDate(serial);
  return null;
}

/** A time of day → HH:MM (08:00, 8.00, 8, 0800). */
export function normalizeTime(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") { if (value >= 0 && value < 1) { const minutes = Math.round(value * 1440); return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`; } value = String(value); }
  const text = value.trim();
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?$/.exec(text) ?? /(\d{1,2}):(\d{2})/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]); const minute = Number(match[2] ?? 0);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : null;
}

/** A date and a time in a cell or two → a Swedish local date-time text "ÅÅÅÅ-MM-DDTHH:MM". */
export function normalizeDateTime(value: string | number | null | undefined, fallbackDate: string | null = null, fallbackTime = "08:00"): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  const both = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/.exec(text) ?? /^(.+?)\s+(\d{1,2}[:.]\d{2})$/.exec(text);
  if (both) { const date = normalizeDate(both[1]); const time = normalizeTime(both[2]); return date && time ? `${date}T${time}` : null; }
  const date = normalizeDate(text);
  if (date) return `${date}T${fallbackTime}`;
  const time = normalizeTime(text);
  return time && fallbackDate ? `${fallbackDate}T${time}` : null;
}

// ---------- the plan ----------
export type PlanItem = {
  index: number;
  kind: "customer" | "project" | "work_order" | "planned_activity";
  /** A short name of the row, for the preview and the result. */
  title: string;
  /** The input of the tool that creates it (resolved ids are filled in by the server). */
  data: Record<string, unknown>;
  /** Names to resolve on the server: a project or customer written by name. */
  refs: { project?: string; customer?: string; responsible?: string; assignee?: string };
  issues: string[];
  /** Set by the server: the same name already exists. The person chooses to skip or create anyway. */
  duplicateOf?: { id: string; name: string } | null;
  skip?: boolean;
};

const cellOf = (file: ExtractedFile, row: string[], mapping: Record<string, string | null>, field: string) => {
  const header = mapping[field];
  if (!header) return "";
  const index = (file.headers ?? []).indexOf(header);
  return index >= 0 ? (row[index] ?? "").trim() : "";
};

/** Rows → tool inputs for a table import. Pure; the server resolves names to ids and marks duplicates afterwards. */
export function buildPlan(file: ExtractedFile, target: TableTarget, mapping: Record<string, string | null>, today = new Date().toISOString().slice(0, 10)): PlanItem[] {
  const rows = file.rows ?? [];
  const items: PlanItem[] = [];
  rows.forEach((row, index) => {
    if (!row.some((cell) => cell && cell.trim())) return;
    const get = (field: string) => cellOf(file, row, mapping, field);
    const issues: string[] = [];
    if (target === "customers") {
      const name = get("name") || get("company");
      if (!name) { issues.push("saknar namn"); }
      items.push({ index, kind: "customer", title: name || `Rad ${index + 2}`, refs: {}, issues, data: { name: name.slice(0, 200), company: get("company").slice(0, 200), email: get("email").slice(0, 254), phone: get("phone").slice(0, 200), mobile: get("mobile").slice(0, 200), address: get("address").slice(0, 200), postalCode: get("postalCode").slice(0, 200), city: get("city").slice(0, 200), notes: get("notes").slice(0, 5000) } });
    } else if (target === "projects") {
      const name = get("name");
      if (!name) issues.push("saknar projektnamn");
      let startDate = normalizeDate(get("startDate")); let dueDate = normalizeDate(get("dueDate"));
      if (get("startDate") && !startDate) issues.push(`startdatum ”${get("startDate")}” kan inte läsas`);
      if (get("dueDate") && !dueDate) issues.push(`slutdatum ”${get("dueDate")}” kan inte läsas`);
      // A project needs its frame (2026-09-26): a missing date is filled in and said.
      if (!startDate) { startDate = dueDate && dueDate < today ? dueDate : today; issues.push(`startdatum saknas – sätts till ${startDate}`); }
      if (!dueDate || dueDate < startDate) { dueDate = startDate; issues.push(`slutdatum saknas – sätts till ${dueDate}`); }
      items.push({ index, kind: "project", title: name || `Rad ${index + 2}`, refs: { customer: get("customer") || undefined, responsible: get("responsible") || undefined }, issues, data: { name: name.slice(0, 160), startDate, dueDate, description: get("description").slice(0, 2000), workSite: get("workSite").slice(0, 300), reference: get("reference").slice(0, 120) } });
    } else if (target === "work_orders") {
      const title = get("title");
      if (!title) issues.push("saknar rubrik");
      const dueDate = normalizeDate(get("dueDate"));
      if (get("dueDate") && !dueDate) issues.push(`datumet ”${get("dueDate")}” kan inte läsas`);
      items.push({ index, kind: "work_order", title: title || `Rad ${index + 2}`, refs: { project: get("project") || undefined, customer: get("customer") || undefined, assignee: get("assignee") || undefined }, issues, data: { title: title.slice(0, 200), description: get("description").slice(0, 5000), ...(dueDate ? { dueDate } : {}), ...(get("executionNotes") ? { executionNotes: get("executionNotes").slice(0, 10_000) } : {}) } });
    } else {
      const title = get("title");
      if (!title) issues.push("saknar aktivitet");
      const date = normalizeDate(get("date"));
      const startsAt = normalizeDateTime(get("startsAt"), date, "08:00") ?? (date ? `${date}T08:00` : null);
      let endsAt = normalizeDateTime(get("endsAt"), startsAt?.slice(0, 10) ?? date, "16:00");
      if (!startsAt) issues.push("saknar start eller datum");
      if (startsAt && (!endsAt || endsAt <= startsAt)) { endsAt = `${startsAt.slice(0, 10)}T${pad(Math.min(23, Number(startsAt.slice(11, 13)) + 1))}:${startsAt.slice(14, 16)}`; issues.push("slut saknas – sätts till en timme efter start"); }
      items.push({ index, kind: "planned_activity", title: title || `Rad ${index + 2}`, refs: { project: get("project") || undefined }, issues, data: { title: title.slice(0, 200), description: get("description").slice(0, 2000), startsAt, endsAt, kind: /möte|meeting/i.test(title) ? "MEETING" : "TASK" } });
    }
  });
  // A row without its required field cannot be created; it is left out from the start instead of failing on import
  // (2026-10-01), and the person can map the column and plan again.
  return items.map((item) => (item.issues.some((issue) => /^saknar (namn|projektnamn|rubrik|aktivitet|start)/.test(issue)) ? { ...item, skip: true } : item));
}

/**
 * Work orders the AI read out of a report (2026-10-01: before this a report's rows were read and then thrown away):
 * one work order per row, its date as Klart senast. Without AI rows the text is one work order, as before.
 */
export function aiRowsToWorkOrders(rows: NonNullable<ExtractedFile["aiRows"]>): PlanItem[] {
  return rows.filter((row) => row.title.trim()).map((row, index) => {
    const dueDate = normalizeDate(row.date);
    return { index, kind: "work_order" as const, title: row.title.slice(0, 200), refs: {}, issues: row.date && !dueDate ? [`datumet ”${row.date}” kan inte läsas`] : [],
      data: { title: row.title.slice(0, 200), description: [row.section, row.description].filter(Boolean).join("\n").slice(0, 5000), ...(dueDate ? { dueDate } : {}) } };
  });
}

/** A text as one work order: the first line is the title, the rest the description. */
export function textToWorkOrder(file: ExtractedFile): PlanItem {
  const lines = (file.text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = (lines[0] ?? file.name.replace(/\.[a-z0-9]+$/i, "")).slice(0, 200);
  return { index: 0, kind: "work_order", title, refs: {}, issues: [], data: { title, description: lines.slice(1).join("\n").slice(0, 5000) } };
}

/** Control points from a table (the import template's columns, loosely) or from a text. */
export function controlPointsOf(file: ExtractedFile, taken: Set<string>, newId?: () => string): ImportResult {
  if (file.kind === "text") {
    // The AI's reading is used when it found more points than the numbered lines did.
    const ruled = textToControlPoints(file.text ?? "");
    const read = (file.aiRows ?? []).filter((row) => row.title.trim()).map((row) => ({ avsnitt_namn: row.section, kontrollpunkt: row.title, svarstyp: "bedomning" }));
    return importControlPoints(read.length > ruled.length ? read : ruled, taken, newId);
  }
  const headers = (file.headers ?? []).map((header) => importColumn(header));
  const rows = (file.rows ?? []).map((cells) => Object.fromEntries(headers.flatMap((column, index) => (column ? [[column, String(cells[index] ?? "")]] : []))));
  return importControlPoints(rows, taken, newId);
}

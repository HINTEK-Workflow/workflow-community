import type { FieldSpec } from "@/lib/import/detect";

/**
 * The columns of an absence file and of a staff file with employee numbers (frånvaro och lön, 2026-10-29), as the Import page
 * maps them – Swedish names first, English too. No free-text column is read (a comment could hold a diagnosis). Pure and
 * client-safe: the Import page shows these fields for the person's own column choice.
 */
const EMPLOYEE_NUMBER_ALIASES = ["anställningsnummer", "anstallningsnummer", "anställningsnr", "anstnr", "anst nr", "anst.nr", "anst.nr.", "personalnummer", "anställd nr", "employee number", "employee no", "employee id", "empno", "emp no"];
const EMAIL_ALIASES = ["e-post", "epost", "email", "e-mail", "mejl", "mail"];
const NAME_ALIASES = ["namn", "medarbetare", "anställd", "anstalld", "name", "employee", "person"];

export const ABSENCE_FIELDS: FieldSpec[] = [
  { key: "employeeNumber", label: "Anställningsnummer", aliases: EMPLOYEE_NUMBER_ALIASES },
  { key: "email", label: "E-post", aliases: EMAIL_ALIASES },
  { key: "name", label: "Namn (visas bara)", aliases: NAME_ALIASES },
  { key: "code", label: "Frånvarokod", required: true, aliases: ["frånvarokod", "franvarokod", "frånvaroorsak", "frånvarotyp", "frånvaro", "orsak", "orsakskod", "tidkod", "tidskod", "löneart", "loneart", "kod", "typ", "absence code", "absence type", "code", "type", "reason"] },
  { key: "from", label: "Från", required: true, kind: "date", aliases: ["från", "fran", "fr.o.m.", "fr o m", "from", "fom", "från datum", "från och med", "startdatum", "start", "from date", "start date", "datum", "date"] },
  { key: "to", label: "Till och med", kind: "date", aliases: ["till", "t.o.m.", "t o m", "tom", "till och med", "till datum", "slutdatum", "slut", "to", "to date", "end date", "end"] },
  { key: "startTime", label: "Från klockan", aliases: ["från klockan", "från kl", "starttid", "klockslag från", "start time", "from time"] },
  { key: "endTime", label: "Till klockan", aliases: ["till klockan", "till kl", "sluttid", "klockslag till", "end time", "to time"] },
  { key: "hours", label: "Timmar per dag", aliases: ["timmar", "antal timmar", "tim", "hours", "antal", "timmar per dag"] },
  { key: "extent", label: "Omfattning %", aliases: ["omfattning", "omfattning %", "procent", "andel", "extent", "percent", "%"] },
  { key: "status", label: "Status", aliases: ["status", "attest", "attesterad", "godkänd", "beslut", "state", "approval"] },
  { key: "externalId", label: "Id i systemet", aliases: ["id", "id i systemet", "frånvaro id", "frånvaroid", "ärendenummer", "ärende", "post id", "record id", "absence id", "transaktions id"] },
];

/** A staff file for employee numbers: the number and the e-mail of the member it belongs to. */
export const EMPLOYEE_NUMBER_FIELDS: FieldSpec[] = [
  { key: "employeeNumber", label: "Anställningsnummer", required: true, aliases: EMPLOYEE_NUMBER_ALIASES },
  { key: "email", label: "E-post", required: true, aliases: EMAIL_ALIASES },
  { key: "name", label: "Namn (visas bara)", aliases: NAME_ALIASES },
];

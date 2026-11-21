import { z } from "zod";

/**
 * Swedish validation texts (A1, review 2026-10-20): zod's own messages are English ("Too big: expected string to have
 * <=10000 characters") and reached people and API clients through failure() in lib/kfid/server.ts. installed once on
 * the server: zod's Swedish locale as the base and short texts of our own on top, and failure() names the field when
 * it is one of the common ones (FIELD_LABELS). A message a schema writes itself always wins and is never changed.
 */

/** Common field names (the last part of the issue's path) and how a person knows them, in lower case. */
export const FIELD_LABELS: Record<string, string> = {
  title: "rubrik", name: "namn", email: "e-post", phone: "telefon", description: "beskrivning", executionNotes: "utfört arbete",
  notes: "anteckningar", note: "anteckning", comment: "kommentar", message: "meddelande", reason: "orsak", address: "adress",
  street: "gatuadress", postalCode: "postnummer", city: "ort", customerId: "kund", customerName: "kundnamn", projectId: "projekt",
  placeId: "plats", date: "datum", startsAt: "starttid", endsAt: "sluttid", startDate: "startdatum", endDate: "slutdatum",
  dueDate: "förfallodatum", dueAt: "förfallodatum", password: "lösenord", quantity: "antal", unit: "enhet", price: "pris",
  unitPrice: "pris", minutes: "minuter", hours: "timmar", organizationNumber: "organisationsnummer", personalNumber: "personnummer",
  contactName: "kontaktperson", reference: "referens", text: "text", query: "sökord", q: "sökord",
};

/** Said when a required value is not sent at all (also read by lib/tools/issue-text.ts). */
export const MISSING = "En obligatorisk uppgift saknas.";

const KIND: Record<string, string> = { string: "text", number: "ett tal", int: "ett heltal", bigint: "ett heltal", boolean: "ja eller nej", array: "en lista", object: "ett objekt", date: "ett datum" };
const ID_FORMATS = new Set(["uuid", "uuidv4", "uuidv6", "uuidv7", "guid", "cuid", "cuid2", "ulid", "xid", "ksuid", "nanoid"]);
const DATE_FORMATS = new Set(["date", "datetime", "time"]);

type Issue = {
  code?: string; message?: string; path?: PropertyKey[]; input?: unknown; expected?: string; origin?: string; inclusive?: boolean;
  maximum?: unknown; minimum?: unknown; format?: string; keys?: string[]; divisor?: unknown;
};

/** 10000 → "10 000" (a plain space, as the page writes numbers). */
function amount(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
const capital = (text: string) => text.charAt(0).toLocaleUpperCase("sv-SE") + text.slice(1);

/** The text for an issue, without (label undefined) or with the field's name; missing tells invalid_type apart. */
function text(issue: Issue, label: string | undefined, missing: boolean): string {
  const about = label ? capital(label) : undefined;
  const n = (value: unknown) => amount(value);
  switch (issue.code) {
    case "invalid_type":
      if (missing) return label ? `Fyll i ${label}.` : MISSING;
      return `${about ?? "Värdet"} ska vara ${KIND[issue.expected ?? ""] ?? "av en annan sort"}.`;
    case "too_big": {
      const below = issue.inclusive === false;
      if (issue.origin === "string") return `${about ?? "Texten"} får vara högst ${n(below ? Number(issue.maximum) - 1 : issue.maximum)} tecken.`;
      if (issue.origin === "array" || issue.origin === "set") return `${about ?? "Listan"} får ha högst ${n(issue.maximum)} poster.`;
      return `${about ?? "Värdet"} ska vara ${below ? "mindre än" : "högst"} ${n(issue.maximum)}.`;
    }
    case "too_small": {
      const above = issue.inclusive === false;
      if (issue.origin === "string") return Number(issue.minimum) <= 1 ? (label ? `Fyll i ${label}.` : "Ett obligatoriskt fält är tomt.") : `${about ?? "Texten"} ska vara minst ${n(issue.minimum)} tecken.`;
      if (issue.origin === "array" || issue.origin === "set") return Number(issue.minimum) <= 1 ? `${about ?? "Listan"} ska ha minst en post.` : `${about ?? "Listan"} ska ha minst ${n(issue.minimum)} poster.`;
      return `${about ?? "Värdet"} ska vara ${above ? "större än" : "minst"} ${n(issue.minimum)}.`;
    }
    case "invalid_format":
      if (issue.format === "email") return "Ange en giltig e-postadress.";
      if (issue.format === "url") return "Ange en giltig webbadress.";
      if (DATE_FORMATS.has(issue.format ?? "")) return `${about ?? "Datumet"} ska vara ett giltigt datum.`;
      if (ID_FORMATS.has(issue.format ?? "")) return label ? `${about} är inte giltig.` : "Ogiltigt id.";
      return `${about ?? "Värdet"} har fel format.`;
    case "invalid_value": return about ? `${about} har ett värde som inte tillåts.` : "Värdet tillåts inte.";
    case "not_multiple_of": return `${about ?? "Värdet"} ska vara en multipel av ${n(issue.divisor)}.`;
    case "unrecognized_keys": return `Okänt fält: ${(issue.keys ?? []).slice(0, 3).join(", ")}.`;
    case "invalid_union": return label ? `${about} har fel form.` : "Uppgifterna har fel form.";
    case "invalid_key":
    case "invalid_element": return label ? `${about} innehåller ett ogiltigt värde.` : "Listan innehåller ett ogiltigt värde.";
    default: return label ? `${about} har ett ogiltigt värde.` : "Ogiltigt värde.";
  }
}

/** zod's customError: the message an issue gets when its schema wrote none (the path is not known yet here). */
export function swedishIssueMessage(issue: Issue): string {
  return text(issue, undefined, issue.code === "invalid_type" && issue.input === undefined);
}

/** Whether a finished issue still carries one of our default texts (and not a message its schema wrote itself). */
export function isDefaultIssueMessage(issue: Issue) {
  const message = issue.message ?? "";
  return message === text(issue, undefined, true) || message === text(issue, undefined, false);
}

/** The text a person sees for a finished issue: the schema's own message, or ours with the field's name when known. */
export function issueText(issue: Issue | undefined): string {
  if (!issue) return "Ogiltiga uppgifter.";
  if (!isDefaultIssueMessage(issue)) return issue.message || "Ogiltiga uppgifter.";
  const key = [...(issue.path ?? [])].reverse().find((part): part is string => typeof part === "string");
  const label = key ? FIELD_LABELS[key] : undefined;
  if (!label) return issue.message!;
  return text(issue, label, issue.code === "invalid_type" && issue.message === MISSING);
}

let installed = false;
/** Once per server process (lib/kfid/server.ts and the auth actions import it); a second call does nothing. */
export function installSwedishZodErrors() {
  if (installed) return;
  installed = true;
  z.config(z.locales.sv());
  z.config({ customError: (issue) => swedishIssueMessage(issue as Issue) });
}

installSwedishZodErrors();

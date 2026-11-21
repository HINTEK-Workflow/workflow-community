/**
 * Short Swedish text for the first problem of an invalid input (2026-10-18, API-03): the field's name and what is
 * wrong, instead of Zod's English defaults. A message the schema wrote itself (already readable) is kept. Never lists
 * internal action names or allowed values of a discriminator.
 */
import { isDefaultIssueMessage, MISSING } from "@/lib/validation/zod-swedish";
export type IssueLike = { code?: string; message?: string; path?: PropertyKey[]; expected?: string; origin?: string; maximum?: number | bigint; minimum?: number | bigint; format?: string; values?: unknown[]; keys?: string[] };

const KIND: Record<string, string> = { string: "text", number: "tal", int: "heltal", boolean: "sant eller falskt", array: "lista", object: "objekt", date: "datum" };
const DEFAULT_ENGLISH = /^(Invalid|Too (big|small)|Unrecognized|Expected|Input|Required)/;

export function describeIssue(issue: IssueLike | undefined): string {
  if (!issue) return "Ogiltiga uppgifter.";
  const field = (issue.path ?? []).filter((part) => typeof part !== "symbol").join(".");
  const about = field ? `Fältet ”${field}”` : "Indata";
  const message = issue.message ?? "";
  // zod's English defaults, and the Swedish defaults the server installs (lib/validation/zod-swedish.ts), get the field.
  if (message && !DEFAULT_ENGLISH.test(message) && !isDefaultIssueMessage(issue)) return message;
  switch (issue.code) {
    case "invalid_type": return message.includes("received undefined") || message === MISSING || !field ? (field ? `Fältet ”${field}” saknas.` : "Indata saknas eller har fel form.") : `${about} ska vara ${KIND[issue.expected ?? ""] ?? "av annan sort"}.`;
    case "too_big":
      return issue.origin === "string" ? `${about} får vara högst ${issue.maximum} tecken.` : issue.origin === "array" ? `${about} får ha högst ${issue.maximum} poster.` : `${about} får vara högst ${issue.maximum}.`;
    case "too_small":
      return issue.origin === "string" ? (Number(issue.minimum) <= 1 ? `${about} får inte vara tomt.` : `${about} ska vara minst ${issue.minimum} tecken.`) : issue.origin === "array" ? `${about} ska ha minst ${issue.minimum} poster.` : `${about} ska vara minst ${issue.minimum}.`;
    case "invalid_format": return issue.format === "date" || issue.format === "datetime" ? `${about} ska vara ett datum (ÅÅÅÅ-MM-DD).` : `${about} har fel format.`;
    case "invalid_value": return `${about} har ett värde som inte tillåts.`;
    case "unrecognized_keys": return `Okänt fält: ${(issue.keys ?? []).slice(0, 3).join(", ")}.`;
    case "invalid_union": return field ? `${about} har fel form.` : "Åtgärden saknas eller är ogiltig.";
    default: return field ? `${about} har ett ogiltigt värde.` : "Ogiltiga uppgifter.";
  }
}

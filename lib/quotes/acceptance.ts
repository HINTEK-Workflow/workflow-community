import { z } from "zod";

/**
 * Offert per e-post, steg E (2026-10-09): how a customer confirms a quote through the link. Pluggable, so a
 * stronger method can be added later without changing the link, the page's flow or the stored answer:
 * - "simple" (now): the customer types their name and ticks one box with the statement. Workflow stores the name, the
 *   statement, the time, the IP address and the browser.
 * - "bankid", "esign", "sms" (later, not built): a method registers itself here with its own `verify`, which returns the
 *   signer's name and the evidence to store (for example a signing service's reference). The link's `acceptanceMethod`
 *   says which method the customer must use; the answer stores the method that was used.
 * The method id is a string in the database (QuoteLink/QuoteResponse.acceptanceMethod), so a new method needs no
 * migration. Only a registered method can accept; an unknown id is refused. Pure – no database, no network.
 */
export const QUOTE_ACCEPTANCE_METHOD_IDS = ["simple", "bankid", "esign", "sms"] as const;
export type QuoteAcceptanceMethodId = (typeof QUOTE_ACCEPTANCE_METHOD_IDS)[number];
export const DEFAULT_QUOTE_ACCEPTANCE_METHOD: QuoteAcceptanceMethodId = "simple";

/** What a method proved: the signer's name and the evidence stored with the answer (JSON, strings only). */
export type QuoteAcceptanceEvidence = { signerName: string; evidence: Record<string, string> };
/** What the method may read: the quote the customer accepts (for the statement). */
export type QuoteAcceptanceSubject = { label: string; title: string; company: string };

export type QuoteAcceptanceMethod = {
  id: QuoteAcceptanceMethodId;
  /** Shown to the company beside the answer, e.g. "Namn och kryssruta". */
  label: string;
  /** "form": the customer page shows the name field and the tick box. A later method may need its own step ("external"). */
  kind: "form" | "external";
  /** Checks the customer's input and returns what to store; throws a QuoteAcceptanceError with a text for the customer. */
  verify(input: unknown, subject: QuoteAcceptanceSubject): Promise<QuoteAcceptanceEvidence>;
};

export class QuoteAcceptanceError extends Error {}

/** The statement the customer ticks; stored word for word with the answer. */
export const acceptanceStatement = (subject: QuoteAcceptanceSubject) =>
  `Jag accepterar offerten ${subject.label} (${subject.title}) från ${subject.company} med villkoren ovan.`;

const simpleInput = z.object({
  name: z.string().trim().min(2, "Skriv ditt namn.").max(120, "Namnet är för långt."),
  agree: z.boolean().refine((value) => value, "Kryssa i att du accepterar offerten."),
});

export const simpleAcceptance: QuoteAcceptanceMethod = {
  id: "simple",
  label: "Namn och kryssruta",
  kind: "form",
  async verify(input, subject) {
    const parsed = simpleInput.safeParse(input);
    if (!parsed.success) throw new QuoteAcceptanceError(parsed.error.issues[0]?.message ?? "Skriv ditt namn och kryssa i rutan.");
    // One line, no control characters: the name is shown to the company and in the notice.
    const signerName = parsed.data.name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim();
    if (signerName.length < 2) throw new QuoteAcceptanceError("Skriv ditt namn.");
    return { signerName, evidence: { statement: acceptanceStatement(subject) } };
  },
};

const registry = new Map<string, QuoteAcceptanceMethod>([[simpleAcceptance.id, simpleAcceptance]]);

/** A later method (BankID, e-signature, SMS code) registers itself here; the id must be one of the known ids. */
export function registerQuoteAcceptanceMethod(method: QuoteAcceptanceMethod) {
  if (!(QUOTE_ACCEPTANCE_METHOD_IDS as readonly string[]).includes(method.id)) throw new Error(`Okänd signeringsmetod: ${method.id}`);
  registry.set(method.id, method);
}

/** The registered method, or null (an unknown or not yet built method can never accept). */
export function quoteAcceptanceMethod(id: string): QuoteAcceptanceMethod | null {
  return registry.get(id) ?? null;
}

/** The method's name for the company; an unknown id is shown as it is stored. */
export const quoteAcceptanceMethodLabel = (id: string) => registry.get(id)?.label ?? id;

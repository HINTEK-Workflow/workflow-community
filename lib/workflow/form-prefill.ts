import { formLeafBlocks, type FormDocument, type FormValues, FIELD_PREFILLS } from "./form-document";
import { customerNames } from "@/lib/kfid/customer-name";

export type FormPrefill = Exclude<(typeof FIELD_PREFILLS)[number], "none">;
/** What the task knows that a form may start from: its customer, facility, project, responsible person and today. */
export type FormPrefillSource = Partial<Record<FormPrefill, string>>;

/**
 * Fills a protocol's fields from the task (2026-09-27, the control's customer picker): the customer and contact
 * person, the e-mail, the facility, the project, the responsible person and today's date. `kinds` limits it to what just
 * changed; `overwrite` replaces an earlier value (a new customer gives a new contact, like the control), otherwise only
 * empty fields are filled. Nothing else in the protocol is touched.
 */
export function applyFormPrefill(document: FormDocument, values: FormValues, source: FormPrefillSource, options: { kinds?: FormPrefill[]; overwrite?: boolean } = {}): FormValues {
  let fields: FormValues["fields"] | null = null;
  for (const block of formLeafBlocks(document)) {
    if (block.type !== "field" || block.prefill === "none" || (options.kinds && !options.kinds.includes(block.prefill))) continue;
    const next = source[block.prefill];
    if (next === undefined) continue;
    const current = values.fields[block.key];
    const empty = current === undefined || current === null || String(current).trim() === "";
    if (!empty && !options.overwrite) continue;
    if (current === next) continue;
    fields ??= { ...values.fields };
    fields[block.key] = next;
  }
  return fields ? { ...values, fields } : values;
}

/**
 * The customer's part of a protocol's prefill: the customer's name, a contact person and the e-mail. The contact person
 * is only a real one (2026-10-07: Kontaktperson was filled with the customer's name): the project's contact person in a
 * project; without a project the customer's "Namn / kontaktperson" when it names someone else than the company, or the
 * person themselves for a Privatperson (simulation 2026-10-10: Kontaktperson stayed empty for a private customer). Else empty.
 */
export function customerPrefill(customer: { name: string; company?: string | null; email?: string | null; customerType?: string | null } | null | undefined, project?: { contactPerson?: string | null } | null): Pick<FormPrefillSource, "customer" | "contact" | "email"> {
  if (!customer) return { customer: "", contact: project?.contactPerson?.trim() ?? "", email: "" };
  const { title, contact: named } = customerNames(customer);
  const own = customer.customerType === "PRIVATE" ? title : named;
  const contact = project ? project.contactPerson?.trim() ?? "" : own;
  return { customer: title, contact, email: customer.email ?? "" };
}

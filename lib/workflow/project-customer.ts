import { plural } from "@/lib/plural";
import { customerContact, customerTitle, type CustomerNameFields } from "@/lib/kfid/customer-name";
/**
 * Kundbyte på projekt (2026-10-10, kartläggningen 5.3): the same rule as the work order's customer, where a
 * linked task with another customer stops the change. A project whose jobs have the old customer never changes customer
 * silently: the person either moves the open jobs to the new customer with an explicit choice, or keeps the customer.
 * Finished work never changes customer, so a completed job with the old customer blocks the change. Quotes are never
 * moved; they are only named, since a sent quote is locked with its customer. Shared by Cloud, Local and the demo.
 */
export type CustomerChangeJob = { id: string; title: string; status: string; customerId: string | null };
export type CustomerChangeQuote = { status: string; customerId: string | null };

/** What the person is told and asked when a project's customer changes while its jobs or quotes have another customer. */
export type ProjectCustomerChange = {
  fromName: string;
  toName: string;
  /** Jobs that are moved with "Flytta jobben" (open and Utgår). */
  open: number;
  /** Completed jobs with another customer; any one of them blocks the change. */
  completed: number;
  /** Quotes in the project with another customer; never moved. */
  quotes: number;
  /** Set when the change cannot be made at all; the person can only keep the customer. */
  blocked: boolean;
  message: string;
};


/**
 * The decision a customer change needs, or null when nothing has the old customer (or the project loses its customer –
 * a project without a customer leaves its tasks' own customers, like before). Jobs without a customer are not counted:
 * they take the project's customer the next time they are saved.
 */
export function projectCustomerChange(input: {
  fromCustomerId: string | null;
  toCustomerId: string | null;
  fromName: string;
  toName: string;
  jobs: readonly CustomerChangeJob[];
  quotes?: readonly CustomerChangeQuote[];
}): ProjectCustomerChange | null {
  const to = input.toCustomerId;
  if (!to || input.fromCustomerId === to) return null;
  const other = input.jobs.filter((job) => job.customerId && job.customerId !== to);
  const completed = other.filter((job) => job.status === "COMPLETED").length;
  const open = other.length - completed;
  const quotes = (input.quotes ?? []).filter((quote) => quote.customerId && quote.customerId !== to).length;
  if (!other.length && !quotes) return null;
  const fromName = input.fromName.trim() || "en annan kund";
  const toName = input.toName.trim() || "den nya kunden";
  const quoteNote = quotes ? `${plural(quotes, "offert", "offerter")} i projektet har kunden ${fromName}. Offerter flyttas inte; en skickad offert behåller alltid sin kund.` : "";
  if (completed) return {
    fromName, toName, open, completed, quotes, blocked: true,
    message: `Kunden kan inte bytas. ${plural(completed, "färdigställt jobb", "färdigställda jobb")} i projektet har kunden ${fromName}, och färdigställt arbete byter inte kund. Behåll kunden, eller skapa ett nytt projekt för ${toName}.`,
  };
  return {
    fromName, toName, open, completed, quotes, blocked: false,
    message: open
      ? `${plural(open, "jobb", "jobb")} i projektet har kunden ${fromName}. Flytta jobben till ${toName}, eller behåll kunden.${quoteNote ? ` ${quoteNote}` : ""}`
      : `${quoteNote} Byt kund ändå, eller behåll kunden.`,
  };
}

/**
 * The place a moved job gets: its own place when it already belongs to the new customer, else the project's (new) place,
 * else none – a job never keeps the old customer's place (the same rule as choosing a new customer in the job).
 */
export function movedJobPlace(job: { facilityId: string | null; facilityCustomerId: string | null }, toCustomerId: string, projectFacilityId: string | null) {
  if (job.facilityId && job.facilityCustomerId === toCustomerId) return job.facilityId;
  return projectFacilityId;
}

/** The customer's name as Beställare and reports print it (lib/kfid/customer-name.ts). */
export function customerDisplayName(customer: CustomerNameFields | null | undefined) {
  if (!customer) return "";
  return customerTitle(customer);
}

/**
 * A real contact person at the customer (2026-10-07: Kontaktperson was filled with the customer's name): the customer's
 * "Namn / kontaktperson" when it names someone else than the company, else empty. The same rule as a protocol's prefill.
 */
export function customerContactName(customer: CustomerNameFields | null | undefined) {
  if (!customer) return "";
  return customerContact(customer);
}

/**
 * Beställare and Kontaktperson follow the customer (2026-10-10, kartläggningen 5.4), like Arbetsplats / anläggning
 * follows the place: with a customer, Beställare is the customer's name; without one it is free text. Kontaktperson is
 * filled from the customer when it is empty or still the previous customer's contact; a contact the person wrote is kept.
 * Returns the values to store.
 */
export function projectCustomerFields(input: {
  customer: CustomerNameFields | null | undefined;
  previousCustomer?: CustomerNameFields | null;
  client: string;
  contactPerson: string;
}) {
  if (!input.customer) return { client: input.client, contactPerson: input.contactPerson };
  const contact = input.contactPerson.trim();
  const previousContact = customerContactName(input.previousCustomer);
  const followsCustomer = !contact || (Boolean(previousContact) && contact === previousContact);
  return { client: customerDisplayName(input.customer), contactPerson: followsCustomer ? customerContactName(input.customer) : input.contactPerson };
}

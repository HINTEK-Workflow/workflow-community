/**
 * Kundens namn (2026-11-01, beslut 18): for the customer type Företag the company's name is the heading and the
 * contact person stands under it, in lists, pickers and documents. A Privatperson keeps their own name. The stored fields
 * are unchanged: `name` is "Namn / kontaktperson" and `company` the company. Every place that shows a customer's name goes
 * through these functions, on the server, in the page and in the demo.
 */
export type CustomerNameFields = { name?: string | null; company?: string | null; customerType?: string | null };

const clean = (value: string | null | undefined) => (value ?? "").trim();
const same = (a: string, b: string) => a.toLocaleLowerCase("sv-SE") === b.toLocaleLowerCase("sv-SE");

/** The heading and the contact person under it ("" when there is none, or when it only repeats the heading). */
export function customerNames(customer: CustomerNameFields | null | undefined): { title: string; contact: string } {
  if (!customer) return { title: "", contact: "" };
  const person = clean(customer.name), company = clean(customer.company);
  if (customer.customerType === "PRIVATE" || !company) return { title: person || company, contact: "" };
  return { title: company, contact: person && !same(person, company) ? person : "" };
}

/** The customer's heading: the company for a Företag, the person's own name for a Privatperson. */
export const customerTitle = (customer: CustomerNameFields | null | undefined) => customerNames(customer).title;

/** The contact person under the heading of a Företag; "" for a Privatperson. */
export const customerContact = (customer: CustomerNameFields | null | undefined) => customerNames(customer).contact;

/** A single line, where only one fits (a drop-down's option): "Reläbacken AB · Eva Ek". */
export function customerLine(customer: CustomerNameFields | null | undefined) {
  const { title, contact } = customerNames(customer);
  return contact ? `${title} · ${contact}` : title;
}

/** The same rule as customerTitle in PostgreSQL, for an order or a search result: `alias` is the query's name for "Customer". */
export const customerTitleSql = (alias?: string) => {
  const column = (name: string) => alias ? `${alias}.${name}` : name;
  return `CASE WHEN ${column('"customerType"')}::text = 'PRIVATE' OR btrim(${column("company")}) = '' THEN ${column("name")} ELSE ${column("company")} END`;
};

/**
 * Register order by the heading a person sees (PostgreSQL's same rule is in lib/kfid/records.ts), for lists held in memory.
 */
export const compareCustomerTitles = (a: CustomerNameFields, b: CustomerNameFields) => customerTitle(a).localeCompare(customerTitle(b), "sv-SE", { sensitivity: "base" });

import { countByFilter, sortListItems, type ListSortKey } from "@/lib/list-filter";
import { customerTitle, type CustomerNameFields } from "./customer-name";
import { customerTypeOf } from "./customer-schema";

/**
 * Kundlistan i den gemensamma toppvisningen (2026-10-31): no Mina | Alla (a customer has no one responsible), chips
 * Alla | Företag | Privatpersoner with counts, the search, the sort and Rader | Kort. Cloud and the demo count and filter on
 * the server (the list is read a page at a time, so the chips never count only the page); Local uses listLocalCustomers on
 * its file. The rules are here so all three say the same.
 */
export const CUSTOMER_FILTERS = ["all", "COMPANY", "PRIVATE"] as const;
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];
export const CUSTOMER_FILTER_LABEL: Record<CustomerFilter, string> = { all: "Alla", COMPANY: "Företag", PRIVATE: "Privatpersoner" };
export const CUSTOMER_SORTS = ["title", "updated", "address", "email"] as const satisfies readonly ListSortKey[];
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

/** The register's query for a sort: Namn A–Ö by the heading a person sees, Senast ändrad newest first. */
export function customerSortQuery(sort: CustomerSort): { sort: "name" | "updated" | "address" | "email"; direction: "asc" | "desc" } {
  if (sort === "title") return { sort: "name", direction: "asc" };
  if (sort === "updated") return { sort: "updated", direction: "desc" };
  return { sort, direction: "asc" };
}

export const customerMatchesFilter = (customer: { customerType?: string | null }, filter: CustomerFilter) => filter === "all" || customerTypeOf(customer.customerType) === filter;

type LocalEntry = CustomerNameFields & { address?: string | null; email?: string | null; updatedAt?: string | Date | null };

/** The list in memory, in the same order as the server, with the chips' counts on everything that was searched. */
export function listLocalCustomers<T extends LocalEntry>(items: readonly T[], input: { filter: CustomerFilter; sort: CustomerSort }) {
  const byTitle = { value: (item: T) => customerTitle(item) };
  const keys = input.sort === "updated" ? [{ value: (item: T) => item.updatedAt ? new Date(item.updatedAt).toISOString() : "", direction: "desc" as const }, byTitle]
    : input.sort === "address" ? [{ value: (item: T) => item.address }, byTitle]
    : input.sort === "email" ? [{ value: (item: T) => item.email }, byTitle]
    : [byTitle];
  return { items: sortListItems(items.filter((item) => customerMatchesFilter(item, input.filter)), keys), counts: countByFilter(items, CUSTOMER_FILTERS, customerMatchesFilter) };
}

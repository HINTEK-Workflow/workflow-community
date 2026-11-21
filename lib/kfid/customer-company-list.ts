import { countByFilter, listSearchMatches, sortListItems, type ListSortKey } from "@/lib/list-filter";
import type { CompanyPayment } from "@/lib/extensions/types";
import { formatSek } from "@/lib/workflow/expenses";

/**
 * Kundföretag (superadmin) i den gemensamma toppvisningen (2026-10-31; SA12): the chips Alla | Aktiva | Pausade with
 * counts, the search, the sort and Rader | Kort. The list is read at once (at most 500 companies, the server's limit), so
 * the chips, the search and the sort work on what was read and always agree with the list.
 */
export const COMPANY_FILTERS = ["all", "active", "paused"] as const;
export type CompanyFilter = (typeof COMPANY_FILTERS)[number];
export const COMPANY_FILTER_LABEL: Record<CompanyFilter, string> = { all: "Alla", active: "Aktiva", paused: "Pausade" };
export const COMPANY_SORTS = ["title", "updated"] as const satisfies readonly ListSortKey[];
export type CompanySort = (typeof COMPANY_SORTS)[number];

/** Betalningen i listan och på företagets sida (beslut 11, 2026-11-01); the data comes from ee/, so without it there is no column. */
export const COMPANY_PAYMENT_LABEL: Record<CompanyPayment["status"], string> = { PAID: "Betald", FAILED: "Misslyckad", OVERDUE: "Förfallen", TRIAL: "Prov", TEST: "Test", ENDED: "Avslutad", NONE: "Ingen betalning" };
export const COMPANY_PAYMENT_TONE: Record<CompanyPayment["status"], "success" | "danger" | "warning" | "neutral"> = { PAID: "success", FAILED: "danger", OVERDUE: "danger", TRIAL: "neutral", TEST: "neutral", ENDED: "warning", NONE: "neutral" };
export const paymentSumText = (ore: number) => `${formatSek(ore / 100)} kr`;

type CompanyEntry = { name: string; isActive: boolean; organizationNumber: string; contactName: string; contactEmail: string; updatedAt?: string | null };

/**
 * Local to Cloud is the paid step only where billing exists; an installation without it has no payment to wait for, so the
 * installation's admin may move a company there. The other direction keeps its own export check in the route.
 */
export const CLOUD_NEEDS_PAYMENT = "Cloud öppnas först efter verifierad betalning. Köp är ännu inte aktiverade.";
export function storageChangeRefusal(from: "LOCAL" | "HINTEK_CLOUD", to: "LOCAL" | "HINTEK_CLOUD", billing: boolean) {
  return from === "LOCAL" && to === "HINTEK_CLOUD" && billing ? CLOUD_NEEDS_PAYMENT : null;
}

/** What decides whether the company's first admin invitation may go out now. */
export type OwnerInvitationSendState = { companyActive: boolean; hasAdmin: boolean; status: string; sentAt: Date | null };
/** Time between two sends of the same invitation: a double click or a second window sends one mail. */
export const OWNER_INVITATION_RESEND_MINUTES = 5;

/** Why the invitation may not be sent, or null. A sent one goes again only when asked for, and not within a few minutes. */
export function ownerInvitationSendRefusal(input: OwnerInvitationSendState & { resend: boolean; now: Date }) {
  if (!input.companyActive) return "Företaget är pausat. Aktivera det innan inbjudan skickas.";
  if (input.hasAdmin) return "Företaget har redan en aktiv administratör.";
  if (input.status === "PREPARED") return null;
  if (input.status !== "PENDING") return "Inbjudan kan inte skickas.";
  if (!input.resend) return "Inbjudan är redan skickad.";
  if (input.sentAt && input.now.getTime() - input.sentAt.getTime() < OWNER_INVITATION_RESEND_MINUTES * 60_000) return `Inbjudan skickades nyss. Vänta ${OWNER_INVITATION_RESEND_MINUTES} minuter innan du skickar igen.`;
  return null;
}

export const companyMatchesFilter = (company: { isActive: boolean }, filter: CompanyFilter) => filter === "all" || (filter === "active") === company.isActive;

export function listCustomerCompanies<T extends CompanyEntry>(items: readonly T[], input: { filter: CompanyFilter; sort: CompanySort; q: string }) {
  const searched = items.filter((item) => listSearchMatches(input.q, [item.name, item.organizationNumber, item.contactName, item.contactEmail]));
  const byName = { value: (item: T) => item.name };
  const keys = input.sort === "updated" ? [{ value: (item: T) => item.updatedAt ?? "", direction: "desc" as const }, byName] : [byName];
  return { items: sortListItems(searched.filter((item) => companyMatchesFilter(item, input.filter)), keys), counts: countByFilter(searched, COMPANY_FILTERS, companyMatchesFilter) };
}

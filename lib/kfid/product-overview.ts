import type { CompanyPayment } from "@/lib/extensions/types";

/**
 * Produktöversikten (beslut 11, 2026-11-01): where the superadmin lands. New companies, payments that need action,
 * Workflow's own keys that run out and the servers' alarms. Metadata only: names, dates and sums, never a customer's work.
 */
export const NEW_COMPANY_DAYS = 30;
export const KEY_WARNING_DAYS = 14;
const DAY = 86_400_000;

export type OverviewCompany = { id: string; name: string; isActive: boolean; createdAt: Date | string; payment: CompanyPayment | null };
export type PaymentProblem = { id: string; name: string; status: "FAILED" | "OVERDUE"; since: string | null; ore: number };
export type ProductOverview = {
  counts: { total: number; active: number; paused: number };
  newCompanies: { id: string; name: string; createdAt: string }[];
  /** null: the installation has no payment (no ee/). */
  paymentProblems: PaymentProblem[] | null;
  keys: { id: string; name: string; expiresAt: string; expired: boolean }[];
  serverAlarms: string[];
  /** PDF-mallar (2026-11-03): blocks whose default changed under the owner's text (Förvalet ändrades, Lagkrav uppdaterades). */
  pdfTemplatesFlagged?: number;
  /** Demostarter de senaste dagarna (Beteendeanalys, 2026-11-04): visits, never people. */
  visits?: { days: number; demoStarts: number; /** Visits to the start page by visitors who allowed statistics (2026-11-11). */ landing: number; /** Share who allowed statistics, 0–100; null without answers. */ consentRate: number | null } | null;
};
export const VISITS_DAYS = 7;

export const companyHref = (id: string) => `/?view=customer_companies&companyId=${encodeURIComponent(id)}`;

/** The company figures and the payments to act on, the failed ones first and then the oldest. */
export function summarizeCompanies(companies: readonly OverviewCompany[], now: Date, hasPayments: boolean): Pick<ProductOverview, "counts" | "newCompanies" | "paymentProblems"> {
  const since = now.getTime() - NEW_COMPANY_DAYS * DAY;
  const problems = companies.flatMap((company): PaymentProblem[] => company.payment && (company.payment.status === "FAILED" || company.payment.status === "OVERDUE")
    ? [{ id: company.id, name: company.name, status: company.payment.status, since: company.payment.problemSince, ore: company.payment.problemOre }] : []);
  problems.sort((a, b) => Number(b.status === "FAILED") - Number(a.status === "FAILED") || (a.since ?? "").localeCompare(b.since ?? "") || a.name.localeCompare(b.name, "sv"));
  return {
    counts: { total: companies.length, active: companies.filter((company) => company.isActive).length, paused: companies.filter((company) => !company.isActive).length },
    newCompanies: companies.filter((company) => new Date(company.createdAt).getTime() >= since)
      .map((company) => ({ id: company.id, name: company.name, createdAt: new Date(company.createdAt).toISOString() }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10),
    paymentProblems: hasPayments ? problems : null,
  };
}

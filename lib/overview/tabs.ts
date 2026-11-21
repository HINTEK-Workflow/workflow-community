import { canViewEconomy, canViewTeam, hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import type { WorkView } from "@/lib/workflow/work-view";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { teamGroupCounts } from "./team-headline";

/**
 * Översiktens flikar (dashboard etapp 6–7, 2026-10-28): Jag | Teamet | Ekonomi | Kunder – Statistik is no tab of its
 * own since 2026-10-29: the company's statistics are cards on Teamet, your own on Jag. Pure, so the
 * route (app/api/overview), the page (features/overview/overview-page.tsx) and the tests read the same rule.
 *
 * Who sees which tab is decided here from the person's role and permissions only – the server checks it again on every
 * read (each tab's loader throws 403 itself). The work view (Arbetsvy) may choose the tab the page opens on, never what
 * is shown: "Arbetsvy … styr bara vad som visas först och är ingen behörighet".
 */
export const OVERVIEW_TABS = ["me", "team", "economy", "customers"] as const;
export type OverviewTab = (typeof OVERVIEW_TABS)[number];
/** The tabs read through GET /api/overview?tab=. Statistik is no tab since 2026-10-29: Teamet and Jag carry its cards. */
export const LOADED_OVERVIEW_TABS = ["me", "team", "economy", "customers"] as const;
export type LoadedOverviewTab = (typeof LOADED_OVERVIEW_TABS)[number];
export type OverviewTabAccess = Record<OverviewTab, boolean>;

export const OVERVIEW_TAB_LABEL: Record<OverviewTab, string> = { me: "Jag", team: "Teamet", economy: "Ekonomi", customers: "Kunder" };

type Viewer = { admin: boolean; workflowPermissions: WorkflowPermissionProfile; organization?: { disabledModules?: readonly string[] | null } | null };

/**
 * The permission matrix: Jag for everyone; Teamet (with the company's statistics) for admins or team:read; Ekonomi for admins or economy:read; Kunder for admins or customers:read.
 * Företagets moduler (0.39.0): Ekonomi needs Offerter or Fakturaunderlag, and Kunder needs Kunder. A permission never opens a module that is off.
 */
export function overviewTabs(viewer: Viewer): OverviewTabAccess {
  const team = canViewTeam(viewer);
  const on = (key: Parameters<typeof organizationModuleOn>[1]) => organizationModuleOn(viewer.organization, key);
  return {
    me: true,
    team,
    economy: canViewEconomy(viewer) && (on("quotes") || on("invoicing")),
    customers: on("customers") && (viewer.admin || hasWorkflowPermission(viewer.workflowPermissions, "customers", "read")),
  };
}

/** A tab both access maps allow: Visa som may only ever hide a tab, never open one. */
export const narrowedTabs = (real: OverviewTabAccess, shown: OverviewTabAccess): OverviewTabAccess =>
  Object.fromEntries(OVERVIEW_TABS.map((tab) => [tab, real[tab] && shown[tab]])) as OverviewTabAccess;

export const isOverviewTab = (value: unknown): value is OverviewTab => (OVERVIEW_TABS as readonly unknown[]).includes(value);
export const isLoadedOverviewTab = (value: unknown): value is LoadedOverviewTab => (LOADED_OVERVIEW_TABS as readonly unknown[]).includes(value);

/** The tabs a person sees, in the fixed order. */
export const shownOverviewTabs = (access: OverviewTabAccess) => OVERVIEW_TABS.filter((tab) => access[tab]);

/**
 * The tab the page opens on: the one in the address (?tab=) when the person may see it; otherwise the yrkesprofil's when
 * the person may see that; otherwise the work view's – Arbetsledning opens on Teamet, Utförande and Ledande on Jag – and Jag
 * without a view. Only ever a tab in `access`: neither the profile nor the work view grants anything.
 */
export function overviewStartTab(access: OverviewTabAccess, view: WorkView | null | undefined, asked?: string | null, profileTab?: OverviewTab | null): OverviewTab {
  if (isOverviewTab(asked) && access[asked]) return asked;
  // An old link to Statistik opens Teamet, where its cards are now.
  if (asked === "statistics" && access.team) return "team";
  if (profileTab && access[profileTab]) return profileTab;
  if (view === "supervisor" && access.team) return "team";
  return "me";
}

/** What GET /api/overview answers: the tab's own JSON, the tabs the person may see and the chip of the tab read. */
export type OverviewAnswer<T = unknown> = { tab: LoadedOverviewTab; tabs: OverviewTabAccess; chips: Partial<Record<OverviewTab, string>>; data: T };

/** A tab's chip: the short text its JSON carries as `chip` (string or number), else none. */
export function overviewChip(data: unknown): string | null {
  const chip = data && typeof data === "object" ? (data as { chip?: unknown }).chip : undefined;
  if (chip === undefined) return derivedChip(data);
  return typeof chip === "string" ? chip : typeof chip === "number" && Number.isFinite(chip) ? chip.toLocaleString("sv-SE") : null;
}

/**
 * The chips of Kunder and Ekonomi from their own figures (the same numbers the tab shows): overdue work orders at customers;
 * work orders and projects with unbilled time. Teamet (2026-11-18, mobilresan; replaces "no total" of beslut 15 for the tab's
 * figure): its krockar and its förfallna together, the two groups that need someone now – the same counts its groups show.
 */
function derivedChip(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = data as { totals?: { overdueWorkOrders: number | null }; unbilled?: { groups: number } | null };
  const count = (amount: number, text: string) => amount > 0 ? `${amount.toLocaleString("sv-SE")} ${text}` : null;
  if ("overdueJobs" in value && "deviations" in value) {
    const groups = teamGroupCounts(value as unknown as Parameters<typeof teamGroupCounts>[0]);
    return count(groups.conflicts + groups.overdue, "att åtgärda");
  }
  if (value.totals && "overdueWorkOrders" in value.totals) return count(value.totals.overdueWorkOrders ?? 0, "förfallna");
  if ("unbilled" in value) return count(value.unbilled?.groups ?? 0, "att fakturera");
  return null;
}


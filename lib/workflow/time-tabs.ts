/**
 * Tid har tre flikar (2026-11-01, beslut 13): Min tid · Teamet · Lön och export. Each tab is its own address
 * (/?view=time, &tab=team, &tab=payroll), so Bakåt and links work and every older /?view=time still opens Min tid.
 *
 * Who sees a tab follows the server's own checks: Teamet and the export need the Teamet right or admin (canViewTeam,
 * mayApproveTime, requireExport); the settings on Lön och export are admin only (requireAdmin). A person with Min tid only
 * has no tab row at all, and Local has one user and no team or payroll. Display only: every call is checked on the server.
 * Pure, so the workspace, the search and the tests read the same rule.
 */
export const TIME_TABS = ["mine", "team", "payroll"] as const;
export type TimeTab = (typeof TIME_TABS)[number];
export type TimeTabRights = { local: boolean; team: boolean; admin: boolean };

export const TIME_TAB_LABEL: Record<TimeTab, string> = { mine: "Min tid", team: "Teamet", payroll: "Lön och export" };
export const timeTabHref = (tab: TimeTab) => (tab === "mine" ? "/?view=time" : `/?view=time&tab=${tab}`);

export function timeTabsFor(rights: TimeTabRights): TimeTab[] {
  if (rights.local) return ["mine"];
  return rights.team || rights.admin ? ["mine", "team", "payroll"] : ["mine"];
}

/** An address that names a tab the person has no right to: the shared NoPermission box, never a silent jump (Local has no such tabs). */
export function timeTabDenied(asked: string | null | undefined, rights: TimeTabRights) {
  return !rights.local && (TIME_TABS as readonly (string | null | undefined)[]).includes(asked) && !timeTabsFor(rights).some((tab) => tab === asked);
}

/** The tab an address asks for; an unknown one, or one the person has no right to, counts as Min tid (see timeTabDenied). */
export function timeTabOf(asked: string | null | undefined, rights: TimeTabRights): TimeTab {
  return timeTabsFor(rights).find((tab) => tab === asked) ?? "mine";
}

import type { SitemapRole } from "./types";

/**
 * Provat i appen (2026-10-24: "är testet gjort i webbplatskartan?"): the map's marks from the click robot's round
 * (scripts/sitemap/observed.json). Plain functions shared by the page (features/workflow/site-map.tsx) and the tests; the
 * stand-alone page (scripts/sitemap/template.html) does the same in its own script.
 */

/** Visa: Allt · Provat i appen · Bara i koden. */
export type SeenFilter = "all" | "tested" | "code";

type Marked = { kind?: string; tested?: string[]; robotOnly?: boolean };

/** Whether a box or a line was tried by the robot (a way only the robot found counts as tried). */
export const wasTested = (item: Marked) => Boolean(item.robotOnly) || (item.tested?.length ?? 0) > 0;

/** Whether the filter shows the item. Without the robot's data, and for the menu groups and entries, always. */
export function seenVisible(item: Marked, mode: SeenFilter) {
  if (mode === "all" || item.tested === undefined) return true;
  if (item.kind === "group" || item.kind === "entry") return true;
  return mode === "tested" ? wasTested(item) : !wasTested(item);
}

/** The roles Visa som uses: the robot's (QA's roles) where it tried, else the code's. */
export const rolesFor = (item: { roles?: SitemapRole[]; appRoles?: SitemapRole[] }, followRobot: boolean) =>
  (followRobot && item.appRoles ? item.appRoles : item.roles);

const ROLE_TEXT: Record<string, string> = { superadmin: "Produktadmin", admin: "Kundföretagets admin", member: "Användare" };
const DEVICE_TEXT: Record<string, string> = { desktop: "dator", phone: "telefon" };

/** "Produktadmin (dator, telefon) · Användare (telefon)" from the runs "superadmin-desktop" … */
export function runsText(runs: string[] | undefined) {
  const byRole = new Map<string, string[]>();
  for (const run of runs ?? []) {
    const [role, device] = run.split("-");
    if (!byRole.has(role)) byRole.set(role, []);
    if (DEVICE_TEXT[device] && !byRole.get(role)!.includes(DEVICE_TEXT[device])) byRole.get(role)!.push(DEVICE_TEXT[device]);
  }
  return ["superadmin", "admin", "member"].filter((role) => byRole.has(role)).map((role) => `${ROLE_TEXT[role]} (${byRole.get(role)!.join(", ")})`).join(" · ");
}

/** The line for a box or a line in the panel and the tooltip. */
export function testedText(item: Marked) {
  if (item.tested === undefined) return "";
  if (item.robotOnly) return `Bara hittad av roboten – saknas i koden${item.tested.length ? `: ${runsText(item.tested)}` : ""}`;
  return item.tested.length ? `Provad i appen: ${runsText(item.tested)}` : "Bara i koden – aldrig nådd av roboten";
}

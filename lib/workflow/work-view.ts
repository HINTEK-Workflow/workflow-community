import { defaultDetailLevels, type DetailLevel, type DetailLevels } from "./detail-level";
import type { WorkListScope } from "./work-list";

/**
 * Arbetsvy (2026-10-08, proposal arbetsvy-och-behorighet step 5): the company's admin chooses a default work view
 * per person – Utförande, Ledande or Arbetsledning (neutral names since 2026-11-01, the stored keys are the same; the
 * occupation itself is the Yrkesprofil, lib/workflow/work-profile.ts). A work view is NOT a permission role: it only sets what is shown
 * first (display level per device, which panels start open on a task page, which menu groups start open, Mina or Alla in
 * the work lists). What the person may do is still the permission profile and the self-inspection level, checked by the
 * server on every call; no validation, requirement or saved data changes with the view.
 *
 * Priority, strongest first: server > company functions > always shown (Uppdraget, risk, priority …) > the admin's view
 * > the person's own choices > the device. The person may simplify or show more; when the admin changes the view, the
 * person's earlier choices for these defaults stop counting, so an old personal choice never bypasses the admin.
 *
 * Storage: the admin's choice is kept beside the member's permission profile (OrganizationMember.workflowPermissions,
 * key `workView`) only because that is the member's JSON record; no permission check reads it, and the permission schema
 * drops the key when it parses a profile. The person's own choices carry `viewBasis`, the stamp of the view they were
 * made under (UserPreferences; the work lists keep it beside the remembered scope on the device).
 */
export const WORK_VIEWS = ["fitter", "lead", "supervisor"] as const;
export type WorkView = (typeof WORK_VIEWS)[number];
export const WORK_VIEW_LABEL: Record<WorkView, string> = { fitter: "Utförande", lead: "Ledande", supervisor: "Arbetsledning" };
export const WORK_VIEW_DESCRIPTION: Record<WorkView, string> = {
  fitter: "Utförandet först. Planeringen ligger hopfälld i mobil och surfplatta.",
  lead: "Som Utförande, med Egenkontroll (krävd nivå och nivåer) öppen.",
  supervisor: "Allt öppet, planering och kontorets fält först, listorna visar Alla.",
};

/** The admin's choice for a member: the view (null = no default chosen) and when it was set, which is its stamp. */
export type WorkViewSetting = { view: WorkView | null; setAt: string };

export type WorkViewDefaults = {
  detailLevels: DetailLevels;
  /** Utförande först (executionFirst) for the responsible person at level 1–2. */
  executionFirst: boolean;
  /** The task page's Egenkontroll panel (risk class, levels) starts open. */
  openSelfInspection: boolean;
  /** The menu's "Ny X / Mina X" groups start open. */
  menuGroupsOpen: boolean;
  /** Mina or Alla in the work lists; Alla only where the person may read the area (resolveWorkListScope). */
  listScope: WorkListScope;
};

// Without a view (Local, the demo also with its people's profiles, a member the admin has not given one) everything is as before the work views.
const NO_VIEW: WorkViewDefaults = { detailLevels: { ...defaultDetailLevels }, executionFirst: true, openSelfInspection: false, menuGroupsOpen: false, listScope: "mine" };
// The phone (A2, 2026-10-22): Utförande and Ledande the app, Arbetsledning the app with Visa allt on (3); a
// saved 2 on the phone reads as 3 (phoneShowsAll). Utförande's tablet starts in the app view like everyone's without a view
// (appkänslan, produktägarens beslut 2026-11-23); Ledande and Arbetsledning keep Allt there, as the computer.
const VIEW_DEFAULTS: Record<WorkView, WorkViewDefaults> = {
  fitter: { detailLevels: { phone: 1, tablet: 1, desktop: 3 }, executionFirst: true, openSelfInspection: false, menuGroupsOpen: false, listScope: "mine" },
  lead: { detailLevels: { phone: 1, tablet: 3, desktop: 3 }, executionFirst: true, openSelfInspection: true, menuGroupsOpen: false, listScope: "mine" },
  supervisor: { detailLevels: { phone: 3, tablet: 3, desktop: 3 }, executionFirst: false, openSelfInspection: false, menuGroupsOpen: true, listScope: "all" },
};

export function workViewDefaults(setting: WorkViewSetting | null | undefined): WorkViewDefaults {
  const view = setting?.view;
  const defaults = view ? VIEW_DEFAULTS[view] : NO_VIEW;
  return { ...defaults, detailLevels: { ...defaults.detailLevels } };
}

export const isWorkView = (value: unknown): value is WorkView => WORK_VIEWS.includes(value as WorkView);

/** The admin's choice read from the member's JSON record; anything unknown is no choice. */
export function readWorkView(raw: unknown): WorkViewSetting | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as { workView?: unknown }).workView;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { view, setAt } = value as { view?: unknown; setAt?: unknown };
  if (typeof setAt !== "string" || !setAt || setAt.length > 40) return null;
  return { view: isWorkView(view) ? view : null, setAt };
}

/** The stamp the person's own choices must carry to count; "" while the admin has never chosen anything. */
export const workViewStamp = (setting: WorkViewSetting | null | undefined) => setting?.setAt ?? "";

/**
 * Whether the person's own choices still count. A choice saved before any view (no basis) counts until the admin chooses
 * one; `null` is "back to the default" (Återställ till standard); otherwise the basis must be the current view's stamp.
 */
export function personalChoicesCount(basis: string | null | undefined, setting: WorkViewSetting | null | undefined) {
  if (basis === null) return false;
  return (basis ?? "") === workViewStamp(setting);
}

const level = (value: unknown): DetailLevel | null => value === 1 || value === 2 || value === 3 ? value : null;

/** The display levels in force: the person's own while they count, otherwise the view's (or the plain defaults). */
export function effectiveDetailLevels(setting: WorkViewSetting | null | undefined, preferences: { detailLevel?: Partial<Record<keyof DetailLevels, unknown>> | null; viewBasis?: string | null } | null | undefined): DetailLevels {
  const defaults = workViewDefaults(setting).detailLevels;
  if (!preferences || !personalChoicesCount(preferences.viewBasis, setting)) return defaults;
  return { phone: level(preferences.detailLevel?.phone) ?? defaults.phone, tablet: level(preferences.detailLevel?.tablet) ?? defaults.tablet, desktop: level(preferences.detailLevel?.desktop) ?? defaults.desktop };
}

/** The scope a work list starts with: the remembered one while it counts, otherwise the view's. */
export function workListStartScope(saved: { scope?: WorkListScope; basis?: string | null }, setting: WorkViewSetting | null | undefined): WorkListScope {
  return saved.scope && personalChoicesCount(saved.basis, setting) ? saved.scope : workViewDefaults(setting).listScope;
}

/**
 * The admin's save: a new stamp only when the view changes or the admin resets the person's choices, so saving the
 * member's permissions keeps the person's own choices. `undefined` = nothing to write.
 */
export function nextWorkViewSetting(stored: WorkViewSetting | null, wanted: WorkView | null | undefined, reset: boolean, now: Date): WorkViewSetting | undefined {
  if (wanted === undefined && !reset) return undefined;
  const view = wanted === undefined ? stored?.view ?? null : wanted;
  if (!reset && (stored?.view ?? null) === view) return undefined;
  return { view, setAt: now.toISOString() };
}

/** The member's JSON record with the work view beside the permission profile (which stays exactly as it was). */
export function withWorkView(record: unknown, setting: WorkViewSetting | null | undefined) {
  const base = record && typeof record === "object" && !Array.isArray(record) ? { ...(record as Record<string, unknown>) } : {};
  delete base.workView;
  return setting ? { ...base, workView: setting } : base;
}

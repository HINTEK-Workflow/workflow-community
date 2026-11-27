/**
 * Egenkontrollens delar (2026-11-24, "lättare att gå mellan sidorna"): one row of pills under the heading for every part –
 * the shell's tab row, as on Kunder – each with its own address, so the browser's Bakåt, the app's arrows and the breadcrumbs
 * go step by step between them. The four new parts keep `&part=`, the older tabs `&tab=`. The rights are the backend's; this
 * only decides what the row offers (an admin's parts are not offered to a member).
 */
export const SELF_INSPECTION_TABS = [
  { key: "program", label: "Program", admin: false },
  { key: "roles", label: "Rollbeskrivningar", admin: true },
  { key: "organisation", label: "Organisation och ansvar", admin: true },
  { key: "cards", label: "Kompetenskort", admin: false },
  { key: "external", label: "Inhyrd personal", admin: true },
  { key: "review", label: "Årlig översyn", admin: true },
  { key: "versions", label: "Versioner", admin: true },
  { key: "levels", label: "Krävd nivå", admin: true },
] as const;
export type SelfInspectionTab = (typeof SELF_INSPECTION_TABS)[number]["key"];
export const SELF_INSPECTION_PARTS = ["roles", "organisation", "cards", "external"] as const;
export type SelfInspectionPart = (typeof SELF_INSPECTION_PARTS)[number];
const OLD_TABS = ["review", "versions", "levels"] as const;

export const isSelfInspectionPart = (value: string | null | undefined): value is SelfInspectionPart => (SELF_INSPECTION_PARTS as readonly string[]).includes(value ?? "");
export const selfInspectionTabLabel = (key: SelfInspectionTab) => SELF_INSPECTION_TABS.find((tab) => tab.key === key)!.label;

/** A part's address; `extra` are more values (an opened role or person: `&role=`, `&person=`). */
export function selfInspectionHref(key: string, extra: Record<string, string> = {}) {
  const base = key === "program" ? "/?view=self_inspection" : isSelfInspectionPart(key) ? `/?view=self_inspection&part=${key}` : `/?view=self_inspection&tab=${key}`;
  return `${base}${Object.entries(extra).map(([name, value]) => `&${name}=${encodeURIComponent(value)}`).join("")}`;
}
/** The part an address shows. */
export function selfInspectionTabOf(params: { get: (key: string) => string | null }): SelfInspectionTab {
  const part = params.get("part");
  if (isSelfInspectionPart(part)) return part;
  const tab = params.get("tab");
  return (OLD_TABS as readonly string[]).includes(tab ?? "") ? tab as SelfInspectionTab : "program";
}
/** The parts the row offers the reader. */
export const selfInspectionTabsFor = (admin: boolean) => SELF_INSPECTION_TABS.filter((tab) => admin || !tab.admin);

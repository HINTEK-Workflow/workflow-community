"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { COMPANY_VIEWS } from "@/lib/workflow/settings-tabs";
import { rememberShowMorePages } from "@/lib/workflow/show-more";
import { Bell, Building2, CalendarDays, Download, HelpCircle, Home, LayoutGrid, Lightbulb, Menu, MessageSquareWarning, Palette, Plug, Rocket, ShieldCheck, Smartphone, Sparkles, Trash2, UserRound } from "lucide-react";
import { REPORT_PATH } from "@ee/present";
import { NativeMenuPage, ShowMoreMarker, useNativeScreen, useNativeTopBar, type NativeMenuGroup } from "@/components/native";
import { useDetailLevel } from "@/features/workflow/use-detail-level";
import { MY_SETTINGS_GROUPS, nativeSettingsHidden, parseSettingsSection, SETTINGS_SECTION_TITLE, type SettingsSection, type TypeKey } from "@/lib/workflow/native-mode";

/**
 * Mina inställningar on a phone at level 1 (Nivå 1 på mobil, 2026-10-09): grouped rows like the phone's Settings
 * app; each row opens the page's own panel or fieldset as a screen of its own (`&step=` in the address, so Bakåt works).
 * The page keeps its fields where they are and wraps each part in `NativeScreen`; nothing is rebuilt here.
 */
type Row = { key: SettingsSection; icon: LucideIcon; type: TypeKey; value?: string; subtitle?: string };
/** Each row's icon and colour; the groups and their order come from MY_SETTINGS_GROUPS (the same as on the computer). */
const ROW: Record<SettingsSection, Omit<Row, "key">> = {
  start: { icon: Home, type: "neutral" }, theme: { icon: Palette, type: "quote" }, sidemenu: { icon: Menu, type: "neutral" },
  display: { icon: Smartphone, type: "project" }, home: { icon: LayoutGrid, type: "project" }, install: { icon: Download, type: "neutral" },
  notices: { icon: Bell, type: "work-order" }, advisor: { icon: Lightbulb, type: "risk" }, ai: { icon: Sparkles, type: "control" },
  profile: { icon: UserRound, type: "customer" }, security: { icon: ShieldCheck, type: "round" }, calendar: { icon: CalendarDays, type: "project" }, apps: { icon: Plug, type: "instrument" },
  erase: { icon: Trash2, type: "neutral" },
};

/** The page's own frame (a Panel) outside the native look; at level 1 on a phone only its contents, one part per screen. */
export function NativeUnwrap({ wrap, children }: { wrap: (children: ReactNode) => ReactNode; children: ReactNode }) {
  const { native } = useNativeScreen();
  return native ? <>{children}</> : wrap(children);
}

export function NativeSettingsMenu({ values, has, setupHref, companyHref }: {
  /** What a row shows to the right (the chosen start page, display level, theme). */
  values: Partial<Record<SettingsSection, string>>;
  /** Parts this installation and person have (Local has no layout editor, Workflow AI and connected apps are optional). */
  has: Partial<Record<SettingsSection, boolean>>;
  /** Ställ in Workflow for an administrator. */
  setupHref?: string | null;
  /** The company's settings for an administrator: always a row (TF10, 2026-11-01), which opens them on a phone without Visa mer. */
  companyHref?: string | null;
}) {
  const { native, step } = useNativeScreen();
  const content = useDetailLevel();
  const section = parseSettingsSection(step);
  useNativeTopBar(native && section ? { title: SETTINGS_SECTION_TITLE[section] } : null);
  if (!native || step) return null;
  const href = (key: SettingsSection) => `/?view=settings&step=${key}`;
  // M2 (2026-10-12): Profil and Konto och säkerhet as the two big tiles; the sections slimmed away at level 1
  // (NATIVE_SETTINGS_HIDDEN) are in display level 2, and on a phone behind Visa mer (A2). The title is the top bar's.
  const shown = (key: SettingsSection) => has[key] !== false && !nativeSettingsHidden(key, content);
  // Visa mer is offered when a section is left out (lib/workflow/show-more.ts, the data-show-more marker).
  const more = (Object.keys(ROW) as SettingsSection[]).some((key) => has[key] !== false && nativeSettingsHidden(key, 1));
  const tile = (key: "profile" | "security") => shown(key) ? { title: SETTINGS_SECTION_TITLE[key], type: ROW[key].type, icon: ROW[key].icon, href: href(key), testId: `native-settings-${key}` } : null;
  const tiles = [tile("profile"), tile("security")].filter((item): item is NonNullable<typeof item> => item !== null);
  const rows = (keys: readonly SettingsSection[]) => keys.filter((key) => key !== "profile" && key !== "security" && shown(key)).map(
    (key) => ({ key, type: ROW[key].type, icon: ROW[key].icon, title: SETTINGS_SECTION_TITLE[key], value: values[key], href: href(key), testId: `native-settings-${key}` }));
  const groups: NativeMenuGroup[] = MY_SETTINGS_GROUPS.map((group) => ({
    title: group.title,
    rows: [...rows(group.sections),
      ...(group.title === "Konto" && setupHref ? [{ key: "setup", type: "project" as const, icon: Rocket, title: "Ställ in Workflow", subtitle: "Avtal, företaget och första stegen", href: setupHref, testId: "native-settings-setup" }] : [])],
  })).filter((group) => group.rows.length);
  // Hjälp is a tab beside Mina inställningar on the computer; at level 1 there is no tab row, so it is a row here. The
  // company's tabs are office work, drawn with Visa mer (A2): the row turns it on for them (TF10), so one tap opens them.
  groups.push({
    rows: [...(companyHref ? [{ key: "company", type: "neutral" as const, icon: Building2, title: "Företagets inställningar", subtitle: "Företaget, användare, priser och funktioner", href: companyHref, onClick: () => rememberShowMorePages(COMPANY_VIEWS), testId: "native-settings-company" }] : []),
      { key: "help", type: "neutral", icon: HelpCircle, title: "Hjälp", subtitle: "Nyheter och hur Workflow hänger ihop", href: "/?view=help", testId: "native-settings-help" },
      // Rapportera fel eller förslag (2026-11-13): the profile menu's row, here at level 1 where there is no profile menu.
      ...(REPORT_PATH ? [{ key: "report", type: "neutral" as const, icon: MessageSquareWarning, title: "Rapportera fel eller förslag", subtitle: "Berätta vad som inte fungerar", href: REPORT_PATH, testId: "native-settings-report" }] : [])] });
  return <><ShowMoreMarker when={more} /><NativeMenuPage testId="native-settings" tiles={tiles} groups={groups} /></>;
}

"use client";

import { Archive, BadgeCheck, Calculator, FilePenLine, Gauge, Upload, type LucideIcon } from "lucide-react";
import { HubCards, PageHeader } from "@/components/page-shell";
import { NativeMenuPage, ShowMoreMarker } from "@/components/native";
import { menuItemAllowed, type MenuAccess } from "@/lib/workflow/menu-items";
import { SUPPORT_DESCRIPTION, SUPPORT_VIEWS, VIEW_LABEL, type SupportView } from "@/lib/workflow/navigation";
import { nativeHidesView, NATIVE_MORE_HIDDEN, type TypeKey } from "@/lib/workflow/native-mode";
import { useDetailLevel, useNativeMode } from "@/features/workflow/use-detail-level";

const ICON: Record<SupportView, LucideIcon> = { report_archive: Archive, self_inspection: BadgeCheck, instruments: Gauge, calculators: Calculator, import: Upload, forms: FilePenLine };
// Verktyg: one shared colour for all its pages (2026-10-24, answer 7).
const TYPE: Record<SupportView, TypeKey> = { report_archive: "tools", self_inspection: "tools", instruments: "tools", calculators: "tools", import: "tools", forms: "tools" };

/**
 * Verktyg (2026-10-09; Register for a while in point 5, Verktyg again 2026-10-23; Kunder is a menu button of its
 * own since B2, Skapa formulär is here since 2026-10-23 and Kalkylator since 2026-11-01): the supporting pages gathered under one menu choice. The hub lists the sub-pages the person may use (the menu's own rule, display only;
 * each page's server checks the rights). At level 1 on a phone it is a grouped list without the pages that are in display level 2 (Import).
 */
export function ToolsHub({ access }: { access: MenuAccess | null }) {
  const native = useNativeMode();
  // On a phone Visa mer brings the pages for a larger screen back (A2); the marker tells the button there is more.
  const content = useDetailLevel();
  const permitted = SUPPORT_VIEWS.filter((view) => menuItemAllowed(view, access) && !(native && NATIVE_MORE_HIDDEN.has(view)));
  const allowed = permitted.filter((view) => !nativeHidesView(native, content, view));
  const more = native && permitted.some((view) => nativeHidesView(native, 1, view));
  // M2 (2026-10-12): the first two pages as tiles, the rest as rows; the title is the top bar's.
  if (native) {
    const open = (view: SupportView) => ({ title: VIEW_LABEL[view], subtitle: SUPPORT_DESCRIPTION[view], type: TYPE[view], icon: ICON[view], href: `/?view=${view}`, testId: `hub-${view}` });
    return <><ShowMoreMarker when={more} /><NativeMenuPage testId="tools-hub" tiles={allowed.slice(0, 2).map((view) => ({ ...open(view), subtitle: undefined }))} groups={[{ rows: allowed.slice(2).map((view) => ({ key: view, ...open(view) })) }]} /></>;
  }
  const items = allowed.map((view) => ({ href: `/?view=${view}`, title: VIEW_LABEL[view], description: SUPPORT_DESCRIPTION[view], icon: ICON[view], testId: `hub-${view}` }));
  return <div data-testid="tools-hub">
    <PageHeader title={VIEW_LABEL.tools} description="Rapporter, egenkontroll, instrument, kalkylator, formulär och import. Under Anpassa menyn kan du visa en sida direkt i menyn." />
    {items.length ? <HubCards items={items} area="tools" /> : <p className="notice" role="status">Det finns inga register eller verktyg som du kan använda här.</p>}
  </div>;
}

import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { Bell, CalendarClock, ClipboardCheck, Clock, FolderKanban, Gauge, MapPin, Plus, Repeat, Settings2, ShieldAlert, ShoppingCart, Users, Wrench, ClipboardList, FileText, PencilRuler } from "lucide-react";
import { cn } from "@/lib/utils";
import { panelAreaColor, type PanelArea } from "@/lib/workflow/panel-area";

/**
 * Ikonstandarden (2026-10-24, docs/proposals/ikoner-standard-2026-10-24.md; Uppgifter is the reference): one icon
 * square for the whole app, coloured by the function (area) it belongs to – the --type-* tokens, Workflow Blue for
 * Inställningar and Installation; Verktyg's pages share a slate blue-grey (`tools`) and Kalender has a plum of its
 * own (`calendar`, 2026-10-24). Two tones:
 *   - `soft`  – lists and overviews: a light background in the function's colour and a darker symbol (Uppgifter's light
 *               violet rows);
 *   - `solid` – main and content cards: the function's colour filled, a white symbol (Uppgifter's dark violet cards).
 * One size (2 rem, 8 px rounding, a 16 px symbol) everywhere; `tile` is the motivated variant for Hem's large tiles on the
 * phone. Status colours (green, amber, red) are never an area: a status keeps `indicatorBadge`.
 */
export type AreaIconTone = "soft" | "solid";
export type AreaIconSize = "md" | "tile";

/** The icon of each area: the same symbol as the app's icon squares of that type (components/native/type-icon.tsx). */
const AREA_ICON: Record<PanelArea, LucideIcon> = {
  "work-order": ClipboardList, control: ClipboardCheck, risk: ShieldAlert, round: Repeat, time: Clock, customer: Users,
  project: FolderKanban, quote: FileText, purchase: ShoppingCart, instrument: Gauge, tools: PencilRuler, calendar: CalendarClock, maintenance: Wrench, neutral: Settings2,
  checkin: MapPin, new: Plus, notice: Bell, admin: Settings2,
};
export const areaIconOf = (area: PanelArea): LucideIcon => AREA_ICON[area];

export function AreaIcon({ area, icon, tone = "soft", size = "md", className, testId, dataType }: {
  /** The function the icon belongs to; without it the icon takes the surrounding card's colour (`--panel-tone`). */
  area?: PanelArea;
  icon?: LucideIcon;
  tone?: AreaIconTone;
  size?: AreaIconSize;
  className?: string;
  testId?: string;
  /** The app view's type key on the square (`data-type`), which its screen tests find rows by. */
  dataType?: string;
}) {
  const Icon = icon ?? (area ? AREA_ICON[area] : Settings2);
  return <span aria-hidden="true" data-tone={tone} data-size={size} data-area={area} data-type={dataType} data-testid={testId} className={cn("area-icon", className)}
    style={area ? { "--area-color": panelAreaColor(area) } as CSSProperties : undefined}>
    <Icon />
  </span>;
}

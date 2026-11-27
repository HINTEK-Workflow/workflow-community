import type { LucideIcon } from "lucide-react";
import { CalendarClock } from "lucide-react";
import { AreaIcon, areaIconOf, type AreaIconTone } from "@/components/area-icon";
import type { TypeKey } from "@/lib/workflow/native-mode";

/**
 * The icon square of a type in the app view (Nivå 1 på mobil, 2026-10-09): since the icon standard (
 * 2026-10-24) it is the shared `AreaIcon` – the same size, rounding and colour per function as on the computer. A list row
 * is soft (a light background in the type's colour, a darker symbol), Hem's tiles are solid (the colour filled, a white
 * symbol), like Uppgifter's rows and cards.
 */
export const typeIconOf = (type: TypeKey): LucideIcon => areaIconOf(type);
export const PLANNING_ICON = CalendarClock;

export function TypeIcon({ type, icon, size = "row", tone, className }: { type: TypeKey; icon?: LucideIcon; size?: "row" | "tile"; tone?: AreaIconTone; className?: string }) {
  return <AreaIcon area={type} icon={icon} size={size === "tile" ? "tile" : "md"} tone={tone ?? (size === "tile" ? "solid" : "soft")} className={className} dataType={type} />;
}

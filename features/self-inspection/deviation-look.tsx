import type { LucideIcon } from "lucide-react";
import { Eye, Lightbulb, Siren, TriangleAlert, Zap } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { scaleBadge, scaleSurface, type ScaleStep } from "@/features/workflow/indicator-tone";
import { DEVIATION_SEVERITIES, DEVIATION_SEVERITY_STEP, DEVIATION_TYPES, deviationSeverity, deviationType, type DeviationView } from "@/lib/self-inspection/model";
import type { TypeKey } from "@/lib/workflow/native-mode";

/**
 * Avvikelsernas utseende i listan (2026-10-30: "Ikonen kan vara typen och bakgrundsfärgen på kortet
 * allvarlighetsgraden"; "Ikonfärgen kan vara samma färg som menyvalet oavsett typ … alltså en gemensam ikonfärg"): every
 * icon is in the menu item's colour (risk, --type-risk; the shared icon standard, components/area-icon.tsx) and only the
 * symbol tells the type. On a tinted card it stands on its own base (ICON_ON_TINT), so the orange never blends into the
 * tint. Allvarlighetsgrad (Låg · Normal · Hög · Akut) is a pill and the card's tint, steps on one yellow → orange → red scale
 * ("gradient från gul, orange, röd"; the shared scale in features/workflow/indicator-tone.ts); a Förbättring is plain.
 */
export type DeviationLookKey = keyof typeof DEVIATION_TYPES | "IMPROVEMENT";
export const DEVIATION_LOOK: Record<DeviationLookKey, { label: string; icon: LucideIcon; area: TypeKey }> = {
  SELF_INSPECTION: { label: DEVIATION_TYPES.SELF_INSPECTION, icon: Zap, area: "risk" },
  RISK_OBSERVATION: { label: DEVIATION_TYPES.RISK_OBSERVATION, icon: Eye, area: "risk" },
  NEAR_MISS: { label: DEVIATION_TYPES.NEAR_MISS, icon: TriangleAlert, area: "risk" },
  ACCIDENT: { label: DEVIATION_TYPES.ACCIDENT, icon: Siren, area: "risk" },
  IMPROVEMENT: { label: "Förbättring", icon: Lightbulb, area: "risk" },
};
export const deviationLookKey = (item: Pick<DeviationView, "kind"> & { type?: string | null }): DeviationLookKey =>
  item.kind === "IMPROVEMENT" ? "IMPROVEMENT" : deviationType(item.type);
export const deviationLook = (item: Pick<DeviationView, "kind"> & { type?: string | null }) => DEVIATION_LOOK[deviationLookKey(item)];

/** The entry's Allvarlighetsgrad: its label, step, pill and tint classes (the shared scale); a Förbättring has none (null). */
export function severityOf(item: Pick<DeviationView, "kind" | "severity">): { key: string; label: string; step: ScaleStep; badge: string; surface: string } | null {
  if (item.kind === "IMPROVEMENT") return null;
  const severity = deviationSeverity(item.severity);
  const step = DEVIATION_SEVERITY_STEP[severity];
  return { key: severity, label: DEVIATION_SEVERITIES[severity], step, badge: scaleBadge(step), surface: scaleSurface(step) };
}
/** The icon on a tinted card or row: its own base (a ring in the card's colour), so the common orange never blends into the tint. */
export const ICON_ON_TINT = "ring-2 ring-card shadow-xs";

/** The type's icon square (soft, as in every list). */
export function DeviationTypeIcon({ item, onTint = false }: { item: Pick<DeviationView, "kind"> & { type?: string | null }; onTint?: boolean }) {
  const look = deviationLook(item);
  return <AreaIcon area={look.area} icon={look.icon} className={onTint ? ICON_ON_TINT : undefined} dataType={deviationLookKey(item)} />;
}

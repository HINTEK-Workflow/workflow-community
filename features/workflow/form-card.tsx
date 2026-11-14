import type { ReactNode } from "react";
import { Building2, Camera, ClipboardCheck, FileSpreadsheet, Flame, Gauge, ListChecks, Plug, ShieldCheck, Thermometer, Wrench, Zap, type LucideIcon, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formCategoryLabel, type FORM_ICONS } from "@/lib/workflow/form-publish";
import { formColorClass } from "./form-colors";
import { RiskClassMark } from "@/features/self-inspection/risk-class-mark";
import type { RiskClass } from "@/lib/self-inspection/levels";

/** A form's icon from a fixed list (decision 2): forms never bring their own pictures, scripts or styles. */
export const FORM_ICON_COMPONENTS: Record<(typeof FORM_ICONS)[number], { icon: LucideIcon; label: string }> = {
  "file-spreadsheet": { icon: FileSpreadsheet, label: "Protokoll" },
  "clipboard-check": { icon: ClipboardCheck, label: "Kontroll" },
  "list-checks": { icon: ListChecks, label: "Checklista" },
  gauge: { icon: Gauge, label: "Mätning" },
  zap: { icon: Zap, label: "El" },
  plug: { icon: Plug, label: "Anslutning" },
  wrench: { icon: Wrench, label: "Service" },
  "shield-check": { icon: ShieldCheck, label: "Säkerhet" },
  "shield-alert": { icon: ShieldAlert, label: "Risk" },
  flame: { icon: Flame, label: "Brand" },
  thermometer: { icon: Thermometer, label: "Temperatur" },
  camera: { icon: Camera, label: "Foto" },
  building: { icon: Building2, label: "Fastighet" },
};

export function FormIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = FORM_ICON_COMPONENTS[icon as keyof typeof FORM_ICON_COMPONENTS]?.icon ?? FileSpreadsheet;
  return <Icon className={className} />;
}

export type FormCardData = { name: string; description: string; color: string; icon: string; category: string; version?: number | null; allowStandalone: boolean; allowInProject: boolean; publisher?: string;
  /** Workflow's original of a built-in type, or the company's own version of one (2026-09-28: the card says which). */
  origin?: "original" | "companyVersion";
  /** Workflow's own form (2026-09-28): marked HINTEK Original in small text; a community form names its author. */
  hintek?: boolean; source?: string; author?: string;
  /** The form's risk class (2026-10-07), the company's own or Workflow's proposal; a small mark on the card. */
  risk?: { value: RiskClass; suggested: boolean } | null;
  /** An admin changes the class from the card. */
  onRiskClass?: () => void };

/**
 * A published form as it appears under Ny uppgift. The builder shows the same card before publishing, so the
 * superadmin sees exactly what customers will see.
 */
export function FormTypeCardContent({ form, corner, children, meta }: { form: FormCardData; corner?: ReactNode; children?: ReactNode;
  /** A small link on the card's last line, left of who made the form (Värden för den här kontrollen). */ meta?: ReactNode }) {
  const usage = form.allowStandalone && form.allowInProject ? null : form.allowInProject ? "Kopplas till ett projekt" : "Används utan projekt";
  // A global original says who made it (2026-11-10, M3): the built-in ones Workflow, the installation's own its operator.
  const origin = form.hintek ? `${form.publisher || "HINTEK"} Original` : form.source === "COMMUNITY" && form.author ? `Community · ${form.author}` : form.publisher ? `Utgivare: ${form.publisher}` : null;
  return <>
    <div className="flex items-start justify-between gap-3">
      <span className={cn("flex size-11 items-center justify-center rounded-xl", formColorClass(form.color))}><FormIcon icon={form.icon} className="size-5" /></span>
      <span className="relative z-10 flex flex-wrap items-center justify-end gap-1.5">
        {form.risk ? <RiskClassMark value={form.risk.value} suggested={form.risk.suggested} onClick={form.onRiskClass} /> : null}
        {form.origin === "companyVersion" ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="form-origin">Er version</Badge> : null}
        {corner ?? (form.origin === "companyVersion" ? null : <Badge variant="outline">{formCategoryLabel(form.category)}</Badge>)}
      </span>
    </div>
    <h2 className="section-title mt-5 truncate" title={form.name || undefined} data-card-title="">{form.name || "Namnlöst formulär"}</h2>
    {/* Short texts (2026-09-29): at most three lines, so the cards keep an even height; the whole text is the title. */}
    <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-muted-foreground" title={form.description || undefined}>{form.description || (form.publisher ? `Formulär från ${form.publisher}.` : form.hintek ? "Formulär från Workflow." : "Ingen beskrivning ännu.")}</p>
    {usage ? <p className="mt-1 text-xs text-muted-foreground">{usage}.</p> : null}
    {children}
    {/* Who made the form, in one place (2026-09-29): "HINTEK Original" for Workflow's own, otherwise the publisher
        (2026-09-27, so shared forms can be told apart) or a community author – with the version. Since 2026-10-07 on the
        card's own last line, in the flow beside the values link, so nothing overlaps and every card ends on the same line.
        Since 2026-10-08 in 12 px like the card's other metadata (10 px was hard to read); the values link beside it is
        short, so the line fits without a tooltip. The title only complements a very long publisher name. */}
    <CardFoot meta={meta} label={origin} version={form.version} testId={form.hintek ? "hintek-original" : "form-publisher"} />
  </>;
}

/** The card's last line: an optional link to the left, who made the type (and its version) to the right. */
export function CardFoot({ meta, label, version, testId }: { meta?: ReactNode; label: string | null; version?: number | null; testId?: string }) {
  const full = label ? `${label}${version ? ` · version ${version}` : ""}` : "";
  return <div className="mt-3 flex min-h-5 items-center justify-between gap-3" data-testid="form-card-foot">
      {meta ?? <span aria-hidden="true" />}
      {label ? <span className="min-w-0 truncate text-right text-xs font-medium text-muted-foreground" title={full} data-testid={testId}>
        {label}{version ? <span className="font-normal"> · version {version}</span> : null}
      </span> : null}
    </div>;
}

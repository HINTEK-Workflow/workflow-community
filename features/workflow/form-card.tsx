import type { ReactNode } from "react";
import { Building2, Camera, ClipboardCheck, FileSpreadsheet, Flame, Gauge, ListChecks, Plug, ShieldCheck, Thermometer, Wrench, Zap, type LucideIcon, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formCategoryLabel, type FORM_ICONS } from "@/lib/workflow/form-publish";
import { formColorClass } from "./form-colors";

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
  /** HINTEK's original of a built-in type, or the company's own version of one (2026-09-28: the card says which). */
  origin?: "original" | "companyVersion";
  /** HINTEK's own form (2026-09-28): marked HINTEK Original in small text; a community form names its author. */
  hintek?: boolean; source?: string; author?: string };

/**
 * A published form as it appears under Ny uppgift. The builder shows the same card before publishing, so the
 * superadmin sees exactly what customers will see.
 */
export function FormTypeCardContent({ form, corner, children }: { form: FormCardData; corner?: ReactNode; children?: ReactNode }) {
  const usage = form.allowStandalone && form.allowInProject ? null : form.allowInProject ? "Kopplas till ett projekt" : "Används fristående";
  const origin = form.hintek ? "HINTEK Original" : form.source === "COMMUNITY" && form.author ? `Community · ${form.author}` : form.publisher ? `Utgivare: ${form.publisher}` : null;
  return <>
    <div className="flex items-start justify-between gap-3">
      <span className={cn("flex size-11 items-center justify-center rounded-xl", formColorClass(form.color))}><FormIcon icon={form.icon} className="size-5" /></span>
      <span className="relative z-10 flex flex-wrap items-center justify-end gap-1.5">
        {form.origin === "companyVersion" ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="form-origin">Er version</Badge> : null}
        {corner ?? (form.origin === "companyVersion" ? null : <Badge variant="outline">{formCategoryLabel(form.category)}</Badge>)}
      </span>
    </div>
    <h2 className="section-title mt-5">{form.name || "Namnlöst formulär"}</h2>
    {/* Short texts (2026-09-29): at most three lines, so the cards keep an even height; the whole text is the title. */}
    <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-muted-foreground" title={form.description || undefined}>{form.description || `Formulär från ${form.publisher ?? "HINTEK"}.`}</p>
    {usage ? <p className="mt-1 text-xs text-muted-foreground">{usage}.</p> : null}
    {children}
    {/* Who made the form, in one place (2026-09-29): "HINTEK Original" for HINTEK's own, otherwise the publisher
        (2026-09-27, so shared forms can be told apart) or a community author – with the version. */}
    {origin ? <span className="pointer-events-none absolute bottom-2.5 right-3.5 max-w-[55%] truncate text-right text-[10px] font-medium tracking-wide text-muted-foreground" data-testid={form.hintek ? "hintek-original" : "form-publisher"}>
      {origin}{form.version ? <span className="font-normal"> · version {form.version}</span> : null}
    </span> : null}
  </>;
}

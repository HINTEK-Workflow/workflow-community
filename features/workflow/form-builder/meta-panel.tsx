"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Panel } from "@/features/kfid/ui";
import { FORM_CATEGORIES, FORM_ICONS, formCategoryLabel, formDisplayName, type FormMeta } from "@/lib/workflow/form-publish";
import type { EditorDocument } from "@/lib/workflow/form-editor";
import { FORM_ICON_COMPONENTS, FormIcon, FormTypeCardContent } from "../form-card";
import { FORM_COLOR_OPTIONS, formColorClass } from "../form-colors";

const label = "grid gap-1.5 text-xs font-medium text-muted-foreground";

type DocumentSettings = Pick<EditorDocument, "report" | "moments" | "task">;

/**
 * Grunduppgifter (2026-09-26): compact at the top and collapsible while working in the editor. Open for a new
 * form, collapsed for an existing one; the card beside the icon and colour is exactly what Ny uppgift will show. The
 * form's report heading and its moments (2026-09-27) are set here too; they are saved with the form's version.
 * The content uses the whole width of the card (2026-10-07): fields in rows of up to four, the limits in two
 * columns, so nothing ends far from the card's right edge.
 */
export function MetaPanel({ meta, status, version, open, onToggle, onChange, settings, onSettings, titleFields = [], limits, riskClass, valuesHref }: {
  meta: FormMeta; status: string; version: number | null; open: boolean; onToggle: () => void; onChange: (patch: Partial<FormMeta>, group: string) => void;
  settings: DocumentSettings; onSettings: (patch: Partial<DocumentSettings>, group: string) => void;
  /** The text fields the task's title can follow. */
  titleFields?: { key: string; label: string }[];
  /** The form's configurable limits (2026-09-28), edited here on every screen size. */
  limits?: ReactNode;
  /** The form's risk class (2026-10-07): the company's own, set at once and not part of the version. */
  riskClass?: ReactNode;
  /** Företagets gränsvärden for this form in Värden och referenser (UX-granskningen C5, 2026-10-22); a saved form only. */
  valuesHref?: string;
}) {
  const set = <K extends keyof FormMeta>(key: K) => (value: FormMeta[K]) => onChange({ [key]: value } as Partial<FormMeta>, `meta:${key}`);
  // Rapport och moment are advanced (kundresa 2026-11-07, L40: a new form showed twelve settings at once): folded until
  // opened, open from the start once any of them differs from a new form's.
  const [reportOpen, setReportOpen] = useState(() => Boolean(settings.report.title || settings.report.code || settings.task.newTitle || settings.task.tagline || settings.task.titleKey
    || settings.task.layout !== "panel" || settings.moments.requireOne || settings.moments.placement !== "top" || (settings.moments.label && settings.moments.label !== "Moment") || !settings.report.taskFacts || !settings.task.requiredMarks));
  // The shared Panel (hela kortet klickbart, 2026-10-24): the whole header opens and folds Grunduppgifter, only the
  // arrow at the right; the form's own icon and colour stand where a card's icon stands.
  return <div data-testid="form-meta"><Panel title="Grunduppgifter" icon={null}
    leadingIcon={<span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", formColorClass(meta.color))} aria-hidden="true"><FormIcon icon={meta.icon} className="size-4" /></span>}
    description={open ? undefined : `${meta.name || "Namnlöst formulär"} · visas som ”${formDisplayName(meta)}” · ${formCategoryLabel(meta.category)} · ${status}`}
    collapsible collapsed={!open} onCollapsedChange={(collapsed) => { if (collapsed === open) onToggle(); }}>
    <div id="form-meta-content" className="grid gap-5" data-testid="form-meta-body">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className={label}>Namn<Input id="form-meta-name" value={meta.name} maxLength={120} placeholder="t.ex. Isolationsmätning" onChange={(event) => set("name")(event.target.value)} /></label>
        <label className={label}>Namn under Ny uppgift<Input id="form-meta-displayName" value={meta.displayName} maxLength={120} placeholder={meta.name || "Samma som namnet"} onChange={(event) => set("displayName")(event.target.value)} /></label>
        <label className={label}>Kategori<select id="form-meta-category" className="form-select" value={meta.category} onChange={(event) => set("category")(event.target.value as FormMeta["category"])}>{FORM_CATEGORIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <fieldset className="grid content-start gap-1.5"><legend className="mb-1.5 text-xs font-medium text-muted-foreground">Får användas</legend>
          <label className="flex items-center gap-2 text-sm"><input id="form-meta-allowStandalone" type="checkbox" checked={meta.allowStandalone} onChange={(event) => set("allowStandalone")(event.target.checked)} />Utan projekt</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={meta.allowInProject} onChange={(event) => set("allowInProject")(event.target.checked)} />I projekt</label>
        </fieldset>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <div className={label}>Ikon
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ikon">{FORM_ICONS.map((icon) => {
              const Icon = FORM_ICON_COMPONENTS[icon].icon;
              return <button key={icon} type="button" role="radio" aria-checked={meta.icon === icon} aria-label={FORM_ICON_COMPONENTS[icon].label} title={FORM_ICON_COMPONENTS[icon].label} onClick={() => set("icon")(icon)}
                className={cn("flex size-9 items-center justify-center rounded-lg border-2 transition-colors hover:bg-secondary", meta.icon === icon ? "border-primary bg-secondary text-primary" : "border-transparent text-muted-foreground")}><Icon className="size-4" /></button>;
            })}</div>
          </div>
          <div className={label}>Färg
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Färg">{FORM_COLOR_OPTIONS.map(([value, text]) => <button key={value} type="button" role="radio" aria-checked={meta.color === value} aria-label={text} title={text} onClick={() => set("color")(value)} className={cn("size-8 rounded-lg border-2", formColorClass(value), meta.color === value ? "border-primary" : "border-transparent")} />)}</div>
          </div>
          <label className={label}>Kort beskrivning under Ny uppgift<textarea className="form-textarea min-h-20" maxLength={500} value={meta.description} placeholder="Vad protokollet används till." onChange={(event) => set("description")(event.target.value)} /><span className="text-[11px] font-normal">{meta.description.length}/500 tecken. Kort text blir tydligast på kortet.</span></label>
          {riskClass ? <div data-testid="form-risk-class-field">{riskClass}</div> : null}
        </div>
        <div className="grid content-start gap-2">
          <p className="text-xs font-medium text-muted-foreground">Så visas den under Ny uppgift</p>
          <div className="flex min-h-52 flex-col rounded-xl border bg-card p-5 shadow-xs" data-testid="form-card-preview"><FormTypeCardContent form={{ ...meta, name: formDisplayName(meta), version }} /></div>
          <p className="text-xs text-muted-foreground">Status: <Badge variant="outline">{status}</Badge></p>
        </div>
      </div>
      <details className="group rounded-lg border" open={reportOpen} onToggle={(event) => setReportOpen(event.currentTarget.open)} data-testid="form-report-settings">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground" data-testid="form-report-settings-toggle">Rapport och moment (avancerat)<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
      <fieldset className="field-group grid gap-3 border-t p-3 md:grid-cols-2 xl:grid-cols-4"><legend className="sr-only">Rapport och moment</legend>
        <label className={label}>Rubrik i PDF:en<Input id="form-meta-reportTitle" value={settings.report.title} maxLength={120} placeholder={meta.name || "Formulärets namn"} onChange={(event) => onSettings({ report: { ...settings.report, title: event.target.value } }, "report:title")} /></label>
        <label className={label}>Kod under rubriken<Input value={settings.report.code} maxLength={60} placeholder="Version och nummer, t.ex. Regelprofil V1-2026.1" onChange={(event) => onSettings({ report: { ...settings.report, code: event.target.value } }, "report:code")} /></label>
        <label className={label}>Rubrik över momenten som kan väljas bort<Input value={settings.moments.label} maxLength={60} placeholder="Moment" onChange={(event) => onSettings({ moments: { ...settings.moments, label: event.target.value } }, "moments:label")} /></label>
        <label className={label}>Momenten väljs<select className="form-select" value={settings.moments.placement} onChange={(event) => onSettings({ moments: { ...settings.moments, placement: event.target.value as EditorDocument["moments"]["placement"] } }, "moments:placement")}><option value="top">Överst i uppgiften</option><option value="firstSection">Sist i första avsnittet (som kontrollens grunduppgifter)</option></select></label>
        {/* The task's own basic data (2026-09-27): Workflow's panel, or inside the form like the control. */}
        <label className={label}>Uppgiftens grunduppgifter (projekt, kund, plats)<select className="form-select" value={settings.task.layout} onChange={(event) => onSettings({ task: { ...settings.task, layout: event.target.value as EditorDocument["task"]["layout"] } }, "task:layout")}><option value="panel">Egen panel före formuläret</option><option value="inline">Inne i formulärets första avsnitt (som kontrollen)</option></select></label>
        <label className={label}>Uppgiftens rubrik följer fältet<select className="form-select" value={settings.task.titleKey} onChange={(event) => onSettings({ task: { ...settings.task, titleKey: event.target.value } }, "task:titleKey")}><option value="">Skrivs av den som fyller i</option>{titleFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
        {/* The heading and the line under it for a new protocol, exactly like the originals (2026-09-28: "Ny kontroll"). */}
        <label className={label}>Rubrik för ett nytt protokoll<Input value={settings.task.newTitle} maxLength={120} placeholder={`Nytt protokoll: ${meta.name || "formulärets namn"}`} onChange={(event) => onSettings({ task: { ...settings.task, newTitle: event.target.value } }, "task:newTitle")} /></label>
        <label className={label}>Text under rubriken tills protokollet är sparat<Input value={settings.task.tagline} maxLength={200} placeholder="Uppgiften läggs i arbetsordern." onChange={(event) => onSettings({ task: { ...settings.task, tagline: event.target.value } }, "task:tagline")} /></label>
        <div className="grid content-start gap-2 md:col-span-2 xl:col-span-4 xl:grid-cols-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.report.taskFacts} onChange={(event) => onSettings({ report: { ...settings.report, taskFacts: event.target.checked } }, "report:taskFacts")} />Uppgiftens fakta (projekt, kund, ansvarig, status) först i PDF:en</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.moments.requireOne} onChange={(event) => onSettings({ moments: { ...settings.moments, requireOne: event.target.checked } }, "moments:requireOne")} />Minst ett moment måste väljas</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.task.requiredMarks} onChange={(event) => onSettings({ task: { ...settings.task, requiredMarks: event.target.checked } }, "task:requiredMarks")} />Visa * vid obligatoriska fält</label>
        </div>
      </fieldset>
      </details>
      {limits ? <fieldset className="grid gap-3 rounded-lg border p-3" data-testid="form-limit-settings" data-tour="form-limit-settings"><legend className="px-1 text-xs font-semibold text-muted-foreground">Gränsvärden och larmnivåer</legend>{limits}</fieldset> : null}
      {valuesHref ? <p className="text-xs text-muted-foreground" data-testid="form-company-values-link">Företagets egna gränsvärden för formulärets mätningar: <Link href={valuesHref} className="text-primary underline underline-offset-4">Gränsvärden i Värden och referenser</Link>.</p> : null}
      <label className={label}>Intern beskrivning (visas bara för er som bygger formulär)<textarea className="form-textarea min-h-20" maxLength={2000} value={meta.internalNote} onChange={(event) => set("internalNote")(event.target.value)} /></label>
    </div>
  </Panel></div>;
}

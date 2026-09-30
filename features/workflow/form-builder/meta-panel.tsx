"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FORM_CATEGORIES, FORM_ICONS, formCategoryLabel, formDisplayName, type FormMeta } from "@/lib/workflow/form-publish";
import type { EditorDocument } from "@/lib/workflow/form-editor";
import { FORM_ICON_COMPONENTS, FormIcon, FormTypeCardContent } from "../form-card";
import { FORM_COLOR_OPTIONS, formColorClass } from "../form-colors";

const label = "grid gap-1.5 text-xs font-medium text-muted-foreground";

type DocumentSettings = Pick<EditorDocument, "report" | "moments" | "task">;

/**
 * Grunduppgifter (Daniel 2026-09-26): compact at the top and collapsible while working in the editor. Open for a new
 * form, collapsed for an existing one; the card on the right is exactly what Ny uppgift will show. The form's report
 * heading and its moments (Daniel 2026-09-27) are set here too; they are saved with the form's version.
 */
export function MetaPanel({ meta, status, version, open, onToggle, onChange, settings, onSettings, titleFields = [], limits }: {
  meta: FormMeta; status: string; version: number | null; open: boolean; onToggle: () => void; onChange: (patch: Partial<FormMeta>, group: string) => void;
  settings: DocumentSettings; onSettings: (patch: Partial<DocumentSettings>, group: string) => void;
  /** The text fields the task's title can follow. */
  titleFields?: { key: string; label: string }[];
  /** The form's configurable limits (2026-09-28), edited here on every screen size. */
  limits?: ReactNode;
}) {
  const set = <K extends keyof FormMeta>(key: K) => (value: FormMeta[K]) => onChange({ [key]: value } as Partial<FormMeta>, `meta:${key}`);
  return <section aria-labelledby="form-meta-title" className="rounded-xl border bg-card shadow-xs" data-testid="form-meta">
    <div className={cn("panel-header flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b px-5 py-3", !open && "rounded-b-xl border-b-0")}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", formColorClass(meta.color))}><FormIcon icon={meta.icon} className="size-4" /></span>
        <div className="min-w-0">
          <h2 id="form-meta-title" className="section-title">Grunduppgifter</h2>
          {!open ? <p className="truncate text-xs text-muted-foreground">{meta.name || "Namnlöst formulär"} · visas som ”{formDisplayName(meta)}” · {formCategoryLabel(meta.category)} · {status}</p> : null}
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls="form-meta-content" onClick={onToggle}>
        <ChevronDown className={cn("transition-transform", !open && "-rotate-90")} />{open ? "Fäll ihop" : "Visa"}
      </Button>
    </div>
    <div id="form-meta-content" hidden={!open} className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="grid content-start gap-4 md:grid-cols-2">
        <label className={label}>Namn<Input id="form-meta-name" value={meta.name} maxLength={120} placeholder="t.ex. Isolationsmätning" onChange={(event) => set("name")(event.target.value)} /></label>
        <label className={label}>Namn under Ny uppgift<Input id="form-meta-displayName" value={meta.displayName} maxLength={120} placeholder={meta.name || "Samma som namnet"} onChange={(event) => set("displayName")(event.target.value)} /></label>
        <label className={label}>Kategori<select id="form-meta-category" className="form-select" value={meta.category} onChange={(event) => set("category")(event.target.value as FormMeta["category"])}>{FORM_CATEGORIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <fieldset className="grid gap-1.5"><legend className="mb-1.5 text-xs font-medium text-muted-foreground">Får användas</legend>
          <label className="flex items-center gap-2 text-sm"><input id="form-meta-allowStandalone" type="checkbox" checked={meta.allowStandalone} onChange={(event) => set("allowStandalone")(event.target.checked)} />Fristående</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={meta.allowInProject} onChange={(event) => set("allowInProject")(event.target.checked)} />I projekt</label>
        </fieldset>
        <div className={cn(label, "md:col-span-2")}>Ikon
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ikon">{FORM_ICONS.map((icon) => {
            const Icon = FORM_ICON_COMPONENTS[icon].icon;
            return <button key={icon} type="button" role="radio" aria-checked={meta.icon === icon} aria-label={FORM_ICON_COMPONENTS[icon].label} title={FORM_ICON_COMPONENTS[icon].label} onClick={() => set("icon")(icon)}
              className={cn("flex size-9 items-center justify-center rounded-lg border-2 transition-colors hover:bg-secondary", meta.icon === icon ? "border-primary bg-secondary text-primary" : "border-transparent text-muted-foreground")}><Icon className="size-4" /></button>;
          })}</div>
        </div>
        <div className={cn(label, "md:col-span-2")}>Färg
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Färg">{FORM_COLOR_OPTIONS.map(([value, text]) => <button key={value} type="button" role="radio" aria-checked={meta.color === value} aria-label={text} title={text} onClick={() => set("color")(value)} className={cn("size-8 rounded-lg border-2", formColorClass(value), meta.color === value ? "border-primary" : "border-transparent")} />)}</div>
        </div>
        <label className={cn(label, "md:col-span-2")}>Kort beskrivning under Ny uppgift<textarea className="form-textarea min-h-20" maxLength={500} value={meta.description} placeholder="Vad protokollet används till." onChange={(event) => set("description")(event.target.value)} /><span className="text-[11px] font-normal">{meta.description.length}/500 tecken. Kort text blir tydligast på kortet.</span></label>
        <fieldset className="grid gap-3 rounded-lg border p-3 md:col-span-2 md:grid-cols-2" data-testid="form-report-settings"><legend className="px-1 text-xs font-semibold text-muted-foreground">Rapport och moment</legend>
          <label className={label}>Rubrik i PDF:en<Input id="form-meta-reportTitle" value={settings.report.title} maxLength={120} placeholder="Protokoll" onChange={(event) => onSettings({ report: { ...settings.report, title: event.target.value } }, "report:title")} /></label>
          <label className={label}>Kod under rubriken<Input value={settings.report.code} maxLength={60} placeholder="Version och nummer, t.ex. KFID-V1-2026.1" onChange={(event) => onSettings({ report: { ...settings.report, code: event.target.value } }, "report:code")} /></label>
          <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={settings.report.taskFacts} onChange={(event) => onSettings({ report: { ...settings.report, taskFacts: event.target.checked } }, "report:taskFacts")} />Uppgiftens fakta (projekt, kund, ansvarig, status) först i PDF:en</label>
          <label className={label}>Rubrik över momenten som kan väljas bort<Input value={settings.moments.label} maxLength={60} placeholder="Moment" onChange={(event) => onSettings({ moments: { ...settings.moments, label: event.target.value } }, "moments:label")} /></label>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={settings.moments.requireOne} onChange={(event) => onSettings({ moments: { ...settings.moments, requireOne: event.target.checked } }, "moments:requireOne")} />Minst ett moment måste väljas</label>
          <label className={label}>Momenten väljs<select className="form-select" value={settings.moments.placement} onChange={(event) => onSettings({ moments: { ...settings.moments, placement: event.target.value as EditorDocument["moments"]["placement"] } }, "moments:placement")}><option value="top">Överst i uppgiften</option><option value="firstSection">Sist i första avsnittet (som kontrollens grunduppgifter)</option></select></label>
          {/* The task's own basic data (Daniel 2026-09-27): Workflow's panel, or inside the form like the control. */}
          <label className={label}>Uppgiftens grunduppgifter (projekt, kund, plats)<select className="form-select" value={settings.task.layout} onChange={(event) => onSettings({ task: { ...settings.task, layout: event.target.value as EditorDocument["task"]["layout"] } }, "task:layout")}><option value="panel">Egen panel före formuläret</option><option value="inline">Inne i formulärets första avsnitt (som kontrollen)</option></select></label>
          <label className={label}>Uppgiftens rubrik följer fältet<select className="form-select" value={settings.task.titleKey} onChange={(event) => onSettings({ task: { ...settings.task, titleKey: event.target.value } }, "task:titleKey")}><option value="">Skrivs av den som fyller i</option>{titleFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
          {/* The heading and the line under it for a new protocol, exactly like the originals (Daniel 2026-09-28: "Ny kontroll"). */}
          <label className={label}>Rubrik för ett nytt protokoll<Input value={settings.task.newTitle} maxLength={120} placeholder={`Nytt protokoll: ${meta.name || "formulärets namn"}`} onChange={(event) => onSettings({ task: { ...settings.task, newTitle: event.target.value } }, "task:newTitle")} /></label>
          <label className={label}>Text under rubriken tills protokollet är sparat<Input value={settings.task.tagline} maxLength={200} placeholder="Skapa uppgiften fristående eller koppla den till ett projekt." onChange={(event) => onSettings({ task: { ...settings.task, tagline: event.target.value } }, "task:tagline")} /></label>
          <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={settings.task.requiredMarks} onChange={(event) => onSettings({ task: { ...settings.task, requiredMarks: event.target.checked } }, "task:requiredMarks")} />Visa * vid obligatoriska fält</label>
        </fieldset>
        {limits ? <fieldset className="grid gap-3 rounded-lg border p-3 md:col-span-2" data-testid="form-limit-settings" data-tour="form-limit-settings"><legend className="px-1 text-xs font-semibold text-muted-foreground">Gränsvärden och larmnivåer</legend>{limits}</fieldset> : null}
        <label className={cn(label, "md:col-span-2")}>Intern beskrivning (visas bara för er som bygger formulär)<textarea className="form-textarea min-h-20" maxLength={2000} value={meta.internalNote} onChange={(event) => set("internalNote")(event.target.value)} /></label>
      </div>
      <div className="grid content-start gap-2">
        <p className="text-xs font-medium text-muted-foreground">Så visas den under Ny uppgift</p>
        <div className="flex min-h-52 flex-col rounded-xl border bg-card p-5 shadow-xs" data-testid="form-card-preview"><FormTypeCardContent form={{ ...meta, name: formDisplayName(meta), version }} /></div>
        <p className="text-xs text-muted-foreground">Status: <Badge variant="outline">{status}</Badge></p>
      </div>
    </div>
  </section>;
}

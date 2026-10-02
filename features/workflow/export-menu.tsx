"use client";

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Download, LoaderCircle } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** One way out of the menu: a format (PDF, Excel, CSV …), a preview or an empty template. */
export type ExportFormat = {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** The filled button; the others are outlined. One per menu. */
  primary?: boolean;
  disabled?: boolean;
  /** Why the format is unavailable, shown under the buttons. */
  hint?: string;
  /** An empty template: available whatever is picked. */
  ignoresSelection?: boolean;
  run: (selection: ExportSelection) => void | Promise<void>;
};
export type ExportSelection = { sections: Record<string, boolean>; selected: string[] };
export type ExportChoice = { id: string; title: string; detail?: string };
export type ExportSection = { key: string; label: string };

/**
 * Exportera (2026-10-01: "exportknappen och det lilla fönstret som visar vad som exporteras ser olika ut på
 * olika ställen"): every export in Workflow – tasks, protocols, the control, projects, the time report and forms – is
 * this one button and this one window. It opens on click, says what is exported, lets the person pick what to
 * include and ends with the formats as a row of equal buttons.
 */
export function ExportMenu({ label = "Exportera", title = "Exportera", description, choices, choicesLabel = "Innehåll", sections, formats, disabled, note, onOpen, size, testId = "export-menu" }: {
  label?: string;
  title?: string;
  description?: string;
  /** Items to pick (tasks of a project, forms to share); all are picked from the start. `null` while they load. */
  choices?: ExportChoice[] | null;
  choicesLabel?: string;
  /** Parts of the report to include; all are on from the start. */
  sections?: ExportSection[];
  formats: ExportFormat[];
  disabled?: boolean;
  /** A short line under the buttons (what is needed first, where the file is made). */
  note?: string;
  onOpen?: () => void;
  size?: "sm";
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState("");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const selected = useMemo(() => (choices ?? []).filter((choice) => picked ? picked.has(choice.id) : true).map((choice) => choice.id), [choices, picked]);
  const sectionValues = Object.fromEntries((sections ?? []).map((section) => [section.key, included[section.key] ?? true]));
  const nothingPicked = Boolean(choices && choices.length && !selected.length) || Boolean(sections?.length && !Object.values(sectionValues).some(Boolean)) || (choices !== undefined && (!choices || !choices.length));
  const toggle = (id: string, checked: boolean) => setPicked((current) => {
    const next = new Set(current ?? (choices ?? []).map((choice) => choice.id));
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  const hints = formats.filter((format) => format.disabled && format.hint).map((format) => format.hint!);
  async function run(format: ExportFormat) {
    setBusy(format.id); setFailure("");
    // A failure stays in the window, so the person sees it where they clicked.
    try { await format.run({ sections: sectionValues, selected }); setOpen(false); } catch (issue) { setFailure(issue instanceof Error ? issue.message : "Exporten misslyckades."); } finally { setBusy(""); }
  }
  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { setPicked(null); setFailure(""); onOpen?.(); } }}>
    <Popover.Trigger asChild>
      <Button type="button" variant="outline" size={size} disabled={disabled} data-testid={testId}><Download />{label}</Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content align="end" sideOffset={8} collisionPadding={16} className="export-menu z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg" data-testid={`${testId}-content`}>
        <Popover.Arrow className="fill-border" />
        <p className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg bg-secondary text-primary"><Download className="size-4" /></span>{title}</p>
        {description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        {choices !== undefined ? <fieldset className="mt-4">
          <legend className="text-xs font-semibold">{choicesLabel}</legend>
          {!choices ? <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Hämtar…</p>
            : !choices.length ? <p className="mt-2 text-xs text-muted-foreground">Det finns inget att exportera ännu.</p>
            : <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">{choices.map((choice) => <label key={choice.id} className="flex items-start gap-2 rounded-lg border p-2.5 text-xs">
              <Checkbox checked={selected.includes(choice.id)} onCheckedChange={(checked) => toggle(choice.id, checked === true)} />
              <span className="min-w-0"><span className="block truncate font-medium">{choice.title}</span>{choice.detail ? <span className="mt-0.5 block text-muted-foreground">{choice.detail}</span> : null}</span>
            </label>)}</div>}
        </fieldset> : null}
        {sections?.length ? <fieldset className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <legend className="text-xs font-semibold">Ta med</legend>
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { const all = !Object.values(sectionValues).every(Boolean); setIncluded(Object.fromEntries(sections.map((section) => [section.key, all]))); }}>
              {Object.values(sectionValues).every(Boolean) ? "Avmarkera alla" : "Markera alla"}
            </button>
          </div>
          {/* One line per part, in even rows of two (2026-10-01). */}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">{sections.map((section) => <label key={section.key} className="flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm hover:bg-muted">
            <Checkbox checked={sectionValues[section.key]} onCheckedChange={(checked) => setIncluded((current) => ({ ...current, [section.key]: checked === true }))} /><span className="truncate">{section.label}</span>
          </label>)}</div>
        </fieldset> : null}
        <p className="mt-4 text-xs font-semibold">Format</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {formats.map((format) => {
            const Icon = format.icon ?? Download;
            return <Button key={format.id} type="button" variant={format.primary ? "default" : "outline"} className={cn("justify-start", formats.length % 2 === 1 && format === formats[formats.length - 1] && "col-span-2")}
              disabled={Boolean(busy) || format.disabled || (nothingPicked && !format.ignoresSelection)} onClick={() => void run(format)} data-testid={`export-${format.id}`}>
              {busy === format.id ? <LoaderCircle className="animate-spin" /> : <Icon />}{busy === format.id ? "Skapar…" : format.label}
            </Button>;
          })}
        </div>
        {failure ? <p role="alert" className="mt-3 text-xs text-destructive">{failure}</p> : null}
        {note || hints.length ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{[note, ...new Set(hints)].filter(Boolean).join(" ")}</p> : null}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

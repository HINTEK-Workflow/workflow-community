"use client";

import { Fragment, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Dialog } from "radix-ui";
import { AlignLeft, Calendar, CheckSquare, ClipboardCheck, Columns3, FileText, Grid3x3, Hash, Heading, Image as ImageIcon, Info, LayoutList, ListChecks, PenLine, Plus, Ruler, Scissors, Sigma, SquareDashed, ToggleLeft, Type, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LIBRARY, type LibraryType } from "@/lib/workflow/form-editor";

export const LIBRARY_ICON: Record<LibraryType, LucideIcon> = {
  section: SquareDashed, heading: Heading, text: AlignLeft, pagebreak: Scissors, text_field: Type, long_text: FileText, number: Hash, measurement: Ruler, datetime: Calendar,
  yesno: ToggleLeft, single_choice: LayoutList, multiple_choice: CheckSquare, checklist: ListChecks, table: Columns3, attachment: ImageIcon, signature: PenLine, computed: Sigma,
  note: Info, summary: ClipboardCheck, matrix: Grid3x3,
};
const GROUPS = ["Struktur", "Fält", "Resultat"] as const;

function RibbonItem({ type, label, hint, onAdd }: { type: LibraryType; label: string; hint: string; onAdd: (type: LibraryType) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `library:${type}`, data: { kind: "library", type } });
  const Icon = LIBRARY_ICON[type];
  return <button ref={setNodeRef} type="button" {...attributes} {...listeners} onClick={() => onAdd(type)} title={`${label} – ${hint}. Dra till arket eller klicka.`} aria-label={`Lägg till ${label}`}
    // Clear icons and names (Daniel 2026-09-27: never shrunk to save height); the ribbon wraps rather than cutting a name.
    data-tour={`block-${type}`}
    className={cn("group flex min-w-11 shrink-0 touch-none flex-col items-center justify-center gap-1 rounded-lg px-1 py-1 text-[11.5px] font-medium leading-none whitespace-nowrap text-foreground/80 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-ring", isDragging && "opacity-40")}
    data-testid="library-item">
    {/* The icon rests in a light box (Daniel 2026-09-29), stronger on hover, so every block reads as a button. */}
    <span className="flex size-7 items-center justify-center rounded-md bg-secondary text-primary transition-colors group-hover:bg-primary/15"><Icon className="size-5" /></span><span>{label}</span>
  </button>;
}

/**
 * The field ribbon (Daniel 2026-09-26): every block type as an icon above the sheet, like a word processor's toolbar.
 * Drag an icon onto the sheet, or click it to add after the selected block. It is the only way to add blocks, so there
 * are no duplicate "Lägg till" menus. The names are never cut: the ribbon wraps to a second row when the width runs out
 * (Daniel 2026-09-27). Phones use the floating button below instead of a ribbon that scrolls sideways.
 */
export function FieldRibbon({ onAdd }: { onAdd: (type: LibraryType) => void }) {
  return <div role="toolbar" aria-label="Fält att lägga till" className="flex flex-wrap items-stretch" data-testid="field-ribbon">
    {GROUPS.map((group, index) => <Fragment key={group}>
      {index ? <span aria-hidden="true" className="mx-0.5 my-2.5 w-px shrink-0 bg-border" /> : null}
      <div role="group" aria-label={group} className="contents">
        {LIBRARY.filter((item) => item.group === group).map((item) => <RibbonItem key={item.type} type={item.type} label={item.label} hint={item.hint} onAdd={onAdd} />)}
      </div>
    </Fragment>)}
  </div>;
}

/**
 * On a phone (Daniel 2026-09-27): one floating "Lägg till" button above the bottom menu opens the building blocks as a
 * panel from below, grouped like the ribbon. A tap adds the block after the selected one and closes the panel, so the
 * sheet keeps the whole screen while building.
 */
export function FieldSheetButton({ onAdd }: { onAdd: (type: LibraryType) => void }) {
  const [open, setOpen] = useState(false);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>
      <button type="button" className="fixed right-4 z-30 flex h-12 items-center gap-2 rounded-full bg-primary pl-4 pr-5 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden bottom-[calc(5.5rem+env(safe-area-inset-bottom))]" data-testid="field-sheet-open">
        <Plus className="size-5" />Lägg till
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/30" />
      <Dialog.Content className="workspace-modal fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl border bg-card px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl" data-testid="field-sheet">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><Dialog.Title className="section-title">Lägg till</Dialog.Title><Dialog.Description className="text-xs text-muted-foreground">Hamnar efter det markerade blocket.</Dialog.Description></div>
          <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Stäng"><X /></Button></Dialog.Close>
        </div>
        <div className="space-y-4">
          {GROUPS.map((group) => <section key={group} aria-label={group}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {LIBRARY.filter((item) => item.group === group).map((item) => {
                const Icon = LIBRARY_ICON[item.type];
                return <button key={item.type} type="button" aria-label={`Lägg till ${item.label}`} onClick={() => { onAdd(item.type); setOpen(false); }}
                  className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border bg-card px-1 py-2 text-center text-[11px] font-medium leading-tight text-foreground/80 hover:border-primary/40 hover:bg-secondary hover:text-primary" data-testid="field-sheet-item">
                  <span className="flex size-8 items-center justify-center rounded-md bg-secondary text-primary"><Icon className="size-5" /></span>{item.label}
                </button>;
              })}
            </div>
          </section>)}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

"use client";

import { forwardRef, Fragment, useEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import { MoreHorizontal, Plus, Redo2, Undo2, X, type LucideIcon } from "lucide-react";
import { useDialogPage, useMobileDialogViewport } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";

/**
 * The shared editor chrome (2026-10-07): Skapa formulär, the landing editor and the self-inspection document all
 * use one sticky bar under the top bar – the commands on top and, under them, a Word-like icon ribbon in full width
 * (icon with a short label under it, grouped with dividers). The ribbon wraps to a second row instead of cutting a name
 * and is never shrunk (2026-09-27); on phones it gives way to a floating button that opens the same groups as a
 * panel from below, so nothing scrolls sideways.
 */
export type EditorRibbonItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Tooltip; the label is used when it is missing. */
  hint?: string;
  /** Accessible name when it should say more than the label (e.g. "Lägg till Textfält"). */
  ariaLabel?: string;
  onSelect: () => void;
  disabled?: boolean;
  /** A switch that is on (aria-pressed). */
  pressed?: boolean;
  tone?: "danger";
  /** Keep the focus (and the selection) where it is, e.g. in the text being formatted. */
  keepFocus?: boolean;
  /** Not offered in the phone panel (e.g. moves that need the item in view). */
  desktopOnly?: boolean;
  /**
   * Every label the button can show (e.g. "Visas" and "Dold"): the button keeps the width of the longest, so a label
   * that changes never pushes the buttons after it (2026-10-07: nothing may move when you click).
   */
  labels?: string[];
};
export type EditorRibbonGroup = { label: string; items: EditorRibbonItem[] };

type RibbonButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { icon: LucideIcon; label: string; labels?: string[]; pressed?: boolean; tone?: "danger" };

/** One ribbon button: the icon resting in a light box (2026-09-29), a readable label of at least 11 px under it. */
export const EditorRibbonButton = forwardRef<HTMLButtonElement, RibbonButtonProps>(function EditorRibbonButton({ icon: Icon, label, labels, pressed, tone, className, ...props }, ref) {
  const reserved = (labels ?? []).filter((text) => text !== label);
  return <button ref={ref} type="button" aria-pressed={pressed} {...props}
    className={cn("group flex min-w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1 text-[11.5px] font-medium leading-none whitespace-nowrap text-foreground/80 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40",
      tone === "danger" && "hover:text-destructive", className)}>
    <span className={cn("flex size-7 items-center justify-center rounded-md bg-secondary text-primary transition-colors group-hover:bg-primary/15",
      pressed && "bg-primary/20 ring-1 ring-primary/40", tone === "danger" && "text-destructive group-hover:bg-destructive/15")}><Icon className="size-5" /></span>
    {/* The other labels lie invisibly in the same cell, so the button is as wide as its longest label. */}
    <span className="grid justify-items-center">
      <span className="col-start-1 row-start-1">{label}</span>
      {reserved.map((text) => <span key={text} aria-hidden="true" className="invisible col-start-1 row-start-1">{text}</span>)}
    </span>
  </button>;
});

function DefaultItem({ item, testId }: { item: EditorRibbonItem; testId: string }) {
  return <EditorRibbonButton icon={item.icon} label={item.label} labels={item.labels} pressed={item.pressed} tone={item.tone} disabled={item.disabled} title={item.hint ?? item.label} aria-label={item.ariaLabel}
    onMouseDown={item.keepFocus ? (event) => event.preventDefault() : undefined} onClick={item.onSelect} data-testid={testId} data-ribbon-item={item.key} />;
}

/** The icon ribbon: groups of buttons with a thin divider between them, wrapping rather than scrolling. */
export function EditorRibbon({ label, groups, testId = "editor-ribbon", itemTestId = "ribbon-item", Item, disabled }: {
  label: string; groups: EditorRibbonGroup[]; testId?: string; itemTestId?: string;
  /**
   * The ribbon stays in place but every button is off, e.g. in Förhandsgranska or Läsläge: the bar keeps its height
   * and the page under it does not jump when the mode changes (2026-10-07).
   */
  disabled?: boolean;
  /** Draws an item another way (Skapa formulär makes its blocks draggable) – usually with EditorRibbonButton. */
  Item?: ComponentType<{ item: EditorRibbonItem; testId: string }>;
}) {
  const Draw = Item ?? DefaultItem;
  // Every group is always drawn; a command that does not apply to the selection is disabled, never removed, so the
  // ribbon never reflows when something is selected.
  const shown = disabled ? groups.map((group) => ({ ...group, items: group.items.map((item) => ({ ...item, disabled: true, pressed: false })) })) : groups;
  return <div role="toolbar" aria-label={label} aria-disabled={disabled || undefined} className="flex flex-wrap items-stretch" data-testid={testId}>
    {shown.filter((group) => group.items.length).map((group, index) => <Fragment key={group.label}>
      {index ? <span aria-hidden="true" className="mx-0.5 my-2.5 w-px shrink-0 bg-border" /> : null}
      <div role="group" aria-label={group.label} className="contents">
        {group.items.map((item) => <Draw key={item.key} item={item} testId={itemTestId} />)}
      </div>
    </Fragment>)}
  </div>;
}

/**
 * The sticky editor bar: the command row and, under it, the ribbon in full width. Its height is published as
 * --editor-bar-h, so a panel beside the sheet can stay just under it while scrolling.
 */
export function EditorBar({ children, ribbon, footer, testId, tour, className }: { children: ReactNode; ribbon?: ReactNode;
  /** Under the ribbon, e.g. the self-inspection document's folded contents list on smaller screens. */
  footer?: ReactNode; testId: string; tour?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--editor-bar-h", `${Math.round(element.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => { observer.disconnect(); root.style.removeProperty("--editor-bar-h"); };
  }, []);
  return <div ref={ref} className={cn("sticky top-16 z-30 rounded-xl border bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/90", className)} data-chrome-follow data-editor-bar data-testid={testId} data-tour={tour}>
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">{children}</div>
    {ribbon ? <div className="border-t px-2 py-1 max-md:hidden" data-editor-ribbon>{ribbon}</div> : null}
    {footer}
  </div>;
}

/**
 * The bar's controls (2026-10-07: "känn igen menyn vilken sida du än är på"): the three editors put the same
 * things in the same order – Ångra/Gör om, the mode, the save status, then on the right the secondary actions, the
 * save button, the primary action and ⋯. One compact editor height: 32 px on a computer, 44 px below 1024 px.
 */
export const EDITOR_BUTTON = "h-8 px-2.5 max-lg:h-11";
export const EDITOR_ICON_BUTTON = "size-8 max-lg:size-11";

export function EditorUndoRedo({ canUndo, canRedo, onUndo, onRedo }: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }) {
  return <span className="flex shrink-0">
    <IconButton label="Ångra" title="Ångra (Ctrl+Z)" className={EDITOR_ICON_BUTTON} disabled={!canUndo} onClick={onUndo}><Undo2 /></IconButton>
    <IconButton label="Gör om" title="Gör om (Ctrl+Y)" className={EDITOR_ICON_BUTTON} disabled={!canRedo} onClick={onRedo}><Redo2 /></IconButton>
  </span>;
}

export type EditorSegment<T> = { value: T; label: string; icon?: LucideIcon };

/**
 * A segmented switch in the bar. The mode ("Läge": Redigera first, then the view) is a radio group; other switches such
 * as the landing page's Visas/Dold are toggle buttons. Every segment keeps its width, whatever is chosen.
 */
export function EditorSegmented<T extends string | boolean>({ label, value, options, onChange, kind = "radio", disabled, testId, tour, compactOnPhone }: {
  label: string; value: T; options: EditorSegment<T>[]; onChange: (value: T) => void; kind?: "radio" | "toggle"; disabled?: boolean; testId?: string; tour?: string;
  /** Only the icons below 640 px (the label stays as the accessible name). */
  compactOnPhone?: boolean;
}) {
  return <div role={kind === "radio" ? "radiogroup" : "group"} aria-label={label} className="flex h-8 shrink-0 rounded-[var(--radius-control)] border bg-background/78 p-0.5 max-lg:h-11" data-testid={testId} data-tour={tour}>
    {options.map((option) => {
      const on = option.value === value;
      const Icon = option.icon;
      return <button key={String(option.value)} type="button" disabled={disabled} onClick={() => { if (!on) onChange(option.value); }}
        {...(kind === "radio" ? { role: "radio", "aria-checked": on } : { "aria-pressed": on })} aria-label={compactOnPhone && Icon ? option.label : undefined}
        className={cn("flex h-full items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
          on ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground")}>
        {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}<span className={cn(compactOnPhone && Icon && "max-sm:sr-only")}>{option.label}</span>
      </button>;
    })}
  </div>;
}

/**
 * The save status in a slot of its own that takes the free room and cuts a long text: a changing text never moves a
 * button. The dot always has its place (amber while something is unsaved), so the text does not jump either.
 */
export function EditorStatus({ tone, children, testId }: { tone: "saved" | "unsaved" | "error"; children: ReactNode; testId?: string }) {
  return <span role="status" className={cn("flex min-w-0 flex-1 basis-0 items-center gap-1.5 text-xs sm:basis-32", tone === "error" ? "text-destructive" : "text-muted-foreground")} data-testid={testId}>
    <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", tone === "unsaved" ? "bg-amber-500" : tone === "error" ? "bg-destructive" : "bg-transparent")} />
    <span className="min-w-0 truncate">{children}</span>
  </span>;
}

/** The right-hand side of the bar: secondary actions, the save button, the primary action and ⋯, in that order. */
export function EditorActions({ children, tour }: { children: ReactNode; tour?: string }) {
  return <div className="ml-auto flex shrink-0 items-center gap-2" data-tour={tour}>{children}</div>;
}

export type EditorMenuItem = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; className?: string; icon?: LucideIcon; testId?: string };

/**
 * ⋯ at the far right of the bar, with the same look in every editor. The same menu is a row's discreet action menu in a
 * list or tree (Anläggningar, 2026-10-15): `label` names it for screen readers ("Åtgärder för Elcentral"), `triggerClassName`
 * sizes the button to the row, and an item may carry its icon.
 */
export function EditorMoreMenu({ items, footer, label = "Fler åtgärder", triggerClassName = EDITOR_ICON_BUTTON, testId }: { items: EditorMenuItem[]; footer?: ReactNode; label?: string; triggerClassName?: string; testId?: string }) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><IconButton label={label} className={triggerClassName} data-testid={testId}><MoreHorizontal /></IconButton></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-64 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-1.5 shadow-lg">
      {items.map((item) => <DropdownMenu.Item key={item.label} disabled={item.disabled} onSelect={item.onSelect} data-testid={item.testId}
        className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-secondary", item.danger && "text-destructive", item.className)}>
        {item.icon ? <item.icon className="size-4 shrink-0 opacity-80" aria-hidden="true" /> : null}{item.label}</DropdownMenu.Item>)}
      {footer}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

/** The settings column while nothing is selected: the column keeps its place, so selecting never moves the sheet. */
export function EditorPanelEmpty({ title = "Inget markerat", children }: { title?: string; children: ReactNode }) {
  return <div className="grid gap-1 p-4 text-sm text-muted-foreground" data-testid="editor-panel-empty">
    <p className="font-medium text-foreground">{title}</p>
    <p className="text-xs leading-5">{children}</p>
  </div>;
}

/** Classes for a panel that stays under the editor bar while the sheet scrolls (the selected block's settings). */
export const EDITOR_SIDE_PANEL = "sticky top-[calc(5rem+var(--editor-bar-h,7rem))] max-h-[calc(100dvh-6rem-var(--editor-bar-h,7rem))] overflow-y-auto rounded-xl border bg-card";

/**
 * On a phone (2026-09-27): one floating button above the bottom menu opens the ribbon's groups as a panel from
 * below. A tap runs the action and closes the panel, so the sheet keeps the whole screen.
 */
export function EditorRibbonSheet({ groups, label = "Lägg till", description, testId = "editor-sheet", icon: Icon = Plus }: {
  groups: EditorRibbonGroup[]; label?: string; description?: string; testId?: string; icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(false);
  // A long list of commands becomes a page of its own on a phone instead of a panel that scrolls (2026-10-08).
  const { page, scrollRef, contentRef, mode } = useDialogPage(open);
  const viewportStyle = useMobileDialogViewport(open, "bottom", page);
  const shown = groups.map((group) => ({ ...group, items: group.items.filter((item) => !item.desktopOnly) })).filter((group) => group.items.length);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>
      <button type="button" className="fixed right-4 z-30 flex h-12 items-center gap-2 rounded-full bg-primary pl-4 pr-5 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
        onMouseDown={(event) => event.preventDefault()} data-testid={`${testId}-open`}>
        <Icon className="size-5" />{label}
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/30" />
      <Dialog.Content style={viewportStyle} data-modal={page ? "page" : mode} onCloseAutoFocus={(event) => event.preventDefault()} className="workspace-modal workspace-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-2xl border bg-card shadow-xl" data-testid={testId}>
        <div className="workspace-modal-header flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-3">
          <div><Dialog.Title className="section-title">{label}</Dialog.Title><Dialog.Description className={description ? "text-xs text-muted-foreground" : "sr-only"}>{description ?? label}</Dialog.Description></div>
          <Dialog.Close asChild><IconButton label="Stäng"><X /></IconButton></Dialog.Close>
        </div>
        <div ref={scrollRef} className="workspace-modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div ref={contentRef} className="workspace-modal-content space-y-4">
          {shown.map((group) => <section key={group.label} aria-label={group.label}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {group.items.map((item) => {
                const ItemIcon = item.icon;
                return <button key={item.key} type="button" aria-label={item.ariaLabel ?? item.label} aria-pressed={item.pressed} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }}
                  className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border bg-card px-1 py-2 text-center text-[11px] font-medium leading-tight text-foreground/80 hover:border-primary/40 hover:bg-secondary hover:text-primary disabled:opacity-40", item.tone === "danger" && "text-destructive")} data-testid={`${testId}-item`}>
                  <span className="flex size-8 items-center justify-center rounded-md bg-secondary text-primary"><ItemIcon className="size-5" /></span>{item.label}
                </button>;
              })}
            </div>
          </section>)}
        </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

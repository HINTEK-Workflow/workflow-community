"use client";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Save, Stethoscope, Trash2 } from "lucide-react";
import type { IndicatorTone } from "@/features/workflow/indicator-tone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { cn } from "@/lib/utils";
import { CollapsibleSection, Panel } from "../../features/kfid/ui";
import { useConfirm } from "../../features/kfid/confirm";
import { StatusPill } from "./status-pill";

/**
 * Korten på Tjänster och nycklar och under Kopplingar (2026-11-01: "Sidan behöver bara exakt visa det jag måste veta";
 * one card for every key and connection on both pages since 2026-11-11). The same build on every card, top to bottom:
 *   1. the header: icon and the service's name; ONE status and Kontrollera at the right (on/off is in the page's overview,
 *      features/integrations/key-overview.tsx);
 *   2. the fields (children): the label above, the field and its bin beside it (`KeyFields`, `KeyTextField`, `SecretField`);
 *   3. the settings (`settings`): a little apart, under the small label Inställningar (no line); switches for yes/no;
 *   4. ONE action row: Spara first – one for all the card's fields and settings, with "Ej sparade ändringar" while something
 *      is changed – then the card's other actions as outline buttons (2026-11-12: "Öppna Min webbsida", "Skicka
 *      testmejl", "Lägg till nyckel" …; a way to another page is a `KeyCardLink`). A part deep in the card puts its buttons there
 *      with `KeyCardActions`. A bin only empties its field; nothing changes until the card is saved. Leaving the page with
 *      changes asks (the app's own card). The header's right side holds only the status and Kontrollera;
 *   5. Mer: folded, with the explanations, instructions and technical details; a destructive action (Ta bort kopplingen) only
 *      there, at its foot to the left.
 * One thin line on every card (2026-11-12): the one right above Mer; everything else is kept apart by space.
 * A part a card does not need is not drawn. Parts inside the card that save on their own endpoint (the OpenAI key, the e-mail
 * server) join the card's Spara through `useKeyCardPart`.
 */
export type KeyCardStatus = { label: string; tone: IndicatorTone; problem?: string | null };
export const KEY_STATUS = {
  works: { label: "Fungerar", tone: "success" },
  missing: { label: "Saknas", tone: "neutral" },
  untested: { label: "Ej provad", tone: "neutral" },
  failed: { label: "Fel", tone: "danger" },
} as const satisfies Record<string, KeyCardStatus>;

/** The header's Kontrollera. */
export type KeyCardCheck = { onClick: () => void; busy?: boolean; disabled?: boolean; disabledReason?: string | null; label?: string; testId?: string };
/**
 * The card's own changes: `onSave` saves them and says whether it went well (false keeps the changes; the card said why).
 * `blocked` holds Spara back with a reason.
 */
export type KeyCardSave = { dirty: boolean; onSave: () => Promise<boolean | void>; blocked?: string | null };
type Part = { dirty: boolean; save: () => Promise<boolean | void>; blocked?: string | null };
type PartRegistry = { set: (id: string, part: Part | null) => void };
const KeyCardParts = createContext<PartRegistry | null>(null);

/** A part inside a card that saves on its own endpoint: its changes are saved by the card's one Spara. Returns whether it is inside a card. */
export function useKeyCardPart(dirty: boolean, save: () => Promise<boolean | void>, blocked?: string | null) {
  const registry = useContext(KeyCardParts);
  const id = useId();
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  const stableSave = useCallback(() => saveRef.current(), []);
  useEffect(() => { registry?.set(id, { dirty, save: stableSave, blocked }); }, [registry, id, dirty, stableSave, blocked]);
  useEffect(() => () => registry?.set(id, null), [registry, id]);
  return Boolean(registry);
}

/**
 * The card's action row, for a part drawn deep inside it: undefined outside a card (the part draws its buttons where it is),
 * null until the row is in place.
 */
const KeyCardActionSlot = createContext<HTMLElement | null | undefined>(undefined);
/** Puts its buttons in the card's one action row, after Spara; with no card around they stand where they are. */
export function KeyCardActions({ children }: { children: React.ReactNode }) {
  const slot = useContext(KeyCardActionSlot);
  if (slot === undefined) return <div className="flex flex-wrap items-center gap-3">{children}</div>;
  return slot ? createPortal(children, slot) : null;
}
/** A way to another page from a card: the same outline button with its icon, in the same size, everywhere. */
export function KeyCardLink({ href, icon: Icon, children, testId }: { href: string; icon: LucideIcon; children: React.ReactNode; testId?: string }) {
  return <Button type="button" variant="outline" asChild><Link href={href} data-testid={testId}><Icon />{children}</Link></Button>;
}

/**
 * The page's one question before changes are thrown away: every card on the page says whether it has changes, and a way out
 * asks once for all of them. Without it each card asks for itself.
 */
const KeyCardsGuardContext = createContext<((id: string, dirty: boolean) => void) | null>(null);
export function KeyCardsGuard({ children }: { children: React.ReactNode }) {
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [confirm, confirmElement] = useConfirm();
  const report = useCallback((id: string, value: boolean) => setDirty((current) => (Boolean(current[id]) === value ? current : { ...current, [id]: value })), []);
  useUnsavedGuard(Object.values(dirty).some(Boolean), confirm);
  return <KeyCardsGuardContext.Provider value={report}>{confirmElement}{children}</KeyCardsGuardContext.Provider>;
}

/** Two equal columns where the room is there (a container query, so the card's own width decides), one under the other otherwise. */
export function KeyCardGrid({ children, label, testId, className }: { children: React.ReactNode; label?: string; testId?: string; className?: string }) {
  return <div className="@container min-w-0">
    <ul className={cn("grid list-none grid-cols-1 gap-5 p-0 @2xl:grid-cols-2", className)} aria-label={label} data-testid={testId} data-key-card-grid="">{children}</ul>
  </div>;
}

export function KeyCard({ icon, title, description, status, statusTestId, problemTestId, check, children, settings, save, saveable = false, saveTestId, actions, more, moreOpenWhen = false, moreTestId, className }: {
  icon: LucideIcon; title: string;
  /** One line under the title (cards outside the key pages: Säkerhet, 2026-11-12); the key cards have none. */
  description?: string;
  /** null while the card reads its data. */
  status: KeyCardStatus | null;
  statusTestId?: string; problemTestId?: string;
  /** Kontrollera in the header. */
  check?: KeyCardCheck;
  /** The fields. */
  children?: React.ReactNode;
  /** The settings, under their small label (no line). */
  settings?: React.ReactNode;
  save?: KeyCardSave;
  /** The card has a Spara although its parts register later: the row is drawn from the start, so nothing moves. */
  saveable?: boolean;
  saveTestId?: string;
  /** The card's other actions, after Spara in the action row: outline buttons, a KeyCardLink for another page. */
  actions?: React.ReactNode;
  /** Mer. A function gets whether it is open, for what should only be drawn then (a map). */
  more?: React.ReactNode | ((open: boolean) => React.ReactNode);
  /** Something is wrong that Mer explains: it opens by itself (also later), and can still be closed. */
  moreOpenWhen?: boolean;
  moreTestId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(moreOpenWhen);
  const [openedFor, setOpenedFor] = useState(moreOpenWhen);
  if (moreOpenWhen !== openedFor) {
    setOpenedFor(moreOpenWhen);
    if (moreOpenWhen) setOpen(true);
  }
  const [parts, setParts] = useState<Record<string, Part>>({});
  const registry = useMemo<PartRegistry>(() => ({
    set: (id, part) => setParts((current) => {
      if (!part) { if (!(id in current)) return current; const next = { ...current }; delete next[id]; return next; }
      const known = current[id];
      return known && known.dirty === part.dirty && known.save === part.save && known.blocked === part.blocked ? current : { ...current, [id]: part };
    }),
  }), []);
  const [saving, setSaving] = useState(false);
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const partList = Object.values(parts);
  const dirty = Boolean(save?.dirty) || partList.some((part) => part.dirty);
  const hasSave = Boolean(save) || saveable || partList.length > 0;
  const blocked = (save?.dirty ? save.blocked : null) ?? partList.find((part) => part.dirty && part.blocked)?.blocked ?? null;
  const runSave = async () => {
    setSaving(true);
    try {
      if (save?.dirty && (await save.onSave()) === false) return;
      for (const part of partList) if (part.dirty && (await part.save()) === false) return;
    } finally { setSaving(false); }
  };
  // The page's guard, or the card's own when it stands alone.
  const report = useContext(KeyCardsGuardContext);
  const cardId = useId();
  const [confirm, confirmElement] = useConfirm();
  useUnsavedGuard(dirty && !report, confirm);
  useEffect(() => { report?.(cardId, dirty); }, [report, cardId, dirty]);
  useEffect(() => () => report?.(cardId, false), [report, cardId]);

  const problem = status?.problem;
  // The status and Kontrollera stay on the title's row from a tablet up, so the headers of two cards side by side line up.
  return <Panel icon={icon} title={title} description={description} className={cn("h-full", className)} headerClassName="sm:flex-nowrap"
    actions={status || check ? <span className="flex flex-wrap items-center justify-end gap-2" data-testid="key-card-actions">
      {status ? <StatusPill tone={status.tone} testId={statusTestId}>{status.label}</StatusPill> : null}
      {check ? <Button type="button" variant="outline" size="sm" disabled={check.disabled || saving} disabledReason={check.disabledReason} onClick={check.onClick} aria-label={check.label ?? `Kontrollera ${title}`}
        data-testid={check.testId ?? "key-card-check"} busy={check.busy} busyLabel="Kontrollerar…"><Stethoscope />Kontrollera</Button> : null}
    </span> : undefined}>
    {confirmElement}
    <KeyCardParts.Provider value={registry}><KeyCardActionSlot.Provider value={actionSlot}>
      <div className="@container min-w-0 space-y-3 text-sm" data-key-card="" data-dirty={dirty || undefined}>
        {problem ? <p className={`break-words text-xs ${status?.tone === "danger" ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`} data-testid={problemTestId ?? "key-card-problem"}>{problem}</p> : null}
        {children}
        {settings ? <KeySection>{settings}</KeySection> : null}
        {/* The one action row (2026-11-12): Spara, the card's actions, then the parts' (KeyCardActions); shown only when it
            holds a button or a link. */}
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-2 pt-2 has-[button,a]:flex" data-testid="key-card-save-row" data-key-card-actions-row="">
          {hasSave ? <Button type="button" disabled={!dirty} disabledReason={dirty ? blocked : null} onClick={() => void runSave()} busy={saving} busyLabel="Sparar…" data-testid={saveTestId ?? "key-card-save"}><Save />Spara</Button> : null}
          {actions}
          <div ref={setActionSlot} className="contents" data-key-card-action-slot="" />
          {/* Always drawn, hidden while nothing is changed, so the row never moves. */}
          {hasSave ? <span className={cn("flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300", !dirty && "invisible")} aria-hidden={!dirty || undefined} data-testid="key-card-unsaved">
            <span aria-hidden="true" className="size-2 rounded-full bg-current" />Ej sparade ändringar
          </span> : null}
        </div>
        {more ? <CollapsibleSection title="Mer" open={open} onOpenChange={setOpen} testId={moreTestId ?? "key-card-more"} divided={false}>
          <div className="space-y-2 text-xs text-muted-foreground">{typeof more === "function" ? more(open) : more}</div>
        </CollapsibleSection> : null}
      </div>
    </KeyCardActionSlot.Provider></KeyCardParts.Provider>
  </Panel>;
}

/** The fields of a card, two side by side where the card is wide enough, else one under the other. */
export function KeyFields({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return <div className={cn("grid gap-3 @lg:grid-cols-2", className)} data-testid={testId} data-key-fields="">{children}</div>;
}

/** The settings of the service under the fields: a part of its own, a little apart under its small label (no line, 2026-11-12). */
export function KeySection({ title = "Inställningar", children }: { title?: string; children: React.ReactNode }) {
  return <section className="space-y-3 pt-2" aria-label={title} data-key-section="">
    <h4 className="text-xs font-semibold text-foreground">{title}</h4>
    {children}
  </section>;
}

/**
 * A plain field of a card (an address, a user name, a number): the label above, the field and its bin beside it. The bin
 * empties the field; the card's Spara saves it.
 */
export function KeyTextField({ id, label, value, onChange, placeholder, hint, type = "text", inputMode, maxLength, autoComplete = "off", disabled, testId, removeLabel, className, mono, ariaLabel, invalid }: {
  id: string; label: React.ReactNode; value: string; onChange: (value: string) => void; placeholder?: string; hint?: React.ReactNode;
  type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; maxLength?: number; autoComplete?: string; disabled?: boolean; testId?: string;
  /** The bin's name; "Töm <label>" when left out. */
  removeLabel?: string; className?: string; mono?: boolean; ariaLabel?: string;
  /** The value cannot be read (the card says why). */
  invalid?: boolean;
}) {
  const bin = removeLabel ?? `Töm ${typeof label === "string" ? label.toLowerCase() : "fältet"}`;
  return <div className={cn("grid min-w-0 gap-1.5", className)} data-key-field={id}>
    <Label htmlFor={id} className="field-label text-xs font-medium">{label}</Label>
    <div className="flex min-w-0 items-center gap-2" data-key-field-row="">
      <Input id={id} type={type} inputMode={inputMode} value={value} maxLength={maxLength} autoComplete={autoComplete} disabled={disabled} placeholder={placeholder} spellCheck={false} aria-label={ariaLabel} aria-invalid={invalid || undefined}
        aria-describedby={hint ? `${id}-hint` : undefined} onChange={(event) => onChange(event.target.value)} className={cn("min-w-0 flex-1", mono && "font-mono")} data-testid={testId} />
      <Button type="button" variant="outline" size="icon" className="size-[var(--control-h)] shrink-0" aria-label={bin} title={bin} disabled={disabled || !value} onClick={() => onChange("")}><Trash2 /></Button>
    </div>
    {hint ? <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
  </div>;
}

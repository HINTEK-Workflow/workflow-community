"use client";

import type { ReactNode } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The dots that stand for a saved key or password; the last characters follow when the server tells them. */
export const secretDots = (tail?: string | null) => `••••••••••${tail ?? ""}`;

/** What the common password managers look for before they offer anything. */
const MANAGER_OFF = { "data-form-type": "other", "data-lpignore": "true", "data-1p-ignore": "true", "data-bwignore": "true" };

/**
 * One layout for every key and password (2026-10-07): the label above the field, the field and its buttons in
 * one row (40 px, 44 px on a touch screen), and the explanation under it in muted text. A row that does not fit wraps
 * with the field on its own line first, never sideways.
 */
export function KeyField({ id, label, hint, children, className, hintId }: { id: string; label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; hintId?: string }) {
  return <div className={cn("grid min-w-0 gap-1.5", className)} data-key-field={id}>
    <Label htmlFor={id} className="field-label text-xs font-medium">{label}</Label>
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-key-field-row="">{children}</div>
    {hint ? <p id={hintId ?? `${id}-hint`} className="text-xs leading-5 text-muted-foreground" data-key-field-hint="">{hint}</p> : null}
  </div>;
}

/**
 * A key or password that is only ever written (secrets-fields-simple, 2026-10-03): dots when a value is saved, a
 * bin that removes it, and a new value typed in the field replaces it. Where the value is kept is never told. `onRemove`
 * either removes at once or – with `removed`/`onUndo` – marks the removal until the page is saved, and then offers Ångra.
 */
export function SecretField({ id, label, hint, value, onChange, stored, tail, placeholder = "", removedPlaceholder = "Tas bort när du sparar", ariaLabel, removeLabel = "Ta bort", removed = false, onRemove, onUndo, disabled = false, busy = false, actions, mono = false, autoComplete = "off", required, minLength, className, testId, noManager = false, keepBin = false }: {
  id: string; label: ReactNode; hint?: ReactNode;
  value: string; onChange: (value: string) => void;
  /** A value is saved: the field shows dots. */
  stored: boolean;
  /** The saved value's last characters, shown after the dots. */
  tail?: string | null;
  /** Shown when nothing is saved. */
  placeholder?: string;
  removedPlaceholder?: string;
  /** The field's name for assistive technology when it must say more than the visible label. */
  ariaLabel?: string;
  /** The bin's name, e.g. "Ta bort lösenordet". */
  removeLabel?: string;
  removed?: boolean;
  onRemove?: () => void;
  onUndo?: () => void;
  /** The field itself cannot be changed. */
  disabled?: boolean;
  /** The buttons are held back while something is being saved. */
  busy?: boolean;
  /** Buttons in the same row, between the field and the bin (Kontrollera nyckeln, Spara nyckeln). */
  actions?: ReactNode;
  mono?: boolean;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  className?: string;
  testId?: string;
  /** A value that password managers should neither offer to save nor fill in (PLC-simulatorns nyckel, 2026-11-02). */
  noManager?: boolean;
  /**
   * The bin is always beside the field (the key cards, 2026-11-11: field and bin, field and bin): with a saved value it removes it
   * (onRemove), with a typed value it empties the field, and with neither it is greyed.
   */
  keepBin?: boolean;
}) {
  const shown = removed ? removedPlaceholder : stored ? secretDots(tail) : placeholder;
  return <KeyField id={id} label={label} hint={hint} className={className}>
    <Input id={id} type="password" autoComplete={autoComplete} spellCheck={false} value={value} disabled={disabled} placeholder={shown} aria-label={ariaLabel} required={required} minLength={minLength} aria-describedby={hint ? `${id}-hint` : undefined} data-testid={testId} {...(noManager ? MANAGER_OFF : {})}
      onChange={(event) => onChange(event.target.value)} className={cn("min-w-0 flex-1 basis-56", mono && "font-mono")} />
    {actions}
    {removed && onUndo ? <Button type="button" variant="outline" className="shrink-0" disabled={busy} onClick={onUndo}><RotateCcw />Ångra</Button>
      : stored && onRemove && !removed ? <Button type="button" variant="outline" size="icon" className="size-[var(--control-h)] shrink-0" aria-label={removeLabel} title={removeLabel} disabled={busy} onClick={onRemove}><Trash2 /></Button>
        : keepBin ? <Button type="button" variant="outline" size="icon" className="size-[var(--control-h)] shrink-0" aria-label={removeLabel} title={removeLabel} disabled={busy || disabled || !value} onClick={() => onChange("")}><Trash2 /></Button> : null}
  </KeyField>;
}

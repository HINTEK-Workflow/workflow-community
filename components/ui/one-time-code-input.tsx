"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The six digits of an authenticator app's code, from whatever was typed or pasted ("123 456", "123-456"). */
export const totpDigits = (value: string) => value.replace(/\D/g, "").slice(0, 6);
/** A backup code as typed: upper case, the alphabet's characters and the dash between its halves (lib/security/backup-codes.ts). */
const backupChars = (value: string) => value.toUpperCase().replace(/[^0-9A-Z-]/g, "").slice(0, 12);

/**
 * Kodrutan för tvåstegsverifiering (2026-11-25, "QR-ruta + passkey"): one large field for the six digits, the same
 * at sign-in, when two-step verification is turned on and when it is confirmed. The phone's keyboard shows digits
 * (inputMode numeric), iPhone and Android offer the code from a text or the app (autocomplete one-time-code), a pasted
 * code with spaces or a dash is cleaned, and the sixth digit calls `onComplete` (the form goes on by itself). With
 * `backup` the person can switch to a backup code (ten characters, no automatic step). Checking is always the server's.
 */
export function OneTimeCodeInput({ id, value, onChange, onComplete, backup = false, onBackupChange, autoFocus = false, invalid = false, disabled = false, name, describedBy, testId }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Called once when the sixth digit is in (never for a backup code). */
  onComplete?: (code: string) => void;
  /** Whether a backup code is being typed instead of the app's code. */
  backup?: boolean;
  /** Offered when set: a link under the field switches between the app's code and a backup code. */
  onBackupChange?: (backup: boolean) => void;
  autoFocus?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  name?: string;
  describedBy?: string;
  testId?: string;
}) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  // The sixth digit goes on once per code: a wrong code typed again (or the same code after an error) goes on again.
  const sent = React.useRef<string | null>(null);
  React.useEffect(() => { if (value.length < 6) sent.current = null; }, [value]);
  React.useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }); }, [autoFocus, backup]);

  const change = (raw: string) => {
    const next = backup ? backupChars(raw) : totpDigits(raw);
    onChange(next);
    if (!backup && next.length === 6 && sent.current !== next && onComplete) {
      sent.current = next;
      // After React has the new value, so a form that submits reads all six digits.
      window.setTimeout(() => onComplete(next), 0);
    }
  };

  return <div className="space-y-2">
    <Input ref={ref} id={id} name={name} value={value} onChange={(event) => change(event.target.value)}
      type="text" inputMode={backup ? "text" : "numeric"} autoComplete="one-time-code" autoCapitalize={backup ? "characters" : "none"} autoCorrect="off" spellCheck={false}
      // No maxLength: a pasted "123 456" or "123-456" must reach the cleaning above whole (the browser would cut it to "123 45").
      pattern={backup ? undefined : "[0-9]{6}"} placeholder={backup ? "XXXXX-XXXXX" : "123456"}
      aria-invalid={invalid || undefined} aria-describedby={describedBy} disabled={disabled} data-testid={testId}
      className={cn("h-14 text-center font-mono text-2xl font-semibold tracking-[0.4em] placeholder:tracking-[0.4em] placeholder:text-muted-foreground/40 md:text-2xl", backup && "text-xl tracking-[0.15em] placeholder:tracking-[0.15em] md:text-xl")} />
    {onBackupChange ? <button type="button" className="public-link text-xs" disabled={disabled} onClick={() => { onChange(""); onBackupChange(!backup); }} data-testid={testId ? `${testId}-switch` : undefined}>
      {backup ? "Använd koden från appen i stället" : "Har du inte telefonen? Använd en reservkod"}
    </button> : null}
  </div>;
}

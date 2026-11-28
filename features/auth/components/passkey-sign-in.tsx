"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Fingerprint, LoaderCircle, Smartphone } from "lucide-react";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { withPhoneHint } from "@/lib/auth/passkey-hints";

/** The sign-in errors in plain words (the server's codes from lib/auth/passkey-sign-in.ts and the rate limit). */
export function passkeyErrorText(code: string | undefined) {
  if (code === "RATE_LIMITED") return "För många inloggningsförsök. Vänta en kvart och försök igen.";
  if (code === "TRY_AGAIN_LATER") return "Det gick inte att kontrollera inloggningen just nu. Försök igen om en stund.";
  if (code === "PASSKEY_EXPIRED") return "Det tog för lång tid. Försök igen.";
  if (code === "PASSKEY_UNKNOWN") return "Den här passkeyn är inte kopplad till något konto här. Logga in på annat sätt och lägg till den under Mina inställningar → Säkerhet.";
  return "Inloggningen med passkey gick inte igenom. Försök igen eller logga in på annat sätt.";
}

/**
 * A new sign-in with one of the person's passkeys, without leaving the page (the two-step box at first sign-in,
 * 2026-11-25): the same server checks as Logga in med passkey. Returns the server's error code, "cancelled" when the person
 * closed the browser's dialog, or null when the sign-in went through (the page is then reloaded by the caller).
 */
export async function signInWithPasskey(): Promise<string | null> {
  try {
    const { options } = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("/api/passkeys", { method: "POST", body: JSON.stringify({ action: "login_options" }) });
    const assertion = await startAuthentication({ optionsJSON: options });
    const result = await signIn("passkey", { redirect: false, response: JSON.stringify(assertion) });
    return result?.error ?? null;
  } catch (error) {
    return cancelled(error) ? "cancelled" : "failed";
  }
}

/** The person closed the browser's dialog, or another ceremony took over: nothing to tell. */
const cancelled =(error: unknown) => error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");

/** A phone or tablet (touch, no hover): "Logga in med telefonen" is for a computer, so it is not shown there. */
const onTouchDevice = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;

/**
 * Logga in med passkey (2026-10-11): a button, and – where the browser can – the passkeys offered directly in the
 * e-mail field's autofill (conditional UI). Shown only where the browser supports WebAuthn (https or localhost).
 * With `phone` it is "Logga in med telefonen" (2026-11-27): the same sign-in with the hybrid hint, an extra choice beside the
 * others, without the autofill (the ordinary button's instance keeps that) and not on a phone itself.
 */
export function PasskeySignIn({ returnTo, busy, onError, onPending, label, primary = false, testId, phone = false }: { returnTo: string; busy: boolean; onError: (text: string | null) => void; onPending: (pending: boolean) => void;
  /** The button's words; both login steps say "Logga in med passkey" (2026-11-28: the same words everywhere). */
  label?: string;
  /** The first choice of its box (the code step): a filled button instead of an outlined one. */
  primary?: boolean;
  testId?: string;
  /** Logga in med telefonen: the QR code for a phone first (the hybrid hint), with a short line under the button. */
  phone?: boolean }) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [pending, setPending] = useState(false);
  const latest = useRef({ returnTo, onError, onPending });
  useEffect(() => { latest.current = { returnTo, onError, onPending }; });
  const text = label ?? (phone ? "Logga in med telefonen" : "Logga in med passkey");
  const id = testId ?? (phone ? "login-phone" : "login-passkey");

  async function run(autofill: boolean) {
    const { options } = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("/api/passkeys", { method: "POST", body: JSON.stringify({ action: "login_options" }) });
    const assertion = await startAuthentication({ optionsJSON: phone && !autofill ? withPhoneHint(options) : options, useBrowserAutofill: autofill });
    setPending(true); latest.current.onPending(true); latest.current.onError(null);
    try {
      const result = await signIn("passkey", { redirect: false, response: JSON.stringify(assertion), callbackUrl: latest.current.returnTo });
      if (result?.error) { latest.current.onError(passkeyErrorText(result.error)); return; }
      router.push(latest.current.returnTo);
      router.refresh();
    } finally { setPending(false); latest.current.onPending(false); }
  }

  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    let active = true;
    // Shown after the check, so a browser without passkeys never sees a button that cannot work.
    if (phone) {
      // Only the button: the ordinary passkey button's instance owns the e-mail field's autofill (one ceremony at a time).
      queueMicrotask(() => { if (active && !onTouchDevice()) setSupported(true); });
      return () => { active = false; };
    }
    queueMicrotask(() => { if (active) setSupported(true); });
    // Autofill is started when the person first goes to the e-mail field (2026-10-09), not when the page opens: a visitor
    // who only looks at the page (or opens the demo from it) never makes the server create a challenge.
    let started = false;
    const onFocus = (event: FocusEvent) => {
      if (started || !(event.target instanceof HTMLInputElement) || !/\bwebauthn\b/.test(event.target.autocomplete)) return;
      started = true;
      void browserSupportsWebAuthnAutofill().then((autofill) => {
        if (!autofill || !active) return;
        // Autofill waits quietly until the person picks a passkey in the e-mail field. Before a pick nothing is said (a
        // busy server or a closed list is no reason to greet the visitor with an error); after one, run() reports itself.
        run(true).catch(() => undefined);
      });
    };
    document.addEventListener("focusin", onFocus);
    return () => { active = false; document.removeEventListener("focusin", onFocus); WebAuthnAbortService.cancelCeremony(); };
    // Started once per page; `run` reads the latest props through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supported) return null;
  const button = <Button type="button" variant={primary ? "default" : "outline"} className="w-full" disabled={busy || pending} data-testid={id} aria-describedby={phone ? `${id}-help` : undefined}
    onClick={() => { onError(null); run(false).catch((error) => { if (!cancelled(error)) onError(error instanceof Error && error.message && !/WebAuthn|credential/i.test(error.message) ? error.message : passkeyErrorText(undefined)); }); }} busy={pending} busyLabel="Loggar in…">
    {pending ? <LoaderCircle className="size-4 animate-spin" /> : phone ? <Smartphone className="size-4" /> : <Fingerprint className="size-4" />}
    {text}
  </Button>;
  if (!phone) return button;
  return <div className="space-y-1.5">
    {button}
    <p id={`${id}-help`} className="text-center text-xs leading-5 text-muted-foreground">Skanna QR-koden med telefonen och godkänn med ansikte eller finger. Datorn behöver Bluetooth påslaget.</p>
  </div>;
}

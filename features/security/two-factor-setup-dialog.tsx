"use client";

/* eslint-disable @next/next/no-img-element -- The QR code is a data: URL made by the server for this person only. */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Eye, EyeOff, Fingerprint } from "lucide-react";
import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Label } from "@/components/ui/label";
import { OneTimeCodeInput } from "@/components/ui/one-time-code-input";
import { api } from "@/features/kfid/api";
import { DialogPage } from "@/features/kfid/dialog-page";
import { DialogActions } from "@/features/kfid/ui";
import { passkeyErrorText, signInWithPasskey } from "@/features/auth/components/passkey-sign-in";

type Setup = { secret: string; qr: string };

/** The browser's own refusals when a passkey is made, in plain words; closing its dialog is not an error. */
function registrationError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return null;
  if (name === "InvalidStateError") return "Den här enheten har redan en passkey för ditt konto. Välj Använd din passkey i stället.";
  if (name === "SecurityError") return "Passkeys fungerar bara när Workflow öppnas via sin riktiga adress (https).";
  return error instanceof Error && error.message && !/WebAuthn|credential/i.test(error.message) ? error.message : "Passkeyn kunde inte skapas. Försök igen.";
}

const finePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

/**
 * Slå på tvåstegsverifiering (2026-11-25, "QR-ruta + passkey"): one box – a popup on a computer, a page or a screen
 * on a phone (DialogPage size="form") – with a large QR code for the authenticator app, the key as text behind a button
 * (for the app in the same phone), and one field for the six digits that goes on by itself. A passkey is offered instead:
 * when Workflow requires two-step verification (`gate`) a passkey added here signs the person in again with it, since a
 * passkey sign-in counts as two steps (lib/kfid/server.ts). Everything is checked by the server as before: /api/security
 * (totp_start, totp_confirm, a fresh sign-in, the code's rate limit) and /api/passkeys.
 */
export function TwoFactorSetupDialog({ open, onOpenChange, gate = false, change = false, onEnabled, onPasskeyAdded, notify }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Workflow requires two-step verification before the person may go on. */
  gate?: boolean;
  /** Byt app eller telefon: the same steps, other words. */
  change?: boolean;
  /** The code was right: the backup codes to show once. */
  onEnabled: (codes: string[]) => void;
  /** A passkey was added outside the gate (the passkey list is read again). */
  onPasskeyAdded?: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeys, setPasskeys] = useState<{ supported: boolean; own: number } | null>(null);
  const [autoFocus, setAutoFocus] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  // A new secret each time the box opens (kept aside on the server until a code confirms it), and whether this browser can
  // make or use passkeys (asked after the first render, so the server's HTML never differs).
  // Asked once per opening: a second totp_start (React's double effect in development) would replace the secret on the server
  // while the box still showed the first QR code, and the right code would then be refused.
  const started = useRef<Promise<Setup> | null>(null);
  useEffect(() => {
    if (!open) { started.current = null; queueMicrotask(() => setSetup(null)); return; }
    let active = true;
    queueMicrotask(() => { if (active) { setLoadError(null); setShowKey(false); setCode(""); setError(null); setAutoFocus(finePointer()); } });
    started.current ??= api<Setup>("/api/security", { method: "POST", body: JSON.stringify({ action: "totp_start" }) });
    started.current
      .then((result) => { if (active) setSetup(result); })
      .catch((reason: Error) => { if (active) setLoadError(reason.message); });
    const supported = browserSupportsWebAuthn();
    if (!supported) queueMicrotask(() => { if (active) setPasskeys({ supported: false, own: 0 }); });
    else api<{ passkeys: unknown[] }>("/api/passkeys", { cache: "no-store" })
      .then((result) => { if (active) setPasskeys({ supported: true, own: result.passkeys.length }); })
      .catch(() => { if (active) setPasskeys({ supported: true, own: 0 }); });
    return () => { active = false; };
  }, [open]);

  async function confirmCode(value = code) {
    if (busy || value.length !== 6) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ codes: string[] }>("/api/security", { method: "POST", body: JSON.stringify({ action: "totp_confirm", code: value }) });
      notify("Tvåstegsverifiering är påslagen.");
      onEnabled(result.codes);
    } catch (reason) {
      setError((reason as Error).message);
      setCode("");
    } finally { setBusy(false); }
  }

  /** Passkey instead: one the person already has (gate only), or a new one; in the gate the person then signs in with it. */
  async function choosePasskey(add: boolean) {
    setPasskeyBusy(true); setError(null);
    try {
      if (add) {
        const { options } = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>("/api/passkeys", { method: "POST", body: JSON.stringify({ action: "register_options" }) });
        const response = await startRegistration({ optionsJSON: options });
        await api("/api/passkeys", { method: "POST", body: JSON.stringify({ action: "register", response: JSON.stringify(response), name: "" }) });
        if (!gate) {
          notify("Passkeyn är tillagd. Nästa gång kan du logga in med den.");
          onPasskeyAdded?.();
          onOpenChange(false);
          return;
        }
      }
      const failed = await signInWithPasskey();
      if (failed === "cancelled") { if (add) setError("Passkeyn är tillagd. Välj Använd din passkey för att fortsätta."); setPasskeys((current) => current && { ...current, own: Math.max(1, current.own) }); return; }
      if (failed) { setError(passkeyErrorText(failed === "failed" ? undefined : failed)); return; }
      // Signed in again with the passkey: the page starts over with the new sign-in.
      window.location.reload();
    } catch (reason) {
      const text = registrationError(reason);
      if (text) setError(text);
    } finally { setPasskeyBusy(false); }
  }

  // Short enough for a phone's top bar next to × and Slå på.
  const title = change ? "Byt app eller telefon" : "Tvåstegsverifiering";
  const working = busy || passkeyBusy;
  const passkeyChoice = passkeys?.supported ? gate && passkeys.own > 0 ? "use" : "add" : null;

  return <DialogPage open={open} onOpenChange={onOpenChange} title={title} pageKey="tvasteg" size="form" panelTitle={false}
    description={gate ? "Krävs för ditt konto innan du kan fortsätta." : undefined}>
    <form ref={formRef} className="space-y-5" data-testid="totp-setup" onSubmit={(event) => { event.preventDefault(); void confirmCode(); }}>
      {gate ? <p className="text-sm font-medium text-amber-700 dark:text-amber-300" role="status" data-testid="totp-setup-required">Tvåstegsverifiering krävs för ditt konto. Det tar en minut.</p> : null}

      <section className="space-y-3" aria-labelledby="totp-scan-title">
        <h3 id="totp-scan-title" className="text-sm font-semibold">1. Skanna koden med telefonen</h3>
        <p className="text-sm leading-6 text-muted-foreground">Öppna autentiseringsappen, till exempel Microsoft Authenticator eller Google Authenticator, välj att lägga till ett konto och skanna rutan.</p>
        <div className="flex justify-center">
          {setup ? <img src={setup.qr} alt="QR-kod att skanna med autentiseringsappen" width={240} height={240} data-testid="totp-qr"
            className="qr-surface size-60 rounded-xl border p-3 [image-rendering:pixelated]" />
            : <div className="flex size-60 items-center justify-center rounded-xl border bg-secondary/40 p-4 text-center text-sm text-muted-foreground" role="status">{loadError ?? "Skapar koden…"}</div>}
        </div>
        <div className="flex flex-col items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!setup} onClick={() => setShowKey((value) => !value)} aria-expanded={showKey} data-testid="totp-show-key">
            {showKey ? <EyeOff /> : <Eye />}{showKey ? "Dölj nyckeln" : "Visa nyckeln som text"}
          </Button>
          {showKey && setup ? <div className="w-full space-y-2 rounded-lg border bg-secondary/30 p-3 text-center">
            <p className="text-xs text-muted-foreground">Har du appen i den här telefonen? Lägg till kontot med nyckeln och välj tidsbaserad kod.</p>
            <p className="break-all font-mono text-base font-semibold tracking-wider" data-testid="totp-secret">{setup.secret}</p>
            <CopyButton size="sm" value={setup.secret.replace(/\s/g, "")} label="Kopiera nyckeln" />
          </div> : null}
        </div>
      </section>

      <section className="space-y-2">
        <Label htmlFor="totp-setup-code" className="text-sm font-semibold">2. Skriv de sex siffrorna som appen visar</Label>
        <OneTimeCodeInput id="totp-setup-code" value={code} onChange={(next) => { setCode(next); if (error) setError(null); }} onComplete={(value) => void confirmCode(value)}
          autoFocus={autoFocus && Boolean(setup)} invalid={Boolean(error)} disabled={!setup || working} describedBy={error ? "totp-setup-error" : undefined} testId="totp-setup-code" />
        {error ? <p id="totp-setup-error" className="flex items-start gap-1.5 text-sm font-medium text-destructive" role="alert" data-testid="totp-setup-error"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
      </section>

      {passkeyChoice ? <section className="space-y-2 border-t pt-4" data-testid="totp-setup-passkey">
        <p className="text-sm text-muted-foreground">{gate ? "Eller använd en passkey. Den räknas som tvåstegsverifiering, och du loggar in med ansikte, finger eller datorns PIN." : "Eller lägg till en passkey och logga in med ansikte, finger eller datorns PIN i stället för lösenord."}</p>
        <Button type="button" variant="outline" className="w-full" disabled={working} busy={passkeyBusy} busyLabel="Väntar på enheten…" onClick={() => void choosePasskey(passkeyChoice === "add")} data-testid="totp-setup-passkey-button">
          <Fingerprint />{passkeyChoice === "use" ? "Använd din passkey (Face ID / fingeravtryck)" : "Lägg till passkey i stället"}
        </Button>
      </section> : null}

      <DialogActions cancel={{ onClick: () => onOpenChange(false) }}
        primary={{ label: change ? "Byt" : "Slå på", type: "submit", disabled: !setup || code.length !== 6 || passkeyBusy, busy, busyLabel: "Kontrollerar…", testId: "totp-setup-submit" }} />
    </form>
  </DialogPage>;
}

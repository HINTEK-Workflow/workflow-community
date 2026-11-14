"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { browserSupportsWebAuthn, startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { api, setReauthHandler } from "@/features/kfid/api";
import { Field, Modal } from "@/features/kfid/ui";

/**
 * Bekräfta att det är du (2026-10-10): rendered once in the workspace. When a sensitive change answers `reauth`, this
 * card asks for the password or a code (app or backup code); the change is then sent again by api(). A person who only
 * signs in with Google confirms with a new Google sign-in. Never the browser's own dialogs.
 */
export function ReauthHost() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleOnly, setGoogleOnly] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setReauthHandler((text) => new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setMessage(text);
      setPassword(""); setCode(""); setError(""); setGoogleOnly(false);
      setPasskeys(browserSupportsWebAuthn());
      setOpen(true);
    }));
    return () => setReauthHandler(null);
  }, []);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  };

  // Bekräfta med passkey (2026-10-11): one of the person's own passkeys instead of the password or a code.
  async function confirmWithPasskey() {
    setBusy(true); setError("");
    try {
      const { options } = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("/api/passkeys", { method: "POST", body: JSON.stringify({ action: "reauth_options" }) });
      const assertion = await startAuthentication({ optionsJSON: options });
      await api("/api/security", { method: "POST", body: JSON.stringify({ action: "reauth", passkey: JSON.stringify(assertion) }) });
      finish(true);
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") setError(cause instanceof Error && cause.message && !/WebAuthn|credential/i.test(cause.message) ? cause.message : "Passkeyn kunde inte bekräfta att det är du.");
    } finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setError("");
    try {
      await api("/api/security", { method: "POST", body: JSON.stringify({ action: "reauth", ...(password ? { password } : {}), ...(code ? { code } : {}) }) });
      finish(true);
    } catch (cause) {
      const text = (cause as Error).message;
      if (/Google/.test(text)) setGoogleOnly(true);
      setError(text);
    } finally { setBusy(false); }
  }

  return <Modal open={open} onOpenChange={(value) => { if (!value) finish(false); }} title="Bekräfta att det är du" size="compact">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void confirm(); }} data-testid="reauth-card">
      <p className="flex gap-2 text-sm text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />{message || "Ändringen kräver att du bekräftar med lösenord eller kod."} Bekräftelsen gäller i tio minuter.</p>
      {googleOnly ? <>
        <p className="text-sm">Du har inget lösenord i Workflow. Logga in igen med Google (eller Microsoft) eller använd en passkey, och gör sedan ändringen en gång till.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void signIn("google", { callbackUrl: window.location.href })}>Logga in med Google</Button>
          {passkeys ? <Button type="button" variant="outline" disabled={busy} onClick={() => void confirmWithPasskey()}><Fingerprint />Använd passkey</Button> : null}
        </div>
        {error && !/Google/.test(error) ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </> : <>
        <Field id="reauth-password" type="password" label="Lösenord" value={password} onChange={setPassword} />
        <Field id="reauth-code" label="Eller kod från appen eller en reservkod" value={code} onChange={setCode} />
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {passkeys ? <Button type="button" variant="outline" className="mr-auto" disabled={busy} onClick={() => void confirmWithPasskey()} data-testid="reauth-passkey"><Fingerprint />Använd passkey</Button> : null}
          <Button type="button" variant="outline" onClick={() => finish(false)}>Avbryt</Button>
          <Button type="submit" disabled={busy || (!password && !code)} busy={busy} busyLabel="Kontrollerar…">Bekräfta</Button>
        </div>
      </>}
    </form>
  </Modal>;
}

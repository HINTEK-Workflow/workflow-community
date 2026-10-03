"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";

/**
 * Radera mitt konto (2026-10-03, GDPR art. 17): the person removes their own personal data. Name and e-mail
 * become "Borttagen användare" in what the company keeps; a company where they are the only member goes with them.
 */
export function EraseAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const erase = async () => {
    setBusy(true); setError("");
    try {
      await api("/api/erasure", { method: "POST", body: JSON.stringify({ action: "self", confirm, ...(password ? { password } : {}) }) });
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* nothing more to clear */ }
      await signOut({ callbackUrl: "/login?raderat=1" });
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Panel title="Radera mitt konto" description="Dina personuppgifter tas bort. Det går inte att ångra."
    leadingActions={<span className="panel-icon" aria-hidden="true"><UserX className="size-4" /></span>}>
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      <li>Ditt namn och din e-post ersätts med ”Borttagen användare” i det företaget sparar, till exempel protokoll och historik.</li>
      <li>Inloggning, kopplade Google-konton och appar, dina egna AI-konversationer och dina inställningar raderas.</li>
      <li>Är du ensam i ditt företag raderas företagets data också. Bokföringsunderlag sparas så länge lagen kräver.</li>
      <li>Är du ensam ägare i ett företag med fler medlemmar: gör någon annan till ägare först.</li>
    </ul>
    <Button type="button" variant="destructive" className="mt-4" onClick={() => { setOpen(true); setError(""); }} data-testid="erase-account">Radera mitt konto</Button>
    <Modal open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }} title="Radera ditt konto?">
      <p className="text-sm text-muted-foreground">Bekräfta med ditt lösenord (om du har ett) och skriv RADERA.</p>
      <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void erase(); }}>
        <label className="grid gap-1.5 text-xs font-medium">Lösenord<Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Lämna tomt om du bara loggar in med Google" /></label>
        <label className="grid gap-1.5 text-xs font-medium">Skriv RADERA<Input value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" /></label>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" variant="destructive" className="w-full" disabled={busy || confirm !== "RADERA"}>{busy ? "Raderar…" : "Radera mitt konto"}</Button>
      </form>
    </Modal>
  </Panel>;
}

"use client";

import { useCallback, useState } from "react";
import { Fingerprint, Pencil, Plus, Smartphone, Trash2 } from "lucide-react";
import { withPhoneHint } from "@/lib/auth/passkey-hints";
import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Field } from "@/features/kfid/ui";
import { useLoadEffect } from "@/lib/use-load-effect";
import { KeyCard } from "@/features/integrations/key-card";

type Passkey = { id: string; name: string; synced: boolean; createdAt: string; lastUsedAt: string | null };

const date = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { dateStyle: "medium" });

/** The browser's own refusals in plain words; closing the dialog is not an error. */
function registrationError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return null;
  if (name === "InvalidStateError") return "Den här enheten har redan en passkey för ditt konto.";
  if (name === "SecurityError") return "Passkeys fungerar bara när Workflow öppnas via sin riktiga adress (https).";
  return error instanceof Error && error.message && !/WebAuthn|credential/i.test(error.message) ? error.message : "Passkeyn kunde inte skapas. Försök igen.";
}

/**
 * Passkeys under Mina inställningar → Säkerhet (2026-10-09, built 2026-10-11): add one (the server asks for a
 * fresh confirmation first), name it, rename it and remove it. The server refuses to remove the last way to sign in.
 */
export function PasskeySettings({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [supported] = useState(() => typeof window !== "undefined" && browserSupportsWebAuthn());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();

  const load = useCallback(async () => {
    try { setPasskeys((await api<{ passkeys: Passkey[] }>("/api/passkeys", { cache: "no-store" })).passkeys); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);

  async function post(input: Record<string, unknown>) {
    return api<{ passkeys: Passkey[] }>("/api/passkeys", { method: "POST", body: JSON.stringify(input) });
  }

  /** `phone` (2026-11-27): the hybrid hint, so the browser shows the QR code for saving the passkey in a phone at once. */
  async function add(phone = false) {
    setBusy(true);
    try {
      const { options } = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>("/api/passkeys", { method: "POST", body: JSON.stringify({ action: "register_options" }) });
      const response = await startRegistration({ optionsJSON: phone ? withPhoneHint(options) : options });
      setPasskeys((await post({ action: "register", response: JSON.stringify(response), name })).passkeys);
      setAdding(false); setName("");
      notify("Passkeyn är tillagd. Nästa gång kan du logga in med den.");
    } catch (error) {
      const text = registrationError(error);
      if (text) notify(text, true);
    } finally { setBusy(false); }
  }

  // Ett eget kort enligt kortmallen (2026-11-12): the title and one line, the passkeys as a plain list with Byt namn and
  // Ta bort on each row, Lägg till passkey at the card's foot and the explanation under Mer.
  return <div data-testid="passkeys">
    {confirmElement}
    <KeyCard icon={Fingerprint} title="Passkeys" description="Logga in med ansikte, finger eller datorns PIN i stället för lösenord." status={null}
      actions={passkeys && supported && !adding ? <Button type="button" variant="outline" disabled={busy} onClick={() => setAdding(true)} data-testid="passkey-start"><Plus />Lägg till passkey</Button> : null}
      more={<p>Workflow sparar bara en offentlig nyckel. Passkey räknas som tvåstegsverifiering. Ta också bort en passkey i enhetens lösenordshanterare om du inte ska använda den igen.</p>}>
      {!passkeys ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : passkeys.length ? <ul className="space-y-3 text-sm" data-testid="passkey-list">
        {passkeys.map((passkey) => <li key={passkey.id} className="flex flex-wrap items-center justify-between gap-2">
          {renaming?.id === passkey.id ? <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try { setPasskeys((await post({ action: "rename", id: passkey.id, name: renaming.name })).passkeys); setRenaming(null); notify("Namnet är ändrat."); }
            catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
          }}>
            <Input aria-label="Passkeyns namn" value={renaming.name} maxLength={60} autoFocus className="min-w-0 flex-1 basis-48" onChange={(event) => setRenaming({ id: passkey.id, name: event.target.value })} />
            <Button type="submit" size="sm" disabled={busy || !renaming.name.trim()}>Spara</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Avbryt</Button>
          </form> : <>
            <span className="min-w-0">
              <span className="font-medium">{passkey.name}</span>{passkey.synced ? <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-primary">Synkad</span> : null}
              <span className="block text-xs text-muted-foreground">Tillagd {date(passkey.createdAt)} · {passkey.lastUsedAt ? `senast använd ${date(passkey.lastUsedAt)}` : "inte använd än"}</span>
            </span>
            <span className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setRenaming({ id: passkey.id, name: passkey.name })}><Pencil />Byt namn</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => {
                if (!(await confirm({ title: "Ta bort passkeyn?", message: `”${passkey.name}” kan inte längre användas för att logga in i Workflow. Ta också bort den i enhetens lösenordshanterare om du inte ska använda den igen.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
                setBusy(true);
                try { setPasskeys((await post({ action: "remove", id: passkey.id })).passkeys); notify("Passkeyn är borttagen."); }
                catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
              }}><Trash2 />Ta bort</Button>
            </span>
          </>}
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">Ingen passkey är tillagd.</p>}

      {/* After the list has loaded (never in the first render), so the browser check cannot differ from the server's HTML. */}
      {!passkeys ? null : !supported ? <p className="text-xs text-muted-foreground">Den här webbläsaren kan inte skapa passkeys här. Passkeys kräver en aktuell webbläsare och att Workflow öppnas via https.</p>
        : adding ? <form className="space-y-3" data-testid="passkey-add" onSubmit={(event) => { event.preventDefault(); void add(); }}>
          <Field id="passkey-name" label="Namn (valfritt), till exempel Jobbdatorn eller Min iPhone" value={name} onChange={setName} />
          <p className="text-xs text-muted-foreground">Efter Fortsätt frågar webbläsaren efter ditt fingeravtryck, ansikte eller PIN. Utan namn används webbläsarens och enhetens namn.</p>
          {/* Spara i telefonen (2026-11-27): the same passkey, with the hint that shows the QR code for a phone first. */}
          <p className="text-xs text-muted-foreground">Vill du logga in med telefonen? Välj Spara i telefonen, skanna QR-koden med telefonen och godkänn med ansikte eller finger.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy} busyLabel="Väntar på enheten…">Fortsätt</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void add(true)} data-testid="passkey-phone"><Smartphone />Spara i telefonen</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setAdding(false); setName(""); }}>Avbryt</Button>
          </div>
        </form> : null}
    </KeyCard>
  </div>;
}

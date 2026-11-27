"use client";

import { useCallback, useState } from "react";
import { BellRing, KeyRound, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, Field, Panel } from "@/features/kfid/ui";
import { KEY_STATUS, KeyCard } from "@/features/integrations/key-card";
import { formatSwedish } from "@/lib/swedish-time";
import type { PublicPushSettings } from "@/lib/push/settings";
import { useLoadEffect } from "@/lib/use-load-effect";

type State = PublicPushSettings & { devices: number };

/**
 * Webbpush (2026-10-07): the installation's VAPID keys and on/off, under Installation → E-post. The keys
 * are made here (never typed into .env text), the private key is sealed on the server and never shown; each person then
 * chooses push for their own devices under Mina inställningar → Notiser.
 */
export function PushSettings({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [subject, setSubject] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "keys" | "test">("");
  const [confirm, confirmElement] = useConfirm();
  const apply = (next: State) => { setState(next); setSubject(next.subject); setEnabled(next.enabled); };
  const load = useCallback(async () => {
    try { apply(await api<State>("/api/superadmin/push-settings", { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);

  if (error) return <Panel icon={BellRing} title="Webbpush"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (!state) return <Panel icon={BellRing} title="Webbpush"><p className="text-sm text-muted-foreground">Hämtar…</p></Panel>;

  const send = async (busyName: "save" | "keys" | "test", run: () => Promise<string>) => {
    setBusy(busyName);
    try { notify(await run()); return true; } catch (cause) { notify((cause as Error).message, true); return false; } finally { setBusy(""); }
  };
  const save = () => send("save", async () => {
    apply(await api<State>("/api/superadmin/push-settings", { method: "PUT", body: JSON.stringify({ enabled, subject }) }));
    return enabled ? "Webbpush är påslaget." : "Webbpush är avstängt.";
  });
  const makeKeys = async () => {
    const replacing = state.hasKeys;
    if (replacing && !(await confirm({ title: "Byta nycklarna?", message: `${state.devices === 1 ? "1 enhet" : `${state.devices} enheter`} som har slagit på push tas bort, och personerna måste slå på push igen under Mina inställningar. Det går inte att ångra.`, confirmLabel: "Byt nycklarna", tone: "danger" }))) return;
    await send("keys", async () => {
      apply(await api<State>("/api/superadmin/push-settings", { method: "POST", body: JSON.stringify({ action: "generate", replace: replacing }) }));
      return replacing ? "Nya nycklar är skapade." : "Nycklarna är skapade. Slå på webbpush och spara.";
    });
  };
  const test = () => send("test", async () => {
    const result = await api<{ delivered: number; devices: number }>("/api/superadmin/push-settings", { method: "POST", body: JSON.stringify({ action: "test" }) });
    return `Testnotisen är skickad till ${result.delivered} av dina ${result.devices === 1 ? "1 enhet" : `${result.devices} enheter`}.`;
  });
  const changed = enabled !== state.enabled || subject !== state.subject;

  const status = !state.hasKeys ? KEY_STATUS.missing : KEY_STATUS.untested;
  // The same card as every key card (2026-11-12): the settings under Inställningar, ONE Spara first in the action row with
  // Skapa nycklar and the test push after it, and Byt nycklar (it removes the push of every device) only under Mer.
  return <div className="h-full" data-testid="push-settings">{confirmElement}<KeyCard icon={BellRing} title="Webbpush" status={status} statusTestId="push-status" moreTestId="push-more"
    save={{ dirty: changed, onSave: save }} saveTestId="push-save"
    actions={<>
      {state.hasKeys ? null : <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void makeKeys()} busy={busy === "keys"} busyLabel="Skapar…" data-testid="push-make-keys"><KeyRound />Skapa nycklar</Button>}
      <Button type="button" variant="outline" disabled={Boolean(busy) || !state.ready} onClick={() => void test()} busy={busy === "test"} busyLabel="Skickar…" data-testid="push-test"><Send />Skicka testpush till mig</Button>
    </>}
    settings={<>
      <CheckField id="push-enabled" label="Slå på webbpush" checked={enabled} disabled={!state.hasKeys} onChange={setEnabled} description={state.hasKeys ? undefined : "Skapa nycklarna först."} />
      <Field id="push-subject" label="Kontaktadress för push-tjänsterna (valfritt)" value={subject} onChange={setSubject} autoComplete="off"
        placeholder={state.effectiveSubject || "mailto:drift@exempel.se"} help="Tomt: e-postavsändarens adress." />
    </>}
    more={<>
      <p>Notiser på enheten, även när Workflow är stängt. Varje person väljer under Mina inställningar.</p>
      <p data-testid="push-keys">
        <span data-testid="push-keys-status">{state.hasKeys ? `Nycklar: skapade ${state.keysCreatedAt ? formatSwedish(state.keysCreatedAt, { dateStyle: "medium", timeStyle: "short" }) : ""}` : "Nycklar: inga ännu"}</span>
        {" · "}{state.devices === 1 ? "1 enhet har slagit på push" : `${state.devices} enheter har slagit på push`}
      </p>
      {state.hasKeys ? <p className="break-all">Publik nyckel: <span className="font-mono" data-testid="push-public-key">{state.publicKey}</span></p> : null}
      <p>Testpushen går till de enheter där du själv slagit på push. Den kräver att webbpush är sparat som påslaget.</p>
      {state.hasKeys ? <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={Boolean(busy)} onClick={() => void makeKeys()} busy={busy === "keys"} busyLabel="Skapar…" data-testid="push-replace-keys"><RefreshCw />Byt nycklar</Button> : null}
    </>}>
    {state.blockedReason ? <div className="notice" role="status"><p>{state.blockedReason}</p></div> : null}
  </KeyCard></div>;
}

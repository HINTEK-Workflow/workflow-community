"use client";

import { useEffect, useState } from "react";
import { Clapperboard, Film, LogIn, TriangleAlert, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { SecretField } from "@/features/kfid/secret-field";
import { KEY_STATUS, KeyCard, KeyCardLink, KeyFields, KeyTextField, type KeyCardStatus } from "@/features/integrations/key-card";
import { useServerKeySectionStatus } from "@/features/integrations/server-key-status";
import { formatSwedish } from "@/lib/swedish-time";
import type { YouTubeView } from "@/lib/youtube/server";

export const VIDEOS_HREF = "/?view=company_videos";

/** The card's one status (Fungerar, Välj kanal, Behöver åtgärd, Fel, Ej kopplad, Saknas). */
export function youTubeCardStatus(view: Pick<YouTubeView, "status" | "statusMessage"> | null): KeyCardStatus | null {
  if (!view) return null;
  switch (view.status) {
    case "ok": return KEY_STATUS.works;
    case "choose": return { label: "Välj kanal", tone: "warning", problem: view.statusMessage };
    case "action": return { label: "Behöver åtgärd", tone: "warning", problem: view.statusMessage };
    case "invalid": return { ...KEY_STATUS.failed, problem: view.statusMessage };
    case "unchecked": return { label: "Ej kopplad", tone: "neutral" };
    default: return KEY_STATUS.missing;
  }
}

/** What the callback's word means on the page (lib/youtube/server.ts YouTubeCallbackResult). */
const CALLBACK: Record<string, { text: string; error?: boolean }> = {
  ok: { text: "YouTube är kopplat." },
  choose: { text: "YouTube är kopplat. Välj vilken kanal filmerna ska till." },
  action: { text: "YouTube är kopplat, men något behöver åtgärdas. Se kortet." },
  cancelled: { text: "Kopplingen avbröts hos Google.", error: true },
  expired: { text: "Svaret från Google kom för sent eller hörde inte till dig. Tryck Koppla YouTube igen.", error: true },
  failed: { text: "Kopplingen till YouTube misslyckades. Kontrollera klient-id, klienthemlighet och omdirigeringsadressen i Google Cloud.", error: true },
};

/** The short way to a Google API project: one line each. The whole checklist is docs/drift/YOUTUBE.md. */
export function YouTubeConnectSteps({ redirectUri }: { redirectUri: string }) {
  return <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground" data-testid="youtube-connect-steps">
    <li>Skapa ett projekt i Google Cloud Console och slå på YouTube Data API v3.</li>
    <li>Fyll i OAuth-samtyckesskärmen och lägg till dig själv som testanvändare.</li>
    <li>Skapa en OAuth-klient av typen Webbapplikation med adressen <span className="break-all font-mono text-foreground">{redirectUri}</span> som auktoriserad omdirigerings-URI.</li>
    <li>Kopiera klient-id och klienthemlighet hit, tryck Spara och sedan Koppla YouTube.</li>
    <li>Ansök om Googles granskning av projektet. Till dess blir alla filmer privata på YouTube.</li>
  </ol>;
}

/**
 * YouTube under Kopplingar (2026-11-20), built like LinkedIn (features/linkedin/linkedin-card.tsx) on the shared key card: the
 * company's own Google API project – klient-id and klienthemlighet (dots and a bin, never the value) – the address to register at
 * Google with a copy button, and the channel the films go to. Koppla YouTube sends the browser to Google's own sign-in and back.
 * Whether films may be uploaded at all is the switch Publicering in the area's overview (off until the admin switches it on).
 * When YouTube has kept an upload private because Google's audit is not passed yet, the card says so plainly.
 */
export function YouTubeCard({ notify, onChanged }: { notify: (text: string, error?: boolean) => void; onChanged?: (view: YouTubeView) => void }) {
  const [view, setView] = useState<YouTubeView | null>(null);
  const [error, setError] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);
  const [channelChoice, setChannelChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const show = (next: YouTubeView) => { setView(next); setClientId(next.clientId ?? ""); setChannelChoice(next.channel?.id ?? ""); onChanged?.(next); };
  useEffect(() => {
    let active = true;
    void api<{ connection: YouTubeView }>("/api/youtube", { cache: "no-store" }).then((result) => { if (active) show(result.connection); }).catch((cause) => { if (active) setError((cause as Error).message); });
    // Back from Google: say how it went once, and take the word out of the address.
    const params = new URLSearchParams(window.location.search);
    const word = params.get("youtube");
    if (word) {
      const said = CALLBACK[word] ?? CALLBACK.failed;
      notify(said.text, said.error);
      params.delete("youtube");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once when the card opens
  }, []);

  const post = async (input: Record<string, unknown>) => {
    setBusy(true);
    try {
      const result = await api<{ connection: YouTubeView; check?: { ok: boolean; message: string } }>("/api/youtube", { method: "POST", body: JSON.stringify(input) });
      show(result.connection);
      setClientSecret(""); setRemoveSecret(false);
      return result;
    } catch (cause) { notify((cause as Error).message, true); return null; } finally { setBusy(false); }
  };
  const keysInput = () => {
    const input: Record<string, unknown> = { action: "keys" };
    if (clientId.trim() !== (view?.clientId ?? "")) input.clientId = clientId.trim();
    if (removeSecret) input.clientSecret = null; else if (clientSecret.trim()) input.clientSecret = clientSecret.trim();
    return input;
  };
  const channelChanged = Boolean(view?.connected && channelChoice && channelChoice !== (view.channel?.id ?? ""));
  const dirty = Object.keys(keysInput()).length > 1 || channelChanged;
  const save = async () => {
    const input = keysInput();
    let current = view;
    if (Object.keys(input).length > 1) {
      const result = await post(input);
      if (!result) return false;
      current = result.connection;
    }
    if (current?.connected && channelChoice && channelChoice !== (current.channel?.id ?? "")) {
      if (!(await post({ action: "choose", channel: channelChoice }))) return false;
      notify("Kanalen är vald.");
      return true;
    }
    notify(current?.status === "unchecked" ? "Sparat. Tryck Koppla YouTube." : current?.statusMessage ?? "Sparat.");
    return true;
  };
  // Koppla YouTube: the changes first, then to Google's own sign-in (the answer comes back to /api/youtube/callback).
  const connect = async () => {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/api/youtube", { method: "POST", body: JSON.stringify({ action: "authorize" }) });
      window.location.assign(url);
    } catch (cause) { notify((cause as Error).message, true); setBusy(false); }
  };
  const check = async () => {
    const result = await post({ action: "check" });
    if (result?.check) notify(result.check.message || "Kopplingen fungerar.", !result.check.ok);
  };
  const switchPublishing = async (on: boolean) => {
    if (on && !(await confirm({
      title: "Slå på publicering?",
      message: `Filmer kan då laddas upp till kanalen ${view?.channel?.name ?? ""} när någon trycker Publicera eller Schemalägg under Mer › Webb och inlägg › Filmer. Inget laddas upp av sig självt.`,
      confirmLabel: "Slå på",
    }))) return false;
    const result = await post({ action: "publishing", on });
    if (result) notify(on ? "Publicering är påslagen." : "Publicering är avstängd.");
    return Boolean(result);
  };
  const disconnect = async () => {
    if (await confirm({ title: "Ta bort kopplingen?", message: "Workflow slutar nå YouTube och lämnar tillbaka sin åtkomst till Google-kontot. Filmerna i Workflow och på YouTube finns kvar.", confirmLabel: "Ta bort", tone: "danger" }))
      if (await post({ action: "disconnect" })) notify("Kopplingen är borttagen.");
  };

  const status = youTubeCardStatus(view);
  const keysReady = Boolean(view?.clientId && view.clientSecretStored);
  useServerKeySectionStatus("youtube", status ? {
    label: status.label, tone: status.tone, detail: status.problem ?? (view?.privateLocked ? "Filmerna blir privata tills Google har granskat projektet." : undefined), name: "YouTube",
    toggle: view ? {
      label: "Publicering", on: view.publishingApproved, testId: "youtube-publishing",
      disabledReason: view.publishingApproved ? null : !view.connected ? "Koppla YouTube först." : !view.channel || view.status === "invalid" || view.status === "choose" ? "Kopplingen måste fungera först." : null,
      onChange: switchPublishing,
    } : undefined,
  } : error ? { label: "Kunde inte läsas", tone: "danger", detail: error, name: "YouTube" } : null);
  if (error) return <p className="notice text-destructive" role="alert">{error}</p>;
  const date = (value: string | null) => (value ? formatSwedish(value, { dateStyle: "medium", timeStyle: "short" }) : "–");
  const connectReason = !keysReady && !(clientId.trim() && (clientSecret.trim() || view?.clientSecretStored)) ? "Fyll i klient-id och klienthemlighet först." : removeSecret ? "Klienthemligheten tas bort när du sparar." : null;

  return <div className="h-full" data-testid="youtube-connection">{confirmElement}<KeyCard icon={Clapperboard} title="YouTube" status={status} statusTestId="youtube-connection-status" problemTestId="youtube-connection-problem"
    check={{ onClick: () => void check(), busy, disabled: busy || !view?.connected, disabledReason: view?.connected ? null : "Koppla YouTube först.", label: "Kontrollera kopplingen", testId: "youtube-check" }}
    save={view ? { dirty, onSave: save } : undefined} saveable saveTestId="youtube-save"
    settings={view ? <>
      {view.privateLocked ? <div className="notice flex gap-3 text-sm" role="status" data-testid="youtube-private-locked"><TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
        <p>YouTube gör alla filmer från Workflow privata tills Google har granskat ert API-projekt. Ansök om granskningen i Google Cloud. När den är klar kan du ändra vem som får se filmerna under Filmer.</p></div> : null}
      {view.channels.length > 1 ? <div className="space-y-1">
        <p className="text-xs font-medium" id="youtube-channel-label">Filmerna laddas upp till</p>
        <div role="radiogroup" aria-labelledby="youtube-channel-label" className="space-y-1" data-testid="youtube-channels">
          {view.channels.map((choice) => <label key={choice.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-[var(--surface-hover)]">
            <input type="radio" name="youtube-channel" value={choice.id} checked={channelChoice === choice.id} onChange={() => setChannelChoice(choice.id)} className="size-4 accent-[var(--primary)]" />
            <span className="block min-w-0 text-sm font-medium">{choice.name}</span>
          </label>)}
        </div>
      </div> : null}
      {view.channel ? <p className="min-w-0 text-sm" data-testid="youtube-target"><span className="text-muted-foreground">Filmerna går till kanalen </span>{view.channel.name}</p>
        : <p className="min-w-0 text-xs text-muted-foreground">{view.connected ? "Välj vilken kanal filmerna ska till." : "Tryck Koppla YouTube och logga in med det Google-konto som äger kanalen."}</p>}
    </> : null}
    actions={view ? <>
      <Button type="button" variant="outline" disabled={busy} disabledReason={connectReason} onClick={() => void connect()} data-testid="youtube-connect"><LogIn />{view.connected ? "Koppla igen" : "Koppla YouTube"}</Button>
      {view.channel ? <KeyCardLink href={VIDEOS_HREF} icon={Film} testId="youtube-open-videos">Öppna Filmer</KeyCardLink> : null}
    </> : null}
    more={<>
      <YouTubeConnectSteps redirectUri={view?.redirectUri ?? ""} />
      <p>Inget laddas upp av sig självt. Filmer läggs in under Mer › Webb och inlägg › Filmer och laddas upp först när du trycker Publicera eller Schemalägg. Publicering slås på i översikten.</p>
      <p>Workflow ber bara om rätten att hantera kanalens filmer ({view?.scope ?? ""}). Det räcker för att ladda upp, ändra, sätta omslagsbild, lägga i spellistor och ta bort filmer.</p>
      {view?.connected ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1" data-testid="youtube-dates">
        <dt>Kontrollerad</dt><dd className="text-foreground">{date(view.checkedAt)}</dd>
        <dt>Förnyas av sig själv</dt><dd className="text-foreground">{view.refreshable ? "Ja" : "Nej, koppla igen"}</dd>
        <dt>Spellistor</dt><dd className="text-foreground">{view.playlists.length}</dd>
      </dl> : null}
      <p>Kopplingen kontrolleras hos Google när kortet öppnas och när du trycker Kontrollera.{view?.standIn ? " Den här installationen talar med en låtsastjänst för provning, inte med Google." : ""}</p>
      {view && (view.connected || view.clientId) ? <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void disconnect()} data-testid="youtube-disconnect"><Unplug />Ta bort kopplingen</Button> : null}
    </>} moreTestId="youtube-more" moreOpenWhen={Boolean(view && !view.connected)}>
    {!view ? <p className="text-xs text-muted-foreground">Hämtar…</p> : <>
      <KeyFields>
        <KeyTextField id="youtube-client-id" label="Klient-id" value={clientId} maxLength={120} onChange={setClientId} placeholder="…apps.googleusercontent.com" testId="youtube-client-id" removeLabel="Töm klient-id" mono />
        <SecretField keepBin id="youtube-client-secret" label="Klienthemlighet" value={clientSecret} onChange={(value) => { setClientSecret(value); setRemoveSecret(false); }} stored={view.clientSecretStored} removed={removeSecret} placeholder="Från OAuth-klienten i Google Cloud"
          removeLabel="Ta bort klienthemligheten" busy={busy} onRemove={() => { setClientSecret(""); setRemoveSecret(true); }} onUndo={() => setRemoveSecret(false)} noManager testId="youtube-client-secret" />
      </KeyFields>
      <div className="grid min-w-0 gap-1.5" data-key-field="youtube-redirect">
        <label htmlFor="youtube-redirect" className="field-label text-xs font-medium">Adress att lägga in hos Google</label>
        <div className="flex min-w-0 items-center gap-2">
          <Input id="youtube-redirect" readOnly value={view.redirectUri} className="min-w-0 flex-1 font-mono" onFocus={(event) => event.currentTarget.select()} aria-describedby="youtube-redirect-hint" data-testid="youtube-redirect" />
          <CopyButton value={view.redirectUri} iconOnly label="Kopiera adressen" className="size-[var(--control-h)] shrink-0" data-testid="youtube-redirect-copy" />
        </div>
        <p id="youtube-redirect-hint" className="text-xs leading-5 text-muted-foreground">Auktoriserad omdirigerings-URI på OAuth-klienten i Google Cloud.</p>
      </div>
    </>}
  </KeyCard></div>;
}

"use client";

import { useEffect, useState } from "react";
import { Briefcase, LogIn, Megaphone, TriangleAlert, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { SecretField } from "@/features/kfid/secret-field";
import { KEY_STATUS, KeyCard, KeyCardLink, KeyFields, KeyTextField, type KeyCardStatus } from "@/features/integrations/key-card";
import { useServerKeySectionStatus } from "@/features/integrations/server-key-status";
import { formatSwedish } from "@/lib/swedish-time";
import type { LinkedInView } from "@/lib/linkedin/server";

export const POSTS_HREF = "/?view=company_posts";

/** The card's one status (Fungerar, Välj var, Behöver åtgärd, Fel, Ej kopplad, Saknas). */
export function linkedInCardStatus(view: Pick<LinkedInView, "status" | "statusMessage"> | null): KeyCardStatus | null {
  if (!view) return null;
  switch (view.status) {
    case "ok": return KEY_STATUS.works;
    case "choose": return { label: "Välj var", tone: "warning", problem: view.statusMessage };
    case "action": return { label: "Behöver åtgärd", tone: "warning", problem: view.statusMessage };
    case "invalid": return { ...KEY_STATUS.failed, problem: view.statusMessage };
    case "unchecked": return { label: "Ej kopplad", tone: "neutral" };
    default: return KEY_STATUS.missing;
  }
}

/** What the callback's word means on the page (lib/linkedin/server.ts LinkedInCallbackResult). */
const CALLBACK: Record<string, { text: string; error?: boolean }> = {
  ok: { text: "LinkedIn är kopplat." },
  choose: { text: "LinkedIn är kopplat. Välj var inläggen ska publiceras." },
  action: { text: "LinkedIn är kopplat, men något behöver åtgärdas. Se kortet." },
  cancelled: { text: "Kopplingen avbröts hos LinkedIn.", error: true },
  expired: { text: "Svaret från LinkedIn kom för sent eller hörde inte till dig. Tryck Koppla LinkedIn igen.", error: true },
  failed: { text: "Kopplingen till LinkedIn misslyckades. Kontrollera Client ID, Client Secret och adressen under Auth hos LinkedIn.", error: true },
};

/** The short way to a LinkedIn app: one line each (2026-11-11). */
export function LinkedInConnectSteps({ redirectUri }: { redirectUri: string }) {
  return <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground" data-testid="linkedin-connect-steps">
    <li>Skapa en app på developer.linkedin.com (den kopplas till företagets LinkedIn-sida).</li>
    <li>Under Products: lägg till Share on LinkedIn och Sign In with LinkedIn using OpenID Connect.</li>
    <li>För företagssidan: ansök om Community Management API. Till dess publiceras inlägg på din egen profil.</li>
    <li>Under Auth: lägg till adressen <span className="break-all font-mono text-foreground">{redirectUri}</span> som Authorized redirect URL.</li>
    <li>Kopiera Client ID och Client Secret hit, tryck Spara och sedan Koppla LinkedIn.</li>
  </ol>;
}

/**
 * LinkedIn under Kopplingar (2026-11-11), built like Facebook och Instagram (features/meta/meta-card.tsx) on the shared key card:
 * the company's own LinkedIn app – Client ID and Client Secret (dots and a bin, never the value) – the address to register at
 * LinkedIn with a copy button, what Koppla LinkedIn asks for (the own profile, or also company pages) and where posts go. Koppla
 * LinkedIn sends the browser to LinkedIn's own sign-in and back. Whether posts may be published at all is the switch "Publicering"
 * in the area's overview (off until the admin switches it on). Nothing is published here.
 */
export function LinkedInCard({ notify, onChanged }: { notify: (text: string, error?: boolean) => void; onChanged?: (view: LinkedInView) => void }) {
  const [view, setView] = useState<LinkedInView | null>(null);
  const [error, setError] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);
  const [scopeSet, setScopeSet] = useState<LinkedInView["scopeSet"]>("personal");
  const [authorChoice, setAuthorChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const authorOf = (next: LinkedInView) => (next.author ? (next.author.type === "organization" ? next.author.id : "person") : "");
  const show = (next: LinkedInView) => { setView(next); setClientId(next.clientId ?? ""); setScopeSet(next.scopeSet); setAuthorChoice(authorOf(next)); onChanged?.(next); };
  useEffect(() => {
    let active = true;
    void api<{ connection: LinkedInView }>("/api/linkedin", { cache: "no-store" }).then((result) => { if (active) show(result.connection); }).catch((cause) => { if (active) setError((cause as Error).message); });
    // Back from LinkedIn: say how it went once, and take the word out of the address.
    const params = new URLSearchParams(window.location.search);
    const word = params.get("linkedin");
    if (word) {
      const said = CALLBACK[word] ?? CALLBACK.failed;
      notify(said.text, said.error);
      params.delete("linkedin");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once when the card opens
  }, []);

  const post = async (input: Record<string, unknown>) => {
    setBusy(true);
    try {
      const result = await api<{ connection: LinkedInView; check?: { ok: boolean; message: string } }>("/api/linkedin", { method: "POST", body: JSON.stringify(input) });
      show(result.connection);
      setClientSecret(""); setRemoveSecret(false);
      return result;
    } catch (cause) { notify((cause as Error).message, true); return null; } finally { setBusy(false); }
  };
  const keysInput = () => {
    const input: Record<string, unknown> = { action: "keys" };
    if (clientId.trim() !== (view?.clientId ?? "")) input.clientId = clientId.trim();
    if (removeSecret) input.clientSecret = null; else if (clientSecret.trim()) input.clientSecret = clientSecret.trim();
    if (view && scopeSet !== view.scopeSet) input.scopeSet = scopeSet;
    return input;
  };
  const authorChanged = Boolean(view?.connected && authorChoice && authorChoice !== authorOf(view));
  const dirty = Object.keys(keysInput()).length > 1 || authorChanged;
  const save = async () => {
    const input = keysInput();
    let current = view;
    if (Object.keys(input).length > 1) {
      const result = await post(input);
      if (!result) return false;
      current = result.connection;
    }
    if (current?.connected && authorChoice && authorChoice !== authorOf(current)) {
      if (!(await post({ action: "choose", author: authorChoice }))) return false;
      notify("Valt var inläggen ska publiceras.");
      return true;
    }
    notify(current?.status === "unchecked" ? "Sparat. Tryck Koppla LinkedIn." : current?.statusMessage ?? "Sparat.");
    return true;
  };
  // Koppla LinkedIn: the changes first, then to LinkedIn's own sign-in (the answer comes back to /api/linkedin/callback).
  const connect = async () => {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/api/linkedin", { method: "POST", body: JSON.stringify({ action: "authorize" }) });
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
      message: `Inlägg kan då publiceras på LinkedIn (${view?.author?.name ?? "kontot"}) när någon trycker Publicera under Inlägg. Inget publiceras av sig självt.`,
      confirmLabel: "Slå på",
    }))) return false;
    const result = await post({ action: "publishing", on });
    if (result) notify(on ? "Publicering är påslagen." : "Publicering är avstängd.");
    return Boolean(result);
  };
  const disconnect = async () => {
    if (await confirm({ title: "Ta bort kopplingen?", message: "Workflow slutar nå LinkedIn. Inläggen i Workflow finns kvar. Ta också bort appens åtkomst hos LinkedIn om den inte ska användas mer.", confirmLabel: "Ta bort", tone: "danger" }))
      if (await post({ action: "disconnect" })) notify("Kopplingen är borttagen.");
  };

  const status = linkedInCardStatus(view);
  const keysReady = Boolean(view?.clientId && view.clientSecretStored);
  useServerKeySectionStatus("linkedin", status ? {
    label: status.label, tone: status.tone, detail: status.problem ?? undefined, name: "LinkedIn",
    toggle: view ? {
      label: "Publicering", on: view.publishingApproved, testId: "linkedin-publishing",
      disabledReason: view.publishingApproved ? null : !view.connected ? "Koppla LinkedIn först." : !view.author || view.status === "invalid" || view.status === "choose" ? "Kopplingen måste fungera först." : null,
      onChange: switchPublishing,
    } : undefined,
  } : error ? { label: "Kunde inte läsas", tone: "danger", detail: error, name: "LinkedIn" } : null);
  if (error) return <p className="notice text-destructive" role="alert">{error}</p>;
  const date = (value: string | null) => (value ? formatSwedish(value, { dateStyle: "medium" }) : "–");
  const choices = view?.connected ? [
    ...(view.scopes.includes("w_member_social") && view.member ? [{ id: "person", name: `Min profil (${view.member.name})` }] : []),
    ...view.organizations.map((page) => ({ id: page.id, name: `Företagssidan ${page.name}` })),
  ] : [];
  const connectReason = !keysReady && !(clientId.trim() && (clientSecret.trim() || view?.clientSecretStored)) ? "Fyll i Client ID och Client Secret först." : removeSecret ? "Client Secret tas bort när du sparar." : null;

  return <div className="h-full" data-testid="linkedin-connection">{confirmElement}<KeyCard icon={Briefcase} title="LinkedIn" status={status} statusTestId="linkedin-connection-status" problemTestId="linkedin-connection-problem"
    check={{ onClick: () => void check(), busy, disabled: busy || !view?.connected, disabledReason: view?.connected ? null : "Koppla LinkedIn först.", label: "Kontrollera kopplingen", testId: "linkedin-check" }}
    save={view ? { dirty, onSave: save } : undefined} saveable saveTestId="linkedin-save"
    settings={view ? <>
      <div className="space-y-1">
        <p className="text-xs font-medium" id="linkedin-scope-label">Behörighet</p>
        <div role="radiogroup" aria-labelledby="linkedin-scope-label" className="space-y-1" data-testid="linkedin-scope">
          {([["personal", "Min profil", "openid profile w_member_social – fungerar direkt."], ["organization", "Även företagssidor", "Lägger till w_organization_social r_organization_admin – kräver Community Management API."]] as const).map(([key, label, hint]) =>
            <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-[var(--surface-hover)]">
              <input type="radio" name="linkedin-scope" value={key} checked={scopeSet === key} onChange={() => setScopeSet(key)} className="size-4 accent-[var(--primary)]" data-testid={`linkedin-scope-${key}`} />
              <span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
            </label>)}
        </div>
        {/* Företagssidor need LinkedIn's approval of the app (Community Management API); without it LinkedIn's sign-in shows an error (2026-11-14). */}
        {scopeSet === "organization" ? <div className="notice flex gap-3 text-sm" data-testid="linkedin-scope-warning"><TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" /><p>Företagssidor fungerar först när LinkedIn har godkänt appen för Community Management API. Välj Min profil tills dess, annars visar LinkedIn ett fel.</p></div> : null}
      </div>
      {choices.length > 1 ? <div className="space-y-1">
        <p className="text-xs font-medium" id="linkedin-author-label">Inläggen publiceras på</p>
        <div role="radiogroup" aria-labelledby="linkedin-author-label" className="space-y-1" data-testid="linkedin-authors">
          {choices.map((choice) => <label key={choice.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-[var(--surface-hover)]">
            <input type="radio" name="linkedin-author" value={choice.id} checked={authorChoice === choice.id} onChange={() => setAuthorChoice(choice.id)} className="size-4 accent-[var(--primary)]" />
            <span className="block min-w-0 text-sm font-medium">{choice.name}</span>
          </label>)}
        </div>
      </div> : null}
      {view.author ? <p className="min-w-0 text-sm" data-testid="linkedin-target"><span className="text-muted-foreground">Inläggen går till </span>{view.author.type === "organization" ? `företagssidan ${view.author.name}` : `${view.author.name}s profil`}</p>
        : <p className="min-w-0 text-xs text-muted-foreground">{view.connected ? "Välj var inläggen ska publiceras." : "Tryck Koppla LinkedIn och logga in hos LinkedIn."}</p>}
    </> : null}
    // The card's one action row (2026-11-12): Spara, then Koppla LinkedIn and the way to Inlägg as outline buttons.
    actions={view ? <>
      <Button type="button" variant="outline" disabled={busy} disabledReason={connectReason} onClick={() => void connect()} data-testid="linkedin-connect"><LogIn />{view.connected ? "Koppla igen" : "Koppla LinkedIn"}</Button>
      {view.author ? <KeyCardLink href={POSTS_HREF} icon={Megaphone} testId="linkedin-open-posts">Öppna Inlägg</KeyCardLink> : null}
    </> : null}
    more={<>
      <LinkedInConnectSteps redirectUri={view?.redirectUri ?? ""} />
      <p>Inget publiceras av sig självt. Inlägg görs under Inlägg och publiceras först när du trycker Publicera. Publicering slås på i översikten.</p>
      {view?.connected ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1" data-testid="linkedin-dates">
        <dt>Token gäller till</dt><dd className="text-foreground">{date(view.accessTokenExpiresAt)}</dd>
        <dt>Förnyas av sig själv</dt><dd className="text-foreground">{view.refreshable ? `Ja, till ${date(view.refreshTokenExpiresAt)}` : "Nej, koppla igen innan den går ut"}</dd>
        <dt>Behörigheter</dt><dd className="break-words text-foreground">{view.scopes.join(" ") || "–"}</dd>
      </dl> : null}
      <p>Kopplingen kontrolleras hos LinkedIn när kortet öppnas och när du trycker Kontrollera. LinkedIns API version {view?.apiVersion ?? ""}.</p>
      {view && (view.connected || view.clientId) ? <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void disconnect()} data-testid="linkedin-disconnect"><Unplug />Ta bort kopplingen</Button> : null}
    </>} moreTestId="linkedin-more" moreOpenWhen={Boolean(view && !view.connected)}>
    {!view ? <p className="text-xs text-muted-foreground">Hämtar…</p> : <>
      <KeyFields>
        <KeyTextField id="linkedin-client-id" label="Client ID" value={clientId} maxLength={40} onChange={setClientId} placeholder="Från appens Auth-flik" testId="linkedin-client-id" removeLabel="Töm Client ID" mono />
        <SecretField keepBin id="linkedin-client-secret" label="Client Secret" value={clientSecret} onChange={(value) => { setClientSecret(value); setRemoveSecret(false); }} stored={view.clientSecretStored} removed={removeSecret} placeholder="Från appens Auth-flik"
          removeLabel="Ta bort Client Secret" busy={busy} onRemove={() => { setClientSecret(""); setRemoveSecret(true); }} onUndo={() => setRemoveSecret(false)} noManager testId="linkedin-client-secret" />
      </KeyFields>
      <div className="grid min-w-0 gap-1.5" data-key-field="linkedin-redirect">
        <label htmlFor="linkedin-redirect" className="field-label text-xs font-medium">Adress att lägga in hos LinkedIn</label>
        <div className="flex min-w-0 items-center gap-2">
          <Input id="linkedin-redirect" readOnly value={view.redirectUri} className="min-w-0 flex-1 font-mono" onFocus={(event) => event.currentTarget.select()} aria-describedby="linkedin-redirect-hint" data-testid="linkedin-redirect" />
          <CopyButton value={view.redirectUri} iconOnly label="Kopiera adressen" className="size-[var(--control-h)] shrink-0" data-testid="linkedin-redirect-copy" />
        </div>
        <p id="linkedin-redirect-hint" className="text-xs leading-5 text-muted-foreground">Authorized redirect URL under appens Auth-flik.</p>
      </div>
    </>}
  </KeyCard></div>;
}

"use client";

import { useEffect, useState } from "react";
import { Megaphone, Share2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { SecretField } from "@/features/kfid/secret-field";
import { KEY_STATUS, KeyCard, KeyCardLink, KeyFields, KeyTextField, type KeyCardStatus } from "@/features/integrations/key-card";
import { useServerKeySectionStatus } from "@/features/integrations/server-key-status";
import { formatSwedish } from "@/lib/swedish-time";
import type { MetaView } from "@/lib/meta/server";

export const POSTS_HREF = "/?view=company_posts";
export const SCOPE_LIST = "pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management";

/** The card's one status (Fungerar, Välj sida, Behöver åtgärd, Fel, Ej provad, Saknas). */
export function metaCardStatus(view: Pick<MetaView, "status" | "statusMessage"> | null): KeyCardStatus | null {
  if (!view) return null;
  switch (view.status) {
    case "ok": return KEY_STATUS.works;
    case "choose": return { label: "Välj sida", tone: "warning", problem: view.statusMessage };
    case "action": return { label: "Behöver åtgärd", tone: "warning", problem: view.statusMessage };
    case "invalid": return { ...KEY_STATUS.failed, problem: view.statusMessage };
    case "unchecked": return KEY_STATUS.untested;
    default: return KEY_STATUS.missing;
  }
}

export const META_DEVELOPERS_URL = "https://developers.facebook.com/";

/**
 * Så skapar du en egen Meta-app (2026-11-10; the whole way 2026-11-12): every company connects its own app. One line
 * each, in Mer. Whether the app is in development mode cannot be read from Meta (neither the app's node nor debug_token has
 * such a field), so step 5 says it in words. Only a plain link to Meta's site; nothing of Meta's is loaded here.
 */
export function MetaConnectSteps() {
  return <div className="space-y-1" data-testid="meta-guide">
    <p className="text-xs font-semibold text-foreground">Så skapar du en egen Meta-app</p>
    <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground" data-testid="meta-connect-steps">
      <li>Logga in på <a href={META_DEVELOPERS_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground" data-testid="meta-developers-link">developers.facebook.com</a> med
        ett Facebookkonto som är administratör för företagets sida och registrera dig som utvecklare.</li>
      <li>Skapa en app av typen Företag (Business) och lägg till Facebook Login for Business.</li>
      <li>Ska inläggen även till Instagram: koppla företagets professionella Instagramkonto till Facebooksidan.</li>
      <li>Fyll i Appinställningar → Grundläggande: namn, e-postadress för kontakt, kategori, ikon och adresser till företagets integritetspolicy och användarvillkor.</li>
      <li>Ställ appläget på Live. I utvecklingsläge syns inläggen bara för appens egna användare.</li>
      <li>Öppna Graph API Explorer, välj appen och User Token, och kryssa i de sex behörigheterna: {SCOPE_LIST}. Tryck Generate Access Token och välj företagets Facebooksida och Instagramkonto.</li>
      <li>Klistra in appens id, appens hemlighet (Appinställningar → Grundläggande) och token här och tryck Spara. Workflow byter token mot en som gäller längre och hämtar sidans egen token.</li>
      <li>Tryck Kontrollera och prova sedan Testpublicering under Inlägg.</li>
    </ol>
    {/* Även som story (2026-11-13): no new permission is needed. */}
    <p className="text-xs text-muted-foreground" data-testid="meta-guide-story">Stories använder samma behörigheter. Länkar och klistermärken går inte i en story via Meta, och höjdpunkter lägger du till i Instagram-appen.</p>
  </div>;
}

/**
 * Facebook och Instagram under Kopplingar (2026-11-10; the shared key card 2026-11-11): the company's own Meta app – its id,
 * its secret and a user token from Graph API Explorer (dots and a bin, never the value) – and the page posts go to, all saved by
 * the card's one Spara. Whether posts may be published at all is the switch "Publicering" in the area's overview (off until the
 * admin switches it on). The steps, what Meta says about the token and removing the connection are under Mer. Nothing is
 * published here.
 */
export function MetaCard({ notify, onChanged }: { notify: (text: string, error?: boolean) => void; onChanged?: (view: MetaView) => void }) {
  const [view, setView] = useState<MetaView | null>(null);
  const [error, setError] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);
  const [userToken, setUserToken] = useState("");
  const [pageChoice, setPageChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const show = (next: MetaView) => { setView(next); setAppId(next.appId ?? ""); setPageChoice(next.page?.id ?? next.pages[0]?.id ?? ""); onChanged?.(next); };
  useEffect(() => {
    let active = true;
    void api<{ connection: MetaView }>("/api/meta", { cache: "no-store" }).then((result) => { if (active) show(result.connection); }).catch((cause) => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once when the card opens
  }, []);

  /** Sends one change; the answer is the connection as it now stands, or null when it was refused (the toast says why). */
  const post = async (input: Record<string, unknown>) => {
    setBusy(true);
    try {
      const result = await api<{ connection: MetaView; check?: { ok: boolean; message: string } }>("/api/meta", { method: "POST", body: JSON.stringify(input) });
      show(result.connection);
      setAppSecret(""); setUserToken(""); setRemoveSecret(false);
      return result;
    } catch (cause) { notify((cause as Error).message, true); return null; } finally { setBusy(false); }
  };
  const connectionInput = () => {
    const input: Record<string, unknown> = { action: "connection" };
    if (appId.trim() !== (view?.appId ?? "")) input.appId = appId.trim();
    if (removeSecret) input.appSecret = null; else if (appSecret.trim()) input.appSecret = appSecret.trim();
    if (userToken.trim()) input.userToken = userToken.trim();
    return input;
  };
  const choosing = Boolean(view && (view.status === "choose" || view.pages.length > 1));
  const pageChanged = Boolean(view && choosing && pageChoice && pageChoice !== view.page?.id);
  const dirty = Object.keys(connectionInput()).length > 1 || pageChanged;
  // One Spara (2026-11-11): first the app and the token, then the page – when it is still one the connection reaches.
  const save = async () => {
    const input = connectionInput();
    let current = view;
    if (Object.keys(input).length > 1) {
      const result = await post(input);
      if (!result) return false;
      current = result.connection;
    }
    if (current && pageChoice && pageChoice !== current.page?.id && current.pages.some((page) => page.id === pageChoice) && (current.status === "choose" || current.pages.length > 1)) {
      if (!(await post({ action: "choose", pageId: pageChoice }))) return false;
      notify("Sidan är vald.");
      return true;
    }
    notify(current?.status === "ok" ? "Facebook och Instagram är kopplade." : current?.statusMessage ?? "Sparat.");
    return true;
  };
  const check = async () => {
    const result = await post({ action: "check" });
    if (result?.check) notify(result.check.message || "Kopplingen fungerar.", !result.check.ok);
  };
  // Publicering in the area's overview: saved at once; switching on asks first.
  const switchPublishing = async (on: boolean) => {
    if (on && !(await confirm({
      title: "Slå på publicering?",
      message: `Inlägg kan då publiceras på ${view?.page?.name ?? "sidan"}${view?.instagram?.username ? ` och @${view.instagram.username}` : ""} när någon trycker Publicera under Inlägg. Inget publiceras av sig självt.`,
      confirmLabel: "Slå på",
    }))) return false;
    const result = await post({ action: "publishing", on });
    if (result) notify(on ? "Publicering är påslagen." : "Publicering är avstängd.");
    return Boolean(result);
  };
  const disconnect = async () => {
    if (await confirm({ title: "Ta bort kopplingen?", message: "Workflow slutar nå Facebook och Instagram. Inläggen i Workflow finns kvar. Ta också bort appen hos Meta om den inte ska användas mer.", confirmLabel: "Ta bort", tone: "danger" }))
      if (await post({ action: "disconnect" })) notify("Kopplingen är borttagen.");
  };

  const connected = Boolean(view && view.status !== "missing");
  const status = metaCardStatus(view);
  useServerKeySectionStatus("meta", status ? {
    label: status.label, tone: status.tone, detail: status.problem ?? undefined, name: "Facebook och Instagram",
    toggle: view ? {
      label: "Publicering", on: view.publishingApproved, testId: "meta-publishing",
      disabledReason: view.publishingApproved ? null : !view.page ? "Koppla en Facebooksida först." : view.status === "invalid" || view.status === "choose" ? "Kopplingen måste fungera först." : null,
      onChange: switchPublishing,
    } : undefined,
  } : error ? { label: "Kunde inte läsas", tone: "danger", detail: error, name: "Facebook och Instagram" } : null);
  if (error) return <p className="notice text-destructive" role="alert">{error}</p>;
  const date = (value: string | null) => (value ? formatSwedish(value, { dateStyle: "medium" }) : "–");
  return <div className="h-full" data-testid="meta-connection">{confirmElement}<KeyCard icon={Share2} title="Facebook och Instagram" status={status} statusTestId="meta-connection-status" problemTestId="meta-connection-problem"
    check={{ onClick: () => void check(), busy, disabled: busy || !connected, label: "Kontrollera kopplingen", testId: "meta-check" }}
    save={view ? { dirty, onSave: save } : undefined} saveable saveTestId="meta-save"
    actions={view?.page ? <KeyCardLink href={POSTS_HREF} icon={Megaphone} testId="meta-open-posts">Öppna Inlägg</KeyCardLink> : null}
    settings={view && (choosing || view.page) ? <>
      {choosing ? <div className="space-y-1">
        <p className="text-xs font-medium">Facebooksida</p>
        <div role="radiogroup" aria-label="Facebooksida" className="space-y-1" data-testid="meta-pages">
          {view.pages.map((page) => <label key={page.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-[var(--surface-hover)]">
            <input type="radio" name="meta-page" value={page.id} checked={pageChoice === page.id} onChange={() => setPageChoice(page.id)} className="size-4 accent-[var(--primary)]" />
            <span className="min-w-0"><span className="block text-sm font-medium">{page.name}</span>
              <span className="block text-xs text-muted-foreground">{page.instagram ? `Instagram: @${page.instagram.username ?? page.instagram.id}` : "Inget Instagramkonto kopplat"}</span></span>
          </label>)}
        </div>
      </div> : null}
      {view.page ? <p className="min-w-0 text-sm" data-testid="meta-target"><span className="text-muted-foreground">Inläggen går till </span>{view.page.name}{view.instagram ? ` · @${view.instagram.username ?? view.instagram.id}` : " · inget Instagramkonto"}</p>
 : null}
      {view.missingScopes.length ? <p className="text-xs text-red-700 dark:text-red-300" data-testid="meta-missing-scopes">Saknas: {view.missingScopes.join(", ")}</p> : null}
    </> : null}
    more={<>
      <MetaConnectSteps />
      <p>Inget publiceras av sig självt. Inlägg görs under Inlägg och publiceras först när du trycker Publicera. Publicering slås på i översikten.</p>
      {view?.page ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1" data-testid="meta-dates">
        <dt>Token gäller till</dt><dd className="text-foreground">{date(view.userTokenExpiresAt)}</dd>
        <dt>Dataåtkomst till</dt><dd className="text-foreground">{date(view.dataAccessExpiresAt)}</dd>
      </dl> : null}
      {view?.instagram && !view.instagramReachable ? <p data-testid="meta-instagram-local">Instagram hämtar bilden från Workflows adress, och den här servern nås inte från internet. Facebook går att testa här.</p> : null}
      <p>Token kontrolleras hos Meta när kortet öppnas och när du trycker Kontrollera. Graph API {view?.graphVersion ?? ""}.</p>
      {connected ? <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void disconnect()} data-testid="meta-disconnect"><Unplug />Ta bort kopplingen</Button> : null}
    </>} moreTestId="meta-more" moreOpenWhen={Boolean(view && !connected)}>
    {!view ? <p className="text-xs text-muted-foreground">Hämtar…</p> : <KeyFields>
      <KeyTextField id="meta-app-id" label="Appens id" inputMode="numeric" value={appId} maxLength={20} onChange={setAppId} placeholder="Siffror från appens sida" testId="meta-app-id" removeLabel="Töm appens id" />
      <SecretField keepBin id="meta-app-secret" label="Appens hemlighet" value={appSecret} onChange={(value) => { setAppSecret(value); setRemoveSecret(false); }} stored={view.appSecretStored} removed={removeSecret} placeholder="Från Appinställningar → Grundläggande"
        removeLabel="Ta bort appens hemlighet" busy={busy} onRemove={() => { setAppSecret(""); setRemoveSecret(true); }} onUndo={() => setRemoveSecret(false)} noManager testId="meta-app-secret" />
      <SecretField keepBin id="meta-user-token" label="Token" value={userToken} onChange={setUserToken} stored={view.userTokenStored} placeholder="Klistra in från Graph API Explorer"
        hint="Byts mot en token som gäller längre. Klistra in en ny när kortet säger det." busy={busy} noManager testId="meta-user-token" />
    </KeyFields>}
  </KeyCard></div>;
}

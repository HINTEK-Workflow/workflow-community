"use client";

import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { SecretField } from "@/features/kfid/secret-field";
import { api } from "@/features/kfid/api";
import { useServerKeySectionStatus } from "@/features/integrations/server-key-status";
import { KEY_STATUS, KeyCard, KeyFields, KeyTextField } from "@/features/integrations/key-card";
import { formatSwedish } from "@/lib/swedish-time";
import { MICROSOFT_TENANT_LABELS, MICROSOFT_TENANT_MODES } from "@/lib/auth/microsoft-text";

export type MicrosoftSettingsView = {
  enabled: boolean; configured: boolean; ready: boolean; clientId: string | null; tenant: string;
  lastCheck: { ok: boolean; message: string; at: string } | null; redirectUri: string;
  /** Microsofts tvåsteg räknas som tvåsteg i Workflow (2026-11-27); on unless switched off. */
  mfaAsSecondStep: boolean;
};

const isMode = (tenant: string) => (MICROSOFT_TENANT_MODES as readonly string[]).includes(tenant);

/**
 * Inloggning med Microsoft under Installation → Servernycklar (2026-10-09, built 2026-10-11): the app
 * registration's client id and secret (dots and a bin, never shown again), which accounts may sign in, the redirect
 * address to paste into the registration, and Kontrollera. The button on the login page also needs the switch
 * "Fortsätt med Microsoft" under Inloggning.
 */
export function MicrosoftSignInSettings({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [settings, setSettings] = useState<MicrosoftSettingsView | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  // The bins mark the id and the secret for removal until the card is saved (2026-11-11).
  const [removeKeys, setRemoveKeys] = useState(false);
  const [mode, setMode] = useState("common");
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const apply = (next: MicrosoftSettingsView) => {
    setSettings(next);
    setMode(isMode(next.tenant) ? next.tenant : "single");
    setDirectory(isMode(next.tenant) ? "" : next.tenant);
    setClientId(next.clientId ?? "");
  };
  useEffect(() => { api<MicrosoftSettingsView>("/api/superadmin/microsoft-settings").then(apply).catch((cause: Error) => setError(cause.message)); }, []);
  const post = async (input: Record<string, unknown>, done?: string) => {
    setError("");
    try {
      const result = await api<MicrosoftSettingsView & { check?: { ok: boolean; message: string } }>("/api/superadmin/microsoft-settings", { method: "POST", body: JSON.stringify(input) });
      apply(result); setSecret(""); setRemoveKeys(false);
      if (result.check) notify(result.check.message, !result.check.ok); else if (done) notify(done);
      return true;
    } catch (cause) { setError((cause as Error).message); notify((cause as Error).message, true); return false; }
  };
  const check = async () => { setBusy(true); try { await post({ action: "check" }); } finally { setBusy(false); } };
  const tenant = mode === "single" ? directory.trim() : mode;
  const dirty = Boolean(settings && (removeKeys || secret || clientId.trim() !== (settings.clientId ?? "") || tenant !== settings.tenant));
  const save = () => {
    if (removeKeys) return post({ clientId: null, secret: null, tenant }, "Nycklarna är borttagna. Microsoft-knappen visas inte längre.");
    const input: Record<string, unknown> = { tenant };
    if (clientId.trim() && clientId.trim() !== (settings?.clientId ?? "")) input.clientId = clientId.trim();
    if (secret) input.secret = secret;
    return post(input, "Inställningarna för Microsoft-inloggning är sparade.");
  };
  const problem = settings?.lastCheck?.ok === false ? settings.lastCheck.message : null;
  const status = !settings ? null : !settings.configured ? KEY_STATUS.missing
    : settings.lastCheck?.ok ? KEY_STATUS.works
      : problem ? { ...KEY_STATUS.failed, problem } : KEY_STATUS.untested;
  // "Fortsätt med Microsoft" in the page's overview (2026-11-11): the same setting as under Drift och säkerhet → Inloggning, saved at once.
  const toggle = settings ? {
    label: "Fortsätt med Microsoft", on: settings.enabled, disabledReason: settings.configured ? null : "Lägg in nycklarna först.",
    onChange: async (on: boolean) => post({ enabled: on }, on ? "Inloggning med Microsoft är påslagen." : "Inloggning med Microsoft är avstängd."),
  } : undefined;
  useServerKeySectionStatus("microsoft", status ? { label: status.label, tone: status.tone, detail: problem ?? undefined, name: "Inloggning med Microsoft", toggle } : error ? { label: "Kunde inte hämtas", tone: "danger", detail: error, name: "Inloggning med Microsoft" } : null);
  const field = "grid gap-1.5 text-xs font-medium text-muted-foreground";
  return <KeyCard icon={LogIn} title="Inloggning med Microsoft" status={status} statusTestId="microsoft-status" problemTestId="microsoft-problem" moreTestId="microsoft-more" moreOpenWhen={Boolean(problem)}
    check={settings ? { onClick: () => void check(), busy, disabled: busy || !settings.configured, label: "Kontrollera Microsoft", testId: "microsoft-check" } : undefined}
    save={settings ? { dirty, onSave: save, blocked: mode === "single" && !directory.trim() ? "Skriv katalogens id först." : null } : undefined} saveable
    settings={settings ? <div className="grid gap-3 @lg:grid-cols-2">
      <label className={field}>Vilka konton får logga in<select className="form-select" value={mode} onChange={(event) => setMode(event.target.value)} data-testid="microsoft-tenant">
        {MICROSOFT_TENANT_MODES.map((value) => <option key={value} value={value}>{MICROSOFT_TENANT_LABELS[value]}</option>)}
        <option value="single">{MICROSOFT_TENANT_LABELS.single}</option>
      </select></label>
      {mode === "single" ? <KeyTextField id="microsoft-directory" label="Katalogens id (Directory/tenant ID)" value={directory} onChange={setDirectory} placeholder="00000000-0000-0000-0000-000000000000" removeLabel="Töm katalogens id" /> : null}
    </div> : null}
    more={settings ? <>
      <p>Knappen på inloggningssidan kräver också att Fortsätt med Microsoft är på i översikten.{settings.configured && !settings.enabled ? " Den är av nu." : ""}</p>
      {/* Microsofts tvåsteg (2026-11-27): Microsoft says it only when the app registration asks for the amr claim. */}
      <p data-testid="microsoft-mfa-help">Microsofts tvåsteg räknas som tvåsteg i Workflow{settings.mfaAsSecondStep ? "" : " när det är påslaget under Inloggning (nu av)"}. Då behövs ingen kod från Workflow efter Microsoft. Det kräver att appregistreringen skickar anspråket amr: Token configuration → Add optional claim → ID → amr. Utan det frågar Workflow efter sin kod som vanligt.</p>
      <p className="font-medium text-foreground">Omdirigerings-URI för appregistreringen (plattform Webb)</p>
      <p className="flex flex-wrap items-center gap-2"><code className="break-all rounded bg-muted px-1.5 py-0.5" data-testid="microsoft-redirect">{settings.redirectUri}</code>
        <CopyButton variant="ghost" size="sm" value={settings.redirectUri} onCopied={() => notify("Adressen är kopierad.")} /></p>
      {settings.lastCheck ? <p className="break-words" data-testid="microsoft-last-check">Senast kontrollerad {formatSwedish(settings.lastCheck.at, { dateStyle: "medium", timeStyle: "short" })}: {settings.lastCheck.message}</p> : null}
    </> : undefined}>
    {!settings ? <p className="text-muted-foreground">{error || "Hämtar…"}</p> : <div className="space-y-3" data-testid="microsoft-settings">
      <KeyFields>
        <KeyTextField id="microsoft-client-id" label="Program-id (klient-id)" value={removeKeys ? "" : clientId} onChange={(value) => { setClientId(value); if (!value && settings.configured) setRemoveKeys(true); else setRemoveKeys(false); }}
          placeholder={removeKeys ? "Tas bort när du sparar" : "Från appregistreringen"} removeLabel="Ta bort nycklarna" />
        <SecretField keepBin id="microsoft-secret" label="Klienthemlighet" autoComplete="new-password" value={secret} onChange={(value) => { setSecret(value); setRemoveKeys(false); }} stored={settings.configured} removed={removeKeys} placeholder="Värdet (Value)"
          removeLabel="Ta bort nycklarna" onRemove={() => { setSecret(""); setRemoveKeys(true); }} onUndo={() => { setRemoveKeys(false); setClientId(settings.clientId ?? ""); }} />
      </KeyFields>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>}
  </KeyCard>;
}

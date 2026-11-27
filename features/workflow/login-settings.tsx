"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { LogIn, Search, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceCard } from "@/components/ui/choice-card";
import { parseLoginList, ruleAllows, type LoginAccessMode } from "@/lib/auth/login-rule";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { KeyField, SecretField } from "@/features/kfid/secret-field";
import { useServerKeySectionStatus } from "@/features/integrations/server-key-status";
import { KEY_STATUS, KeyCard, KeyExpiryLine, type KeyCardStatus } from "@/features/integrations/key-card";
import { WARN_DAYS, expiryDateProblem } from "@/lib/secrets/key-expiry";
import type { MicrosoftSettingsView } from "@/features/workflow/microsoft-settings";

type LoginAccess = { mode: LoginAccessMode; allow: string[]; block: string[]; chosen: boolean; pilotCount: number; owner: string | null };
type Settings = { me: string; loginAccess: LoginAccess; googleSignIn: boolean; googleConfigured: boolean; googleAvailable: boolean; registrationOpen: boolean; companyLookup: { configured: boolean; keyHint: string | null; updatedAt: string | null; updatedBy: string | null; validUntil: string | null } };

const MODES: { value: LoginAccessMode; title: string; text: string }[] = [
  { value: "ALL", title: "Alla", text: "Alla med ett konto kan logga in." },
  { value: "ONLY", title: "Endast", text: "Bara adresserna och domänerna i listan kan logga in." },
  { value: "BLOCK", title: "Alla utom blockerade", text: "Alla med ett konto utom adresserna och domänerna i listan." },
];

/**
 * Vem får logga in (2026-10-06): Alla, Endast or Alla utom blockerade, with one address or "@domän" per line.
 * Saved with the button; the superadmin can never lock themselves out – the button is held back with the reason.
 */
function LoginAccessSettings({ settings, busy, save }: { settings: Settings; busy: boolean; save: (patch: { loginAccess: { mode: LoginAccessMode; allow: string; block: string } }) => Promise<void> }) {
  const saved = settings.loginAccess;
  const [mode, setMode] = useState(saved.mode);
  const [allow, setAllow] = useState(saved.allow.join("\n"));
  const [block, setBlock] = useState(saved.block.join("\n"));
  const allowList = parseLoginList(allow);
  const blockList = parseLoginList(block);
  const invalid = mode === "ONLY" ? allowList.invalid : mode === "BLOCK" ? blockList.invalid : [];
  const me = settings.me.toLowerCase();
  const locksMeOut = me !== (saved.owner ?? "") && !ruleAllows({ mode, allow: allowList.entries, block: blockList.entries }, me);
  const edited = mode !== saved.mode || allowList.entries.join("\n") !== saved.allow.join("\n") || blockList.entries.join("\n") !== saved.block.join("\n");
  const changed = !saved.chosen || mode !== saved.mode || allowList.entries.join("\n") !== saved.allow.join("\n") || blockList.entries.join("\n") !== saved.block.join("\n");
  const list = mode === "ONLY" ? { value: allow, set: setAllow, label: "Får logga in", count: allowList.entries.length } : mode === "BLOCK" ? { value: block, set: setBlock, label: "Blockerade", count: blockList.entries.length } : null;
  // No inner heading with a grey line (UX-punkt 6): the choice's name is a label above it, like a field's.
  return <div className="mb-4 space-y-3 text-sm" data-testid="login-access">
    <div>
      <p className="field-label text-xs font-medium">Vem får logga in</p>
      <p className="text-xs text-muted-foreground">Valet gäller all inloggning: nya konton, inbjudningar, API-nycklar och MCP. Den som inte längre får logga in stoppas nästa gång Workflow kontrollerar inloggningen.</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Vem får logga in">
      {MODES.map((option) => <ChoiceCard key={option.value} name="login-access-mode" value={option.value} checked={mode === option.value} disabled={busy} onChange={(value) => setMode(value as LoginAccessMode)} title={option.title} description={option.text} />)}
    </div>
    {list ? <label className="block space-y-1.5 text-xs font-medium">{list.label} – en e-postadress eller domän (@foretag.se) per rad{list.count ? ` (${list.count})` : ""}
      <textarea className="form-textarea min-h-32 bg-card font-mono text-xs" value={list.value} disabled={busy} spellCheck={false} onChange={(event) => list.set(event.target.value)} data-testid={mode === "ONLY" ? "login-allow-list" : "login-block-list"} placeholder={"namn@foretag.se\n@foretag.se"} />
    </label> : null}
    {invalid.length ? <p className="text-xs text-destructive" role="alert">Raderna kan inte tolkas: {invalid.slice(0, 5).join(", ")}. Skriv en hel e-postadress eller en domän som @foretag.se.</p> : null}
    {locksMeOut && edited ? <p className="text-xs text-amber-700 dark:text-amber-300" role="alert" data-testid="login-access-self">Du skulle låsa ute dig själv. {mode === "ONLY" ? `Lägg till din egen adress (${settings.me}) eller din domän i listan.` : `Ta bort din egen adress (${settings.me}) eller din domän ur listan.`}</p> : null}
    <ul className="space-y-1 text-xs text-muted-foreground">
      {saved.owner ? <li>Installationens ägarkonto ({saved.owner}) får alltid logga in.</li> : null}
      <li>”Tillåt nya konton” styr bara om ”Skapa konto” visas. Adresser som inte får logga in kan inte skapa konto.</li>
      {!saved.chosen ? <li>Inget eget val är sparat. Valet ovan visar vad som gäller nu. När du sparar gäller bara valet här.</li> : null}
    </ul>
    <Button type="button" disabled={busy || !changed || locksMeOut || invalid.length > 0} onClick={() => void save({ loginAccess: { mode, allow, block } })} data-testid="login-access-save">Spara</Button>
  </div>;
}

/** Inloggning (2026-10-03): switch "Fortsätt med Google" on the login page on or off; saved at once. */
export function LoginSettings({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<Settings>("/api/superadmin/login-settings", { cache: "no-store" }).then(setSettings).catch((error) => notify((error as Error).message, true)); }, [notify]);
  const change = async (patch: Partial<Pick<Settings, "googleSignIn" | "registrationOpen">>) => {
    setBusy(true);
    try {
      setSettings(await api<Settings>("/api/superadmin/login-settings", { method: "POST", body: JSON.stringify(patch) }));
      notify(patch.googleSignIn !== undefined ? (patch.googleSignIn ? "Inloggning med Google är påslagen." : "Inloggning med Google är avstängd.")
        : patch.registrationOpen ? "Nya konton tillåts. Skapa konto visas på inloggningssidan." : "Nya konton tillåts inte.");
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  const saveAccess = async (patch: { loginAccess: { mode: LoginAccessMode; allow: string; block: string } }) => {
    setBusy(true);
    try {
      setSettings(await api<Settings>("/api/superadmin/login-settings", { method: "POST", body: JSON.stringify(patch) }));
      notify("Vem som får logga in är sparat.");
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  return <Panel title="Inloggning" description="Här väljer du vem som får logga in och skapa konto, och på vilket sätt. Inloggning med e-post och lösenord finns alltid."
    icon={LogIn}>
    {settings ? <LoginAccessSettings key={JSON.stringify(settings.loginAccess)} settings={settings} busy={busy} save={saveAccess} /> : null}
    {settings ? <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" data-testid="registration-open">
      <Checkbox className="mt-0.5" checked={settings.registrationOpen} disabled={busy} onCheckedChange={(value) => void change({ registrationOpen: value === true })} aria-label="Tillåt nya konton" />
      <span><span className="block font-medium">Tillåt nya konton</span><span className="block text-xs text-muted-foreground">På: ”Skapa konto” visas och nya företag börjar gratis. Av: bara inbjudna får konto. Sparas direkt.</span></span>
    </label> : null}
    {!settings ? <p className="text-sm text-muted-foreground">Hämtar…</p> : !settings.googleAvailable ? <p className="text-sm text-muted-foreground">Google-inloggning finns inte i den här installationen.</p> : <div className="space-y-3" data-testid="login-settings">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
        <Checkbox className="mt-0.5" checked={settings.googleSignIn} disabled={busy} onCheckedChange={(value) => void change({ googleSignIn: value === true })} aria-label="Fortsätt med Google" />
        <span><span className="block font-medium">Fortsätt med Google</span><span className="block text-xs text-muted-foreground">Visar knappen på inloggningssidan. Av betyder att knappen försvinner och att servern vägrar Google-inloggning. Alla loggar då in med e-post och lösenord. Sparas direkt.</span></span>
      </label>
      {!settings.googleConfigured ? <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="google-keys-missing">Google-nycklarna saknas, så knappen visas inte även om den är påslagen. Lägg in klient-id och klienthemlighet under <Link href="/?view=server_keys" className="underline underline-offset-2">Tjänster och nycklar</Link>.</p> : null}
    </div>}
    <MicrosoftSwitch notify={notify} />
    {/* The SCB key moved to Servernycklar (2026-10-07), on to Tjänster och verktyg (2026-10-09 natt) and is under
        Tjänster och nycklar since 2026-10-15, where every service and its key is (the link lands on the SCB card). */}
    <p className="mt-3 text-xs text-muted-foreground" data-testid="company-lookup-moved">Nyckeln för företagsuppslag (SCB) finns under <Link href="/?view=server_keys&section=scb" className="underline underline-offset-2">Tjänster och nycklar</Link>.</p>
  </Panel>;
}

/**
 * Fortsätt med Microsoft (2026-10-11): the switch, saved at once. The button on the login page also needs the keys
 * under Servernycklar and a passed check; until then the reason is said here.
 */
function MicrosoftSwitch({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [settings, setSettings] = useState<MicrosoftSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<MicrosoftSettingsView>("/api/superadmin/microsoft-settings", { cache: "no-store" }).then(setSettings).catch((error) => notify((error as Error).message, true)); }, [notify]);
  if (!settings) return null;
  const missing = !settings.configured ? "Nycklarna saknas under Tjänster och nycklar. Knappen visas inte."
    : !settings.lastCheck?.ok ? "Nycklarna är inte kontrollerade under Tjänster och nycklar. Knappen visas inte ännu." : null;
  const save = async (patch: { enabled?: boolean; mfaAsSecondStep?: boolean }, done: string) => {
    setBusy(true);
    try {
      setSettings(await api<MicrosoftSettingsView>("/api/superadmin/microsoft-settings", { method: "POST", body: JSON.stringify(patch) }));
      notify(done);
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  return <div className="mt-3 space-y-3" data-testid="login-microsoft-settings">
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
      <Checkbox className="mt-0.5" checked={settings.enabled} disabled={busy} aria-label="Fortsätt med Microsoft" onCheckedChange={(value) =>
        void save({ enabled: value === true }, value === true ? "Inloggning med Microsoft är påslagen." : "Inloggning med Microsoft är avstängd.")} />
      <span><span className="block font-medium">Fortsätt med Microsoft</span><span className="block text-xs text-muted-foreground">Knappen visas på inloggningssidan och var och en kopplar sitt konto under Mina inställningar. Inga nya konton skapas. Av: knappen tas bort och inloggningen vägras. Sparas direkt.</span></span>
    </label>
    {/* Microsofts tvåsteg räknas som Workflows (2026-11-27): on by default; off means Workflow's own code as before. */}
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" data-testid="login-microsoft-mfa">
      <Checkbox className="mt-0.5" checked={settings.mfaAsSecondStep} disabled={busy} aria-label="Microsofts tvåsteg räknas som tvåsteg" onCheckedChange={(value) =>
        void save({ mfaAsSecondStep: value === true }, value === true ? "Microsofts tvåsteg räknas nu som tvåsteg i Workflow." : "Workflow frågar nu alltid efter sin egen kod efter Microsoft.")} />
      <span><span className="block font-medium">Microsofts tvåsteg räknas som tvåsteg</span><span className="block text-xs text-muted-foreground">Godkänner personen inloggningen med Microsofts tvåsteg, till exempel i Microsoft Authenticator, behövs ingen kod från Workflow. Det gäller också produktadministratören. Kräver anspråket amr i appregistreringen (se Microsoft-kortet under Tjänster och nycklar). Av: Workflow frågar efter sin kod som förut. Sparas direkt.</span></span>
    </label>
    {missing ? <p className="text-xs text-amber-700 dark:text-amber-300">{missing}</p> : null}
  </div>;
}

/** The SCB key's one status: no call is made by itself, so it is Ej provad until a test lookup answers; an ended key is Fel. */
function companyLookupStatus(configured: boolean, validUntil: string | null, answered: boolean): KeyCardStatus {
  if (!configured) return KEY_STATUS.missing;
  const today = new Date();
  const day = (offset: number) => { const date = new Date(today); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
  if (validUntil && validUntil < day(0)) return { ...KEY_STATUS.failed, problem: `Nyckeln gällde till ${validUntil}.` };
  const base = answered ? KEY_STATUS.works : KEY_STATUS.untested;
  // The same 30 days as every other key's Gäller till (lib/secrets/key-expiry.ts WARN_DAYS, 2026-11-14).
  return validUntil && validUntil <= day(WARN_DAYS) ? { label: base.label, tone: "warning", problem: `Nyckeln går ut ${validUntil}.` } : base;
}

/**
 * Företagsuppslag (SCB) under Servernycklar (2026-10-07, moved from Inloggning): the key for Skapa konto,
 * Företagsuppgifter, Ställ in Workflow and "Förbered kundföretag", its valid-until date and a test lookup.
 */
export function CompanyLookupSettings({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [scbKey, setScbKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [validUntil, setValidUntil] = useState("");
  const [testNumber, setTestNumber] = useState("");
  const [testResult, setTestResult] = useState("");
  const apply = (next: Settings) => { setSettings(next); setValidUntil(next.companyLookup.validUntil ?? ""); };
  useEffect(() => { void api<Settings>("/api/superadmin/login-settings", { cache: "no-store" }).then(apply).catch((error) => notify((error as Error).message, true)); }, [notify]);
  const post = async (payload: Record<string, unknown>) => {
    const result = await api<Settings & { test?: string }>("/api/superadmin/login-settings", { method: "POST", body: JSON.stringify(payload) });
    apply(result);
    return result;
  };
  // One Spara for the key and its end date (2026-11-11); the bin marks the key for removal until then.
  const saved = settings?.companyLookup.validUntil ?? "";
  const dirty = Boolean(scbKey.trim() || removeKey || (settings && validUntil !== saved));
  const save = async () => {
    try {
      const payload: Record<string, unknown> = {};
      if (removeKey) payload.scbKey = null; else if (scbKey.trim()) payload.scbKey = scbKey.trim();
      if (validUntil !== saved) payload.scbValidUntil = validUntil || null;
      await post(payload);
      setScbKey(""); setRemoveKey(false);
      notify(removeKey ? "SCB-nyckeln är borttagen." : validUntil && validUntil !== saved ? "Sparat. Du får ett driftlarm 30, 14, 7 och 1 dag innan nyckeln går ut." : "SCB-nyckeln är sparad.");
      return true;
    } catch (error) { notify((error as Error).message, true); return false; }
  };
  const tryNumber = async () => {
    setBusy(true); setTestResult("");
    try { const result = await post({ testNumber, ...(scbKey.trim() ? { scbKey: scbKey.trim() } : {}) }); setTestResult(result.test ?? ""); }
    catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  const status = settings ? companyLookupStatus(settings.companyLookup.configured, settings.companyLookup.validUntil, /^SCB svarar/.test(testResult)) : null;
  useServerKeySectionStatus("scb", status ? { label: status.label, tone: status.tone, detail: status.problem ?? undefined, name: "Företagsuppslag (SCB)" } : null);
  return <KeyCard icon={Search} title="Företagsuppslag (SCB)" status={status} statusTestId="company-lookup-status" moreTestId="company-lookup-more"
    // SCB has no call of its own to check with: Kontrollera is a test lookup of a number, under Mer.
    check={settings ? { onClick: () => void tryNumber(), busy, disabled: busy, disabledReason: !testNumber.trim() ? "Skriv ett organisationsnummer under Mer först." : !settings.companyLookup.configured && !scbKey.trim() ? "Lägg in nyckeln först." : null, label: "Kontrollera SCB", testId: "company-lookup-check" } : undefined}
    save={settings ? { dirty, onSave: save } : undefined} saveable
    settings={settings?.companyLookup.configured ? <KeyField id="scb-valid-until" label="Gäller till (valfritt)" hint={validUntil && !expiryDateProblem(validUntil) ? <KeyExpiryLine on={validUntil} /> : "Du får ett mejl 30, 14, 7 och 1 dag innan."}>
      <Input id="scb-valid-until" type="date" value={validUntil} className="w-44" onChange={(event) => setValidUntil(event.target.value)} />
      <Button type="button" variant="outline" size="icon" className="size-[var(--control-h)] shrink-0" aria-label="Töm slutdatumet" title="Töm slutdatumet" disabled={!validUntil} onClick={() => setValidUntil("")}><Trash2 /></Button>
    </KeyField> : null}
    more={settings ? <>
      <p>Med nyckeln hämtar Workflow företagets namn och adress från SCB. Utan nyckel skriver du in dem själv. En personlig nyckel får du på registreraafr.scb.se.</p>
      {/* The lookup is the header's Kontrollera (2026-11-12: only status and Kontrollera there, no second button here). */}
      <KeyField id="scb-test" label="Prova ett organisationsnummer" hint="Skriv ett organisationsnummer och tryck på Kontrollera för att prova uppslaget.">
        <Input id="scb-test" value={testNumber} onChange={(event) => setTestNumber(event.target.value)} placeholder="Organisationsnummer" className="min-w-0 flex-1 basis-56" />
      </KeyField>
      {testResult ? <p className="text-xs" role="status">{testResult}</p> : null}
    </> : undefined}>
    {settings ? <div className="space-y-3" data-testid="company-lookup">
      <SecretField keepBin id="scb-key" label="SCB:s API-nyckel" value={scbKey} onChange={(value) => { setScbKey(value); setRemoveKey(false); }} stored={settings.companyLookup.configured} removed={removeKey}
        tail={settings.companyLookup.keyHint?.replace(/^…/, "")} placeholder="Klistra in nyckeln" busy={busy} removeLabel="Ta bort nyckeln"
        onRemove={() => { setScbKey(""); setRemoveKey(true); }} onUndo={() => setRemoveKey(false)} />
    </div> : <p className="text-muted-foreground">Hämtar…</p>}
  </KeyCard>;
}

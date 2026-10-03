"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogIn } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";

type Settings = { googleSignIn: boolean; googleConfigured: boolean; googleAvailable: boolean; registrationOpen: boolean; companyLookup: { configured: boolean; keyHint: string | null; updatedAt: string | null; updatedBy: string | null; validUntil: string | null } };

/** Inloggning (2026-10-03): switch "Fortsätt med Google" on the login page on or off; saved at once. */
export function LoginSettings({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [scbKey, setScbKey] = useState("");
  const [testNumber, setTestNumber] = useState("");
  const [testResult, setTestResult] = useState("");
  const scb = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true); setTestResult("");
    try {
      const result = await api<Settings & { test?: string }>("/api/superadmin/login-settings", { method: "POST", body: JSON.stringify(payload) });
      setSettings(result);
      if (result.test) setTestResult(result.test); else { notify(done); setScbKey(""); }
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  useEffect(() => { void api<Settings>("/api/superadmin/login-settings", { cache: "no-store" }).then(setSettings).catch((error) => notify((error as Error).message, true)); }, [notify]);
  const change = async (patch: Partial<Pick<Settings, "googleSignIn" | "registrationOpen">>) => {
    setBusy(true);
    try {
      setSettings(await api<Settings>("/api/superadmin/login-settings", { method: "POST", body: JSON.stringify(patch) }));
      notify(patch.googleSignIn !== undefined ? (patch.googleSignIn ? "Inloggning med Google är påslagen." : "Inloggning med Google är avstängd.")
        : patch.registrationOpen ? "Nya konton tillåts. Workflow är öppet för alla med konto." : "Nya konton tillåts inte.");
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  return <Panel title="Inloggning" description="Vem som kan skapa konto och hur man loggar in. E-post och lösenord finns alltid."
    leadingActions={<span className="panel-icon" aria-hidden="true"><LogIn className="size-4" /></span>}>
    {settings ? <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" data-testid="registration-open">
      <Checkbox className="mt-0.5" checked={settings.registrationOpen} disabled={busy} onCheckedChange={(value) => void change({ registrationOpen: value === true })} aria-label="Tillåt nya konton" />
      <span><span className="block font-medium">Tillåt nya konton</span><span className="block text-xs text-muted-foreground">På: ”Skapa konto” visas på inloggningssidan och alla med ett konto kan logga in – det här är beslutet att öppna Workflow för kunder. Nya konton börjar gratis. Av: bara inbjudna och pilotlistan. Sparas direkt.</span></span>
    </label> : null}
    {!settings ? <p className="text-sm text-muted-foreground">Hämtar…</p> : !settings.googleAvailable ? <p className="text-sm text-muted-foreground">Google-inloggning finns inte i den här installationen.</p> : <div className="space-y-3" data-testid="login-settings">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
        <Checkbox className="mt-0.5" checked={settings.googleSignIn} disabled={busy} onCheckedChange={(value) => void change({ googleSignIn: value === true })} aria-label="Fortsätt med Google" />
        <span><span className="block font-medium">Fortsätt med Google</span><span className="block text-xs text-muted-foreground">Visar knappen på inloggningssidan. Av betyder att knappen försvinner och att servern vägrar Google-inloggning; alla loggar då in med e-post och lösenord. Sparas direkt.</span></span>
      </label>
      {!settings.googleConfigured ? <p className="text-xs text-amber-700 dark:text-amber-300">Google-nycklarna (GOOGLE_CLIENT_ID och GOOGLE_CLIENT_SECRET) saknas i serverns miljö, så knappen visas inte även om den är påslagen.</p> : null}
    </div>}
    {settings ? <div className="mt-3 space-y-2 rounded-lg border p-3 text-sm" data-testid="company-lookup">
      <p className="font-medium">Företagsuppslag (SCB)</p>
      <p className="text-xs text-muted-foreground">När en kund skriver sitt organisationsnummer i Skapa konto hämtas namn och adress från SCB:s avgiftsfria företagsregister. Nyckeln får du när du registrerar dig på registreraafr.scb.se; den är personlig och sparas krypterad här. Utan nyckel fyller kunden i namnet själv.</p>
      <p className="text-xs">{settings.companyLookup.configured ? `Nyckel sparad: ${settings.companyLookup.keyHint}` : "Ingen nyckel ännu."}</p>
      <div className="flex flex-wrap gap-2">
        <Input type="password" autoComplete="off" value={scbKey} onChange={(event) => setScbKey(event.target.value)} placeholder="SCB:s API-nyckel" aria-label="SCB:s API-nyckel" className="min-w-0 flex-1 basis-56" />
        <Button type="button" variant="outline" disabled={busy || !scbKey.trim()} onClick={() => void scb({ scbKey: scbKey.trim() }, "SCB-nyckeln är sparad.")}>Spara nyckeln</Button>
        {settings.companyLookup.configured ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void scb({ scbKey: null }, "SCB-nyckeln är borttagen.")}>Ta bort</Button> : null}
      </div>
      {settings.companyLookup.configured ? <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="scb-valid-until" className="text-xs">Giltig till</label>
        <Input id="scb-valid-until" type="date" key={settings.companyLookup.validUntil ?? "none"} defaultValue={settings.companyLookup.validUntil ?? ""} className="w-44"
          onChange={(event) => void scb({ scbValidUntil: event.target.value || null }, event.target.value ? "Slutdatumet är sparat. Du får ett driftlarm 14 och 3 dagar innan." : "Slutdatumet är borttaget.")} />
        <span className="text-xs text-muted-foreground">Driftlarmet påminner 14 och 3 dagar innan nyckeln slutar gälla.</span>
      </div> : null}
      <div className="flex flex-wrap gap-2">
        <Input value={testNumber} onChange={(event) => setTestNumber(event.target.value)} placeholder="Organisationsnummer att prova" aria-label="Organisationsnummer att prova" className="min-w-0 flex-1 basis-56" />
        <Button type="button" variant="outline" disabled={busy || !testNumber.trim() || (!settings.companyLookup.configured && !scbKey.trim())} onClick={() => void scb({ testNumber, ...(scbKey.trim() ? { scbKey: scbKey.trim() } : {}) }, "")}>Prova</Button>
      </div>
      {testResult ? <p className="text-xs" role="status">{testResult}</p> : null}
    </div> : null}
  </Panel>;
}

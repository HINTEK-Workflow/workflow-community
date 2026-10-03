"use client";

import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";

type Settings = { googleSignIn: boolean; googleConfigured: boolean; googleAvailable: boolean };

/** Inloggning (2026-10-03): switch "Fortsätt med Google" on the login page on or off; saved at once. */
export function LoginSettings({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<Settings>("/api/superadmin/login-settings", { cache: "no-store" }).then(setSettings).catch((error) => notify((error as Error).message, true)); }, [notify]);
  const change = async (googleSignIn: boolean) => {
    setBusy(true);
    try {
      setSettings(await api<Settings>("/api/superadmin/login-settings", { method: "POST", body: JSON.stringify({ googleSignIn }) }));
      notify(googleSignIn ? "Inloggning med Google är påslagen." : "Inloggning med Google är avstängd.");
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  return <Panel title="Inloggning" description="Hur man kan logga in på inloggningssidan. E-post och lösenord finns alltid."
    leadingActions={<span className="panel-icon" aria-hidden="true"><LogIn className="size-4" /></span>}>
    {!settings ? <p className="text-sm text-muted-foreground">Hämtar…</p> : !settings.googleAvailable ? <p className="text-sm text-muted-foreground">Google-inloggning finns inte i den här installationen.</p> : <div className="space-y-3" data-testid="login-settings">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
        <Checkbox className="mt-0.5" checked={settings.googleSignIn} disabled={busy} onCheckedChange={(value) => void change(value === true)} aria-label="Fortsätt med Google" />
        <span><span className="block font-medium">Fortsätt med Google</span><span className="block text-xs text-muted-foreground">Visar knappen på inloggningssidan. Av betyder att knappen försvinner och att servern vägrar Google-inloggning; alla loggar då in med e-post och lösenord. Sparas direkt.</span></span>
      </label>
      {!settings.googleConfigured ? <p className="text-xs text-amber-700 dark:text-amber-300">Google-nycklarna (GOOGLE_CLIENT_ID och GOOGLE_CLIENT_SECRET) saknas i serverns miljö, så knappen visas inte även om den är påslagen.</p> : null}
    </div>}
  </Panel>;
}

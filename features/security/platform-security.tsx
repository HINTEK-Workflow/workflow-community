"use client";

import { useCallback, useState } from "react";
import { ScrollText, ShieldCheck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/features/kfid/api";
import { useLoadEffect } from "@/lib/use-load-effect";
import { Panel } from "@/features/kfid/ui";
import { SECURITY_LOG_NOTE, SecurityLogList, type SecurityLogPage } from "./security-settings";

type Data = { required: boolean; log: SecurityLogPage };

function usePlatformSecurity(notify: (message: string, error?: boolean) => void) {
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(async () => {
    try { setData(await api<Data>("/api/superadmin/security", { cache: "no-store" })); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);
  return { data, load };
}

/**
 * Installation → Drift och säkerhet (2026-10-10; C6 2026-10-21): require two-step verification for superadmins.
 * The installation's security log is its own card under Avancerat (`PlatformSecurityLog`).
 */
export function PlatformSecurity({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const { data } = usePlatformSecurity(notify);
  // Always on since the security review 2026-11-24 (G-10): shown as a fixed rule, not a choice.
  return <Panel title="Tvåstegsverifiering för superadmin" description="Krävs alltid för superadmin." icon={ShieldCheck}>
    {!data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : <div className="space-y-5" data-testid="platform-security">
      <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
        <Checkbox className="mt-0.5" checked disabled aria-label="Tvåstegsverifiering krävs för superadmin" />
        <span><span className="block font-medium">Tvåstegsverifiering krävs för superadmin</span>
          <span className="block text-xs text-muted-foreground">Alltid på: en superadmin måste ha en kod från en autentiseringsapp eller en passkey, också vid inloggning med Google eller Microsoft. Tappad telefon utan reservkoder: npm run admin:recover -- --two-factor på servern.</span></span>
      </label>
    </div>}
  </Panel>;
}

/** Installationens säkerhetslogg (Avancerat på Drift och säkerhet): superadmins' accounts and the installation's rules – never a customer's members. */
export function PlatformSecurityLog({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const { data } = usePlatformSecurity(notify);
  return <Panel title="Installationens säkerhetslogg" description="Bara superadmins konton och installationens regler, aldrig kundföretagens medarbetare." icon={ScrollText}>
    {!data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : <div className="space-y-2" data-testid="platform-security-log-part">
      <p className="text-xs text-muted-foreground">{SECURITY_LOG_NOTE}</p>
      <SecurityLogList page={data.log} showPerson testId="platform-security-log" load={async (before) => (await api<{ log: SecurityLogPage }>(`/api/superadmin/security?before=${encodeURIComponent(before)}`)).log} />
    </div>}
  </Panel>;
}

"use client";

import { useCallback, useState } from "react";
import { Link2, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/features/kfid/api";
import { formatSwedish } from "@/lib/swedish-time";
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

type ChainView = { log: string; label: string; chainKey: string; company: string | null; broken: null | { at: string; seq: number | null; text: string } };
type ChainsData = { chains: number; brokenCount: number; lastVerified: string | null; broken: ChainView[] };

/**
 * Loggarnas kedja (K3.1, 2026-11-27; ?section=log-chain): the nightly check of the companies' and the installation's
 * hash-chained logs – how many chains, when, and each broken one by company and log (metadata only; a break also goes to
 * the operations alarm). The company's admin sees its own under Historik och lagring.
 */
export function PlatformLogChains({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [data, setData] = useState<ChainsData | null>(null);
  const load = useCallback(async () => {
    try { setData(await api<ChainsData>("/api/superadmin/log-chains", { cache: "no-store" })); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);
  return <Panel title="Loggarnas kedja" description="Säkerhets-, administrations- och ändringsloggarna kontrolleras varje natt." icon={Link2}>
    {!data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : <div className="space-y-3 text-sm" data-testid="platform-log-chains">
      <p className="flex items-center gap-2">{data.brokenCount ? <ShieldAlert className="size-4 shrink-0 text-destructive" /> : <ShieldCheck className="size-4 shrink-0 text-primary" />}
        {data.brokenCount ? `${data.brokenCount} av ${data.chains} kedjor stämmer inte.` : data.chains ? `Alla ${data.chains} kedjor är hela.` : "Inga loggar än."}
        {data.lastVerified ? <span className="text-xs text-muted-foreground">Senast kontrollerad {formatSwedish(data.lastVerified, { dateStyle: "medium", timeStyle: "short" })}</span> : null}</p>
      {data.broken.length ? <ul className="divide-y rounded-lg border" data-testid="platform-log-chains-broken">{data.broken.map((chain) => <li key={`${chain.log}:${chain.chainKey}`} className="space-y-0.5 px-3 py-2">
        <p className="font-medium">{chain.company ?? "Borttaget företag"} · {chain.label}</p>
        <p className="text-xs text-muted-foreground">{chain.broken!.text}{chain.broken!.seq ? ` Rad ${chain.broken!.seq}.` : ""} Upptäcktes {formatSwedish(chain.broken!.at, { dateStyle: "medium", timeStyle: "short" })}. Loggen rensas inte förrän kedjan är hel.</p>
      </li>)}</ul> : null}
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

"use client";

import { useCallback, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useLoadEffect } from "@/lib/use-load-effect";
import { useConfirm } from "@/features/kfid/confirm";
import { Panel } from "@/features/kfid/ui";
import { SECURITY_LOG_NOTE, SecurityLogList, type SecurityLogPage } from "./security-settings";

type Member = { id: string; name: string; email: string; role: string; twoFactor: boolean; google: boolean };
type Data = { required: boolean; me: string; members: Member[]; log: SecurityLogPage; microsoftAvailable?: boolean; microsoftTenantId?: string | null };

/**
 * Lås Microsoft-inloggning till företagets katalog (2026-10-11): with the directory id, members can sign in with
 * Microsoft only through accounts from the company's own Entra directory – nobody from another directory with a
 * similar address. Empty and Spara lifts the lock. The server refuses a lock that would shut the admin out.
 */
function MicrosoftTenantLock({ saved, busy, save }: { saved: string | null | undefined; busy: boolean; save: (tenantId: string | null) => Promise<void> }) {
  const [value, setValue] = useState(saved ?? "");
  const clean = value.trim().toLowerCase();
  // No inner heading with a grey line (UX-punkt 6): the setting's name is a label above it.
  return <div className="space-y-2 pt-2 text-sm" data-testid="company-microsoft-tenant">
    <p className="field-label text-xs font-medium">Microsoft-inloggning bara från företagets katalog</p>
    <p className="text-xs text-muted-foreground">Katalogens id (Directory/tenant ID, finns på översiktssidan i Microsoft Entra). Då kan medarbetarna bara logga in med konton från er egen katalog. Tomt tillåter alla Microsoft-konton som installationen tillåter.</p>
    <div className="flex flex-wrap gap-2">
      <Input aria-label="Katalogens id" value={value} onChange={(event) => setValue(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="min-w-0 flex-1 basis-72 font-mono text-xs" autoComplete="off" />
      <Button type="button" variant="outline" disabled={busy || clean === (saved ?? "")} onClick={() => void save(clean || null)}>Spara</Button>
    </div>
  </div>;
}

/**
 * Användare → Säkerhet (2026-10-10), company admin only, for the company you work in: require two-step verification
 * for the members (off by default), see who has it, sign a member out everywhere, turn a member's two-step
 * verification off when the phone is lost, and the company's security log. The server checks every step.
 */
export function CompanySecurity({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { setData(await api<Data>("/api/security/company", { cache: "no-store" })); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);
  async function post(input: Record<string, unknown>, done: string) {
    setBusy(true);
    try { await api("/api/security/company", { method: "POST", body: JSON.stringify(input) }); notify(done); await load(); }
    catch (error) { notify((error as Error).message, true); }
    finally { setBusy(false); }
  }
  return <Panel title="Säkerhet" description="Tvåstegsverifiering för företagets medarbetare, utloggning och säkerhetslogg." collapsible defaultCollapsed
    icon={ShieldCheck}>
    {confirmElement}
    {!data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : <div className="space-y-6" data-testid="company-security">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
        <Checkbox className="mt-0.5" checked={data.required} disabled={busy} aria-label="Kräv tvåstegsverifiering"
          onCheckedChange={(value) => void post({ action: "require", on: value === true }, value === true ? "Tvåstegsverifiering krävs nu för medarbetarna." : "Tvåstegsverifiering krävs inte längre.")} />
        <span><span className="block font-medium">Kräv tvåstegsverifiering</span>
          <span className="block text-xs text-muted-foreground">På: alla som loggar in med lösenord måste ha en kod från en autentiseringsapp. Passkey räknas som två steg, och Google och Microsoft har egen tvåstegsverifiering. Sparas direkt.</span></span>
      </label>

      {data.microsoftAvailable || data.microsoftTenantId ? <MicrosoftTenantLock key={data.microsoftTenantId ?? "none"} saved={data.microsoftTenantId} busy={busy} save={(tenantId) => post({ action: "microsoft_tenant", tenantId }, tenantId ? "Microsoft-inloggning är låst till företagets katalog." : "Microsoft-inloggning är inte längre låst.")} /> : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">Medarbetare</p>
        <ul className="divide-y rounded-lg border text-sm">
          {data.members.map((member) => <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0"><span className="block font-medium">{member.name}</span>
              <span className="block text-xs text-muted-foreground">{member.twoFactor ? "Tvåstegsverifiering på" : "Tvåstegsverifiering av"}{member.google ? " · Google kopplat" : ""}</span></span>
            <span className="flex flex-wrap gap-2">
              {member.twoFactor && member.id !== data.me ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={async () => {
                if (!(await confirm({ title: "Stäng av tvåstegsverifiering?", message: `${member.name} loggar sedan in med bara lösenordet tills hen slår på den igen. Används när telefonen har tappats och reservkoderna saknas.`, confirmLabel: "Stäng av", tone: "danger" }))) return;
                await post({ action: "member_two_factor_off", userId: member.id }, "Tvåstegsverifieringen är avstängd för personen.");
              }}>Stäng av koden</Button> : null}
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => {
                if (!(await confirm({ title: "Logga ut överallt?", message: `Alla ${member.id === data.me ? "dina" : `${member.name}s`} inloggningar avslutas. Kontot finns kvar och personen kan logga in igen.`, confirmLabel: "Logga ut överallt", tone: "danger" }))) return;
                await post({ action: "member_signout", userId: member.id }, "Personen är utloggad överallt.");
              }}>Logga ut överallt</Button>
            </span>
          </li>)}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Företagets säkerhetslogg</p>
        <p className="text-xs text-muted-foreground">Företagets nycklar och regler och medarbetarnas inloggningar sedan de gick med. {SECURITY_LOG_NOTE}</p>
        <SecurityLogList page={data.log} showPerson testId="company-security-log" load={async (before) => (await api<{ log: SecurityLogPage }>(`/api/security/company?before=${encodeURIComponent(before)}`)).log} />
      </div>
    </div>}
  </Panel>;
}

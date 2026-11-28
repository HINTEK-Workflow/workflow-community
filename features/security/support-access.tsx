"use client";

import { useCallback, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { useLoadEffect } from "@/lib/use-load-effect";
import { formatSwedish } from "@/lib/swedish-time";
import { SUPPORT_ACCESS_DEFAULT_HOURS, SUPPORT_ACCESS_HOURS, SUPPORT_ACCESS_HOURS_LABEL, type SupportAccessHours } from "@/lib/security/access-rules";

type Read = { id: string; label: string; detail: string; at: string; by: string | null };
type Grant = { id: string; hours: number; createdAt: string; expiresAt: string; state: "active" | "expired" | "revoked"; grantedBy: string | null; revokedAt: string | null };
type Data = { open: { expiresAt: string; grantedBy: string | null } | null; grants: Grant[]; reads: Read[] };

const when = (iso: string) => formatSwedish(iso, { dateStyle: "medium", timeStyle: "short" });
const STATE_LABEL: Record<Grant["state"], string> = { active: "Öppen", expired: "Gick ut", revoked: "Återkallad" };

/**
 * Supportåtkomst (K2.3, beslut 2026-11-28), a part of Användare → Säkerhet: the admin lets the installation's support read the
 * company's data for 1 hour, 24 hours or 7 days, sees each read, and takes it back at any time. Nothing is open until the admin
 * opens it. The server checks every step (app/api/security/support-access).
 */
export function SupportAccessSection({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [hours, setHours] = useState<SupportAccessHours>(SUPPORT_ACCESS_DEFAULT_HOURS);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { setData(await api<Data>("/api/security/support-access", { cache: "no-store" })); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);
  async function post(input: Record<string, unknown>, done: string) {
    setBusy(true);
    try { await api("/api/security/support-access", { method: "POST", body: JSON.stringify(input) }); notify(done); await load(); }
    catch (error) { notify((error as Error).message, true); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3" data-testid="support-access">
    {confirmElement}
    <div className="flex items-center gap-2"><LifeBuoy className="size-4 text-muted-foreground" aria-hidden="true" /><p className="text-sm font-medium">Supportåtkomst</p></div>
    <p className="text-xs text-muted-foreground">Supporten kan inte se era uppgifter. Behöver ni hjälp kan du ge supporten läsåtkomst en kort tid. Allt supporten läser visas här, och du kan återkalla åtkomsten när som helst.</p>
    {!data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : data.open ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm" data-testid="support-access-open">
      <span className="min-w-0"><span className="block font-medium">Supporten kan läsa till {when(data.open.expiresAt)}</span>
        <span className="block text-xs text-muted-foreground">Bara läsning. Gavs av {data.open.grantedBy ?? "en administratör"}.</span></span>
      <Button type="button" variant="destructive" disabled={busy} data-testid="support-access-revoke" onClick={async () => {
        if (!(await confirm({ title: "Återkalla supportåtkomsten?", message: "Supporten kan inte läsa något mer från och med nu.", confirmLabel: "Återkalla", tone: "danger" }))) return;
        await post({ action: "revoke" }, "Supportåtkomsten är återkallad.");
      }}>Återkalla</Button>
    </div> : <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5"><label htmlFor="support-access-hours" className="field-label text-xs font-medium">Hur länge</label>
        <select id="support-access-hours" className="form-select" value={hours} disabled={busy} onChange={(event) => setHours(Number(event.target.value) as SupportAccessHours)} data-testid="support-access-hours">
          {SUPPORT_ACCESS_HOURS.map((value) => <option key={value} value={value}>{SUPPORT_ACCESS_HOURS_LABEL[value]}</option>)}
        </select></div>
      <Button type="button" variant="outline" disabled={busy} data-testid="support-access-grant" onClick={async () => {
        if (!(await confirm({ title: "Ge supporten läsåtkomst?", message: `Supporten kan läsa företagets uppgifter i ${SUPPORT_ACCESS_HOURS_LABEL[hours]}: användare, platser, maskiner, arbetsorder och formulär. Inget kan ändras, och varje läsning visas här.`, confirmLabel: "Ge åtkomst" }))) return;
        await post({ action: "grant", hours }, `Supporten kan läsa i ${SUPPORT_ACCESS_HOURS_LABEL[hours]}.`);
      }}>Ge supporten läsåtkomst</Button>
    </div>}
    {data?.reads.length ? <div className="space-y-1">
      <p className="field-label text-xs font-medium">Det supporten har läst</p>
      <ul className="divide-y rounded-lg border text-sm" data-testid="support-access-reads">
        {data.reads.map((read) => <li key={read.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-3 py-2">
          <span className="min-w-0">{read.label}<span className="block text-xs text-muted-foreground">{read.by ?? "Supporten"} · {read.detail}</span></span>
          <time dateTime={read.at} className="text-xs text-muted-foreground">{when(read.at)}</time>
        </li>)}
      </ul>
    </div> : null}
    {data?.grants.length ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Tidigare åtkomst</summary>
      <ul className="mt-2 space-y-1" data-testid="support-access-grants">{data.grants.map((grant) => <li key={grant.id}>{when(grant.createdAt)}, {SUPPORT_ACCESS_HOURS_LABEL[grant.hours as SupportAccessHours] ?? `${grant.hours} timmar`} · {STATE_LABEL[grant.state]}{grant.grantedBy ? ` · ${grant.grantedBy}` : ""}</li>)}</ul>
    </details> : null}
  </div>;
}

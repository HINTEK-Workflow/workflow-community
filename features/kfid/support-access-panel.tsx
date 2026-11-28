"use client";

import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSwedish } from "@/lib/swedish-time";
import { Panel } from "./ui";
import { api } from "./api";

type Status = { open: { expiresAt: string; hours: number } | null; parts: { key: string; label: string }[] };
type Page = { part: string; label: string; columns: string[]; rows: string[][]; total: number; expiresAt: string };

/**
 * Supportläsning (K2.3, beslut 2026-11-28) on a customer company's page in Installation: whether the company's own
 * admin has given support read access, and – only then – its parts one at a time, read only. Each part read is a line the
 * company's admin sees. Without access the card says so and reads nothing (the server decides: app/api/superadmin/support-access).
 */
export function SupportAccessPanel({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<Status>(`/api/superadmin/support-access?organizationId=${encodeURIComponent(companyId)}`, { cache: "no-store" })
      .then((result) => { if (active) { setStatus(result); setError(""); } })
      .catch((cause) => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [companyId]);
  async function read(part: string) {
    setBusy(true);
    try { setPage(await api<Page>(`/api/superadmin/support-access?organizationId=${encodeURIComponent(companyId)}&part=${encodeURIComponent(part)}`, { cache: "no-store" })); setError(""); }
    catch (cause) { setPage(null); setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <Panel icon={LifeBuoy} title="Supportläsning" description="Bara när företagets administratör har gett supporten åtkomst. Varje läsning visas för företaget.">
    <div className="space-y-3 text-sm" data-testid="support-reading">
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {!status && !error ? <p className="text-muted-foreground" role="status">Hämtar…</p> : null}
      {status && !status.open ? <p className="text-muted-foreground" data-testid="support-reading-closed">Företaget har inte gett supporten åtkomst. Be företagets administratör ge den under Användare → Säkerhet.</p> : null}
      {status?.open ? <>
        <p data-testid="support-reading-open">Öppen till {formatSwedish(status.open.expiresAt, { dateStyle: "medium", timeStyle: "short" })}. Bara läsning.</p>
        <div className="flex flex-wrap gap-2">{status.parts.map((part) => <Button key={part.key} type="button" variant={page?.part === part.key ? "default" : "outline"} size="sm" disabled={busy} onClick={() => void read(part.key)} data-testid={`support-reading-${part.key}`}>{part.label}</Button>)}</div>
      </> : null}
      {page ? <div className="overflow-x-auto rounded-lg border" data-testid="support-reading-page">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/50"><tr>{page.columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-medium">{column}</th>)}</tr></thead>
          <tbody className="divide-y">{page.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} className="px-3 py-2 [overflow-wrap:anywhere]">{cell}</td>)}</tr>)}</tbody>
        </table>
        {page.total > page.rows.length ? <p className="px-3 py-2 text-xs text-muted-foreground">Visar {page.rows.length} av {page.total}.</p> : null}
      </div> : null}
    </div>
  </Panel>;
}

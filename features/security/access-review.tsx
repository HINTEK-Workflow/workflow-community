"use client";

import { useCallback, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DownloadButton } from "@/components/ui/download-button";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { useLoadEffect } from "@/lib/use-load-effect";
import { formatSwedish } from "@/lib/swedish-time";
import { saveResponse } from "@/lib/download";
import { ACCESS_REVIEW_ANCHOR, type AccessReviewRow } from "@/lib/security/access-rules";

type Data = { rows: AccessReviewRow[]; review: { reminderOn: boolean; lastReviewedAt: string | null; reviewedBy: string; dueAt: string; due: boolean } };

/**
 * Granska behörigheter (K2.4, beslut 2026-11-28), under Användare for the company's admin: everyone's role and permissions, the
 * API and MCP keys, the MCP connections, the machine keys and an open support access in one list; Exportera CSV; Granskad as a
 * logged sign-off; and the quarterly reminder on Översikt, off until it is turned on here.
 */
export function AccessReview({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api<Data>("/api/security/access-review", { cache: "no-store" })); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);
  async function post(input: Record<string, unknown>, done: string) {
    setBusy(true);
    try { await api("/api/security/access-review", { method: "POST", body: JSON.stringify(input) }); notify(done); await load(); }
    catch (error) { notify((error as Error).message, true); }
    finally { setBusy(false); }
  }
  async function exportCsv() {
    setBusy(true);
    try {
      const response = await fetch("/api/security/access-review?format=csv", { cache: "no-store" });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "Det gick inte att exportera.");
      await saveResponse(response, "behorigheter.csv");
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  }
  const groups = data ? [...new Set(data.rows.map((row) => row.type))] : [];
  return <div id={ACCESS_REVIEW_ANCHOR}><Panel icon={ClipboardCheck} title="Granska behörigheter" description="Vem som har vilken roll, behörighet, nyckel och koppling." collapsible defaultCollapsed
    actions={<DownloadButton size="sm" disabled={busy || !data} onClick={() => void exportCsv()} data-testid="access-review-export">Exportera CSV</DownloadButton>}>
    {!data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : <div className="space-y-5" data-testid="access-review">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <span className="min-w-0"><span className="block font-medium" data-testid="access-review-last">{data.review.lastReviewedAt ? `Senast granskad ${formatSwedish(data.review.lastReviewedAt, { dateStyle: "medium" })}${data.review.reviewedBy ? ` av ${data.review.reviewedBy}` : ""}` : "Inte granskad ännu"}</span>
          <span className="block text-xs text-muted-foreground">{data.review.due ? "Dags att granska. Gå igenom listan och tryck Granskad." : "Gå igenom listan och tryck Granskad när allt stämmer. Det sparas i historiken."}</span></span>
        <Button type="button" disabled={busy} data-testid="access-review-sign" onClick={() => void post({ action: "sign_off" }, "Granskningen är sparad.")}>Granskad</Button>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
        <Checkbox className="mt-0.5" checked={data.review.reminderOn} disabled={busy} aria-label="Påminn varje kvartal" data-testid="access-review-reminder"
          onCheckedChange={(value) => void post({ action: "reminder", on: value === true }, value === true ? "Du påminns på Översikt varje kvartal." : "Påminnelsen är av.")} />
        <span><span className="block font-medium">Påminn varje kvartal</span>
          <span className="block text-xs text-muted-foreground">Av från början. På: Översikt påminner administratörerna tre månader efter senaste granskningen{data.review.reminderOn ? `, nästa gång ${formatSwedish(data.review.dueAt, { dateStyle: "medium" })}` : ""}.</span></span>
      </label>
      {groups.map((group) => <div key={group} className="space-y-1">
        <p className="field-label text-xs font-medium">{group}</p>
        <ul className="divide-y rounded-lg border text-sm" data-testid="access-review-group">
          {data.rows.filter((row) => row.type === group).map((row, index) => <li key={`${row.name}-${index}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <span className="min-w-0 [overflow-wrap:anywhere]"><span className="block font-medium">{row.name}</span>{row.who ? <span className="block text-xs text-muted-foreground">{row.who}</span> : null}</span>
            <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{row.rights}<span className="block">{[row.status, row.validUntil ? `gäller till ${row.validUntil}` : "", row.lastUsed ? `senast ${row.lastUsed}` : ""].filter(Boolean).join(" · ")}</span></span>
          </li>)}
        </ul>
      </div>)}
    </div>}
  </Panel></div>;
}

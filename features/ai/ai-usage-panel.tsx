"use client";

import { useCallback, useState } from "react";
import { Gauge } from "lucide-react";
import { Field, Panel, RowsSkeleton, SwitchRow } from "@/features/kfid/ui";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { cn } from "@/lib/utils";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { quotaKrText, quotaWarnText, QUOTA_FULL_REASON } from "@/lib/ai/weekly-quota";
import type { AiUsageView } from "@/lib/ai/usage-server";

const weekLabel = (start: string) => `v. ${formatSwedish(start, { day: "numeric", month: "short" })}`;
const opens = (at: string) => formatSwedish(at, { weekday: "long", hour: "2-digit", minute: "2-digit" });
const SOURCE: Record<string, string> = { own: "egen kvot för företaget", price: "andel av abonnemanget", minimum: "lägsta veckokvoten" };

/** The week's share as a bar, the same markup as the other progress bars (solar-register). */
function QuotaBar({ percent, full }: { percent: number; full: boolean }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Veckans kvot" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)} data-testid="ai-usage-bar">
    <div className={cn("h-full rounded-full", full ? "bg-destructive" : percent >= 80 ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.min(100, percent)}%` }} />
  </div>;
}

/**
 * Användning (2026-11-21): one place for following Workflow AI. `company`: the company's own view under Inställningar →
 * Arbetssätt → Workflow AI – the week's quota as a share, when it opens again, the last weeks, answers per week as one number (the chat
 * is one chat), credits and questions per person (the admin sees everyone, a member their own count); the admin chooses Fortsätt med
 * krediter. `superadmin`: the same for one company in Kundföretag, with the quota's cost and where it comes from, and the company's
 * own quota – metadata only, never who asked or what.
 */
export function AiUsagePanel({ mode = "company", organizationId, notify }: { mode?: "company" | "superadmin"; organizationId?: string; notify?: (text: string, error?: boolean) => void }) {
  const [usage, setUsage] = useState<AiUsageView | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [ownQuota, setOwnQuota] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = mode === "superadmin" ? `/api/superadmin/ai-company-usage?organizationId=${encodeURIComponent(organizationId ?? "")}` : "/api/ai/usage";
  const load = useCallback(async () => {
    try {
      const result = await api<{ usage: AiUsageView; canManage?: boolean; ownQuotaKr?: number | null }>(url, { cache: "no-store" });
      setUsage(result.usage); setCanManage(Boolean(result.canManage)); setOwnQuota(result.ownQuotaKr === null || result.ownQuotaKr === undefined ? "" : String(result.ownQuotaKr));
    } catch (cause) { setError((cause as Error).message); }
  }, [url]);
  useLoadEffect(load);
  if (error) return <Panel icon={Gauge} title="Användning"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  // Innehåll på väg (2026-10-16): grey rows in the card's own height, never a spinner.
  if (!usage) return <Panel icon={Gauge} title="Användning"><RowsSkeleton rows={4} label="Hämtar användningen…" /></Panel>;
  const { week } = usage;
  const post = async (path: string, payload: unknown, done: string) => {
    setBusy(true);
    try {
      const result = await api<{ usage: AiUsageView; ownQuotaKr?: number | null }>(path, { method: "POST", body: JSON.stringify(payload) });
      setUsage(result.usage); notify?.(done);
    } catch (cause) { notify?.((cause as Error).message, true); } finally { setBusy(false); }
  };
  const quotaText = week.full ? QUOTA_FULL_REASON : week.warn ? quotaWarnText(week) : `${week.usedPercent} % av veckans kvot är använd. Kvoten börjar om ${opens(week.opensAt)}.`;
  return <Panel icon={Gauge} title="Användning" description={mode === "superadmin" ? "Workflow AI för företaget, som metadata. Aldrig frågor, svar eller vem som frågat." : "Hur Workflow AI används i företaget."}>
    <div className="grid gap-4 text-sm" data-testid={mode === "superadmin" ? "company-ai-usage" : "ai-usage"}>
      {/* Manuellt, Auto och Agenter (2026-11-21): the chat's two modes and the missions on a schedule. */}
      {mode === "company" ? <ul className="grid gap-1 text-xs text-muted-foreground" data-testid="ai-usage-modes">
        <li><span className="font-medium text-foreground">Manuellt:</span> Workflow AI svarar, söker och föreslår. Inget sparas förrän du väljer Använd. Det ingår i abonnemanget upp till veckans kvot.</li>
        <li><span className="font-medium text-foreground">Auto:</span> Workflow AI gör uppgiften direkt, till exempel sparar en arbetsorder som Planerad, och du får en länk och Ångra. Det ingår också upp till veckans kvot.</li>
        <li><span className="font-medium text-foreground">Agenter:</span> uppdrag som körs på schema under Agenter. Uppdrag som bara räknar och listar kostar inget.{usage.credits.system ? " När Workflow AI skriver en text i ett uppdrag används krediter." : " När Workflow AI skriver en text i ett uppdrag används företagets egen AI-nyckel."}</li>
      </ul> : null}
      <section className="grid gap-2" aria-label="Veckans kvot">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-medium">Veckans kvot</p><p className="tabular-nums" data-testid="ai-usage-percent">{Math.min(week.usedPercent, 999)} %</p></div>
        <QuotaBar percent={week.usedPercent} full={week.full} />
        <p className={cn("text-xs", week.full ? "text-destructive" : week.warn ? "text-amber-800 dark:text-amber-200" : "text-muted-foreground")} data-testid="ai-usage-state">{quotaText}</p>
        {mode === "superadmin" && week.quotaOre !== undefined ? <p className="text-xs text-muted-foreground" data-testid="company-ai-quota">Kvot {quotaKrText(week.quotaOre)} i veckan ({SOURCE[week.source ?? ""] ?? ""}{week.monthlyPriceOre ? `, abonnemang ${quotaKrText(week.monthlyPriceOre)} i månaden` : ""}) · använt {quotaKrText(week.spentOre ?? 0)}</p> : null}
      </section>
      <section aria-label="De senaste veckorna">
        <p className="mb-1 font-medium">De senaste veckorna</p>
        <div className="overflow-hidden rounded-lg border"><table className="data-table w-full text-left text-sm" data-testid="ai-usage-weeks">
          <thead><tr><th scope="col">Vecka</th><th scope="col">Svar</th><th scope="col">Av kvoten</th>{usage.credits.system ? <th scope="col">Krediter</th> : null}</tr></thead>
          <tbody>{[...usage.weeks].reverse().map((item) => <tr key={item.start}><td>{weekLabel(item.start)}</td><td className="tabular-nums">{item.answers}</td><td className="tabular-nums">{item.usedPercent} %</td>{usage.credits.system ? <td className="tabular-nums">{item.credits}</td> : null}</tr>)}</tbody>
        </table></div>
      </section>
      {usage.credits.system ? <section aria-label="Krediter" className="grid gap-1" data-testid="ai-usage-credits">
        <p className="font-medium">Krediter</p>
        <p className="text-xs text-muted-foreground">{usage.credits.balance} krediter kvar · {usage.credits.usedThisWeek} använda den här veckan. Krediter används när ett agentuppdrag låter Workflow AI skriva en text, och när ni valt att fortsätta med krediter efter veckans kvot.</p>
        {mode === "company" && canManage ? <SwitchRow id="ai-continueOnCredits" testId="ai-continueOnCredits" title="Fortsätt med krediter när veckans kvot är slut" text="Av: AI-svaren pausas till måndag 00:00. På: AI svarar vidare och varje svar dras från krediterna." checked={usage.continueOnCredits} disabled={busy}
          onCheckedChange={(on) => void post("/api/ai/usage", { action: "continue_on_credits", on }, on ? "AI fortsätter med krediter när veckans kvot är slut." : "AI pausas när veckans kvot är slut.")} /> : null}
      </section> : null}
      {mode === "company" ? <section aria-label="Frågor per person" data-testid="ai-usage-people">
        <p className="mb-1 font-medium">{canManage ? "Frågor per person den här veckan" : "Dina frågor den här veckan"}</p>
        {usage.people.length ? <ul className="divide-y rounded-lg border text-xs">{usage.people.map((person) => <li key={person.name} className="flex justify-between gap-3 px-3 py-2"><span>{person.self ? `${person.name} (du)` : person.name}</span><span className="tabular-nums">{person.questions}</span></li>)}</ul>
          : <p className="text-xs text-muted-foreground">Inga frågor ännu den här veckan.</p>}
        <p className="mt-1 text-xs text-muted-foreground">Bara antal. Frågorna själva visas aldrig här.</p>
      </section> : <p className="text-xs text-muted-foreground">{usage.askers} personer har frågat den här veckan.</p>}
      {mode === "superadmin" ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void post("/api/superadmin/ai-company-usage", { action: "set_quota", organizationId, quotaKr: ownQuota.trim() === "" ? null : Math.max(0, Math.round(Number(ownQuota) || 0)) }, "Veckokvoten är sparad."); }}>
        {/* Etikett ovanför fältet (2026-10-09): the shared Field; a field and its own button may stand in one row. */}
        <Field id="company-ai-own-quota" label="Egen veckokvot (kr)" type="number" value={ownQuota} placeholder="Följer abonnemanget" onChange={setOwnQuota} className="w-48" />
        <Button type="submit" variant="outline" busy={busy} busyLabel="Sparar…">Spara</Button>
      </form> : null}
    </div>
  </Panel>;
}

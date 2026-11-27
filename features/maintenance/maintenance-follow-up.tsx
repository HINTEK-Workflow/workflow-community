"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CalendarCheck2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FoldRow, RowsSkeleton } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useLoadEffect } from "@/lib/use-load-effect";
import { shortDay } from "@/lib/workflow/schedule";
import { cn } from "@/lib/utils";
import { PLAN_STATE_LABELS, PLAN_STATE_TONES } from "@/lib/maintenance/plan-model";
import { maintenanceGet, type FollowUp, type FollowUpRow } from "./maintenance-api";
import { FigureBox } from "./maintenance-figures";

/**
 * Förfallet och i tid (2026-11-27): how well the planned maintenance is kept, for a part (the tab Planer) or a place
 * (its card; Alla platser is the whole company). Only what can be counted: the share done on or before its day over the last
 * year, the occurrences past their day that are still open (the oldest first) and what is due within two weeks. Says so when
 * there is nothing to count. The rule: lib/maintenance/plan-model.ts planFollowUp; the server: lib/maintenance/follow-up-server.ts.
 */
const dayText = (day: string) => day ? `${shortDay(day)} ${day.slice(0, 4)}` : "–";
const rowHref = (row: FollowUpRow) => row.kind === "item" ? `/?view=maintenance&item=${encodeURIComponent(row.id)}` : `/?view=workflow_task&taskType=WORK_ORDER&taskId=${encodeURIComponent(row.id)}`;

export function PlanFollowUpCard({ scope, id, compact = false }: { scope: "part" | "place"; id: string; /** On the tab Planer: the figures and the late ones, no heading. */ compact?: boolean }) {
  const [data, setData] = useState<FollowUp | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await maintenanceGet<FollowUp>(`part=follow_up&scope=${scope}&id=${encodeURIComponent(id)}`)); setError(""); } catch (cause) { setError((cause as Error).message); }
  }, [scope, id]);
  useLoadEffect(load);
  if (error) return <p role="alert" className="notice text-destructive">{error}</p>;
  if (!data) return <RowsSkeleton rows={2} dense label="Räknar planerat underhåll…" />;
  if (!data.plans && compact) return null;
  const { figures } = data;
  return <section className="@container space-y-3" aria-label="Planerat underhåll" data-testid="maintenance-follow-up">
    {compact ? null : <h3 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarCheck2 className="size-4 text-muted-foreground" aria-hidden="true" />Planerat underhåll</h3>}
    {data.plans ? <dl className="grid grid-cols-2 gap-3 text-sm @2xl:grid-cols-4">
      <FigureBox label="I tid" value={figures.share === null ? "–" : `${figures.share} %`} hint={data.text} testId="maintenance-follow-up-share" />
      <FigureBox label="Förfallet" value={String(figures.overdue)} hint={figures.overdue ? "Öppna efter sin dag" : "Inget efter sin dag"} testId="maintenance-follow-up-overdue"
        className={figures.overdue ? "border-destructive/40" : undefined} />
      <FigureBox label="Gjort sent" value={String(figures.doneLate)} hint="Klart efter sin dag" />
      <FigureBox label="Utgått" value={String(figures.cancelled)} hint="Hoppades över" />
    </dl> : <p className="text-sm text-muted-foreground" data-testid="maintenance-follow-up-empty">Inga underhållsplaner här än. Lägg till en plan på en maskin under fliken Planer.</p>}
    {data.late.length ? <FoldRow open={!compact} testId="maintenance-follow-up-late"
      summary={<span className="text-sm font-medium">Förfallet underhåll <span className="text-muted-foreground">({data.late.length}{data.late.length >= 50 ? "+" : ""})</span></span>}>
      <FollowUpList rows={data.late} />
    </FoldRow> : null}
    {!compact && data.soon.length ? <FoldRow testId="maintenance-follow-up-soon" summary={<span className="text-sm font-medium">De närmaste två veckorna <span className="text-muted-foreground">({data.soon.length})</span></span>}>
      <FollowUpList rows={data.soon} />
    </FoldRow> : null}
    {figures.runHours && figures.counted ? <p className="text-xs text-muted-foreground">Planer på drifttimmar har ingen dag och räknas inte i andelen.</p> : null}
    {data.truncated ? <p className="text-xs text-muted-foreground">Väldigt många tillfällen: bara de första räknades.</p> : null}
  </section>;
}

function FollowUpList({ rows }: { rows: FollowUpRow[] }) {
  return <ul className="divide-y rounded-lg border text-sm" data-testid="maintenance-follow-up-rows">{rows.map((row) => <li key={`${row.kind}:${row.id}`}>
    <Link href={rowHref(row)} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 hover:bg-muted" data-testid="maintenance-follow-up-row">
      <span className="min-w-0 flex-1 basis-48">
        <span className="block font-medium [overflow-wrap:anywhere]">{row.planName} · {row.partName}</span>
        <span className="block text-xs text-muted-foreground">{[dayText(row.due), row.daysLate ? `${row.daysLate} ${row.daysLate === 1 ? "dag" : "dagar"} sen` : "", row.kind === "item" ? "I driftronden" : "", row.assignedToName].filter(Boolean).join(" · ")}</span>
      </span>
      <Badge variant="outline" className={cn(indicatorBadge(PLAN_STATE_TONES[row.state]), row.state === "dormant" && "border-dashed")}>{PLAN_STATE_LABELS[row.state]}</Badge>
    </Link>
  </li>)}</ul>;
}

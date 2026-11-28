"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ClipboardList, Route, TriangleAlert, Wrench, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ListGroup, ListRow } from "@/components/native/list";
import { RowsSkeleton } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { maintenanceGet, type HistoryEntry, type PartHistory } from "./maintenance-api";

/**
 * Historik (2026-11-27): the part's whole story in one list, newest first – work orders on it (with the kind of
 * maintenance, the stop and how many files), maintenance items without a work order, the deviation log entries its work
 * orders fix (only those the person may read), and the brister found on it in a driftrond (Åtgärdad direkt with its comment
 * and photo, or the work order it became). Every row opens where it lives. The server: lib/maintenance/follow-up-server.ts.
 */
const ICONS: Record<HistoryEntry["kind"], LucideIcon> = { order: ClipboardList, item: Wrench, deviation: TriangleAlert, finding: Route };
const href = (entry: HistoryEntry) => entry.kind === "deviation" ? `/?view=deviations&deviation=${encodeURIComponent(entry.deviationId ?? entry.id)}`
  : entry.kind === "item" ? `/?view=maintenance&item=${encodeURIComponent(entry.itemId ?? entry.id)}`
  // A brist opens its work order when it has one, else the round's protocol where it was written.
  : entry.kind === "finding" && !entry.workOrderId && entry.taskId ? `/?view=workflow_task&taskType=FORM&taskId=${encodeURIComponent(entry.taskId)}`
  : `/?view=workflow_task&taskType=WORK_ORDER&taskId=${encodeURIComponent(entry.workOrderId ?? entry.id)}`;
const day = (value: string) => formatSwedish(value, { dateStyle: "short" });
const photo = (id: string) => `/api/workflow-task-files/${encodeURIComponent(id)}`;

/** A brist's comment and photos under its row (Åtgärdad direkt: what was done, as the technician wrote it). */
function FindingExtra({ entry }: { entry: HistoryEntry }) {
  if (entry.kind !== "finding" || (!entry.comment && !entry.images?.length)) return null;
  return <div className="space-y-1.5 px-5 pb-2 sm:pl-[calc(6rem+2rem)]" data-testid="maintenance-history-finding">
    {entry.comment ? <p className="whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{entry.comment}</p> : null}
    {entry.images?.length ? <ul className="flex flex-wrap gap-1.5" aria-label={`Bilder: ${entry.title}`}>{entry.images.slice(0, 6).map((id) => <li key={id}>
      <a href={photo(id)} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private attachment behind the session */}
        <img src={photo(id)} alt="Bild från ronden" className="size-12 rounded-md border object-cover" loading="lazy" />
      </a>
    </li>)}</ul> : null}
  </div>;
}

export function PartHistoryTab({ partId }: { partId: string }) {
  const native = useNativeMode();
  const [data, setData] = useState<PartHistory | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await maintenanceGet<PartHistory>(`part=history&id=${encodeURIComponent(partId)}`)); setError(""); } catch (cause) { setError((cause as Error).message); }
  }, [partId]);
  useLoadEffect(load);
  if (error) return <p role="alert" className="notice text-destructive">{error}</p>;
  if (!data) return <RowsSkeleton rows={4} label="Hämtar historiken…" />;
  if (!data.entries.length) return <p className="text-sm text-muted-foreground" data-testid="maintenance-history-empty">Ingen historik än. Arbetsordrar, underhållsposter, avvikelser och brister från ronden på delen hamnar här.</p>;
  const foot = <p className="text-xs text-muted-foreground">{data.truncated ? "De senaste 100 visas. " : ""}Delen och allt under den. Bilder och filer finns i arbetsordrarna och under Bilder.</p>;
  if (native) return <div className="space-y-3" data-testid="maintenance-history">
    <ListGroup>{data.entries.map((entry) => <ListRow key={`${entry.kind}:${entry.id}`} type="maintenance" icon={ICONS[entry.kind]} title={entry.title}
      subtitle={[day(entry.at), entry.status, entry.line, entry.kind === "finding" ? entry.comment : ""].filter(Boolean).join(" · ")} href={href(entry)} testId="maintenance-history-row" />)}</ListGroup>
    {foot}
  </div>;
  return <div className="space-y-3" data-testid="maintenance-history">
    <ul className="-mx-4 divide-y border-y text-sm">{data.entries.map((entry) => {
      const Icon = ICONS[entry.kind];
      return <li key={`${entry.kind}:${entry.id}`}>
        <Link href={href(entry)} className="grid w-full gap-1 px-5 py-2 hover:bg-muted sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center" data-testid="maintenance-history-row" data-kind={entry.kind}>
          <span className="text-xs tabular-nums text-muted-foreground">{day(entry.at)}</span>
          <span className="min-w-0"><span className="flex items-center gap-1.5 font-medium"><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{entry.title}</span></span>
            {entry.line ? <span className="block truncate text-xs text-muted-foreground">{entry.line}</span> : null}</span>
          <span><Badge variant="outline" className={indicatorBadge(entry.tone)}>{entry.status}</Badge></span>
        </Link>
        <FindingExtra entry={entry} />
      </li>;
    })}</ul>
    {foot}
  </div>;
}

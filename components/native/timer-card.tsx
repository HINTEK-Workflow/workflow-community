"use client";

import Link from "next/link";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The running timer at level 1 (2026-10-12): one look in the Tid list, the top bar's pill and the job's own Tid
 * screen. "Tiden går" as the heading, the job on its own line, the clock as a large figure and a button Stoppa – the
 * button stops AND saves the time entry, so it is not called Pausa.
 */
export function NativeTimerCard({ clock, title, href, onStop, busy = false, testId = "native-timer-card", stopTestId = "native-timer-stop", className, compact = false }: {
  clock: string; title: string; href?: string; onStop: () => void; busy?: boolean; testId?: string; stopTestId?: string; className?: string;
  /** One row in the place of Starta tid on a job's first screen (mobilresan 2026-11-18): "Tiden går 0:01:23" and Stoppa. */
  compact?: boolean;
}) {
  if (compact) return <div className={`native-timer-card flex min-h-12 items-center gap-3 px-4 py-2 ${className ?? ""}`} data-testid={testId} aria-label={`Tiden går på ${title}`}>
    <span aria-hidden="true" className="running-timer-dot size-2.5 shrink-0 rounded-full bg-emerald-500" />
    <span className="min-w-0 flex-1 text-[0.9375rem] font-medium">Tiden går <span className="tabular-nums" aria-label={`Tid: ${clock}`}>{clock}</span></span>
    <Button type="button" variant="outline" className="shrink-0" onClick={onStop} data-testid={stopTestId} busy={busy} busyLabel="Stoppar…"><Square />Stoppa</Button>
  </div>;
  return <div className={`native-timer-card flex flex-col gap-1 px-4 py-3 ${className ?? ""}`} data-testid={testId}>
    <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground"><span aria-hidden="true" className="running-timer-dot size-2.5 shrink-0 rounded-full bg-emerald-500" />Tiden går</p>
    {href ? <Link href={href} className="line-clamp-2 text-[0.9375rem] font-medium leading-5 [overflow-wrap:anywhere] hover:underline">{title}</Link>
      : <p className="line-clamp-2 text-[0.9375rem] font-medium leading-5 [overflow-wrap:anywhere]">{title}</p>}
    <p className="text-4xl font-semibold tabular-nums leading-tight" aria-label={`Tid: ${clock}`}>{clock}</p>
    <Button type="button" className="mt-1 w-full" onClick={onStop} data-testid={stopTestId} busy={busy} busyLabel="Stoppar…"><Square />Stoppa</Button>
  </div>;
}

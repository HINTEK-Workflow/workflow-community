"use client";

import { useId, useRef } from "react";
import { EditorSegmented } from "@/components/editor-ribbon";
import { indicatorBar, indicatorText } from "@/features/workflow/indicator-tone";
import type { SummaryShape } from "@/lib/boards/cards/shapes";
import { UPKEEP_HORIZON_LABEL, UPKEEP_HORIZONS } from "@/lib/boards/cards/upkeep";
import { FAULT_PERIODS } from "@/lib/boards/cards/faults";
import { PERIOD_LABEL } from "@/lib/boards/period";
import type { SourceOf } from "@/lib/boards/cards";
import { formatNumber, wordFitSize } from "@/lib/boards/shapes";
import { cn } from "@/lib/utils";
import { useFitCount, useReportShown, type Shown } from "../board-card";

/**
 * Underhållsjobb och Felanmälningar (2026-11-19): a few counts in a row – the number large, its words under it – and the short list
 * of what needs doing, as many rows as fit, each with a coloured dot and words.
 */
export function SummaryBody({ data, onShown, empty }: { data: SummaryShape; onShown: (shown: Shown | null) => void; empty: string }) {
  const box = useRef<HTMLOListElement | null>(null);
  const fit = useFitCount(box, data.items.length);
  useReportShown(fit, data.items.length, data.total, onShown);
  return <div className="flex h-full min-h-0 flex-col gap-[0.5em]" data-testid="board-summary">
    <dl className="grid shrink-0 gap-[0.4em]" style={{ gridTemplateColumns: `repeat(${data.counts.length}, minmax(0, 1fr))` }}>
      {/* The words never break inside a word (filmed 2026-11-20: "Förfa llna"): they shrink with their box instead. */}
      {data.counts.map((count) => <div key={count.label} className="min-w-0 rounded-md border px-[0.5em] py-[0.3em] [container-type:inline-size]">
        <dt className="line-clamp-2 leading-tight text-muted-foreground [overflow-wrap:normal] [word-break:normal]" style={{ fontSize: wordFitSize(count.label, 0.72) }} title={count.label}>{count.label}</dt>
        <dd className={cn("truncate text-[1.9em] font-bold leading-tight tabular-nums", count.tone !== "neutral" && indicatorText(count.tone))} data-testid="board-summary-count">{formatNumber(count.value)}</dd>
      </div>)}
    </dl>
    {data.items.length ? <ol ref={box} className="min-h-0 flex-1 space-y-[0.3em] overflow-hidden" aria-label="Lista">
      {data.items.map((item, index) => <li key={index} data-fit-item="" className={cn("flex min-w-0 items-start gap-[0.45em]", index >= fit && "invisible")} aria-hidden={index >= fit ? true : undefined}>
        <span className={cn("mt-[0.35em] size-[0.65em] shrink-0 rounded-full", indicatorBar(item.tone))} aria-hidden="true" />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium" title={item.title}>{item.title}</span><span className="block truncate text-[0.75em] text-muted-foreground">{item.detail}</span></span>
      </li>)}
    </ol> : <p className="text-[0.85em] text-muted-foreground">{empty}</p>}
  </div>;
}

export function UpkeepSettings({ source, onSource }: { source: SourceOf<"upkeep">; onSource: (source: SourceOf<"upkeep">) => void }) {
  const id = useId();
  return <div className="space-y-3">
    <div className="grid gap-1.5"><span className="field-label text-xs font-medium" id={`${id}-h`}>Kommande</span>
      <EditorSegmented label="Kommande" value={source.horizon ?? "30d"} onChange={(horizon) => onSource({ ...source, horizon })} testId="card-upkeep-horizon"
        options={UPKEEP_HORIZONS.map((value) => ({ value, label: UPKEEP_HORIZON_LABEL[value] }))} /></div>
    <p className="text-xs text-muted-foreground">Jobben kommer från underhållsplanerna. Förfallna visas först, sedan de som pågår och de kommande.</p>
  </div>;
}

export function FaultsSettings({ source, onSource }: { source: SourceOf<"faults">; onSource: (source: SourceOf<"faults">) => void }) {
  return <div className="space-y-3">
    <div className="grid gap-1.5"><span className="field-label text-xs font-medium">Nya under</span>
      <EditorSegmented label="Nya under" value={source.period ?? "week"} onChange={(period) => onSource({ ...source, period })} testId="card-faults-period"
        options={FAULT_PERIODS.map((value) => ({ value, label: PERIOD_LABEL[value] }))} /></div>
    <p className="text-xs text-muted-foreground">Felanmälningar från operatörsterminalen. Listan visar de öppna, nyast först, utan namnet på den som anmälde.</p>
  </div>;
}

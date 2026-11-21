"use client";

import { useId, useRef } from "react";
import { CheckField, Field } from "@/features/kfid/ui";
import { EditorSegmented } from "@/components/editor-ribbon";
import { indicatorBar, indicatorText } from "@/features/workflow/indicator-tone";
import { MACHINE_STATE_LABEL, MACHINE_STATE_TONE, type MachinesShape } from "@/lib/boards/cards/shapes";
import { MACHINES_MAX, SIGNAL_MEASURE_LABEL, SIGNAL_MEASURES, SIGNAL_PERIODS, type SignalMeasure } from "@/lib/boards/cards/machines";
import { PERIOD_LABEL } from "@/lib/boards/period";
import type { SourceOf } from "@/lib/boards/cards";
import type { BoardCard } from "@/lib/boards/model";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { Placeholder, useFitCount, useReportShown, type Shown } from "../board-card";
import { useSourceOptions } from "./options";
import { ChartLookFields } from "./trend";

/**
 * Maskinkorten (2026-11-19): one machine's state as a large lamp with its words, or several machines as small tiles. The colours are
 * the app's own: green in operation, yellow stopped, red an open alarm, grey when nothing is known. A lamp always has words too.
 */
const since = (at: string | null) => at ? `sedan ${formatSwedish(at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";

export function MachinesBody({ card, data, onShown }: { card: BoardCard; data: MachinesShape; onShown: (shown: Shown | null) => void }) {
  if (!data.items.length) return <Placeholder text="Det finns inga maskiner i Underhåll ännu." />;
  return card.type === "machine" ? <MachineNow item={data.items[0]!} /> : <MachineTiles data={data} onShown={onShown} />;
}

function MachineNow({ item }: { item: MachinesShape["items"][number] }) {
  const tone = MACHINE_STATE_TONE[item.state];
  return <div className="flex h-full min-w-0 items-center gap-[0.8em]" data-testid="board-machine" data-state={item.state}>
    <span className={cn("aspect-square shrink-0 rounded-full", indicatorBar(tone))} style={{ height: "min(55cqh, 28cqw)" }} aria-hidden="true" />
    <div className="min-w-0">
      <p className={cn("board-machine-state truncate font-bold leading-tight", indicatorText(tone))}>{MACHINE_STATE_LABEL[item.state]}</p>
      <p className="truncate text-[0.85em] text-muted-foreground" title={item.label}>{item.label !== MACHINE_STATE_LABEL[item.state] ? item.label : ""}{item.at ? `${item.label !== MACHINE_STATE_LABEL[item.state] ? " · " : ""}${since(item.at)}` : ""}</p>
    </div>
  </div>;
}

function MachineTiles({ data, onShown }: { data: MachinesShape; onShown: (shown: Shown | null) => void }) {
  const box = useRef<HTMLUListElement | null>(null);
  const fit = useFitCount(box, data.items.length);
  useReportShown(fit, data.items.length, data.total, onShown);
  return <ul ref={box} className="grid h-full content-start gap-[0.35em] overflow-hidden [grid-template-columns:repeat(auto-fill,minmax(min(100%,8em),1fr))]" aria-label="Maskiner" data-testid="board-machines">
    {data.items.map((item, index) => {
      const tone = MACHINE_STATE_TONE[item.state];
      return <li key={`${item.name}-${index}`} data-fit-item="" data-state={item.state} className={cn("flex min-w-0 flex-col gap-[0.15em] rounded-md border px-[0.5em] py-[0.4em]", index >= fit && "invisible")} aria-hidden={index >= fit ? true : undefined}>
        <span className="flex min-w-0 items-center gap-[0.4em]">
          <span className={cn("size-[0.85em] shrink-0 rounded-full", indicatorBar(tone))} aria-hidden="true" />
          <span className="truncate font-medium" title={item.name}>{item.name}</span>
        </span>
        <span className={cn("truncate text-[0.75em] font-semibold", indicatorText(tone))} title={item.label}>{item.state === "unknown" ? item.label : MACHINE_STATE_LABEL[item.state]}</span>
      </li>;
    })}
  </ul>;
}

/** The machine to show, from Underhåll's machines (the top of the tree). */
function MachineChoice({ value, onChange, label = "Maskin", optional = false }: { value?: string; onChange: (id: string | undefined) => void; label?: string; optional?: boolean }) {
  const id = useId();
  const { items, refused, loading } = useSourceOptions<{ id: string; name: string }>("machines");
  if (refused) return <p className="text-xs text-muted-foreground">Du saknar behörighet att se Underhåll, eller så är modulen avstängd.</p>;
  if (!loading && !items.length) return <p className="text-xs text-muted-foreground">Det finns inga maskiner i Underhåll ännu.</p>;
  return <Field id={`${id}-machine`} label={label} value={value ?? ""} onChange={(next) => onChange(next || undefined)} options={["", ...items.map((item) => item.id)]}
    optionLabels={{ "": optional ? "Alla maskiner" : "Den första maskinen", ...Object.fromEntries(items.map((item) => [item.id, item.name])) }} />;
}

export function MachineSettings({ source, onSource }: { source: SourceOf<"machine">; onSource: (source: SourceOf<"machine">) => void }) {
  return <div className="space-y-3">
    <MachineChoice value={source.partId} onChange={(partId) => onSource({ ...source, partId })} />
    <p className="text-xs text-muted-foreground">Läget kommer från maskinkopplingen: ett öppet larm går före driftläget. Utan koppling visas maskinens status i Underhåll.</p>
  </div>;
}

export function MachinesSettings({ source, onSource }: { source: SourceOf<"machines">; onSource: (source: SourceOf<"machines">) => void }) {
  const id = useId();
  const { items, refused } = useSourceOptions<{ id: string; name: string }>("machines");
  const chosen = source.partIds ?? [];
  if (refused) return <p className="text-xs text-muted-foreground">Du saknar behörighet att se Underhåll, eller så är modulen avstängd.</p>;
  return <fieldset className="grid gap-1.5" data-testid="card-machines-choice"><legend className="field-label text-xs font-medium">Maskiner</legend>
    <CheckField id={`${id}-all`} label="Alla maskiner" description={`Högst ${MACHINES_MAX}, i Underhålls ordning.`} checked={!chosen.length} onChange={(on) => onSource({ ...source, partIds: on ? undefined : items.slice(0, 1).map((item) => item.id) })} />
    {chosen.length ? items.map((item) => <CheckField key={item.id} id={`${id}-${item.id}`} label={item.name} checked={chosen.includes(item.id)}
      onChange={(on) => { const next = on ? [...chosen, item.id].slice(0, MACHINES_MAX) : chosen.filter((value) => value !== item.id); onSource({ ...source, partIds: next.length ? next : undefined }); }} />) : null}
  </fieldset>;
}

export function MachineEventsSettings({ source, onSource }: { source: SourceOf<"machine_events">; onSource: (source: SourceOf<"machine_events">) => void }) {
  const id = useId();
  return <div className="space-y-3">
    <MachineChoice value={source.partId} onChange={(partId) => onSource({ ...source, partId })} optional />
    <CheckField id={`${id}-alarms`} label="Bara larm" description="Utan driftlägen och diagnoser." checked={Boolean(source.alarmsOnly)} onChange={(alarmsOnly) => onSource({ ...source, alarmsOnly })} />
  </div>;
}

export function MachineSignalSettings({ card, source, onSource, onChange }: { card: BoardCard; source: SourceOf<"machine_signal">; onSource: (source: SourceOf<"machine_signal">) => void; onChange: (card: BoardCard) => void }) {
  const id = useId();
  const measure: SignalMeasure = source.measure ?? "signal";
  const signals = useSourceOptions<{ id: string; name: string; machine: string }>("signals");
  return <div className="space-y-3">
    <Field id={`${id}-measure`} label="Visa" value={measure} onChange={(value) => onSource({ ...source, measure: value as SignalMeasure })} options={[...SIGNAL_MEASURES]} optionLabels={SIGNAL_MEASURE_LABEL} />
    {measure === "signal" ? (signals.refused ? <p className="text-xs text-muted-foreground">Du saknar behörighet att se Underhåll, eller så är modulen avstängd.</p>
      : <Field id={`${id}-signal`} label="Mätvärde" value={source.signalId ?? ""} onChange={(value) => onSource({ ...source, signalId: value || undefined })} options={["", ...signals.items.map((item) => item.id)]}
        optionLabels={{ "": "Det första aktiva mätvärdet", ...Object.fromEntries(signals.items.map((item) => [item.id, `${item.name} · ${item.machine}`])) }}
        help={!signals.loading && !signals.items.length ? "Det finns inga aktiva mätvärden ännu. Aktivera dem under Kopplingar → Maskiner." : "Värdena som maskinen har skickat. Ett medelvärde per timme eller dag, tomt där inget kom."} />)
      : <MachineChoice value={source.partId} onChange={(partId) => onSource({ ...source, partId })} optional />}
    <div className="grid gap-1.5"><span className="field-label text-xs font-medium">Period</span>
      <EditorSegmented label="Period" value={source.period ?? "today"} onChange={(period) => onSource({ ...source, period })} testId="card-signal-period"
        options={SIGNAL_PERIODS.map((value) => ({ value, label: PERIOD_LABEL[value] }))} /></div>
    <ChartLookFields card={card} onChange={onChange} defaultKind={measure === "signal" ? "line" : "bar"} />
  </div>;
}

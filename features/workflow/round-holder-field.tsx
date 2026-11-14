"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import type { ScheduleView } from "@/lib/workflow/form-schedule";
import { ROUND_PERIOD_PRESETS, roundPeriodEnd, roundPeriodError, type RoundPeriodPreset } from "@/lib/workflow/round-work-orders";
import type { RoundsBackend } from "./form-rounds";

/** A round as the choice needs it. */
export type RoundChoice = Pick<ScheduleView, "id" | "title" | "ruleText" | "assignedToUserId" | "assignedToName"> & Partial<Pick<ScheduleView, "legacyPlace">>;

/**
 * Avser driftrond (2026-10-27, punkt 3) on a work order's Grunduppgifter: the work order is the holder of a round –
 * the person chooses the round and the work order's period (its Start and Klart senast: one day, a month or a year from the
 * start, or any days). During the period the same work order gathers every occurrence; nothing is made by itself. The round
 * cannot be changed once an occurrence is registered in the work order (the server decides again). Cloud and the demo read
 * the rounds from the server, Local from the file.
 */
export function RoundHolderField({ value, period, onChange, onPeriod, onRound, rounds, disabled = false, locked = false, fillOnLoad = false }: {
  /** The round the work order holds, or null. */
  value: string | null;
  period: { from: string; to: string };
  onChange: (roundScheduleId: string | null) => void;
  onPeriod: (period: { from: string; to: string }) => void;
  /** A round was chosen: the page may fill in what it lacks from it (title and responsible; the customer and place a round from
   * before 2026-10-27 kväll stored, as a suggestion – the work order chooses its own customer and place). */
  onRound?: (round: RoundChoice) => void;
  /** Local: the file's rounds. */
  rounds?: RoundsBackend;
  disabled?: boolean;
  /** Occurrences are registered: the round stays (the period can still change). */
  locked?: boolean;
  /** A new work order opened from the round (Skapa arbetsorder för ronden): fill in from the round once it is read. */
  fillOnLoad?: boolean;
}) {
  const [choices, setChoices] = useState<RoundChoice[] | null>(null);
  const [failed, setFailed] = useState("");
  const enabled = value !== null;
  useEffect(() => {
    if (!enabled || choices) return;
    let active = true;
    (rounds ? rounds.load() : api<{ schedules: ScheduleView[] }>("/api/form-schedules"))
      .then((result) => { if (active) { setChoices(result.schedules); setFailed(""); } })
      .catch((issue) => { if (active) setFailed((issue as Error).message); });
    return () => { active = false; };
  }, [enabled, choices, rounds]);
  const chosen = choices?.find((item) => item.id === value) ?? null;
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!fillOnLoad || filled || !chosen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once, when the round named in the address has been read
    setFilled(true);
    onRound?.(chosen);
  }, [fillOnLoad, filled, chosen, onRound]);
  const periodError = enabled && value ? roundPeriodError(period) : null;
  const preset = (id: RoundPeriodPreset) => { const from = period.from || new Date().toISOString().slice(0, 10); onPeriod({ from, to: roundPeriodEnd(from, id) }); };
  return <fieldset className="field-group space-y-3 rounded-lg border p-3 md:col-span-2 xl:col-span-3" disabled={disabled} data-testid="round-holder">
    <legend className="sr-only">Driftrond</legend>
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" className="size-4" checked={enabled} disabled={locked} data-testid="round-holder-toggle"
        onChange={(event) => onChange(event.target.checked ? "" : null)} />
      <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />Arbetsordern avser en driftrond
    </label>
    {enabled ? <div className="grid gap-3 md:grid-cols-2">
      <label className="space-y-2 text-xs font-medium text-muted-foreground">Driftrond
        <select className="form-select" value={value ?? ""} disabled={locked} data-testid="round-holder-round"
          onChange={(event) => { const next = choices?.find((item) => item.id === event.target.value); onChange(event.target.value); if (next) onRound?.(next); }}>
          <option value="">{choices ? "Välj rond" : "Hämtar ronder…"}</option>
          {value && !chosen && choices ? <option value={value}>Ronden</option> : null}
          {(choices ?? []).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.ruleText}</option>)}
        </select>
        {failed ? <span role="alert" className="block font-normal text-destructive">{failed}</span> : locked ? <span className="block font-normal">Rondtillfällen finns, så ronden ligger fast.</span> : null}
      </label>
      <div className="space-y-2 text-xs font-medium text-muted-foreground">
        <span className="block">Period (Start – Klart senast)</span>
        <div className="flex flex-wrap gap-2">
          {ROUND_PERIOD_PRESETS.map((item) => <Button key={item.id} type="button" variant="outline" size="sm" onClick={() => preset(item.id)} data-testid={`round-holder-${item.id}`}>{item.label}</Button>)}
        </div>
        <span className="block font-normal" data-testid="round-holder-period">{period.from && period.to ? `${period.from} – ${period.to}` : "Välj start och slut."}{periodError ? <span className="block text-destructive">{periodError}</span> : null}</span>
      </div>
      <p className="text-xs text-muted-foreground md:col-span-2">Under perioden samlar arbetsordern alla rondtillfällen. Riskbedömningen görs här och gäller varje tillfälle; före varje tillfälle görs en kort säkerhetsavstämning.</p>
    </div> : null}
  </fieldset>;
}

"use client";

import { memo, useState } from "react";
import { Download } from "lucide-react";
import { saveBlob } from "@/lib/download";
import { formatSwedishTime } from "@/lib/swedish-time";
import { MACHINE_SEVERITY_LABELS } from "@/lib/machine/place-status";
import type { LogEntry } from "@/lib/machine/simulator/device";
import { MAX_LOG_ENTRIES } from "@/lib/machine/simulator/limits";
import { CLOCK_HINT } from "@/lib/machine/simulator/words";
import { useRuntimeSnapshot, useDesktop, useSimSnapshot } from "./context";
import { ChromeButton } from "./controls";

// PLC-simulatorn, skrivbordet: the log. Every call to the intake with its answer, the key masked before it got here, and the
// alarms the surface and the regulator raised, sent or not.

const RESULT_WORDS = { accepted: "Mottagen", duplicate: "Dubblett", rejected: "Nekad" };
/** Hours, minutes and seconds: a log of calls a second apart needs the seconds. */
export const clockText = (atMs: number) => formatSwedishTime(new Date(atMs), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const TONE = { ok: "var(--plc-run)", warning: "var(--plc-prog)", danger: "var(--plc-fault)" } as const;

const LogRow = memo(function LogRow({ entry }: { entry: LogEntry }) {
  return <li data-testid="plc-log-row" data-status={entry.status ?? "none"} className="border-b border-[var(--plc-grid)]">
    <details className="px-2 py-0.5">
      <summary className="flex cursor-default list-none flex-wrap items-baseline gap-x-2">
        <span className="tabular-nums plc-help">{clockText(entry.atMs)}</span>
        <span className="font-semibold tabular-nums" style={{ color: TONE[entry.tone] }} data-testid="plc-log-status">{entry.status ?? "Inget svar"}</span>
        <code className="plc-help">{`/${entry.path.split("/").slice(entry.path.includes("ingest") ? 4 : 2).join("/")}`}{entry.probe ? " (test)" : ""}</code>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]" data-testid="plc-log-summary">{entry.summary}</span>
      </summary>
      <div className="mt-1 space-y-1">
        {entry.results.length ? <ul data-testid="plc-log-results">
          {entry.results.map((row, index) => <li key={index} className="[overflow-wrap:anywhere]"><span className="font-semibold">{RESULT_WORDS[row.status]}{row.reason ? ` (${row.reason})` : ""}</span> {row.text ?? row.eventId}</li>)}
        </ul> : null}
        {entry.retryAfter ? <p>Retry-After: {entry.retryAfter} s</p> : null}
        <pre className="max-h-32 overflow-auto border border-[var(--plc-line)] p-1 text-[11px]" tabIndex={0}>{entry.requestHeader}{"\n\n"}{entry.requestBody}</pre>
        <pre className="max-h-32 overflow-auto border border-[var(--plc-line)] p-1 text-[11px]" tabIndex={0} data-testid="plc-log-answer">{entry.responseBody || "–"}</pre>
      </div>
    </details>
  </li>;
});

const LogRows = memo(function LogRows({ log, onlyBad }: { log: readonly LogEntry[]; onlyBad: boolean }) {
  const rows = (onlyBad ? log.filter((entry) => entry.tone !== "ok") : log).toReversed();
  return <ol aria-label="Anrop, senaste först" data-testid="plc-log">
    {rows.length ? rows.map((entry) => <LogRow key={entry.id} entry={entry} />) : <li className="plc-help px-2 py-1">Inga anrop ännu.</li>}
  </ol>;
});

export function LogPanel() {
  const { simulator, runtime } = useDesktop();
  const sim = useSimSnapshot();
  const { alarms } = useRuntimeSnapshot();
  const [view, setView] = useState<"calls" | "bad" | "alarms">("calls");
  const { log, clockSkewMs } = sim.device;
  const skewed = clockSkewMs !== null && Math.abs(clockSkewMs) > 60_000;
  const queued = sim.device.queue.length;
  return <div className="flex h-full min-h-0 flex-col" data-testid="plc-log-tab">
    <div className="flex flex-none flex-wrap items-center gap-1 border-b border-[var(--plc-line)] p-1">
      <select className="plc-select" aria-label="Visa" value={view} data-testid="plc-log-filter" onChange={(event) => setView(event.target.value as typeof view)}>
        <option value="calls">Alla anrop</option><option value="bad">Bara fel</option><option value="alarms">Larm ({alarms.length})</option>
      </select>
      <span className="plc-help">De senaste {MAX_LOG_ENTRIES} anropen. Nyckeln är dold.</span>
      <span className="ml-auto" />
      <ChromeButton onClick={simulator.clearQueue} disabled={!queued} data-testid="plc-clear-queue">Töm kön</ChromeButton>
      <ChromeButton onClick={() => { if (view === "alarms") runtime.clearAlarms(); else simulator.clearLog(); }} disabled={view === "alarms" ? !alarms.length : !log.length} data-testid="plc-log-clear">Töm</ChromeButton>
      <ChromeButton onClick={() => saveBlob(simulator.logFileText(), "simulator-logg.json", "application/json")} disabled={!log.length} data-testid="plc-log-download"><Download aria-hidden="true" />Ladda ner</ChromeButton>
    </div>
    {skewed ? <p className="plc-note flex-none" role="note">Datorns klocka skiljer sig {Math.round(Math.abs(clockSkewMs) / 1000)} s från serverns. {CLOCK_HINT}</p> : null}
    <div className="plc-scroll" tabIndex={0}>
      {view === "alarms" ? <ul aria-label="Larm" data-testid="plc-local-alarms">
        {alarms.length ? alarms.map((alarm) => <li key={alarm.id} className="flex flex-wrap gap-x-2 border-b border-[var(--plc-grid)] px-2 py-0.5" data-testid="plc-local-alarm" data-code={alarm.code} data-state={alarm.state} data-sent={alarm.sent}>
          <span className="tabular-nums plc-help">{new Date(alarm.at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          <span className="font-semibold">{alarm.state === "cleared" ? "Återgått" : MACHINE_SEVERITY_LABELS[alarm.severity]}</span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{alarm.text}</span>
          <span className="plc-help">{alarm.sent ? "Skickat till Workflow" : "Bara här"}</span>
        </li>) : <li className="plc-help px-2 py-1">Inga larm än.</li>}
      </ul> : <LogRows log={log} onlyBad={view === "bad"} />}
    </div>
  </div>;
}

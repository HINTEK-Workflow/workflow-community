"use client";

import { clockText } from "@/lib/machine/simulator/surface/engine";
import { useRuntimeSnapshot, useDeskState, useSimSnapshot } from "./context";
import { Lamp } from "./controls";

// PLC-simulatorn, skrivbordet: the status bar. PLC mode, cycle time, the check's errors and warnings, the simulated clock, the zoom
// and the state of the connection to Workflow, each in a place of its own so nothing moves as the numbers change.

const cycleText = (ms: number) => `${ms.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ms`;

export function connectionWord(sim: ReturnType<typeof useSimSnapshot>): "Frånkopplad" | "Ansluten" | "Skickar" {
  if (sim.demoLinked) return "Ansluten";
  if (!sim.hasKey || sim.device.halt.kind === "key_refused") return "Frånkopplad";
  return sim.device.inFlight || sim.device.queue.length > 0 ? "Skickar" : "Ansluten";
}

export function StatusBar() {
  const snapshot = useRuntimeSnapshot();
  const sim = useSimSnapshot();
  const { zoom } = useDeskState();
  const { engine } = snapshot;
  const errors = engine.findings.filter((finding) => finding.level === "error").length;
  const warnings = engine.findings.filter((finding) => finding.level === "warning").length;
  const mode = engine.error ? "ERR" : engine.run ? "RUN" : "STOP";
  const word = connectionWord(sim);
  return <div className="plc-statusbar" role="status" data-testid="plc-statusbar">
    <span className="plc-status-cell" data-testid="plc-status-mode" data-mode={mode} title={engine.error ?? undefined}><Lamp tone={engine.error ? "fault" : engine.run ? "run" : "prog"} on />{mode}</span>
    <span className="plc-status-cell" style={{ minWidth: 104 }} data-testid="plc-cycle-time">Cykel {cycleText(engine.cycleMs)}</span>
    <span className="plc-status-cell" style={{ minWidth: 112 }} data-testid="plc-status-findings" data-errors={errors} data-warnings={warnings}>{errors} fel · {warnings} {warnings === 1 ? "varning" : "varningar"}</span>
    <span className="plc-status-cell" style={{ minWidth: 104 }} data-testid="plc-clock">{clockText(engine.clockMin)}</span>
    <span className="plc-status-cell" style={{ minWidth: 76 }} data-testid="plc-status-zoom">Zoom {zoom} %</span>
    <span className="plc-status-cell" data-testid="plc-status-connection" data-word={word}>Workflow: {word}</span>
  </div>;
}

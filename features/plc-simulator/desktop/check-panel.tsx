"use client";

import { useMemo } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { findingsSummary, LEVEL_LABELS } from "@/lib/machine/simulator/surface/check";
import { useRuntimeSnapshot, useDesktop } from "./context";

// PLC-simulatorn, skrivbordet: Kontroll av kopplingen as a panel. A compact list; a click on a row marks its wires, devices and
// terminals on the surface, another click takes the marking away.

const LEVEL_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;
const LEVEL_COLOUR = { error: "var(--plc-fault)", warning: "var(--plc-prog)", info: "var(--plc-accent)" } as const;

export function CheckPanel() {
  const { runtime } = useDesktop();
  const { engine, highlight } = useRuntimeSnapshot();
  const { findings } = engine;
  const ordered = useMemo(() => [...findings.filter((finding) => finding.level !== "info"), ...findings.filter((finding) => finding.level === "info")], [findings]);
  return <div className="flex h-full min-h-0 flex-col" data-testid="plc-check" data-errors={findings.filter((finding) => finding.level === "error").length} data-warnings={findings.filter((finding) => finding.level === "warning").length}>
    <p className="flex-none border-b border-[var(--plc-line)] px-2 py-0.5" data-testid="plc-check-pill">{findingsSummary(findings)}<span className="plc-help"> · bara det nätet visar: spänningar, inte strömmar.</span></p>
    <ul className="plc-scroll" aria-label="Fel och varningar">
      {ordered.map((finding) => {
        const Icon = LEVEL_ICON[finding.level];
        const active = highlight === finding.id;
        return <li key={finding.id}>
          <button type="button" className="plc-tree-row" aria-pressed={active} data-on={active} data-testid="plc-finding" data-level={finding.level} onClick={() => runtime.setHighlight(active ? null : finding.id)}>
            <Icon aria-hidden="true" style={{ color: LEVEL_COLOUR[finding.level] }} />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><span className="sr-only">{LEVEL_LABELS[finding.level]}: </span>{finding.text}</span>
          </button>
        </li>;
      })}
      {!ordered.length ? <li className="plc-help px-2 py-1">Inget att anmärka på.</li> : null}
    </ul>
  </div>;
}

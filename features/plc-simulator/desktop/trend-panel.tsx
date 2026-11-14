"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { PID_PROCESSES } from "@/lib/machine/simulator/pid-loop";
import { penCatalogue, penInfo, readPen, trendClockText, trendLanes, type TrendSample } from "@/lib/machine/simulator/trend";
import { useRuntimeSnapshot, useDesktop, useDeskState } from "./context";

// PLC-simulatorn, Trend (2026-11-04): a small panel. Pens in a list to the left, curves to the right, a compact scale, and nothing else:
// the regulator's and the limits' settings are under Egenskaper. Pens that belong together share a lane, every other pen has its own, on
// one time axis of the simulated clock. The colours are the validated categorical order, by pen, fixed, the names always beside them.

const WINDOWS = [{ value: 60, label: "1 min" }, { value: 300, label: "5 min" }, { value: 900, label: "15 min" }, { value: 3600, label: "1 h" }, { value: 21_600, label: "6 h" }];
const PEN_VARS = ["--plc-pen-1", "--plc-pen-2", "--plc-pen-3", "--plc-pen-4", "--plc-pen-5", "--plc-pen-6", "--plc-pen-7", "--plc-pen-8"];
const penColour = (index: number) => `var(${PEN_VARS[index % PEN_VARS.length]})`;
const valueText = (value: number | null | undefined, digital: boolean, unit: string) => {
  if (value === null || value === undefined) return "–";
  if (digital) return value ? "1" : "0";
  return `${value.toLocaleString("sv-SE", { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1 })}${unit ? ` ${unit}` : ""}`;
};
const AXIS_H = 15;
const LEFT = 42;

export function TrendPanel() {
  const { runtime } = useDesktop();
  const snapshot = useRuntimeSnapshot();
  const { popouts } = useDeskState();
  const { engine, pid, layout, compile } = snapshot;
  const pens = useMemo(() => layout.trendPens ?? [], [layout.trendPens]);
  const compiled = engine.compiled ?? (compile?.ok ? compile.compiled : null);
  const [windowS, setWindowS] = useState(300);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverX, setHoverX] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = plotRef.current;
    if (!box) return;
    const Observer = box.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new Observer(([entry]) => setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    observer.observe(box);
    return () => observer.disconnect();
  }, [popouts]);
  const infos = useMemo(() => pens.map((id) => penInfo(id, compiled)), [pens, compiled]);
  const version = snapshot.trendVersion;
  const end = engine.clockMin * 60;
  const from = end - windowS;
  // Drawn when a new sample has come, not on every tick of the engine.
  const visible = useMemo((): readonly TrendSample[] => runtime.trendSamples().filter((sample) => sample.t >= from - windowS * 0.02), [runtime, version, windowS]); // eslint-disable-line react-hooks/exhaustive-deps
  const lanes = useMemo(() => trendLanes(infos, visible), [infos, visible]);
  const plotW = Math.max(0, size.w - LEFT - 6), plotH = Math.max(0, size.h - AXIS_H);
  const laneH = lanes.length ? plotH / lanes.length : 0;
  const lastT = visible.at(-1)?.t ?? end;
  const firstT = lastT - windowS;
  const xOf = (t: number) => LEFT + ((t - firstT) / windowS) * plotW;
  const hoverT = hoverX === null ? null : firstT + ((hoverX - LEFT) / Math.max(1, plotW)) * windowS;
  const hoverSample = hoverT === null ? null : visible.reduce<TrendSample | null>((best, sample) => (!best || Math.abs(sample.t - hoverT) < Math.abs(best.t - hoverT) ? sample : best), null);
  const catalogue = useMemo(() => penCatalogue(compiled), [compiled]);
  const source = { engine, pid };
  const limitsOn = infos.some((info) => info.id === "pid:pv");
  return <div className="flex h-full min-h-0" data-testid="plc-trend">
    <div className="flex w-40 flex-none flex-col border-r border-[var(--plc-line)]" aria-label="Pennor">
      <div className="flex flex-none gap-1 border-b border-[var(--plc-line)] p-0.5">
        <select className="plc-select min-w-0 flex-1" aria-label="Lägg till penna" value="" data-testid="plc-trend-add" onChange={(event) => { if (event.target.value) runtime.addTrendPen(event.target.value); }}>
          <option value="">Lägg till …</option>
          {catalogue.map((group) => <optgroup key={group.group} label={group.group}>{group.pens.filter((pen) => !pens.includes(pen.id)).map((pen) => <option key={pen.id} value={pen.id}>{pen.label}</option>)}</optgroup>)}
        </select>
        <select className="plc-select w-14 flex-none" aria-label="Tidsaxelns längd" value={windowS} data-testid="plc-trend-window" onChange={(event) => setWindowS(Number(event.target.value))}>{WINDOWS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      </div>
      <ul className="plc-scroll">
        {infos.map((info, index) => <li key={info.id} className="flex items-center gap-1 px-1" data-testid="plc-trend-pen" data-pen={info.id}>
          <svg width={12} height={8} aria-hidden="true" className="flex-none"><line x1={0} x2={12} y1={4} y2={4} stroke={penColour(index)} strokeWidth={2} /></svg>
          <span className="min-w-0 flex-1 truncate" title={info.label}>{info.label}</span>
          <span className="flex-none tabular-nums" data-testid="plc-trend-value">{valueText(hoverSample ? hoverSample.values[info.id] : readPen(info.id, source), info.digital, info.unit)}</span>
          <button type="button" className="plc-tab-close flex-none" aria-label={`Ta bort pennan ${info.label}`} onClick={() => runtime.removeTrendPen(info.id)} data-testid="plc-trend-remove"><X aria-hidden="true" /></button>
        </li>)}
        {!infos.length ? <li className="plc-help px-1 py-0.5">Välj en penna, eller högerklicka en tagg och välj Lägg till i trend.</li> : null}
      </ul>
    </div>
    <div ref={plotRef} className="relative min-w-0 flex-1 bg-[var(--plc-field)]" onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHoverX(event.clientX - box.left); }} onPointerLeave={() => setHoverX(null)}>
      {size.w > 0 && size.h > 0 ? <svg width={size.w} height={size.h} className="absolute inset-0 block" role="img" aria-label={`Trend med ${infos.length} pennor`} data-testid="plc-trend-plot" data-samples={visible.length}>
        {lanes.map((lane, laneIndex) => {
          const top = laneIndex * laneH, inner = Math.max(2, laneH - 6);
          const yOf = (value: number) => top + 3 + inner - ((value - lane.min) / Math.max(1e-9, lane.max - lane.min)) * inner;
          const pidDef = lane.key === "pid" ? PID_PROCESSES[pid.kind] : null;
          return <g key={lane.key} data-testid="plc-trend-lane" data-lane={lane.key}>
            <line x1={LEFT} x2={LEFT + plotW} y1={top + laneH} y2={top + laneH} stroke="var(--plc-grid-major)" strokeWidth={1} />
            {lane.digital ? null : <>
              <text x={LEFT - 3} y={top + 11} textAnchor="end" fontSize={9} fill="var(--plc-muted)" className="tabular-nums">{valueText(lane.max, false, "")}</text>
              <text x={LEFT - 3} y={top + laneH - 3} textAnchor="end" fontSize={9} fill="var(--plc-muted)" className="tabular-nums">{valueText(lane.min, false, "")}</text>
            </>}
            {lane.digital ? <><text x={LEFT - 3} y={yOf(1) + 8} textAnchor="end" fontSize={9} fill="var(--plc-muted)">1</text><text x={LEFT - 3} y={yOf(0)} textAnchor="end" fontSize={9} fill="var(--plc-muted)">0</text></> : null}
            {/* The limits, as before: thin dashed lines from the same setting the regulator's alarms use. */}
            {pidDef && limitsOn ? (["high", "low"] as const).map((which) => { const limit = pid.alarmDefs[which].limit; if (limit < lane.min || limit > lane.max) return null; return <g key={which} data-testid="plc-trend-limit" data-which={which}><line x1={LEFT} x2={LEFT + plotW} y1={yOf(limit)} y2={yOf(limit)} stroke="var(--plc-fault)" strokeWidth={1} strokeDasharray="2 3" /><text x={LEFT + 3} y={yOf(limit) - 2} fontSize={8} fill="var(--plc-muted)">{which === "high" ? "Hög gräns" : "Låg gräns"}</text></g>; }) : null}
            {lane.pens.map((info) => {
              const index = infos.indexOf(info);
              const segments: string[][] = [[]];
              let last: { x: number; y: number } | null = null;
              for (const sample of visible) {
                const value = sample.values[info.id];
                if (value === null || value === undefined) { if (segments.at(-1)!.length) segments.push([]); last = null; continue; }
                const x = xOf(sample.t), y = yOf(value);
                // A bit steps; a number runs straight between its samples.
                if (lane.digital && last && last.y !== y) segments.at(-1)!.push(`${x.toFixed(1)},${last.y.toFixed(1)}`);
                segments.at(-1)!.push(`${x.toFixed(1)},${y.toFixed(1)}`);
                last = { x, y };
              }
              return <g key={info.id} data-testid="plc-trend-curve" data-pen={info.id}>{segments.filter((segment) => segment.length > 1).map((segment, part) => <polyline key={part} points={segment.join(" ")} fill="none" stroke={penColour(index)} strokeWidth={2} strokeLinejoin="round" strokeDasharray={info.id.endsWith("sp") || info.id.endsWith(".SP") ? "6 4" : undefined} />)}</g>;
            })}
          </g>;
        })}
        <line x1={LEFT} x2={LEFT} y1={0} y2={plotH} stroke="var(--plc-line)" />
        {[0, 0.5, 1].map((share) => <text key={share} x={LEFT + share * plotW} y={size.h - 4} textAnchor={share === 0 ? "start" : share === 1 ? "end" : "middle"} fontSize={9} fill="var(--plc-muted)" className="tabular-nums" data-testid="plc-trend-time">{trendClockText(firstT + share * windowS)}</text>)}
        {hoverX !== null && hoverX >= LEFT && hoverX <= LEFT + plotW ? <line x1={hoverX} x2={hoverX} y1={0} y2={plotH} stroke="var(--plc-muted)" strokeWidth={1} pointerEvents="none" data-testid="plc-trend-crosshair" /> : null}
      </svg> : null}
    </div>
  </div>;
}

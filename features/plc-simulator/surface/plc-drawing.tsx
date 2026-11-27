"use client";

import { ANALOG_RAW_MAX, nameIo, PLC_IO, PLC_NAME } from "@/lib/machine/simulator/st/io";
import type { EngineState } from "@/lib/machine/simulator/surface/engine";
import { PLC_BOTTOM_TERMINALS, PLC_BOX, PLC_TOP_TERMINALS, plcTerminalPoint } from "@/lib/machine/simulator/surface/geometry";
import { PLC_DEVICE_ID } from "@/lib/machine/simulator/surface/layout";
import { cn } from "@/lib/utils";
import { ERR, Halo, INK, Led, LOOK, MiniDisplay, MUTED, ON, ScrewTerminal, WARN } from "./parts";

// PLC-simulatorn: Workflow PLC in the middle of the surface (the owner 2026-11-04: an industrial colour language, a dark grey chassis
// with green and red status LEDs, more visual). A rack of our own design: a CPU part with RUN, STOP and ERR, a lit display and a
// RUN/STOP switch, and I/O parts for what the terminal strips carry, screw terminals with their names, an LED per digital point and
// the value per analog point. Generic look and name: nothing of any maker's product. The PLC is fed
// on L+ and M; dark without it, and the display says "Ingen matning".

const STRIP = 30;

function Terminal({ terminal, lit, value, hot, marked }: { terminal: string; lit: boolean | null; value: string | null; hot: boolean; marked: boolean }) {
  const point = plcTerminalPoint(terminal)!;
  const top = point.side === "top";
  const supply = terminal === "24V" || terminal === "0V";
  const io = nameIo(terminal);
  const role = terminal === "24V" ? "supply" : terminal === "0V" ? "ground" : io?.kind === "AI" || io?.kind === "AO" ? "analog" : "wire";
  const title = terminal === "24V" ? "L+ 24 V DC in" : terminal === "0V" ? "M 0 V" : `${terminal}${io?.kind === "AI" || io?.kind === "AO" ? ", 0–10 V" : ""}`;
  const labelY = top ? point.y + 18 : point.y - 12;
  const lampY = top ? point.y + 30 : point.y - 24;
  return <g>
    {marked ? <circle cx={point.x} cy={point.y} r={11} fill={WARN} fillOpacity={0.2} stroke={WARN} strokeWidth={1.2} strokeDasharray="3 2" pointerEvents="none" /> : null}
    <ScrewTerminal x={point.x} y={point.y} id={`${PLC_DEVICE_ID}:${terminal}`} title={title} role={role} hot={hot} />
    <text x={point.x} y={labelY} textAnchor="middle" fontSize={9} fontWeight={supply ? 700 : 600} fill={INK} pointerEvents="none">{terminal === "24V" ? "L+" : terminal === "0V" ? "M" : terminal}</text>
    {lit !== null ? <Led x={point.x} y={lampY} on={lit} colour={ON} testId="plc-io-lamp" data={{ io: terminal }} /> : null}
    {value !== null ? <text x={point.x} y={lampY + 3} textAnchor="middle" fontSize={7.5} fontWeight={500} fill="#7dd3fc" data-testid="plc-io-value" data-io={terminal}>{value}</text> : null}
  </g>;
}

/** An I/O part's name on the rack, under or over the points it holds. */
function Module({ x1, x2, y, height, label }: { x1: number; x2: number; y: number; height: number; label: string }) {
  return <g pointerEvents="none">
    <rect x={x1} y={y} width={x2 - x1} height={height} rx={2} fill="url(#plc-metal-dark)" stroke="#05090f" strokeWidth={0.7} />
    <rect x={x1 + 1} y={y + 1} width={x2 - x1 - 2} height={3} rx={1} fill="url(#plc-sheen)" />
    <text x={(x1 + x2) / 2} y={y + height / 2 + 3.5} textAnchor="middle" fontSize={9.5} fontWeight={700} letterSpacing={1} fill={MUTED}>{label}</text>
  </g>;
}

export function PlcDrawing({ engine, onRun, hotTerminal = null, markedTerminals }: { engine: EngineState; onRun: (run: boolean) => void; hotTerminal?: string | null; markedTerminals?: ReadonlySet<string> }) {
  const { x, y, width, height } = PLC_BOX;
  const volts = (raw: number) => `${(raw / (ANALOG_RAW_MAX / 10)).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} V`;
  const lampFor = (terminal: string) => {
    const io = nameIo(terminal);
    if (io?.kind === "DI") return { lit: engine.inputs.di[io.index] === true, value: null };
    if (io?.kind === "DO") return { lit: engine.outputs.do[io.index] === true, value: null };
    if (io?.kind === "AI") return { lit: null, value: volts(engine.inputs.ai[io.index] ?? 0) };
    if (io?.kind === "AO") return { lit: null, value: volts(engine.outputs.ao[io.index] ?? 0) };
    return { lit: null, value: null };
  };
  const status = !engine.powered ? "OFF" : engine.error ? "ERR" : engine.run ? "RUN" : "STOP";
  const cycle = `${engine.cycleMs.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ms`;
  const activeIn = engine.inputs.di.filter(Boolean).length, activeOut = engine.outputs.do.filter(Boolean).length;
  const faceY = y + STRIP + 18, faceH = height - 2 * (STRIP + 18);
  const xOf = (terminal: string) => plcTerminalPoint(terminal)!.x;
  return <g data-testid="plc-body" data-status={status}>
    {/* The chassis, its mounting ears and the two strips the wires come to. */}
    <rect x={x - 6} y={y + 18} width={width + 12} height={height - 36} rx={3} fill="#10161f" stroke="#05090f" />
    <rect x={x} y={y - 8} width={width} height={height + 16} rx={5} fill="url(#plc-metal-dark)" stroke="#05090f" strokeWidth={1} />
    <rect x={x + 1.5} y={y - 7} width={width - 3} height={10} rx={4} fill="url(#plc-sheen)" />
    <rect x={x + 6} y={y - 7} width={width - 12} height={STRIP + 14} rx={2.5} fill="#0e141d" stroke="#2b3644" strokeWidth={0.7} />
    <rect x={x + 6} y={y + height - STRIP - 7} width={width - 12} height={STRIP + 14} rx={2.5} fill="#0e141d" stroke="#2b3644" strokeWidth={0.7} />
    {/* The front: CPU part with lamps, display and switch. */}
    <rect x={x + 6} y={faceY} width={width - 12} height={faceH} rx={3} fill="#1a222e" stroke="#05090f" />
    <rect x={x + 6} y={faceY} width={5} height={faceH} rx={1.5} fill="url(#plc-blue)" />
    <text x={x + 20} y={faceY + 15} fontSize={13} fontWeight={700} letterSpacing={1.2} fill={INK}>{PLC_NAME.toUpperCase()}</text>
    <text x={x + width - 14} y={faceY + 14} textAnchor="end" fontSize={8.5} fill={MUTED}>{PLC_IO.di} DI · {PLC_IO.ai} AI 0–10 V · {PLC_IO.do} DO · {PLC_IO.ao} AO 0–10 V · L+/M 24 V DC</text>
    {/* RUN, STOP and ERR lamps, with their words, so colour is never the only sign. */}
    <g data-testid="plc-run-lamp" data-on={engine.run}><Led x={x + 26} y={faceY + 36} on={engine.run} colour={ON} label="RUN" labelSize={10} /></g>
    <Led x={x + 26} y={faceY + 56} on={engine.powered && !engine.run && !engine.error} colour="#fbbf24" label="STOP" labelSize={10} />
    <g data-testid="plc-err-lamp" data-on={engine.error !== null}><g className={cn(engine.error && "motion-safe:animate-pulse")}>{engine.error ? <Halo cx={x + 26} cy={faceY + 76} r={11} colour={ERR} /> : null}<Led x={x + 26} y={faceY + 76} on={engine.error !== null} colour={ERR} label="ERR" labelSize={10} /></g></g>
    {/* The display: state and cycle time, the error in words, and how many points are active. */}
    <MiniDisplay x={x + 82} y={faceY + 26} width={width - 240} height={34} size={14} text={!engine.powered ? "Ingen matning" : engine.error ? engine.error.slice(0, 48) : `${status}  cykel ${cycle}`} tone={engine.error ? "error" : "normal"} testId="plc-display" />
    <text x={x + 84} y={faceY + 78} fontSize={9.5} fill={MUTED} data-testid="plc-io-summary">{`Ingångar aktiva ${activeIn}/${PLC_IO.di} · Utgångar aktiva ${activeOut}/${PLC_IO.do} · längsta cykel ${engine.cycleMaxMs.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ms · ${engine.speed}×`}</text>
    {/* The RUN/STOP switch: a slide switch on the plate, a real button underneath. */}
    <foreignObject x={x + width - 148} y={faceY + 28} width={134} height={30}>
      <button type="button" role="switch" aria-checked={engine.run} aria-label="RUN/STOP" data-testid="plc-run-switch" onPointerDown={(event) => event.stopPropagation()} onClick={() => onRun(!engine.run)}
        className="flex h-7 w-full items-center rounded border border-slate-600 bg-[#05090f] p-0.5 text-[11px] font-bold tracking-wide focus-visible:outline-2 focus-visible:outline-sky-400">
        <span className={cn("flex h-full flex-1 items-center justify-center rounded-sm", !engine.run ? "bg-slate-300 text-slate-900" : "text-slate-400")}>STOP</span>
        <span className={cn("flex h-full flex-1 items-center justify-center rounded-sm", engine.run ? "bg-[#16a34a] text-white" : "text-slate-400")}>RUN</span>
      </button>
    </foreignObject>
    {/* The parts' names, each between the strip it belongs to and the front. */}
    <Module x1={xOf("DI0") - 11} x2={xOf("DI11") + 11} y={y + STRIP + 6} height={11} label="DI" />
    <Module x1={xOf("AI0") - 11} x2={xOf("AI3") + 11} y={y + STRIP + 6} height={11} label="AI" />
    <Module x1={xOf("DO0") - 11} x2={xOf("DO7") + 11} y={y + height - STRIP - 17} height={11} label="DO" />
    <Module x1={xOf("AO0") - 11} x2={xOf("AO1") + 11} y={y + height - STRIP - 17} height={11} label="AO" />
    <rect x={x} y={y - 8} width={width} height={height + 16} rx={5} fill="none" stroke={LOOK.steel} strokeOpacity={0.5} pointerEvents="none" />
    {PLC_TOP_TERMINALS.map((terminal) => <Terminal key={terminal} terminal={terminal} {...lampFor(terminal)} hot={hotTerminal === `${PLC_DEVICE_ID}:${terminal}`} marked={markedTerminals?.has(terminal) ?? false} />)}
    {PLC_BOTTOM_TERMINALS.map((terminal) => <Terminal key={terminal} terminal={terminal} {...lampFor(terminal)} hot={hotTerminal === `${PLC_DEVICE_ID}:${terminal}`} marked={markedTerminals?.has(terminal) ?? false} />)}
  </g>;
}

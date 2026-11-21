"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { createHeatingState, createVentilationState } from "@/lib/machine/simulator/process-models";
import { DEVICE_DEFS, type DeviceKindId, isLatching, knobSignal, optionValue, signalKind, terminalName, terminalTitle, voltsToMilliamps } from "@/lib/machine/simulator/surface/devices";
import { createDeviceState, type DeviceState, type Plant, sensorReading } from "@/lib/machine/simulator/surface/engine";
import { deviceTerminalPoint, labelPlace } from "@/lib/machine/simulator/surface/geometry";
import { animationFor, designedDef, designFor, photoColourFilter, pictureOffset, readoutFor, type DeviceDesign } from "@/lib/machine/simulator/surface/device-designs";
import { READOUT_LINE, readoutFrame, readoutLines } from "@/lib/machine/simulator/surface/readouts";
import { DesignPicture } from "./design-picture";
import type { DeviceInst } from "@/lib/machine/simulator/surface/layout";
import { cn } from "@/lib/utils";
import { BuzzerPicture, ContactorPicture, EmergencyStopPicture, SafetyRelayPicture, LampPicture, LimitSwitchPicture, MotorPicture, PushButtonPicture, RelayPicture, SelectorPicture, SolenoidValvePicture } from "./pictures";
import { AnimationStyle, Part, useAnimationScope } from "./animated";
import { BUTTON_COLOURS, Caption, dialPoint, Fan, Halo, HOT, Housing, INK, Knob, LAMP_COLOURS, Led, MiniDisplay, NameTag, ON, Pipe, Plate, ScrewTerminal, STEEL, WARN } from "./parts";

// PLC-simulatorn: the field devices as drawn on the dark surface. Redrawn 2026-11-04 on the owner's word ("mer visuella i
// ritverktyget"): every device is a shaded, glossy, colourful picture of the component itself, with lit and unlit states, and no
// technical symbol anywhere (the owner 2026-11-05: "mer som en bild av vad det är"; the odd ones redrawn again). Own SVG from the parts in parts.tsx, one family and one style definition; no maker's product look, no
// shape taken from any image. The terminals show the designations such devices carry (13/14, 11/12, X1/X2, A1/A2, U1/U2, +/−/ut)
// from the catalogue (terminalName), while the ids wires refer to stay as they were. What a person can touch is a real <button> or
// <input> over the drawing; the palette's small pictures (DeviceThumb) draw the same device still, on the one set of gradients.

export type DeviceTouch = Partial<Pick<DeviceState, "pressed" | "on" | "value" | "tripped">>;

const numberText = (value: number, decimals: number) => value.toLocaleString("sv-SE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const voltsText = (volts: number | null) => (volts === null ? "–" : `${numberText(Math.abs(volts), 1)} V`);

function Terminals({ device, hot, design }: { device: DeviceInst; hot: string | null; design?: DeviceDesign | null }) {
  const def = designedDef(device, design);
  return <>{def.terminals.map((terminal) => {
    const point = deviceTerminalPoint(device, terminal.id, design)!;
    const key = `${device.id}:${terminal.id}`;
    return <ScrewTerminal key={terminal.id} x={point.x} y={point.y} id={key} title={terminalTitle(def, device.options, terminal.id)} role={terminal.role} label={terminalName(def, device.options, terminal.id)} labelBelow={terminal.side === "top"} hot={hot === key} />;
  })}</>;
}

/** A tubular element as in an oven or an air heater: hairpins between x1 and x2 over the given rows, glowing when `heat` > 0. */
function HeatingTube({ x1, x2, rows, heat, width = 4 }: { x1: number; x2: number; rows: number[]; heat: number; width?: number }) {
  const r = (rows[1] - rows[0]) / 2;
  let d = `M ${x1} ${rows[0]}`;
  rows.forEach((y, index) => {
    if (index === rows.length - 1) { d += index % 2 === 0 ? ` H ${x2}` : ` H ${x1}`; return; }
    d += index % 2 === 0 ? ` H ${x2} a ${r} ${r} 0 0 1 0 ${2 * r}` : ` H ${x1 + 8} a ${r} ${r} 0 0 0 0 ${2 * r}`;
  });
  const warm = heat > 0.02;
  const middleY = (rows[0] + rows[rows.length - 1]) / 2;
  return <g pointerEvents="none">
    {warm ? <ellipse cx={(x1 + x2) / 2} cy={middleY} rx={(x2 - x1) * 0.72} ry={(rows[rows.length - 1] - rows[0]) * 0.95} fill="url(#plc-halo-heat)" opacity={0.3 + 0.7 * heat} /> : null}
    <path d={d} fill="none" stroke={warm ? "#fb923c" : "#8795a6"} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    <path d={d} fill="none" stroke={warm ? "#fde68a" : "#e2e8f0"} strokeOpacity={0.6} strokeWidth={width * 0.3} strokeLinecap="round" strokeLinejoin="round" />
  </g>;
}

/** A sensor's probe: a coloured connection head with its gland, a neck, a nut and a chrome stem; the tip warms with `heat` (0–1). */
function Probe({ cx, top, stemTo, heat, head = "url(#plc-blue)" }: { cx: number; top: number; mount: "nut"; stemTo: number; heat: number; head?: string }) {
  const nutY = top + 22;
  return <g pointerEvents="none">
    <rect x={cx - 2.4} y={nutY} width={4.8} height={stemTo - nutY} rx={2.4} fill="url(#plc-metal-h)" stroke={STEEL} strokeWidth={0.5} />
    {heat > 0.02 ? <rect x={cx - 2} y={stemTo - 2 - 18 * heat} width={4} height={18 * heat} rx={2} fill={HOT} opacity={0.75} /> : null}
    <rect x={cx - 3.5} y={top + 14} width={7} height={8} fill="url(#plc-metal-h)" stroke={STEEL} strokeWidth={0.5} />
    <rect x={cx - 7} y={nutY} width={14} height={5.5} rx={1} fill="url(#plc-metal)" stroke={STEEL} strokeWidth={0.6} />
    <rect x={cx + 9} y={top + 5} width={6} height={6} rx={1} fill="url(#plc-metal-dark)" stroke="#05090f" strokeWidth={0.5} />
    <path d={`M ${cx - 11} ${top + 14} q -1 -13 11 -14 q 12 1 11 14 Z`} fill={head} stroke="#05090f" strokeWidth={0.6} />
    <ellipse cx={cx - 2} cy={top + 5} rx={6.5} ry={2.6} fill="url(#plc-sheen)" />
  </g>;
}

/** A dark socket for a device fixed to a wall or panel: the shaded square its round part sits in. */
const Mount = ({ cx, cy, size }: { cx: number; cy: number; size: number }) => <rect x={cx - size} y={cy - size} width={2 * size} height={2 * size} rx={4} fill="url(#plc-metal-dark)" stroke={STEEL} strokeWidth={0.6} pointerEvents="none" />;

/** The still picture of a device: the component itself, shaded and glossy, with its state; the controls a hand can touch are `Controls`. */
function Symbol({ device, state, plant }: { device: DeviceInst; state: DeviceState; plant: Plant }) {
  const def = DEVICE_DEFS[device.kind];
  const { width: w } = def;
  const cx = w / 2;
  const reading = sensorReading(device.kind, plant, state);
  const dead = state.outV === null && def.elements.some((element) => element.kind === "source" && element.plus !== null) && signalKind(device.kind, device.options) === null;
  // The reading itself stands in the value tag beside the plate (2026-11-07); inside, only a missing supply is said.
  const readingCaption = (y: number) => (dead ? <Caption x={cx} y={y} text="ingen matning" tone="hot" /> : null);
  switch (device.kind) {
    // The pictured devices (pictures.tsx, the owner 2026-11-06): large glossy pictures that fill the tile.
    case "knapp": case "knapp_lampa": {
      const nc = optionValue(def, device.options, "nc") === "nc";
      const lit = device.kind === "knapp_lampa";
      const chosen = optionValue(def, device.options, "color");
      const colour = lit ? LAMP_COLOURS[chosen] ?? LAMP_COLOURS.green : chosen === "auto" || !BUTTON_COLOURS[chosen] ? (nc ? BUTTON_COLOURS.red : BUTTON_COLOURS.green) : BUTTON_COLOURS[chosen];
      return <PushButtonPicture cx={cx} cy={41} colour={colour} lit={lit} />;
    }
    case "nodstopp": return <EmergencyStopPicture cx={cx} cy={48} />;
    case "valjare": return <g>
      <SelectorPicture cx={cx} cy={42} />
      <text x={cx - 27} y={68} textAnchor="middle" fontSize={8} fontWeight={700} fill={INK}>0</text>
      <text x={cx + 27} y={68} textAnchor="middle" fontSize={8} fontWeight={700} fill={INK}>I</text>
    </g>;
    case "gransbrytare": return <LimitSwitchPicture cx={cx} />;
    case "lampa": return <LampPicture cx={cx} cy={42} colour={LAMP_COLOURS[optionValue(def, device.options, "color")] ?? LAMP_COLOURS.green} />;
    case "summer": return <BuzzerPicture cx={cx} cy={42} />;
    case "motor": return <MotorPicture />;
    case "ventil": return <SolenoidValvePicture />;
    case "rela": return <RelayPicture />;
    case "nodstoppsrela": return <SafetyRelayPicture state={state} />;
    case "kontaktor": return <ContactorPicture />;
    case "vippa": {
      const cy = 45;
      const angle = -30;
      return <g>
        <Mount cx={cx} cy={cy} size={20} />
        <text x={cx - 13} y={cy - 12} textAnchor="middle" fontSize={8} fontWeight={700} fill={INK}>0</text>
        <text x={cx + 13} y={cy - 12} textAnchor="middle" fontSize={8} fontWeight={700} fill={INK}>I</text>
        <circle cx={cx} cy={cy + 4} r={8} fill="url(#plc-metal)" stroke={STEEL} strokeWidth={0.6} />
        <circle cx={cx} cy={cy + 4} r={4.4} fill="#05090f" />
        <Part name="lever"><g transform={`rotate(${angle} ${cx} ${cy + 4})`}>
          <rect x={cx - 2.4} y={cy - 13} width={4.8} height={18} rx={2.2} fill="url(#plc-metal-h)" stroke={STEEL} strokeWidth={0.5} />
          <circle cx={cx} cy={cy - 13} r={3.8} fill="url(#plc-metal)" stroke={STEEL} strokeWidth={0.5} />
        </g></Part>
      </g>;
    }
    case "vred": return <g>
      <Knob cx={cx} cy={40} r={13} value={state.value} scale={["0", "10"]} part="pointer" />
    </g>;
    case "cirkpump": return <g>
      <Pipe x1={4} x2={68} y={55} width={9} flanges />
      <rect x={cx - 11} y={19} width={22} height={13} rx={3} fill="url(#plc-blue)" stroke="#05224f" strokeWidth={0.7} />
      {[22, 25, 28].map((y) => <line key={y} x1={cx - 9} x2={cx + 9} y1={y} y2={y} stroke="#05224f" strokeOpacity={0.55} strokeWidth={1} />)}
      <circle cx={cx} cy={45} r={14} fill="url(#plc-blue)" stroke="#05224f" strokeWidth={0.8} />
      <ellipse cx={cx - 2} cy={37} rx={8} ry={3.5} fill="url(#plc-sheen)" />
      <circle cx={cx} cy={45} r={9} fill="#05090f" />
      <Part name="rotor"><Fan cx={cx} cy={45} r={8} speed={0} blades={3} colour="#cbd5e1" /></Part>
    </g>;
    case "tilluftsflakt": case "franluftsflakt": {
      const cy = 44, intake = device.kind === "tilluftsflakt";
      const arrow = intake ? "#60a5fa" : "#fb923c";
      return <g>
        <rect x={cx - 23} y={cy - 22} width={46} height={44} rx={5} fill="url(#plc-metal-dark)" stroke={STEEL} strokeWidth={0.7} />
        {[[-19, -18], [19, -18], [-19, 18], [19, 18]].map(([dx, dy]) => <circle key={`${dx}${dy}`} cx={cx + dx} cy={cy + dy} r={1.5} fill={STEEL} />)}
        <circle cx={cx} cy={cy} r={18.5} fill="#05090f" />
        <Part name="rotor"><Fan cx={cx} cy={cy} r={17} speed={0} blades={5} colour="#a9b6c6" /></Part>
        <g stroke="#8795a6" strokeWidth={0.7} strokeOpacity={0.6} fill="none"><circle cx={cx} cy={cy} r={11} /><circle cx={cx} cy={cy} r={17.5} /></g>
        <path d={intake ? `M ${cx + 26} ${cy - 3} h 7 v -3 l 6 5 l -6 5 v -3 h -7 Z` : `M ${cx - 38} ${cy - 3} h 7 v -3 l 6 5 l -6 5 v -3 h -7 Z`} fill={arrow} />
      </g>;
    }
    case "shunt": {
      return <g>
        <Pipe x1={4} x2={80} y={52} width={10} flanges />
        <rect x={36} y={56} width={12} height={13} rx={1} fill="url(#plc-metal-h)" stroke={STEEL} strokeWidth={0.6} />
        <rect x={33} y={66} width={18} height={4} rx={1} fill="url(#plc-metal)" stroke={STEEL} strokeWidth={0.6} />
        <circle cx={42} cy={52} r={11} fill="url(#plc-brass)" stroke="#5c430d" strokeWidth={0.7} />
        <rect x={39} y={36} width={6} height={7} fill="url(#plc-metal-h)" />
        <rect x={27} y={20} width={30} height={18} rx={4} fill="url(#plc-blue)" stroke="#05224f" strokeWidth={0.7} />
        <rect x={29} y={21} width={26} height={5} rx={2.5} fill="url(#plc-sheen)" />
        <circle cx={42} cy={29.5} r={6.5} fill="#05090f" stroke={STEEL} strokeWidth={0.5} />
        <Part name="needle"><line x1={42} y1={29.5} x2={42} y2={24.5} stroke="#ffffff" strokeWidth={1.7} strokeLinecap="round" /></Part>
      </g>;
    }
    case "varmare": return <g>
      <rect x={8} y={23} width={68} height={36} rx={3} fill="#121a26" stroke={STEEL} strokeWidth={0.7} />
      <rect x={8} y={23} width={9} height={36} rx={2} fill="url(#plc-metal)" stroke={STEEL} strokeWidth={0.6} />
      <HeatingTube x1={17} x2={66} rows={[29, 37, 45, 53]} heat={0} />
      <Part name="heat"><HeatingTube x1={17} x2={66} rows={[29, 37, 45, 53]} heat={1} /></Part>
    </g>;
    case "varmebatteri": return <g>
      <rect x={14} y={23} width={60} height={36} rx={2} fill="#c7d0da" stroke={STEEL} strokeWidth={0.7} />
      {Array.from({ length: 14 }, (_, index) => <line key={index} x1={18 + index * 4} x2={18 + index * 4} y1={25} y2={57} stroke="#7b8a9c" strokeWidth={0.9} />)}
      <rect x={6} y={23} width={9} height={36} rx={1.5} fill="url(#plc-copper)" stroke="#5c2d0e" strokeWidth={0.6} />
      <HeatingTube x1={12} x2={68} rows={[31, 41, 51]} heat={0} width={3} />
      <Part name="heat"><HeatingTube x1={12} x2={68} rows={[31, 41, 51]} heat={1} width={3} /></Part>
    </g>;
    case "nivagivare": {
      const level = plant.tank / 100;
      const top = 80 - 52 * level;
      return <g>
        <rect x={14} y={21} width={44} height={61} rx={8} fill="url(#plc-metal-h)" stroke={STEEL} strokeWidth={0.8} />
        <rect x={25} y={26} width={22} height={54} rx={3} fill="#0a111c" stroke="#475569" strokeWidth={0.6} />
        <rect x={26} y={top} width={20} height={52 * level + 0.5} rx={1.5} fill="url(#plc-water)" />
        <rect x={26} y={27} width={6} height={52} fill="url(#plc-sheen)" />
        <ellipse cx={36} cy={top} rx={6} ry={2.4} fill="#fb923c" stroke="#9a3412" strokeWidth={0.5} />
        {readingCaption(92)}
      </g>;
    }
    case "tempgivare": return <g>
      <Probe cx={cx} top={20} mount="nut" stemTo={84} heat={Math.min(1, Math.max(0, (reading ?? 0) / 200))} />
      {readingCaption(92)}
    </g>;
    case "givare_tilluft": return <g>
      <Probe cx={cx} top={20} mount="nut" stemTo={74} heat={0} />
      <rect x={4} y={56} width={52} height={22} rx={2} fill="url(#plc-metal)" fillOpacity={0.55} stroke={STEEL} strokeWidth={0.8} />
      <path d={`M 12 64 h 26 v -3.5 l 9 6.5 l -9 6.5 v -3.5 h -26 Z`} fill="#60a5fa" />
      {readingCaption(92)}
    </g>;
    case "givare_franluft": return <g>
      <Probe cx={cx} top={20} mount="nut" stemTo={74} heat={0} head="url(#plc-copper)" />
      <rect x={4} y={56} width={52} height={22} rx={2} fill="url(#plc-metal)" fillOpacity={0.55} stroke={STEEL} strokeWidth={0.8} />
      <path d={`M 12 64 h 26 v -3.5 l 9 6.5 l -9 6.5 v -3.5 h -26 Z`} fill="#fb923c" />
      {readingCaption(92)}
    </g>;
    case "givare_ute": return <g>
      <path d="M 12 40 L 30 26 L 48 40 Z" fill="url(#plc-grey)" stroke="#596779" strokeWidth={0.7} />
      <Housing x={15} y={40} width={30} height={31} rx={2} tone="light" />
      {[45, 50, 55, 60, 65].map((y) => <line key={y} x1={18} x2={42} y1={y} y2={y} stroke="#475569" strokeWidth={1.3} strokeLinecap="round" />)}
      <circle cx={30} cy={75} r={3} fill="url(#plc-metal)" stroke={STEEL} strokeWidth={0.5} />
      {readingCaption(92)}
    </g>;
    case "givare_rum": return <g>
      <rect x={10} y={30} width={40} height={44} rx={6} fill="url(#plc-grey)" stroke="#596779" strokeWidth={0.7} />
      <rect x={12} y={31} width={36} height={9} rx={4} fill="url(#plc-sheen)" />
      <MiniDisplay x={15} y={38} width={30} height={15} text={dead ? "–" : `${numberText(reading ?? 0, 0)}°`} tone="blue" size={9} />
      {[60, 64, 68].map((y) => <line key={y} x1={18} x2={42} y1={y} y2={y} stroke="#475569" strokeWidth={1} strokeLinecap="round" />)}
      {readingCaption(92)}
    </g>;
    case "givare_fram": return <g>
      <Pipe x1={3} x2={57} y={72} width={11} flanges />
      <Probe cx={cx} top={20} mount="nut" stemTo={70} heat={Math.min(1, Math.max(0, (reading ?? 0) / 100))} />
      {readingCaption(92)}
    </g>;
    case "tryckgivare": {
      const cy = 45;
      const share = Math.min(100, Math.max(0, ((reading ?? 0) / 500) * 100));
      const tip = dialPoint(share, cx, cy, 13);
      return <g>
        <rect x={cx - 3.5} y={cy + 17} width={7} height={9} fill="url(#plc-brass)" stroke="#5c430d" strokeWidth={0.5} />
        <circle cx={cx} cy={cy} r={20} fill="url(#plc-metal)" stroke={STEEL} strokeWidth={0.5} />
        <circle cx={cx} cy={cy} r={17} fill="url(#plc-dial)" />
        {[0, 25, 50, 75, 100].map((tick) => { const a = dialPoint(tick, cx, cy, 15.5), b = dialPoint(tick, cx, cy, tick % 50 === 0 ? 11.5 : 13); return <line key={tick} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={tick >= 75 ? HOT : "#111827"} strokeWidth={1.1} />; })}
        <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={HOT} strokeWidth={1.8} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={2.2} fill="#111827" />
        {readingCaption(80)}
      </g>;
    }
    case "larm": {
      const on = state.energised;
      const dome = `M ${cx - 12} 49 L ${cx - 12} 34 Q ${cx - 12} 22 ${cx} 22 Q ${cx + 12} 22 ${cx + 12} 34 L ${cx + 12} 49 Z`;
      return <g>
        <rect x={cx - 15} y={53} width={30} height={6} rx={1.5} fill="url(#plc-metal)" stroke={STEEL} strokeWidth={0.6} />
        <rect x={cx - 13} y={48} width={26} height={6} rx={1} fill="url(#plc-metal-h)" stroke={STEEL} strokeWidth={0.6} />
        <path d={dome} fill="url(#plc-cap-red)" opacity={0.7} />
        <Part name="beacon"><Halo cx={cx} cy={36} r={32} ry={27} colour={LAMP_COLOURS.red} /><path d={dome} fill="url(#plc-lit-red)" /></Part>
        <ellipse cx={cx - 4} cy={31} rx={3.5} ry={6.5} fill="url(#plc-sheen)" />
        {on ? <Caption x={cx} y={68} text="LARM" tone="hot" /> : null}
      </g>;
    }
    case "spjall": {
      return <g>
        <rect x={12} y={22} width={60} height={33} rx={2} fill="url(#plc-metal)" stroke={STEEL} strokeWidth={0.8} />
        <rect x={16} y={26} width={52} height={25} fill="#05090f" />
        {[21, 30, 39, 48, 57, 63].map((x) => <Part key={x} name="blade"><rect x={x - 1.4} y={27} width={2.8} height={23} rx={1} fill="url(#plc-metal-h)" pointerEvents="none" /></Part>)}
        <Housing x={73} y={28} width={19} height={21} rx={2} tone="dark" />
        <Led x={82.5} y={38.5} on={false} colour={ON} />
        <Part name="led"><Led x={82.5} y={38.5} on colour={ON} /></Part>
      </g>;
    }
    case "brandlarm": {
      const on = state.on;
      return <g>
        <rect x={17} y={22} width={38} height={38} rx={4} fill="url(#plc-cap-red)" stroke="#5f0b0b" strokeWidth={0.8} />
        <rect x={19} y={23} width={34} height={9} rx={3} fill="url(#plc-sheen)" />
        <Part name="normal"><rect x={24} y={31} width={24} height={18} rx={1.5} fill="#f8fafc" stroke="#5f0b0b" strokeWidth={0.6} /><path d="M 28 41 h 16" stroke="#991b1b" strokeWidth={1.5} strokeLinecap="round" /></Part>
        <Part name="alarm">
          <Halo cx={cx} cy={41} r={34} colour={LAMP_COLOURS.red} />
          <rect x={24} y={33} width={24} height={18} rx={1.5} fill="#fecaca" stroke="#5f0b0b" strokeWidth={1.2} />
          <path d="M 27 35 l 18 14 M 45 35 l -18 14" stroke="#991b1b" strokeWidth={1.5} strokeLinecap="round" />
        </Part>
        <Caption x={cx} y={68} text={on ? "UTLÖST" : "normal"} tone={on ? "hot" : "muted"} />
      </g>;
    }
    case "varmekalla": {
      const pump = optionValue(def, device.options, "sort") === "varmepump";
      const on = state.drive > 0;
      if (pump) return <g>
        <Housing x={10} y={24} width={64} height={46} rx={3} tone="light" />
        <circle cx={32} cy={47} r={19} fill="#05090f" />
        <Part name="rotor"><Fan cx={32} cy={47} r={17} speed={0} blades={5} colour="#a9b6c6" /></Part>
        <g stroke="#8795a6" strokeWidth={0.7} strokeOpacity={0.7} fill="none"><circle cx={32} cy={47} r={10} /><circle cx={32} cy={47} r={16.5} /></g>
        {[34, 39, 44, 49, 54, 59, 64].map((y) => <line key={y} x1={56} x2={70} y1={y} y2={y} stroke="#475569" strokeWidth={1.4} strokeLinecap="round" />)}
        <Caption x={cx} y={80} text={`steg ${Math.round(state.drive * 2)}/2`} tone="ink" />
      </g>;
      return <g>
        <rect x={30} y={18} width={5} height={7} fill="url(#plc-metal-h)" /><rect x={49} y={18} width={5} height={7} fill="url(#plc-metal-h)" />
        <rect x={20} y={23} width={44} height={49} rx={4} fill="url(#plc-grey)" stroke="#596779" strokeWidth={0.8} />
        <rect x={22} y={24} width={40} height={9} rx={3} fill="url(#plc-sheen)" />
        <rect x={25} y={28} width={34} height={10} rx={1.5} fill="#121a26" />
        <Led x={31} y={33} on={false} colour={ON} />
        <Part name="led"><Led x={31} y={33} on colour={ON} /></Part>
        <rect x={37} y={31.5} width={18} height={3} rx={1} fill="#475569" />
        <rect x={33} y={43} width={18} height={23} rx={3} fill="#05090f" stroke={STEEL} strokeWidth={0.6} />
        <Part name="flame"><ellipse cx={42} cy={56} rx={8} ry={10} fill="url(#plc-flame)" /></Part>
        <Caption x={cx} y={80} text={on ? "till" : "från"} tone={on ? "on" : "muted"} />
      </g>;
    }
    case "frysvakt": {
      const tripped = state.tripped;
      const limit = Number(optionValue(def, device.options, "limitC"));
      const angle = ((-60 + ((limit - 3) / 5) * 120) * Math.PI) / 180;
      return <g>
        <Part name="frost"><Halo cx={28} cy={40} r={28} colour={LAMP_COLOURS.blue} /></Part>
        <Housing x={10} y={22} width={36} height={36} rx={3} tone="light" />
        <circle cx={28} cy={40} r={11} fill="url(#plc-dial)" stroke={STEEL} strokeWidth={0.6} />
        <line x1={28} y1={40} x2={28 + 8 * Math.sin(angle)} y2={40 - 8 * Math.cos(angle)} stroke="#2563eb" strokeWidth={1.8} strokeLinecap="round" />
        <circle cx={28} cy={40} r={1.8} fill="#111827" />
        <path d="M 46 48 q 3 -8 6 0 t 6 0 t 6 0" fill="none" stroke="url(#plc-copper)" strokeWidth={1.6} />
        <path d="M 58 32 v 12 M 52.8 35 l 10.4 6 M 52.8 41 l 10.4 -6" stroke="#7dd3fc" strokeWidth={1.2} strokeLinecap="round" />
        <Caption x={cx} y={68} text={`${tripped ? "LÖST · " : ""}${numberText(plant.vent.supplyC, 1)} °C`} tone={tripped ? "hot" : "ink"} />
      </g>;
    }
    case "kalla24": return <g>
      <rect x={8} y={5} width={68} height={50} rx={3} fill="url(#plc-metal-dark)" stroke={STEEL} strokeWidth={0.7} />
      <rect x={10} y={6} width={64} height={7} rx={2} fill="url(#plc-sheen)" />
      {[12, 18, 24, 30, 36, 42, 48, 54, 60, 66].map((x) => <line key={x} x1={x + 2} x2={x + 2} y1={8} y2={15} stroke="#05090f" strokeWidth={2} strokeLinecap="round" />)}
      <text x={cx} y={30} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK} pointerEvents="none">24 V DC</text>
      <Led x={21} y={43} on colour={ON} />
      <Led x={31} y={43} on colour={ON} />
      <Led x={41} y={43} on colour={ON} />
      <Caption x={60} y={46} text="DC OK" tone="on" size={7} />
    </g>;
    case "kallajust": return <g>
      <rect x={6} y={5} width={84} height={72} rx={4} fill="url(#plc-metal-dark)" stroke={STEEL} strokeWidth={0.7} />
      <MiniDisplay x={12} y={10} width={w - 24} height={19} size={11} text={voltsText(state.volts ?? (state.value / 100) * 30)} />
      <Knob cx={cx} cy={50} r={11} value={state.value} scale={["0", "30"]} part="pointer" />
    </g>;
    case "kalla010": return <g>
      <rect x={6} y={5} width={72} height={72} rx={4} fill="url(#plc-metal-dark)" stroke={STEEL} strokeWidth={0.7} />
      <MiniDisplay x={12} y={10} width={w - 24} height={19} size={11} tone="blue" text={voltsText(state.value / 10)} />
      <Knob cx={cx} cy={50} r={11} value={state.value} scale={["0", "10"]} part="pointer" />
    </g>;
    case "voltmeter": {
      // 2026-11-09: "Förbättra denna display". A panel meter 0–30 V: a scale with numbers from 0 at the left, a needle that the
      // animation turns with the measured volts (rotate −50° … +50° about the pivot), and the value in figures under it; 0,0 V with open leads.
      const volts = state.volts ?? 0;
      const px = cx, py = 66;
      const at = (share: number, r: number) => { const angle = ((-50 + 100 * share) * Math.PI) / 180; return { x: px + r * Math.sin(angle), y: py - r * Math.cos(angle) }; };
      return <g>
        <rect x={6} y={19} width={60} height={56} rx={3} fill="url(#plc-metal-dark)" stroke={STEEL} strokeWidth={0.7} />
        <rect x={9} y={22} width={54} height={50} rx={1.5} fill="#f8fafc" stroke="#94a3b8" strokeWidth={0.5} />
        {Array.from({ length: 16 }, (_, index) => { const share = index / 15, major = index % 5 === 0; const a = at(share, 37), b = at(share, major ? 31 : 34); return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={share > 0.8 ? HOT : "#111827"} strokeWidth={major ? 1.3 : 0.7} />; })}
        {[0, 10, 20, 30].map((mark) => { const p = at(mark / 30, 25.5); return <text key={mark} x={p.x} y={p.y + 2.6} textAnchor="middle" fontSize={7.5} fontWeight={700} fill="#111827" pointerEvents="none">{mark}</text>; })}
        <text x={cx} y={54} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="#475569" pointerEvents="none">V DC</text>
        <Part name="needle"><line x1={px} y1={py} x2={px} y2={py - 35} stroke={HOT} strokeWidth={1.4} strokeLinecap="round" /></Part>
        <circle cx={px} cy={py} r={3} fill="#111827" />
        <rect x={9} y={66} width={54} height={6} fill="#1b2430" />
        <Caption x={cx} y={83} text={`${numberText(Math.abs(volts), 1)} V`} tone="ink" size={9} testId="plc-meter-value" />
      </g>;
    }
    case "kalla420": return <g>
      <rect x={6} y={5} width={72} height={72} rx={4} fill="url(#plc-metal-dark)" stroke={STEEL} strokeWidth={0.7} />
      <MiniDisplay x={12} y={10} width={w - 24} height={19} size={11} tone="blue" text={`${numberText(voltsToMilliamps(state.outV ?? 0), 1)} mA`} />
      <Knob cx={cx} cy={50} r={11} value={state.value} scale={["4", "20"]} part="pointer" />
    </g>;
    case "signalsim": {
      // 2026-11-09: a handheld loop calibrator ("givartestare"): V or mA, a knob for the value, a large display with ÄV, BV under it.
      const current = signalKind(device.kind, device.options) === "current";
      const unit = current ? "mA" : "V";
      const actual = current ? voltsToMilliamps(state.outV ?? 0) : state.outV;
      return <g>
        <rect x={10} y={3} width={64} height={76} rx={9} fill="#f59e0b" stroke="#92400e" strokeWidth={0.8} />
        <rect x={14} y={7} width={56} height={68} rx={6} fill="url(#plc-metal-dark)" stroke="#05090f" strokeWidth={0.6} />
        <rect x={18} y={11} width={48} height={27} rx={2.5} fill="url(#plc-lcd)" stroke="#465669" strokeWidth={0.7} />
        <Part name="display"><text x={63} y={29} textAnchor="end" fontSize={13} fontWeight={700} fontFamily="ui-monospace, Consolas, monospace" fill="#86efac" data-testid="plc-signalsim-actual">{actual === null ? "–" : numberText(actual, 1)}</text></Part>
        <text x={21} y={19} fontSize={6} fontWeight={700} fill="#86efac" fontFamily="ui-sans-serif, system-ui, sans-serif">ÄV {unit}</text>
        <text x={63} y={35.5} textAnchor="end" fontSize={6} fill="#bbf7d0" fontFamily="ui-monospace, Consolas, monospace">BV {numberText(knobSignal(device.kind, device.options, state.value), 1)}</text>
        <Led x={24} y={45} on={!current} colour={ON} label="V" labelSize={7} />
        <Led x={46} y={45} on={current} colour={ON} label="mA" labelSize={7} />
        <Knob cx={cx} cy={61} r={8} value={state.value} part="pointer" />
      </g>;
    }
    default: return null;
  }
}

type Box = { x: number; y: number; width: number; height: number };
/** Where the real control lies over the drawing of a device one can flip, press or turn. */
const SWITCH_BOX: Partial<Record<DeviceKindId, Box>> = {
  vippa: { x: 10, y: 20, width: 52, height: 40 }, nodstopp: { x: 12, y: 24, width: 48, height: 48 }, valjare: { x: 16, y: 26, width: 40, height: 38 }, gransbrytare: { x: 14, y: 18, width: 44, height: 50 }, brandlarm: { x: 18, y: 22, width: 36, height: 38 },
};
const SLIDER_BOX: Partial<Record<DeviceKindId, Box>> = { vred: { x: 6, y: 68, width: 72, height: 16 }, kallajust: { x: 8, y: 66, width: 80, height: 12 }, kalla010: { x: 8, y: 66, width: 68, height: 12 }, kalla420: { x: 8, y: 66, width: 68, height: 12 }, signalsim: { x: 12, y: 80, width: 60, height: 10 } };

/** The control a person can press, flip or turn: a real HTML control over the drawing. */
function Controls({ device, state, onTouch }: { device: DeviceInst; state: DeviceState; onTouch: (change: DeviceTouch) => void }) {
  const def = DEVICE_DEFS[device.kind];
  const name = device.label || def.label;
  const stop = (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation();
  if (def.interaction === "momentary" && isLatching(def, device.options)) {
    // Låsande: a press holds it in, the next lets it out.
    const nc = optionValue(def, device.options, "nc") === "nc";
    const cx = def.width / 2, cy = 41;
    return <foreignObject x={cx - 18} y={cy - 18} width={36} height={36}>
      <button type="button" aria-pressed={state.pressed} aria-label={`${name} (${nc ? "NC" : "NO"}, latch): ${state.pressed ? "intryckt" : "ute"}`} data-testid="plc-device-button" data-device={device.id}
        onPointerDown={stop} onClick={() => onTouch({ pressed: !state.pressed })}
        className="size-9 rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-sky-400" />
    </foreignObject>;
  }
  if (def.interaction === "momentary") {
    const nc = optionValue(def, device.options, "nc") === "nc";
    const cx = def.width / 2, cy = 41;
    return <foreignObject x={cx - 18} y={cy - 18} width={36} height={36}>
      <button type="button" aria-pressed={state.pressed} aria-label={`${name} (${nc ? "NC" : "NO"})`} data-testid="plc-device-button" data-device={device.id}
        onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onTouch({ pressed: true }); }}
        onPointerUp={() => onTouch({ pressed: false })} onPointerCancel={() => onTouch({ pressed: false })} onLostPointerCapture={() => onTouch({ pressed: false })}
        onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); onTouch({ pressed: true }); } }}
        onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") onTouch({ pressed: false }); }}
        className="size-9 rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-sky-400" />
    </foreignObject>;
  }
  if (def.interaction === "toggle") {
    const box = SWITCH_BOX[device.kind] ?? { x: 10, y: 20, width: def.width - 20, height: def.height - 30 };
    const stateText = device.kind === "brandlarm" ? (state.on ? "utlöst" : "normalläge") : device.kind === "gransbrytare" ? (state.on ? "påverkad" : "fri") : state.on ? "till" : "från";
    return <foreignObject {...box}>
      <button type="button" role="switch" aria-checked={state.on} aria-label={`${name}: ${stateText}`} data-testid="plc-device-switch" data-device={device.id}
        onPointerDown={stop} onClick={() => onTouch({ on: !state.on })} className="size-full rounded-md bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-sky-400" />
    </foreignObject>;
  }
  if (def.interaction === "knob") {
    const box = SLIDER_BOX[device.kind] ?? { x: 6, y: def.height - 16, width: def.width - 12, height: 16 };
    return <foreignObject {...box}>
      <input type="range" min={0} max={100} step={1} value={state.value} aria-label={`${name}, ${device.kind === "kallajust" ? "0–30 V" : signalKind(device.kind, device.options) === "current" ? "4–20 mA" : "0–10 V"}`} data-testid="plc-device-knob" data-device={device.id} onPointerDown={stop} onChange={(event) => onTouch({ value: Number(event.target.value) })} className="h-3 w-full cursor-pointer accent-primary" />
    </foreignObject>;
  }
  return null;
}

export function DeviceDrawing({ device, state, plant, selected, highlighted = false, hotTerminal = null, onPointerDown, onTouch, onOption, design: designOverride }: {
  device: DeviceInst; state: DeviceState; plant: Plant; selected: boolean; highlighted?: boolean; hotTerminal?: string | null;
  onPointerDown: (event: ReactPointerEvent<SVGRectElement>) => void; onTouch: (change: DeviceTouch) => void;
  /** A setpoint changed on the value tag: the same option the properties panel sets. */
  onOption?: (key: string, value: string) => void;
  /** The editor's unsaved design; without it the published one. */
  design?: DeviceDesign | null;
}) {
  const design = designFor(device, designOverride);
  const def = designedDef(device, designOverride);
  const shift = pictureShift(device, designOverride);
  return <g transform={`translate(${device.x} ${device.y})`} data-testid="plc-device" data-device={device.id} data-kind={device.kind} data-energised={state.energised}>
    {highlighted ? <rect x={-4} y={-4} width={def.width + 8} height={def.height + 8} rx={10} fill={WARN} fillOpacity={0.12} stroke={WARN} strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" /> : null}
    <Plate width={def.width} height={def.height} selected={selected} onPointerDown={onPointerDown} />
    <PictureLayer device={device} design={design} state={state} plant={plant} width={def.width} height={def.height} shift={shift} />
    <g transform={shift}><Controls device={device} state={state} onTouch={onTouch} /></g>
    <NameTag {...labelPlace(def)} text={device.label || def.label} />
    <ReadoutTag device={device} design={design} state={state} plant={plant} onOption={onOption} />
    <g transform={`translate(${-device.x} ${-device.y})`}><Terminals device={device} hot={hotTerminal} design={designOverride} /></g>
  </g>;
}

const THUMB_PLANT: Plant = { tank: 40, ovenC: 20, vent: createVentilationState(21), heat: createHeatingState(21), outdoorC: 5, doorOpen: false };

/** The palette's small picture of a device kind: the same drawing, still, without name, controls or terminal texts. */
export function DeviceThumb({ kind, options = {}, design: designOverride, className }: { kind: DeviceKindId; options?: Record<string, string>; design?: DeviceDesign | null; className?: string }) {
  const device: DeviceInst = { id: "thumb", kind, x: 0, y: 0, label: "", options };
  const design = designFor(device, designOverride);
  const def = designedDef(device, designOverride);
  const shift = pictureShift(device, designOverride);
  // A picture in the palette is the device itself: never "ingen matning" in red.
  const state = { ...createDeviceState(), outV: 5, energised: kind === "lampa" || kind === "knapp_lampa", on: false, volts: kind === "kallajust" ? 24 : null, value: kind === "kallajust" ? 80 : 50 };
  const pad = 6;
  return <svg viewBox={`${-pad} ${-pad} ${def.width + pad * 2} ${def.height + pad * 2}`} className={className ?? cn("h-11", def.width > 80 ? "w-14" : "w-12")} aria-hidden="true" focusable="false">
    <Plate width={def.width} height={def.height} />
    <PictureLayer device={device} design={design} state={state} plant={THUMB_PLANT} width={def.width} height={def.height} shift={shift} />
    {def.terminals.map((terminal) => { const point = deviceTerminalPoint(device, terminal.id, designOverride)!; return <g key={terminal.id} pointerEvents="none"><rect x={point.x - 3.5} y={point.y - 3.5} width={7} height={7} rx={1} fill="url(#plc-brass)" stroke="#0a111c" strokeWidth={1} /><circle cx={point.x} cy={point.y} r={2} fill="url(#plc-metal)" /></g>; })}
  </svg>;
}

/** The function's own drawing stands in the middle of a plate that grew with its terminals (PLC-apparater v2). */
function pictureShift(device: DeviceInst, design?: DeviceDesign | null): string | undefined {
  const offset = pictureOffset(device, design);
  return offset ? `translate(${offset} 0)` : undefined;
}

/**
 * The simulator's own picture of a function, alone on its base plate's size and without plate or terminals: what "Ladda ner
 * bilden" saves as an SVG, so the standard picture can be changed elsewhere and put back as the device's own picture.
 */
export function StandardPicture({ kind, options = {} }: { kind: DeviceKindId; options?: Record<string, string> }) {
  const device: DeviceInst = { id: "picture", kind, x: 0, y: 0, label: "", options };
  const state = { ...createDeviceState(), outV: 5, volts: kind === "kallajust" ? 24 : null, value: kind === "kallajust" ? 80 : 50 };
  return <Symbol device={device} state={state} plant={THUMB_PLANT} />;
}

/**
 * The picture layer over the plate (PLC-apparater, 2026-11-07): the function's own drawing at rest – in a viewport of its own size, so
 * an animation's turning points are in the drawing's coordinates – or the design's own picture, moved by the device's animation spec.
 */
function PictureLayer({ device, design, state, plant, width, height, shift }: { device: DeviceInst; design: DeviceDesign | null; state: DeviceState; plant: Plant; width: number; height: number; shift: string | undefined }) {
  const scope = useAnimationScope();
  const base = DEVICE_DEFS[device.kind];
  const colour = photoColourFilter(device, design);
  return <g className={scope} pointerEvents="none" data-testid="plc-device-picture-layer">
    <AnimationStyle scope={scope} spec={animationFor(device.kind, design)} state={state} />
    {colour ? <style>{`.${scope} [data-part="cap"] image, .${scope} [data-part="lens"] image, .${scope} [data-part="light"] { filter: ${colour}; }`}</style> : null}
    <Part name="bild">
      {design?.image ? <DesignPicture design={design} width={width} height={height} state={state} plant={plant} />
        : <g transform={shift}><svg x={0} y={0} width={base.width} height={base.height} viewBox={`0 0 ${base.width} ${base.height}`} overflow="visible"><Symbol device={device} state={state} plant={plant} /></svg></g>}
    </Part>
  </g>;
}

/**
 * The value tag beside the plate (2026-11-07: "sätt värdet som en etikett utanför"): a small dark box with the device's values
 * in larger tabular digits, on a side without terminals; a setpoint is a choice in the tag itself. Its size is fixed by the widest
 * value, so it never jumps while the value changes.
 */
function ReadoutTag({ device, design, state, plant, onOption }: { device: DeviceInst; design: DeviceDesign | null; state: DeviceState; plant: Plant; onOption?: (key: string, value: string) => void }) {
  const def = designedDef(device, design);
  const readout = readoutFor(device.kind, design);
  const frame = readoutFrame(readout, def, labelPlace(def).y > def.height);
  if (!frame) return null;
  const lines = readoutLines(device.kind, readout.values, state, plant, device.options);
  const name = device.label || def.label;
  return <g data-testid="plc-device-readout" data-device={device.id}>
    <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} rx={3} fill="#05090f" stroke="#64748b" strokeWidth={0.8} pointerEvents="none" />
    {lines.map((line, index) => {
      const y = frame.y + 2 + index * READOUT_LINE;
      if (line.setpoint && onOption) {
        const setpoint = line.setpoint;
        return <foreignObject key={line.value} x={frame.x + 1} y={y} width={frame.width - 2} height={READOUT_LINE}>
          <select aria-label={`Börvärde, ${name}`} value={setpoint.current} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => onOption(setpoint.key, event.target.value)} data-testid="plc-device-setpoint" data-device={device.id}
            className="block h-full w-full cursor-pointer appearance-none bg-transparent px-1 text-center font-mono text-[11px] font-bold leading-none text-amber-300 outline-none focus-visible:ring-1 focus-visible:ring-sky-400">
            {setpoint.choices.map((choice) => <option key={choice.value} value={choice.value} className="bg-slate-900 text-white">BV {choice.label}</option>)}
          </select>
        </foreignObject>;
      }
      return <text key={line.value} x={frame.x + frame.width / 2} y={y + 11} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={line.setpoint ? "#fcd34d" : "#e2e8f0"} style={{ fontVariantNumeric: "tabular-nums" }} pointerEvents="none" data-value={line.value}>{line.text}</text>;
    })}
  </g>;
}

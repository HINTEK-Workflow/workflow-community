"use client";

import type { ReactNode } from "react";
import type { TerminalRole } from "@/lib/machine/simulator/surface/devices";
import { nameLines } from "@/lib/machine/simulator/surface/geometry";
import { cn } from "@/lib/utils";

// PLC-simulatorn (the owner 2026-11-04: "mer visuella i ritverktyget"): the SVG parts every device and the PLC are drawn from, on
// the dark drawing surface: glossy shaded caps and lenses that glow, chrome rings, moulded housings, blue motors, copper and
// brass. Own hand-written graphics, one family, no maker's shapes or logos, nothing traced.
//
// The style is one definition: LOOK holds the colours and sizes, SurfaceDefs the gradients built from them, once per sheet. No SVG
// filters at all: a glow is a circle or ellipse filled with a radial gradient that fades out, which costs nothing per device and
// stays sharp at every zoom, so a sheet with 60 devices and 150 wires stays smooth. To restyle everything, change LOOK.

export const LOOK = {
  ink: "#e6edf6", muted: "#94a6bd", line: "#2b3d57", plateTop: "#1c2b42", plateBottom: "#131f33", plateRim: "#33475f",
  sheet: "#0d1626", selected: "#60a5fa",
  steelDark: "#1a222e", steel: "#64748b", steelLight: "#cbd5e1", chromeTop: "#f8fafc", chromeBottom: "#71808f",
  housingTop: "#3d4957", housingBottom: "#1b2430", greyTop: "#d7dee6", greyBottom: "#8d99a8",
  blueTop: "#3b82f6", blueBottom: "#0b3a94", copperTop: "#f0b070", copperBottom: "#8a4a1d", brassTop: "#f3d675", brassBottom: "#a9791c",
  water: "#3b9cf6", hot: "#ef4444", heat: "#fb923c", on: "#22c55e", warn: "#f59e0b",
  lampOff: 0.54, strokeThin: 0.6, strokeNormal: 1,
} as const;

export const INK = LOOK.ink;
export const MUTED = LOOK.muted;
export const PRIMARY = LOOK.selected;
export const ON = LOOK.on;
export const ERR = LOOK.hot;
export const HOT = LOOK.hot;
export const WARN = LOOK.warn;
export const SUPPLY_RED = "#dc2626";
export const WATER = LOOK.water;
export const DARK = LOOK.steelDark;
export const STEEL = LOOK.steel;
export const LAMP_COLOURS: Record<string, string> = { green: "#22c55e", red: "#ef4444", yellow: "#fbbf24", blue: "#3b82f6", white: "#f1f5f9" };
export const BUTTON_COLOURS: Record<string, string> = { ...LAMP_COLOURS, black: "#334155" };
/** The shades behind a colour, and the name its gradients go by: a lens or a cap needs no gradient of its own per device. */
const SHADES = [
  { base: "#22c55e", light: "#bbf7d0", dark: "#0a6b30", name: "green" }, { base: "#ef4444", light: "#fecaca", dark: "#8c1212", name: "red" }, { base: "#fbbf24", light: "#fef3c7", dark: "#a86a05", name: "yellow" },
  { base: "#3b82f6", light: "#bfdbfe", dark: "#0f3d9e", name: "blue" }, { base: "#f1f5f9", light: "#ffffff", dark: "#8d99a8", name: "white" }, { base: "#334155", light: "#94a3b8", dark: "#0f172a", name: "black" },
] as const;
const shadeOf = (colour: string) => SHADES.find((shade) => shade.base === colour) ?? SHADES[0];

const stops = (...pairs: [number, string, number?][]) => pairs.map(([offset, colour, opacity]) => <stop key={offset} offset={offset} stopColor={colour} stopOpacity={opacity ?? 1} />);

/** Once per sheet: every gradient the parts refer to by id. */
export function SurfaceDefs() {
  return <defs>
    <linearGradient id="plc-metal" x1="0" y1="0" x2="0" y2="1">{stops([0, LOOK.chromeTop], [0.45, LOOK.steelLight], [1, LOOK.chromeBottom])}</linearGradient>
    <linearGradient id="plc-metal-h" x1="0" y1="0" x2="1" y2="0">{stops([0, LOOK.chromeBottom], [0.45, LOOK.chromeTop], [1, LOOK.chromeBottom])}</linearGradient>
    <linearGradient id="plc-metal-dark" x1="0" y1="0" x2="0" y2="1">{stops([0, LOOK.housingTop], [1, LOOK.housingBottom])}</linearGradient>
    <linearGradient id="plc-grey" x1="0" y1="0" x2="0" y2="1">{stops([0, LOOK.greyTop], [1, LOOK.greyBottom])}</linearGradient>
    <linearGradient id="plc-plate" x1="0" y1="0" x2="0" y2="1">{stops([0, LOOK.plateTop], [1, LOOK.plateBottom])}</linearGradient>
    <linearGradient id="plc-blue" x1="0" y1="0" x2="0" y2="1">{stops([0, "#60a5fa"], [0.35, LOOK.blueTop], [1, LOOK.blueBottom])}</linearGradient>
    <linearGradient id="plc-copper" x1="0" y1="0" x2="0" y2="1">{stops([0, LOOK.copperTop], [0.5, "#b8672b"], [1, LOOK.copperBottom])}</linearGradient>
    <linearGradient id="plc-brass" x1="0" y1="0" x2="0" y2="1">{stops([0, LOOK.brassTop], [0.55, "#d0a233"], [1, LOOK.brassBottom])}</linearGradient>
    <linearGradient id="plc-glass" x1="0" y1="0" x2="1" y2="1">{stops([0, "#ffffff", 0.32], [0.5, "#bfdbfe", 0.12], [1, "#93c5fd", 0.18])}</linearGradient>
    <linearGradient id="plc-water" x1="0" y1="0" x2="0" y2="1">{stops([0, "#7cc0ff"], [1, "#1d6fe0"])}</linearGradient>
    <linearGradient id="plc-sheen" x1="0" y1="0" x2="0" y2="1">{stops([0, "#ffffff", 0.42], [0.5, "#ffffff", 0.06], [1, "#ffffff", 0])}</linearGradient>
    <linearGradient id="plc-lcd" x1="0" y1="0" x2="0" y2="1">{stops([0, "#0b2a1a"], [1, "#041a10"])}</linearGradient>
    <linearGradient id="plc-lcd-blue" x1="0" y1="0" x2="0" y2="1">{stops([0, "#0b2342"], [1, "#061428"])}</linearGradient>
    <radialGradient id="plc-knob" cx="0.4" cy="0.32" r="0.8">{stops([0, "#64748b"], [0.55, "#222c3a"], [1, "#05090f"])}</radialGradient>
    <radialGradient id="plc-dial" cx="0.5" cy="0.4" r="0.7">{stops([0, "#ffffff"], [0.8, "#eef2f6"], [1, "#b9c4d0"])}</radialGradient>
    <radialGradient id="plc-flame" cx="0.5" cy="0.7" r="0.7">{stops([0, "#fff3c4"], [0.45, "#fb923c"], [1, "#ef4444", 0])}</radialGradient>
    {SHADES.flatMap((shade) => [
      <radialGradient key={`cap-${shade.name}`} id={`plc-cap-${shade.name}`} cx="0.38" cy="0.3" r="0.85">{stops([0, shade.light], [0.42, shade.base], [1, shade.dark])}</radialGradient>,
      <radialGradient key={`on-${shade.name}`} id={`plc-lit-${shade.name}`} cx="0.5" cy="0.45" r="0.6">{stops([0, "#ffffff"], [0.34, shade.light], [0.72, shade.base], [1, shade.dark])}</radialGradient>,
      <radialGradient key={`halo-${shade.name}`} id={`plc-halo-${shade.name}`} cx="0.5" cy="0.5" r="0.5">{stops([0, shade.base, 0.7], [0.55, shade.base, 0.22], [1, shade.dark, 0])}</radialGradient>,
    ])}
    <radialGradient id="plc-halo-heat" cx="0.5" cy="0.5" r="0.5">{stops([0, LOOK.heat, 0.65], [1, LOOK.hot, 0])}</radialGradient>
    {/* The pictures' own materials (pictures.tsx, 2026-11-06): polished chrome, glossy black plastic, yellow and red moulding, aluminium, a soft shadow. */}
    <linearGradient id="plc-chrome-ring" x1="0" y1="0" x2="1" y2="1">{stops([0, "#ffffff"], [0.28, "#d3dbe4"], [0.52, "#5f6b79"], [0.78, "#eef2f6"], [1, "#7f8b99"])}</linearGradient>
    <radialGradient id="plc-black-gloss" cx="0.36" cy="0.28" r="0.85">{stops([0, "#6b7684"], [0.35, "#262e3a"], [1, "#04070b"])}</radialGradient>
    <linearGradient id="plc-black-body" x1="0" y1="0" x2="0" y2="1">{stops([0, "#3a4350"], [0.18, "#1d242e"], [1, "#07090d"])}</linearGradient>
    <radialGradient id="plc-yellow-ring" cx="0.4" cy="0.3" r="0.85">{stops([0, "#fff6b0"], [0.45, "#facc15"], [1, "#a16207"])}</radialGradient>
    <radialGradient id="plc-mushroom" cx="0.38" cy="0.28" r="0.8">{stops([0, "#ffc4c4"], [0.35, "#f23030"], [0.8, "#a50f0f"], [1, "#5c0606"])}</radialGradient>
    <linearGradient id="plc-alu" x1="0" y1="0" x2="0" y2="1">{stops([0, "#f6f8fa"], [0.4, "#cfd6de"], [0.7, "#a3adb9"], [1, "#7c8794"])}</linearGradient>
    <linearGradient id="plc-thread" x1="0" y1="0" x2="0" y2="1">{stops([0, "#e9edf1"], [0.35, "#b9c2cc"], [0.65, "#7d8896"], [1, "#4d5764"])}</linearGradient>
    <linearGradient id="plc-grey-body" x1="0" y1="0" x2="1" y2="1">{stops([0, "#f3f5f7"], [0.6, "#c9d0d8"], [1, "#9aa5b1"])}</linearGradient>
    <linearGradient id="plc-glass-box" x1="0" y1="0" x2="1" y2="1">{stops([0, "#ffffff", 0.34], [0.45, "#dbeafe", 0.1], [1, "#93c5fd", 0.22])}</linearGradient>
    <radialGradient id="plc-shadow" cx="0.5" cy="0.5" r="0.5">{stops([0, "#000000", 0.55], [1, "#000000", 0])}</radialGradient>
    {/* A pressed cap sunk into its ring (2026-11-09): dark at the edge, the middle still lit. */}
    <radialGradient id="plc-sunk" cx="0.5" cy="0.42" r="0.6">{stops([0, "#000000", 0], [0.6, "#000000", 0.18], [1, "#000000", 0.6])}</radialGradient>
    <linearGradient id="plc-coil" x1="0" y1="0" x2="1" y2="0">{stops([0, "#7a3b12"], [0.3, "#e08a3a"], [0.55, "#f6b46b"], [1, "#8a4a1d"])}</linearGradient>
  </defs>;
}

/** A device's base: a dark tile on the dark sheet, so the component stands out as in a display case. Selected: a light ring. */
export function Plate({ width, height, selected, children, onPointerDown, rx = 6 }: { width: number; height: number; selected?: boolean; children?: ReactNode; onPointerDown?: (event: React.PointerEvent<SVGRectElement>) => void; rx?: number }) {
  return <g>
    <rect x={0} y={0} width={width} height={height} rx={rx} fill="url(#plc-plate)" stroke={selected ? LOOK.selected : LOOK.plateRim} strokeWidth={selected ? 2 : LOOK.strokeNormal} className={onPointerDown ? "cursor-move" : undefined} onPointerDown={onPointerDown} />
    {children}
  </g>;
}

/** Soft light around something lit: a gradient instead of a filter. */
export function Halo({ cx, cy, r, colour, ry, pulse }: { cx: number; cy: number; r: number; ry?: number; colour: string; pulse?: boolean }) {
  return <ellipse cx={cx} cy={cy} rx={r} ry={ry ?? r} fill={`url(#plc-halo-${shadeOf(colour).name})`} pointerEvents="none" className={cn(pulse && "motion-safe:animate-pulse")} />;
}

/** A round chrome ring, as around a pushbutton, a lamp or a meter. */
export function Bezel({ cx, cy, r, width = 3 }: { cx: number; cy: number; r: number; width?: number }) {
  return <g pointerEvents="none">
    <circle cx={cx} cy={cy} r={r + width / 2} fill={LOOK.steelDark} />
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#plc-metal)" strokeWidth={width} />
  </g>;
}

/**
 * A glossy button cap in a colour. Pressed: it sits lower, a touch smaller, with less light on it. `lit` is for an illuminated
 * cap: true glows, false shows the colour dimmed, null is an ordinary cap.
 */
export function Cap({ cx, cy, r, colour, pressed = false, lit = null }: { cx: number; cy: number; r: number; colour: string; pressed?: boolean; lit?: boolean | null }) {
  const dy = pressed ? 1.4 : 0;
  const rr = pressed ? r - 0.9 : r;
  const shade = shadeOf(colour);
  return <g pointerEvents="none">
    {lit ? <Halo cx={cx} cy={cy} r={r * 2.1} colour={colour} /> : null}
    <circle cx={cx} cy={cy + dy} r={rr} fill={`url(#${lit ? "plc-lit" : "plc-cap"}-${shade.name})`} opacity={lit === false ? 0.6 : 1} />
    <ellipse cx={cx - rr * 0.2} cy={cy + dy - rr * 0.48} rx={rr * 0.55} ry={rr * 0.3} fill="url(#plc-sheen)" opacity={pressed ? 0.5 : 1} />
  </g>;
}

/** A domed lamp lens: lit it glows with a white core and a halo; dark, the colour only shows. */
export function Lens({ cx, cy, r, colour, lit }: { cx: number; cy: number; r: number; colour: string; lit: boolean }) {
  const shade = shadeOf(colour);
  return <g pointerEvents="none" data-lit={lit}>
    {lit ? <Halo cx={cx} cy={cy} r={r * 2.3} colour={colour} /> : null}
    <circle cx={cx} cy={cy} r={r} fill={`url(#${lit ? "plc-lit" : "plc-cap"}-${shade.name})`} opacity={lit ? 1 : LOOK.lampOff} />
    <ellipse cx={cx - r * 0.2} cy={cy - r * 0.5} rx={r * 0.52} ry={r * 0.28} fill="url(#plc-sheen)" />
  </g>;
}

/** Where a pointer at `value` (0–100) over −135°…+135° points, `r` from the centre. */
export const dialPoint = (value: number, cx: number, cy: number, r: number) => { const angle = ((-135 + 270 * (value / 100)) * Math.PI) / 180; return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) }; };

/** A rotary knob on a scale of light ticks: a black glossy cap with a white pointer and, when given, the words at the two ends. */
/** With `part`, the pointer is drawn straight up as a named part, for the animation to turn (2026-11-07). */
export function Knob({ cx, cy, r, value, scale, part }: { cx: number; cy: number; r: number; value: number; scale?: [string, string]; part?: string }) {
  const at = part ? 50 : value;
  const tip = dialPoint(at, cx, cy, r - 2), root = dialPoint(at, cx, cy, r * 0.35);
  const ticks = [0, 20, 40, 60, 80, 100];
  return <g pointerEvents="none">
    {ticks.map((tick) => { const a = dialPoint(tick, cx, cy, r + 3), b = dialPoint(tick, cx, cy, r + 6); return <line key={tick} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={LOOK.ink} strokeWidth={1.1} strokeLinecap="round" />; })}
    {scale ? <><text x={dialPoint(0, cx, cy, r + 8).x - 2} y={dialPoint(0, cx, cy, r + 8).y + 6} textAnchor="middle" fontSize={7} fill={LOOK.muted}>{scale[0]}</text><text x={dialPoint(100, cx, cy, r + 8).x + 2} y={dialPoint(100, cx, cy, r + 8).y + 6} textAnchor="middle" fontSize={7} fill={LOOK.muted}>{scale[1]}</text></> : null}
    <circle cx={cx} cy={cy} r={r + 1.4} fill="url(#plc-metal)" />
    <circle cx={cx} cy={cy} r={r} fill="url(#plc-knob)" />
    {part ? <g data-part={part}><line x1={root.x} y1={root.y} x2={tip.x} y2={tip.y} stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" /></g> : <line x1={root.x} y1={root.y} x2={tip.x} y2={tip.y} stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" />}
  </g>;
}

/** A selector: a black knob with a wing handle and a white mark, in a square moulded housing, turned `angle` degrees from straight up. */
export function SelectorKnob({ cx, cy, r, angle }: { cx: number; cy: number; r: number; angle: number }) {
  return <g pointerEvents="none">
    <rect x={cx - r - 5} y={cy - r - 5} width={2 * r + 10} height={2 * r + 10} rx={3.5} fill="url(#plc-metal-dark)" stroke={LOOK.steel} strokeWidth={0.7} />
    <circle cx={cx} cy={cy} r={r + 1.5} fill="url(#plc-metal)" />
    <circle cx={cx} cy={cy} r={r} fill="url(#plc-knob)" />
    <g style={{ transformBox: "fill-box", transformOrigin: "center", transform: `rotate(${angle}deg)`, transition: "transform 0.15s linear" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="none" />
      <rect x={cx - 3.2} y={cy - r + 0.8} width={6.4} height={2 * r - 1.6} rx={3.2} fill="#05090f" stroke={LOOK.steel} strokeWidth={0.5} />
      <rect x={cx - 1.1} y={cy - r + 2.2} width={2.2} height={r * 0.72} rx={1.1} fill="#ffffff" />
    </g>
  </g>;
}

/** A box housing: light (painted metal), dark (moulded plastic) or glass (a clear cover one can see into). */
export function Housing({ x, y, width, height, rx = 3, tone = "light", children }: { x: number; y: number; width: number; height: number; rx?: number; tone?: "light" | "dark" | "glass"; children?: ReactNode }) {
  const fill = tone === "light" ? "url(#plc-grey)" : tone === "dark" ? "url(#plc-metal-dark)" : "url(#plc-glass)";
  return <g pointerEvents="none">
    <rect x={x} y={y} width={width} height={height} rx={rx} fill={fill} stroke={tone === "light" ? "#596779" : tone === "dark" ? "#05090f" : "#cbd5e1"} strokeWidth={0.8} />
    <rect x={x + 1} y={y + 1} width={width - 2} height={Math.min(height * 0.3, 8)} rx={Math.max(0, rx - 1)} fill="url(#plc-sheen)" />
    {children}
  </g>;
}

/** Fan blades on a hub, turning with `speed` (0–1): still at 0, faster as it rises. Drawn around (cx, cy), radius r. */
export function Fan({ cx, cy, r, speed, blades = 5, colour = "#aab7c6", hub = true }: { cx: number; cy: number; r: number; speed: number; blades?: number; colour?: string; hub?: boolean }) {
  const spinning = speed > 0.02;
  const blade = (index: number) => {
    const a = (index / blades) * 2 * Math.PI;
    const b = a + (0.9 * 2 * Math.PI) / blades;
    const p = (angle: number, radius: number) => `${cx + radius * Math.sin(angle)} ${cy - radius * Math.cos(angle)}`;
    return `M ${p(a, r * 0.25)} Q ${p(a + 0.25, r * 0.75)} ${p(b, r * 0.95)} Q ${p((a + b) / 2 + 0.1, r * 0.6)} ${p(a, r * 0.25)} Z`;
  };
  return <g pointerEvents="none">
    <g className={cn(spinning && "motion-safe:animate-spin")} style={{ transformBox: "fill-box", transformOrigin: "center", animationDuration: `${0.9 / Math.max(0.08, speed)}s` }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="none" />
      {Array.from({ length: blades }, (_, index) => <path key={index} d={blade(index)} fill={colour} stroke="#05090f" strokeOpacity={0.4} strokeWidth={0.5} />)}
    </g>
    {hub ? <circle cx={cx} cy={cy} r={r * 0.24} fill="url(#plc-metal)" stroke={LOOK.steel} strokeWidth={0.5} /> : null}
  </g>;
}

/** A horizontal steel pipe between x1 and x2 at y, with flanges when asked. */
export function Pipe({ x1, x2, y, width = 8, flanges = false }: { x1: number; x2: number; y: number; width?: number; flanges?: boolean }) {
  return <g pointerEvents="none">
    <rect x={x1} y={y - width / 2} width={x2 - x1} height={width} rx={1} fill="url(#plc-metal)" stroke={LOOK.steel} strokeWidth={0.6} />
    {flanges ? <>
      <rect x={x1} y={y - width / 2 - 3} width={4.5} height={width + 6} rx={1} fill="url(#plc-metal-h)" stroke={LOOK.steel} strokeWidth={0.6} />
      <rect x={x2 - 4.5} y={y - width / 2 - 3} width={4.5} height={width + 6} rx={1} fill="url(#plc-metal-h)" stroke={LOOK.steel} strokeWidth={0.6} />
    </> : null}
  </g>;
}

/** A small status LED with its word beside it, so colour is never the only sign. */
export function Led({ x, y, on, colour, label, labelSize = 8.5, testId, data }: { x: number; y: number; on: boolean; colour: string; label?: string; labelSize?: number; testId?: string; data?: Record<string, string | boolean> }) {
  const extra = Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, String(value)]));
  const name = shadeOf(colour).name;
  return <g data-testid={testId} data-on={on} {...extra}>
    {on ? <circle cx={x} cy={y} r={8} fill={`url(#plc-halo-${name})`} pointerEvents="none" /> : null}
    <circle cx={x} cy={y} r={3} fill={on ? `url(#plc-lit-${name})` : "#0a111c"} stroke={on ? colour : "#465669"} strokeWidth={0.8} />
    {label ? <text x={x + 7} y={y + labelSize * 0.38} fontSize={labelSize} fontWeight={600} fill={LOOK.ink}>{label}</text> : null}
  </g>;
}

const ROLE_LABEL: Record<TerminalRole, string> = { supply: "#fca5a5", ground: "#e2e8f0", analog: "#7dd3fc", wire: "#cbd5e1" };
const ROLE_STROKE: Record<TerminalRole, string> = { supply: "#ef4444", ground: "#e2e8f0", analog: "#38bdf8", wire: "#7b8a9c" };

/** A terminal: a brass screw in a dark socket with its designation in light text; the circle over it is what the pointer takes. */
export function ScrewTerminal({ x, y, id, title, role = "wire", label, labelBelow = true, hot = false, lit = null }: { x: number; y: number; id: string; title: string; role?: TerminalRole; label?: string; labelBelow?: boolean; hot?: boolean; lit?: boolean | null }) {
  return <g>
    <rect x={x - 5} y={y - 5} width={10} height={10} rx={1.5} fill="#0a111c" stroke={hot ? LOOK.selected : ROLE_STROKE[role]} strokeWidth={hot ? 2 : 1.1} pointerEvents="none" />
    <circle cx={x} cy={y} r={3} fill="url(#plc-brass)" stroke="#5c430d" strokeWidth={0.5} pointerEvents="none" />
    <path d={`M ${x - 2} ${y - 1.2} L ${x + 2} ${y + 1.2}`} stroke="#3f2d07" strokeWidth={0.8} pointerEvents="none" />
    {lit !== null ? <circle cx={x} cy={y} r={7.5} fill="none" stroke={lit ? ON : "none"} strokeWidth={1.5} opacity={0.8} pointerEvents="none" /> : null}
    {hot ? <circle cx={x} cy={y} r={9} fill="none" stroke={LOOK.selected} strokeWidth={1.5} strokeDasharray="2 2" pointerEvents="none" /> : null}
    <circle cx={x} cy={y} r={8} fill="transparent" data-terminal={id} className="cursor-crosshair" style={{ pointerEvents: "all" }}><title>{title}</title></circle>
    {label ? <text x={x} y={labelBelow ? y + 15 : y - 9} textAnchor="middle" fontSize={7.5} fontWeight={role === "wire" ? 500 : 700} fill={ROLE_LABEL[role]} pointerEvents="none">{label}</text> : null}
  </g>;
}

/** A device's name. */
export function NameTag({ x, y, text, anchor = "middle" }: { x: number; y: number; text: string; anchor?: "middle" | "end" }) {
  const lines = nameLines(text, anchor);
  return <text x={x} y={y - (lines.length - 1) * 6} textAnchor={anchor} fontSize={10} fontWeight={600} fill={LOOK.ink} pointerEvents="none" data-testid="plc-device-name">
    {lines.length === 1 ? text : lines.map((line, index) => <tspan key={index} x={x} dy={index ? 12 : 0}>{line}</tspan>)}
  </text>;
}

/** A small lit display, green or blue on black, as on a compact instrument. */
export function MiniDisplay({ x, y, width, height, text, tone = "normal", size = 9.5, testId }: { x: number; y: number; width: number; height: number; text: string; tone?: "normal" | "error" | "ok" | "blue"; size?: number; testId?: string }) {
  const colour = tone === "error" ? "#fca5a5" : tone === "blue" ? "#7dd3fc" : "#86efac";
  return <g>
    <rect x={x} y={y} width={width} height={height} rx={2.5} fill={tone === "blue" ? "url(#plc-lcd-blue)" : "url(#plc-lcd)"} stroke="#465669" strokeWidth={0.7} />
    <text x={x + width / 2} y={y + height / 2 + size * 0.36} textAnchor="middle" fontSize={size} fontWeight={600} fontFamily="ui-monospace, Consolas, monospace" fill={colour} pointerEvents="none" data-testid={testId}>{text}</text>
  </g>;
}

/** A short line of text inside a device. */
export function Caption({ x, y, text, tone = "muted", size = 8, testId }: { x: number; y: number; text: string; tone?: "muted" | "ink" | "hot" | "on"; size?: number; testId?: string }) {
  const fill = tone === "muted" ? LOOK.muted : tone === "ink" ? LOOK.ink : tone === "hot" ? "#fca5a5" : "#86efac";
  return <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight={tone === "muted" ? 500 : 600} fill={fill} pointerEvents="none" data-testid={testId}>{text}</text>;
}

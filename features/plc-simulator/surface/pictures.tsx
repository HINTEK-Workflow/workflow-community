"use client";

import { Part } from "./animated";
import { Cap, Fan, Halo, Lens, ON } from "./parts";

// PLC-simulatorn (the owner 2026-11-06, with his pictures as the aim: "inte tekniska symboler utan mer som en bild av vad det är"):
// the industrial devices as large, glossy pictures of the component itself that fill their tile – a chrome-ringed pushbutton,
// a black selector, a roller limit switch, a lamp, a buzzer, a relay in its clear cover, a contactor with auxiliary contacts, a
// solenoid valve and a motor. Own hand-drawn SVG on the shared gradients of SurfaceDefs (no gradient, filter or image here), no maker's shape or
// logo. Since 2026-11-07 every picture is drawn at rest with its moving and lit parts named (Part); the device's animation spec
// (lib/machine/simulator/surface/animation.ts) presses, pulls in, lights and turns them.

const shadow = (cx: number, cy: number, rx: number, ry: number) => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#plc-shadow)" />;
const screw = (x: number, y: number, r = 1.7) => <g><circle cx={x} cy={y} r={r} fill="url(#plc-metal)" stroke="#3b4553" strokeWidth={0.4} /><line x1={x - r * 0.7} y1={y} x2={x + r * 0.7} y2={y} stroke="#3b4553" strokeWidth={0.5} /></g>;

/** A polished chrome ring with a dark gap inside, as round a pushbutton, a lamp or a selector. */
export function ChromeRing({ cx, cy, r, width = 4.5 }: { cx: number; cy: number; r: number; width?: number }) {
  return <g>
    {shadow(cx, cy + 3, r + width + 3, r + width + 1)}
    <circle cx={cx} cy={cy} r={r + width / 2 + 0.6} fill="#05080d" />
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#plc-chrome-ring)" strokeWidth={width} />
    <circle cx={cx} cy={cy} r={r - width / 2 - 0.2} fill="#06090e" />
    <path d={`M ${cx - r * 0.7} ${cy - r * 0.7} A ${r} ${r} 0 0 1 ${cx + r * 0.2} ${cy - r * 0.98}`} fill="none" stroke="#ffffff" strokeOpacity={0.75} strokeWidth={width * 0.35} strokeLinecap="round" />
  </g>;
}

/** A pushbutton as on a panel: chrome ring, glossy domed cap, pressed it sinks; an illuminated cap glows. */
/** A pushbutton as on a panel: chrome ring and glossy domed cap (part "cap"); an illuminated cap also has its lit look (part "light"). */
export function PushButtonPicture({ cx, cy, colour, lit }: { cx: number; cy: number; colour: string; lit: boolean }) {
  return <g>
    <ChromeRing cx={cx} cy={cy} r={20} width={5} />
    <Part name="cap">
      <Cap cx={cx} cy={cy} r={16.5} colour={colour} lit={lit ? false : null} />
      {lit ? <Part name="light"><Cap cx={cx} cy={cy} r={16.5} colour={colour} lit /></Part> : null}
      <circle cx={cx} cy={cy} r={16.5} fill="none" stroke="#000000" strokeOpacity={0.35} strokeWidth={1} />
      <Part name="shade"><circle cx={cx} cy={cy} r={16.5} fill="url(#plc-sunk)" /></Part>
    </Part>
  </g>;
}

/** A black rotary selector 0–I: chrome ring, glossy knob and a wing grip (part "grip"), drawn at 0. */
export function SelectorPicture({ cx, cy }: { cx: number; cy: number }) {
  return <g>
    <ChromeRing cx={cx} cy={cy} r={20} width={4.5} />
    <circle cx={cx} cy={cy} r={17.5} fill="url(#plc-black-gloss)" />
    <Part name="grip">
      <g transform={`rotate(-45 ${cx} ${cy})`}>
        <rect x={cx - 5.5} y={cy - 17} width={11} height={34} rx={4.5} fill="url(#plc-black-body)" stroke="#556070" strokeWidth={0.7} />
        <rect x={cx - 4} y={cy - 16} width={3} height={32} rx={1.5} fill="#ffffff" fillOpacity={0.12} />
        <rect x={cx - 1.3} y={cy - 15} width={2.6} height={11} rx={1.3} fill="#ffffff" />
      </g>
    </Part>
  </g>;
}

/** A roller limit switch: a black body with screws, a metal head and an arm with a roller (part "arm"); its lamp is part "led". */
export function LimitSwitchPicture({ cx }: { cx: number }) {
  const px = cx + 6, py = 34;
  return <g>
    {shadow(cx, 68, 22, 5)}
    <rect x={cx - 17} y={38} width={34} height={29} rx={3} fill="url(#plc-black-body)" stroke="#05080d" strokeWidth={0.8} />
    <rect x={cx - 15} y={39} width={30} height={5} rx={2} fill="url(#plc-sheen)" opacity={0.6} />
    {screw(cx - 12, 43)}{screw(cx + 12, 43)}{screw(cx - 12, 62)}{screw(cx + 12, 62)}
    <rect x={cx - 7} y={48} width={14} height={11} rx={1.5} fill="#0b0f15" stroke="#3b4553" strokeWidth={0.5} />
    <circle cx={cx} cy={53.5} r={2.6} fill="#1f2937" />
    <Part name="led"><circle cx={cx} cy={53.5} r={2.6} fill={ON} /><Halo cx={cx} cy={53.5} r={7} colour={ON} /></Part>
    <rect x={px - 7} y={29} width={14} height={10} rx={2} fill="url(#plc-alu)" stroke="#5b6675" strokeWidth={0.6} />
    <Part name="arm">
      <line x1={px} y1={py} x2={cx - 13} y2={23} stroke="url(#plc-metal)" strokeWidth={3.4} strokeLinecap="round" />
      <circle cx={cx - 13} cy={23} r={7} fill="url(#plc-black-gloss)" stroke="#556070" strokeWidth={0.8} />
      <circle cx={cx - 13} cy={23} r={2.2} fill="url(#plc-metal)" />
    </Part>
    <circle cx={px} cy={py} r={3.2} fill="url(#plc-metal)" stroke="#3b4553" strokeWidth={0.6} />
  </g>;
}

/** A panel lamp: a chrome ring and a domed lens; its lit look is part "light". */
export function LampPicture({ cx, cy, colour }: { cx: number; cy: number; colour: string }) {
  return <g>
    <ChromeRing cx={cx} cy={cy} r={19} width={4.5} />
    <Lens cx={cx} cy={cy} r={16} colour={colour} lit={false} />
    <Part name="light"><Lens cx={cx} cy={cy} r={16} colour={colour} lit /><circle cx={cx} cy={cy} r={6} fill="#ffffff" opacity={0.55} /></Part>
  </g>;
}

/** A buzzer: a round black body with a sound slot ring; the waves that leave it are part "waves". */
export function BuzzerPicture({ cx, cy }: { cx: number; cy: number }) {
  return <g>
    {shadow(cx, cy + 4, 26, 22)}
    <circle cx={cx} cy={cy} r={21} fill="url(#plc-black-gloss)" stroke="#05080d" strokeWidth={0.8} />
    <circle cx={cx} cy={cy} r={14} fill="none" stroke="#05080d" strokeWidth={2.4} />
    <circle cx={cx} cy={cy} r={14} fill="none" stroke="#4b5563" strokeOpacity={0.6} strokeWidth={0.6} />
    <circle cx={cx} cy={cy} r={4} fill="#05080d" />
    <ellipse cx={cx - 6} cy={cy - 11} rx={9} ry={4} fill="url(#plc-sheen)" opacity={0.7} />
    <Part name="waves"><g stroke="#fbbf24" strokeWidth={1.6} fill="none" strokeLinecap="round">
      <path d={`M ${cx + 24} ${cy - 7} q 5 7 0 14`} /><path d={`M ${cx + 28} ${cy - 11} q 7 11 0 22`} />
      <path d={`M ${cx - 24} ${cy - 7} q -5 7 0 14`} /><path d={`M ${cx - 28} ${cy - 11} q -7 11 0 22`} />
    </g></Part>
  </g>;
}

/** A relay in its clear cover: copper coil, contact springs, the armature (part "armature"), the moving contact (part "contact") and its lamp (part "led"). */
export function RelayPicture() {
  return <g>
    {shadow(42, 66, 30, 4)}
    <rect x={14} y={60} width={56} height={7} rx={1.5} fill="url(#plc-black-body)" />
    <rect x={18} y={24} width={20} height={34} rx={3} fill="url(#plc-coil)" stroke="#5c2d0e" strokeWidth={0.6} />
    {Array.from({ length: 10 }, (_, index) => <line key={index} x1={18.5} x2={37.5} y1={27 + index * 3} y2={27 + index * 3} stroke="#5c2d0e" strokeOpacity={0.45} strokeWidth={0.7} />)}
    <rect x={16} y={21} width={24} height={4} rx={1} fill="url(#plc-metal)" />
    <Part name="armature">
      <rect x={40} y={22} width={22} height={3.5} rx={1} fill="url(#plc-metal)" />
      <line x1={58} y1={25} x2={58} y2={44} stroke="url(#plc-metal)" strokeWidth={2} />
    </Part>
    <line x1={52} y1={30} x2={52} y2={57} stroke="url(#plc-brass)" strokeWidth={2.2} />
    <line x1={64} y1={30} x2={64} y2={57} stroke="url(#plc-brass)" strokeWidth={2.2} />
    <Part name="contact"><circle cx={53.5} cy={38} r={1.8} fill="url(#plc-brass)" /></Part>
    <rect x={12} y={18} width={60} height={44} rx={5} fill="url(#plc-glass-box)" stroke="#cbd5e1" strokeOpacity={0.7} strokeWidth={0.9} />
    <rect x={14} y={19} width={14} height={40} rx={3} fill="#ffffff" fillOpacity={0.14} />
    <circle cx={66} cy={24} r={2.2} fill="#3a1a1a" />
    <Part name="led"><circle cx={66} cy={24} r={2.2} fill={ON} /><Halo cx={66} cy={24} r={7} colour={ON} /></Part>
  </g>;
}

/** A contactor: a light grey body, a front window whose carriage (part "carriage", marks "mark-off" and "mark-on") slides over when it pulls in, its lamp part "led". */
export function ContactorPicture() {
  return <g>
    {shadow(60, 68, 48, 5)}
    <rect x={10} y={16} width={84} height={50} rx={4} fill="url(#plc-grey-body)" stroke="#6b7684" strokeWidth={0.8} />
    <rect x={10} y={16} width={84} height={9} rx={3} fill="#c3cad3" stroke="#6b7684" strokeWidth={0.5} />
    <rect x={10} y={57} width={84} height={9} rx={3} fill="#c3cad3" stroke="#6b7684" strokeWidth={0.5} />
    <rect x={95} y={20} width={16} height={42} rx={3} fill="url(#plc-grey-body)" stroke="#6b7684" strokeWidth={0.7} />
    <line x1={103} x2={103} y1={24} y2={58} stroke="#8d99a8" strokeWidth={0.6} />
    <rect x={30} y={30} width={44} height={22} rx={3} fill="#1f2937" stroke="#4b5563" strokeWidth={0.7} />
    <Part name="carriage">
      <rect x={34} y={33} width={20} height={16} rx={2} fill="url(#plc-cap-blue)" />
      <Part name="mark-off"><text x={44} y={45} textAnchor="middle" fontSize={10} fontWeight={800} fill="#ffffff" pointerEvents="none">0</text></Part>
      <Part name="mark-on"><text x={44} y={45} textAnchor="middle" fontSize={10} fontWeight={800} fill="#ffffff" pointerEvents="none">I</text></Part>
    </Part>
    <rect x={16} y={36} width={9} height={10} rx={1.5} fill="#e5e7eb" stroke="#6b7684" strokeWidth={0.5} />
    <circle cx={20.5} cy={41} r={2.2} fill="#4b5563" />
    <Part name="led"><circle cx={20.5} cy={41} r={2.2} fill={ON} /><Halo cx={20.5} cy={41} r={7} colour={ON} /></Part>
    <rect x={12} y={17} width={80} height={4} rx={2} fill="#ffffff" fillOpacity={0.35} />
  </g>;
}

/** A solenoid valve: a brass body with ports and a black coil; the water through it is part "flow", its lamp part "led". */
export function SolenoidValvePicture() {
  return <g>
    {shadow(36, 66, 32, 4)}
    <rect x={3} y={44} width={8} height={18} rx={1.5} fill="url(#plc-brass)" stroke="#5c430d" strokeWidth={0.6} />
    <rect x={61} y={44} width={8} height={18} rx={1.5} fill="url(#plc-brass)" stroke="#5c430d" strokeWidth={0.6} />
    <rect x={9} y={47} width={54} height={12} fill="url(#plc-brass)" stroke="#5c430d" strokeWidth={0.5} />
    <rect x={18} y={40} width={36} height={24} rx={4} fill="url(#plc-brass)" stroke="#5c430d" strokeWidth={0.7} />
    <Part name="flow"><rect x={5} y={51.5} width={62} height={3} rx={1.5} fill="url(#plc-water)" /></Part>
    <rect x={31} y={33} width={10} height={8} fill="url(#plc-metal-h)" stroke="#5b6675" strokeWidth={0.4} />
    <rect x={19} y={14} width={34} height={20} rx={3} fill="url(#plc-black-body)" stroke="#05080d" strokeWidth={0.7} />
    <rect x={21} y={15} width={30} height={4} rx={2} fill="#ffffff" fillOpacity={0.2} />
    <rect x={53} y={17} width={12} height={14} rx={2} fill="url(#plc-black-body)" stroke="#05080d" strokeWidth={0.6} />
    <circle cx={59} cy={24} r={2} fill="#1f2937" />
    <Part name="led"><circle cx={59} cy={24} r={2} fill={ON} /><Halo cx={59} cy={24} r={6} colour={ON} /></Part>
  </g>;
}

/** A blue motor: ribbed body, fan cover, feet, terminal box and shaft; the fan is part "fan", the lamp part "led". */
export function MotorPicture() {
  return <g>
    {shadow(44, 72, 38, 4)}
    <rect x={22} y={66} width={46} height={5} rx={1.5} fill="url(#plc-blue)" stroke="#05224f" strokeWidth={0.6} />
    <rect x={26} y={60} width={7} height={8} fill="url(#plc-blue)" /><rect x={57} y={60} width={7} height={8} fill="url(#plc-blue)" />
    <rect x={70} y={41} width={12} height={8} rx={1.5} fill="url(#plc-metal)" stroke="#5b6675" strokeWidth={0.6} />
    <rect x={66} y={34} width={6} height={22} rx={2} fill="url(#plc-blue)" stroke="#05224f" strokeWidth={0.6} />
    <rect x={20} y={28} width={48} height={34} rx={6} fill="url(#plc-blue)" stroke="#05224f" strokeWidth={0.8} />
    {[33, 38, 43, 48, 53, 58].map((y) => <line key={y} x1={23} x2={65} y1={y} y2={y} stroke="#05224f" strokeOpacity={0.55} strokeWidth={1.2} />)}
    <rect x={22} y={29} width={44} height={6} rx={3} fill="url(#plc-sheen)" />
    <rect x={34} y={18} width={20} height={11} rx={2} fill="url(#plc-blue)" stroke="#05224f" strokeWidth={0.7} />
    <circle cx={44} cy={23.5} r={2.2} fill="#0b1e3d" />
    <Part name="led"><circle cx={44} cy={23.5} r={2.2} fill={ON} /><Halo cx={44} cy={23.5} r={7} colour={ON} /></Part>
    <rect x={6} y={30} width={16} height={30} rx={6} fill="url(#plc-metal-dark)" stroke="#05090f" strokeWidth={0.8} />
    <g transform="translate(14 45) scale(0.5 1) translate(-14 -45)">
      <circle cx={14} cy={45} r={13.5} fill="#05090f" />
      <Part name="fan"><Fan cx={14} cy={45} r={12} speed={0} blades={6} colour="#a9b6c6" /></Part>
      <circle cx={14} cy={45} r={13.5} fill="none" stroke="#8fa4bc" strokeWidth={1.4} />
    </g>
  </g>;
}

/** An emergency stop (2026-11-09): a yellow ring and a red mushroom cap (part "cap") that stays in when pressed. */
export function EmergencyStopPicture({ cx, cy }: { cx: number; cy: number }) {
  return <g>
    {shadow(cx, cy + 4, 30, 27)}
    <circle cx={cx} cy={cy} r={27} fill="#facc15" stroke="#a16207" strokeWidth={0.8} />
    <circle cx={cx} cy={cy} r={24} fill="none" stroke="#fde68a" strokeOpacity={0.55} strokeWidth={1.2} />
    <circle cx={cx} cy={cy} r={18} fill="url(#plc-metal-dark)" stroke="#05080d" strokeWidth={1.4} />
    <circle cx={cx} cy={cy + 1.5} r={16} fill="#05080d" opacity={0.85} />
    <Part name="cap">
      <ellipse cx={cx} cy={cy + 3.5} rx={21} ry={19} fill="url(#plc-shadow)" />
      <Cap cx={cx} cy={cy} r={20} colour="#ef4444" />
      <circle cx={cx} cy={cy} r={20} fill="none" stroke="#450a0a" strokeOpacity={0.6} strokeWidth={1.2} />
      <circle cx={cx} cy={cy} r={15} fill="none" stroke="#ffffff" strokeOpacity={0.12} strokeWidth={1} />
      <Part name="shade"><circle cx={cx} cy={cy} r={20} fill="url(#plc-sunk)" /></Part>
    </Part>
  </g>;
}

/** An emergency stop relay (2026-11-09): a yellow DIN-rail housing with its lamps – supply (part "led-power") and pulled in (part "led-k"). */
export function SafetyRelayPicture({ state }: { state: { energised: boolean; on: boolean } }) {
  void state;
  return <g>
    {shadow(48, 66, 34, 4)}
    <rect x={18} y={20} width={60} height={46} rx={3} fill="#facc15" stroke="#a16207" strokeWidth={0.8} />
    <rect x={20} y={21} width={56} height={5} rx={2} fill="#ffffff" fillOpacity={0.3} />
    <rect x={26} y={30} width={44} height={18} rx={2} fill="#1f2937" stroke="#4b5563" strokeWidth={0.6} />
    <text x={48} y={42} textAnchor="middle" fontSize={7} fontWeight={700} fill="#e5e7eb" pointerEvents="none">NÖDSTOPP</text>
    {[[34, "PWR"], [62, "K1/K2"]].map(([x, text]) => <text key={String(text)} x={Number(x)} y={62} textAnchor="middle" fontSize={5} fontWeight={700} fill="#422006" pointerEvents="none">{text}</text>)}
    <circle cx={34} cy={55} r={2.6} fill="#1f2937" /><circle cx={62} cy={55} r={2.6} fill="#1f2937" />
    <Part name="led-power"><circle cx={34} cy={55} r={2.6} fill={ON} /><Halo cx={34} cy={55} r={7} colour={ON} /></Part>
    <Part name="led-k"><circle cx={62} cy={55} r={2.6} fill={ON} /><Halo cx={62} cy={55} r={7} colour={ON} /></Part>
  </g>;
}

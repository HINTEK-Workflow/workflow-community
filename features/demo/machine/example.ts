import type { DeviceInst, Layout, Wire } from "@/lib/machine/simulator/surface/layout";

// Demokopplingen: the ready machine in the simulator, for the demo only. It is not one of the simulator's own examples, so the product's
// simulator never lists it. A start button, a fan that runs for a minute, a motor protection and an alarm output with a fixed text. Invented
// values, no real plant's.

export const DEMO_MACHINE = { start: "knapp-1", protection: "vippa-1", alarmText: "Fläkt F1, motorskydd" } as const;

const device = (id: string, kind: DeviceInst["kind"], x: number, y: number, label: string): DeviceInst => ({ id, kind, x, y, label, options: {} });
const wires = (pairs: readonly [string, string][]): Wire[] => pairs.map(([from, to], index) => {
  const [a, b] = from.split(":"), [c, d] = to.split(":");
  return { id: `w${index + 1}`, from: { device: a, terminal: b }, to: { device: c, terminal: d } };
});

export const demoMachineLayout = (): Layout => ({
  version: 3, junctions: [], language: "st", ladder: null, outdoorC: 5,
  devices: [
    device("kalla24-1", "kalla24", 220, 300, "24 V DC"),
    device(DEMO_MACHINE.start, "knapp", 150, 60, "Start"),
    device(DEMO_MACHINE.protection, "vippa", 290, 60, "Motorskydd"),
    device("tilluftsflakt-1", "tilluftsflakt", 480, 540, "Fläkt F1"),
    { ...device("larm-1", "larm", 700, 540, DEMO_MACHINE.alarmText), options: { severity: "fault" } },
  ],
  wires: wires([
    ["kalla24-1:+", "plc:24V"], ["kalla24-1:−", "plc:0V"],
    ["kalla24-1:+", "knapp-1:1"], ["knapp-1:2", "plc:DI0"],
    ["kalla24-1:+", "vippa-1:1"], ["vippa-1:2", "plc:DI1"],
    ["plc:DO0", "tilluftsflakt-1:1"], ["tilluftsflakt-1:2", "kalla24-1:−"],
    ["plc:DO1", "larm-1:1"], ["larm-1:2", "kalla24-1:−"],
  ]),
  program: [
    "PROGRAM DemoFlakt",
    "VAR",
    "  Start AT %IX0.0 : BOOL;       // tryckknapp",
    "  Motorskydd AT %IX0.1 : BOOL;  // 1 = har löst ut",
    "  Flakt AT %QX0.0 : BOOL;",
    "  Larm AT %QX0.1 : BOOL;        // larmutgång med fast text",
    "  Minne : BOOL;",
    "  Gangtid : TON;",
    "END_VAR",
    "",
    "(* Ett tryck startar fläkten, som går i en minut. Motorskyddet stoppar den. *)",
    "IF Start AND NOT Motorskydd THEN",
    "  Minne := TRUE;",
    "END_IF;",
    "Gangtid(IN := Minne, PT := T#60s);",
    "IF Gangtid.Q OR Motorskydd THEN",
    "  Minne := FALSE;",
    "END_IF;",
    "Flakt := Minne;",
    "Larm := Motorskydd;",
    "END_PROGRAM",
  ].join("\n"),
});

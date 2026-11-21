import { DEVICE_DEFS, optionValue } from "@/lib/machine/simulator/surface/devices";
import { isTerminalEnd, type Layout, PLC_DEVICE_ID, type WireEnd, wiresAtJunction, wiresAtTerminal } from "@/lib/machine/simulator/surface/layout";
import { nameIo } from "@/lib/machine/simulator/st/io";
import type { LadderProgram } from "./model";

/** The devices that are pushbuttons (a broken contact on one is pressed, not wired as NC). */
const BUTTONS = new Set<string>(["knapp", "knapp_lampa", "nodstopp"]);

// PLC-simulatorn, Ladder (2026-11-03: "stoppknappen är fel i ladder den skall vara NC"): the fail-safe design is kept –
// a breaking (NC) stop button on the terminal and a plain contact in the rung, since the input is 1 at rest – and made visible:
// the editor marks a contact whose variable sits on a terminal wired to a breaking device. This finds those terminals.

export type NcInput = { terminal: string; label: string; button: boolean };

/** The device terminals on the far side of a PLC terminal, through junctions. */
function devicesAt(layout: Layout, terminal: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (end: WireEnd) => {
    const key = isTerminalEnd(end) ? `${end.device}:${end.terminal}` : `@${end.junction}`;
    if (seen.has(key)) return;
    seen.add(key);
    const wires = isTerminalEnd(end) ? wiresAtTerminal(layout, end) : wiresAtJunction(layout, end.junction);
    for (const wire of wires) for (const other of [wire.from, wire.to]) {
      if (isTerminalEnd(other)) { if (other.device !== PLC_DEVICE_ID && !seen.has(`${other.device}:${other.terminal}`)) { seen.add(`${other.device}:${other.terminal}`); found.push(other.device); } }
      else visit(other);
    }
  };
  visit({ device: PLC_DEVICE_ID, terminal });
  return found;
}

/** Every digital input whose wire comes from a device that breaks at rest: an NC button, limit switch, fire alarm or frost guard. */
export function ncInputs(layout: Pick<Layout, "devices" | "wires" | "junctions">): Map<string, NcInput> {
  const result = new Map<string, NcInput>();
  const whole = { ...layout, version: 3 as const, program: "", outdoorC: 0, language: "st" as const, ladder: null };
  for (const device of layout.devices) {
    const def = DEVICE_DEFS[device.kind];
    const breaking = def.elements.some((element) => element.kind === "contact" && (element.invert === true || (element.invert === "nc-option" && optionValue(def, device.options, "nc") === "nc")));
    if (!breaking) continue;
    for (const terminal of def.terminals) {
      if (terminal.role !== "wire") continue;
      for (const wire of wiresAtTerminal(whole, { device: device.id, terminal: terminal.id })) {
        for (const end of [wire.from, wire.to]) {
          if (isTerminalEnd(end) && end.device === PLC_DEVICE_ID && nameIo(end.terminal)?.kind === "DI") result.set(end.terminal, { terminal: end.terminal, label: device.label || def.label, button: BUTTONS.has(def.id) });
          else if (!isTerminalEnd(end)) for (const plc of plcInputsAtJunction(whole, end.junction)) result.set(plc, { terminal: plc, label: device.label || def.label, button: BUTTONS.has(def.id) });
        }
      }
    }
  }
  return result;
}

function plcInputsAtJunction(layout: Layout, junction: string): string[] {
  const seen = new Set<string>([junction]);
  const queue = [junction];
  const inputs: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    for (const wire of wiresAtJunction(layout, current)) for (const end of [wire.from, wire.to]) {
      if (isTerminalEnd(end)) { if (end.device === PLC_DEVICE_ID && nameIo(end.terminal)?.kind === "DI") inputs.push(end.terminal); }
      else if (!seen.has(end.junction)) { seen.add(end.junction); queue.push(end.junction); }
    }
  }
  return inputs;
}

/** The terminal a Ladder variable stands for: its own name (DI1), or the address of its declaration (Stopp AT DI1). */
export function terminalOfVariable(program: LadderProgram, name: string): string | null {
  if (nameIo(name)) return name;
  const declared = program.vars.find((variable) => variable.name === name);
  return declared?.address ?? null;
}

/** The NC device behind a contact's variable, if any. */
export function ncInputOf(program: LadderProgram, inputs: ReadonlyMap<string, NcInput>, name: string): NcInput | null {
  const terminal = terminalOfVariable(program, name);
  return terminal ? inputs.get(terminal) ?? null : null;
}

/** The status line's explanation of such a contact. */
export const ncExplanation = (name: string, input: NcInput) => (input.button ? `${name} är en NC-knapp: ingången är 1 i vila, därför en vanlig kontakt.` : `${name} är en brytande kontakt (NC): ingången är 1 i vila, därför en vanlig kontakt.`);

export { devicesAt };

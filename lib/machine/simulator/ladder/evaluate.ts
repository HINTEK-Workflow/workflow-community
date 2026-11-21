import type { FbState } from "@/lib/machine/simulator/st/blocks";
import type { Value } from "@/lib/machine/simulator/st/interpreter";
import type { LadderProgram, LdCmpOp, LdNode, LdOperand, LdRung } from "./model";

// PLC-simulatorn, Ladder: the power flow through a ladder program for one cycle, so the editor can colour what carries power.
// The rules are those of the generated ST (generate.ts), rung by rung in order: a coil written in rung 1 is what a contact in
// rung 2 reads this cycle, an input is this cycle's input, a timer's Q is the block's output after the cycle's step. With the
// variables the cycle began with and the variables and blocks it ended with, the flow is exactly what the PLC computed.

export type NodeFlow = { in: boolean; out: boolean };
export type LadderFlow = { nodes: Map<string, NodeFlow>; outputs: Map<string, boolean>; rungs: Map<string, boolean>; vars: Record<string, Value> };

const asNumber = (value: Value | undefined) => (typeof value === "number" ? value : value ? 1 : 0);
const truthy = (value: Value | undefined) => value === true || (typeof value === "number" && value !== 0);

export function compare(op: LdCmpOp, left: Value | undefined, right: Value | undefined) {
  const a = asNumber(left), b = asNumber(right);
  switch (op) {
    case "=": return a === b;
    case "<>": return a !== b;
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
  }
}

/**
 * `varsBefore`: the program's variables as the cycle began (coils keep last cycle's value until their rung runs);
 * `varsAfter`: as it ended (inputs and the clock are read from here, since the cycle read them first);
 * `inputs`: the names that are inputs or the clock; `fbs`: the blocks after the cycle.
 */
export function evaluateLadder(program: LadderProgram, varsBefore: Readonly<Record<string, Value>>, varsAfter: Readonly<Record<string, Value>>, inputs: ReadonlySet<string>, fbs: Readonly<Record<string, FbState>>, forces: Readonly<Record<string, Value>> = {}): LadderFlow {
  const vars: Record<string, Value> = { ...varsBefore };
  for (const name of inputs) if (name in varsAfter) vars[name] = varsAfter[name];
  Object.assign(vars, forces);
  const bit = (name: string) => { const dot = name.indexOf("."); return dot < 0 ? truthy(vars[name]) : fbs[name.slice(0, dot)]?.outputs[name.slice(dot + 1)] === true; };
  const routines = new Map((program.routines ?? []).map((routine) => [routine.name, routine]));
  let returned = false;
  const nodes = new Map<string, NodeFlow>(), outputs = new Map<string, boolean>(), rungs = new Map<string, boolean>();
  const operand = (item: LdOperand): Value | undefined => (item.kind === "var" ? vars[item.name] : item.kind === "member" ? fbs[item.object]?.outputs[item.field] : item.value);
  const series = (items: readonly LdNode[], flowIn: boolean): boolean => {
    let flow = flowIn;
    for (const item of items) {
      const before = flow;
      switch (item.kind) {
        case "no": flow = flow && bit(item.var); break;
        case "nc": flow = flow && !bit(item.var); break;
        case "calc": break;
        // A routine's rungs carry power only when it is called; a RETURN with flow leaves the rest of the part dark.
        case "call": if (flow) runRoutine(item.routine); break;
        case "ret": if (flow) returned = true; break;
        case "cmp": flow = flow && compare(item.op, operand(item.left), operand(item.right)); break;
        case "parallel": { let any = false; for (const branch of item.branches) any = series(branch, flow) || any; flow = any; break; }
        // An ST-block runs on the flow in and lets it pass; what its statements wrote is in varsAfter, read by whoever comes next.
        case "st": break;
        default: flow = fbs[item.name]?.outputs.Q === true; break;
      }
      nodes.set(item.id, { in: before, out: flow });
    }
    return flow;
  };
  const runRungs = (list: readonly LdRung[]) => {
    returned = false;
    for (const rung of list) {
      if (returned) { rungs.set(rung.id, false); continue; }
      const flow = series(rung.items, true);
      rungs.set(rung.id, flow);
      for (const out of rung.outputs) {
        if (!(out.var in forces)) {
          if (out.kind === "coil") vars[out.var] = flow;
          else if (out.kind === "ncoil") vars[out.var] = !flow;
          else if (flow) vars[out.var] = out.kind === "set";
        }
        outputs.set(out.id, truthy(vars[out.var]));
      }
    }
    returned = false;
  };
  const running = new Set<string>();
  function runRoutine(name: string) {
    const routine = routines.get(name);
    if (!routine || running.has(name)) return;
    running.add(name);
    const outer = returned;
    runRungs(routine.rungs);
    returned = outer;
    running.delete(name);
  }
  runRungs(program.rungs);
  return { nodes, outputs, rungs, vars };
}

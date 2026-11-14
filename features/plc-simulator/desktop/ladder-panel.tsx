"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, CheckCheck, ExternalLink, Plus, Trash2 } from "lucide-react";
import { applyDrop, type DropDefaults, hitSlot, instructionNode, isOutputTool, type Payload, removePayload, rungSlotAt, rungSlots, type SlotMark, slotKey, type ToolKind } from "@/lib/machine/simulator/ladder/dnd";
import { addBranch, addOutput, addRoutine, addRung, addRungBefore, findNode, fromRoutineView, insertNode, moveRung, namesInUse, removeNode, removeOutput, removeRoutine, removeRung, renameRoutine, replaceNode, routineView, updateOutput, updateRung } from "@/lib/machine/simulator/ladder/edit";
import { evaluateLadder, type LadderFlow } from "@/lib/machine/simulator/ladder/evaluate";
import { operandText, ptLiteral } from "@/lib/machine/simulator/ladder/generate";
import { BOX_HALF, type Cell, CELL_H, type FlowRef, layoutRung, RAIL_END, RAIL_X, type RungGeometry, TOP } from "@/lib/machine/simulator/ladder/geometry";
import { BLOCK_NAMES, CALC_NAMES, CMP_NAMES, INSTRUCTION_TABS, type InstructionTab, parseInstructionLine, parseOperand, toolsInTab } from "@/lib/machine/simulator/ladder/instructions";
import { freeLdId, isLdBit, isLdName, type LadderProgram, LD_CALC_OPS, LD_CMP_OPS, type LdCalcOp, type LdCmpOp, type LdNode, type LdOperand, type LdOutput, type LdRung, MAX_RUNGS, stBlockLines } from "@/lib/machine/simulator/ladder/model";
import { type EditMarks, editMarks, type LdCursor, type RungMark } from "@/lib/machine/simulator/ladder/navigate";
import { ncExplanation, type NcInput, ncInputOf, ncInputs } from "@/lib/machine/simulator/ladder/terminals";
import type { Value } from "@/lib/machine/simulator/st/interpreter";
import { allIo, CLOCK_VARS, ioAddressText, ioName, nameIo } from "@/lib/machine/simulator/st/io";
import { parseTimeLiteral } from "@/lib/machine/simulator/st/lexer";
import { announce, notice } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { type MenuItem, SurfaceMenu } from "../surface/surface-overlays";
import { useRuntimeSnapshot, useDesktop, useDeskState, usePhone } from "./context";
import { ChromeButton, LabeledInput, LabeledSelect, ToolButton } from "./controls";
import { popOut } from "./dock-control";

// PLC-simulatorn, Ladder as a tool of its own (2026-11-04; the owner: standard names and symbols as the base, our own code, help texts
// and drawings): numbered rungs from 0 with an (End) rung last, comments above the rungs, rails, contacts and coils as symbols and
// function blocks as boxes with their pins, tag name above an element and its address below, an instruction toolbar in tabs, a line
// for typing instructions, edit marks in the margin until Verifiera accepts, and in RUN a green, thick power path and live values.
// Everything goes through the program's id-based cursor (lib/machine/simulator/ladder/navigate.ts), shared with the ST view.

const TEXT = "var(--plc-ink)", MUTED = "var(--plc-muted)", LIVE = "var(--plc-live)", PRIMARY = "var(--plc-accent)", BAD = "var(--plc-fault)";
const WIRE = 1.25, WIRE_LIVE = 2.75, RAIL = 2, SYMBOL = 1.5;
const ST_DEFAULT = "// Skriv ST-satser här";
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const nameOrNull = (text: string) => (isLdName(text.trim()) ? text.trim() : null);
const NAME_HELP = "Ett namn: bokstäver, siffror och understreck, inget reserverat ord.";

/** Value as a person reads it on a rung: 1/0 for a bit, a time as a time. */
function valueText(value: Value | undefined, time = false) {
  if (value === undefined) return "–";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (time) return ptLiteral(Math.round(value));
  return Number.isInteger(value) ? String(value) : value.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
}

// ---------- drag and drop, as before ----------

type Over = { kind: "slot"; rungId: string; mark: SlotMark } | { kind: "trash" } | { kind: "rung"; index: number };
type DragState = { payload: Payload; label: string; x: number; y: number; copy: boolean; over: Over | null; doc: Document };
type Press = { payload: Payload; label: string; x: number; y: number; pointerId: number; touch: boolean; timer: ReturnType<typeof setTimeout> | null; started: boolean; target: Window };
type DragView = { marks: readonly SlotMark[]; active: SlotMark | null };

function Marker({ mark, active }: { mark: SlotMark; active: boolean }) {
  const thickness = active ? 7 : 5;
  const box = mark.vertical ? { x: mark.x - thickness / 2, y: mark.y - mark.length / 2, width: thickness, height: mark.length } : { x: mark.x - mark.length / 2, y: mark.y - thickness / 2, width: mark.length, height: thickness };
  const bad = active && !mark.legal;
  return <g pointerEvents="none" data-testid="plc-ld-slot" data-active={active || undefined} data-legal={mark.legal} data-slot={mark.slot.kind}>
    <rect {...box} fill={bad ? BAD : PRIMARY} opacity={active ? 1 : 0.4} />
    {bad ? <line x1={mark.x - 9} y1={mark.y + 9} x2={mark.x + 9} y2={mark.y - 9} stroke={BAD} strokeWidth={2.5} strokeLinecap="round" /> : null}
  </g>;
}
const dragText = (drag: DragState) => {
  const { over } = drag;
  if (!over) return "Dra till en plats i en rung; Esc avbryter.";
  if (over.kind === "trash") return "Släpp för att ta bort.";
  if (over.kind === "rung") return "Släpp här: rungen flyttas.";
  if (!over.mark.legal) return over.mark.same ? "Samma plats som nu." : over.mark.reason ?? "Går inte att släppa här.";
  const slot = over.mark.slot;
  const copy = drag.copy && drag.payload.kind !== "new" && drag.payload.kind !== "rung" ? " (kopia)" : "";
  return slot.kind === "series" ? `Släpp här: i serie${copy}.` : slot.kind === "branch" ? `Släpp här: parallell gren ${slot.where === "above" ? "ovanför" : "under"}${copy}.` : `Släpp här: som utgång${copy}.`;
};
const inside = (rect: DOMRect, x: number, y: number) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

// ---------- one rung ----------

type RungProps = {
  rung: LdRung; number: number; geometry: RungGeometry; flow: LadderFlow | null; cursor: LdCursor; mark: RungMark | null;
  onSelect: (cursor: { rungId: string; nodeId?: string; outputId?: string }) => void;
  onOpen: () => void;
  onMenu: (event: React.MouseEvent, cursor: { rungId: string; nodeId?: string; outputId?: string }, tag: string | null) => void;
  drag: DragView | null;
  program: LadderProgram; nc: ReadonlyMap<string, NcInput>;
  expanded: ReadonlySet<string>; onToggleExpand: (id: string) => void;
  onPress: (event: ReactPointerEvent, payload: Payload, label: string) => void;
  values: Readonly<Record<string, Value>> | null;
  blocks: Readonly<Record<string, { outputs: Record<string, Value> }>> | null;
};

/** The address under a tag: the terminal it is an alias for, or the address of a terminal by its own name. */
function addressOf(program: LadderProgram, tag: string) {
  const declared = program.vars.find((variable) => variable.name === tag);
  if (declared?.address) return declared.address;
  const io = nameIo(tag);
  return io ? ioAddressText(io) : "";
}

function Rung({ rung, number, geometry, flow, cursor, mark, onSelect, onOpen, onMenu, drag, program, nc, expanded, onToggleExpand, onPress, values, blocks }: RungProps) {
  const { width, height } = geometry;
  const selectedNode = cursor?.rungId === rung.id ? cursor.nodeId ?? null : null;
  const selectedOutput = cursor?.rungId === rung.id ? cursor.outputId ?? null : null;
  const rungSelected = cursor?.rungId === rung.id && !selectedNode && !selectedOutput;
  const isOn = (ref: FlowRef): boolean | undefined => {
    if (!flow) return undefined;
    if (ref === "rail") return true;
    if ("output" in ref) return flow.outputs.get(ref.output);
    const state = flow.nodes.get(ref.node);
    return state ? state[ref.side] : undefined;
  };
  const operandValue = (operand: LdOperand) => (operand.kind === "var" ? values?.[operand.name] : operand.kind === "member" ? blocks?.[operand.object]?.outputs[operand.field] : operand.value);
  const isTimeOperand = (operand: LdOperand) => operand.kind === "member" ? operand.field === "ET" : operand.kind === "const" && operand.type === "TIME";
  const pick = (next: { nodeId?: string; outputId?: string }) => (event: React.MouseEvent) => { event.stopPropagation(); onSelect({ rungId: rung.id, ...next }); };
  const keyPick = (next: { nodeId?: string; outputId?: string }) => (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onSelect({ rungId: rung.id, ...next }); } };
  const open = (next: { nodeId?: string; outputId?: string }) => (event: React.MouseEvent) => { event.stopPropagation(); onSelect({ rungId: rung.id, ...next }); onOpen(); };
  const grab = { touchAction: "none" as const };

  /** A box's pin line. */
  const pin = (x: number, y: number, name: string, side: "left" | "right", value?: string, key?: string) => <g key={key ?? `${name}${side}`} pointerEvents="none">
    <text x={side === "left" ? x + 3 : x - 3} y={y} textAnchor={side === "left" ? "start" : "end"} fontSize={8} fontWeight={600} fill={MUTED} className="select-none">{name}</text>
    {value !== undefined ? <text x={side === "left" ? x + 3 : x - 3} y={y + 9} textAnchor={side === "left" ? "start" : "end"} fontSize={8} fill={TEXT} className="select-none" data-testid="plc-ld-pin-value" data-pin={name}>{value}</text> : null}
  </g>;

  const boxOf = (item: LdNode, cx: number, y: number, on: boolean | undefined): ReactNode => {
    const left = cx - BOX_HALF, right = cx + BOX_HALF, top = y + 12, h = 2 * CELL_H - 18;
    const title = item.kind === "cmp" ? CMP_NAMES[item.op] : item.kind === "calc" ? CALC_NAMES[item.op] : item.kind === "call" ? "CALL" : item.kind === "ret" ? "RET" : BLOCK_NAMES[item.kind as keyof typeof BLOCK_NAMES];
    const fb = "name" in item ? blocks?.[item.name]?.outputs : undefined;
    const pins: ReactNode[] = [];
    const firstY = top + 20, second = top + 44;
    if (item.kind === "ton" || item.kind === "tof" || item.kind === "tp") {
      pins.push(pin(left, firstY, "IN", "left"), pin(left, second, "PT", "left", ptLiteral(item.ptMs)), pin(right, firstY, "Q", "right", flow ? valueText(fb?.Q) : undefined), pin(right, second, "ET", "right", flow ? valueText(fb?.ET, true) : undefined));
    } else if (item.kind === "ctu" || item.kind === "ctd") {
      pins.push(pin(left, firstY, item.kind === "ctu" ? "CU" : "CD", "left"), pin(left, second, item.kind === "ctu" ? "R" : "LD", "left", item.aux ?? "–"), pin(right, firstY, "Q", "right", flow ? valueText(fb?.Q) : undefined), pin(right, second, "CV", "right", flow ? `${valueText(fb?.CV)}/${item.pv}` : `PV ${item.pv}`));
    } else if (item.kind === "r_trig" || item.kind === "f_trig") {
      pins.push(pin(left, firstY, "CLK", "left"), pin(right, firstY, "Q", "right", flow ? valueText(fb?.Q) : undefined));
    } else if (item.kind === "cmp") {
      const a = operandValue(item.left), b = operandValue(item.right);
      pins.push(pin(left, firstY, "IN1", "left", flow ? `${clip(operandText(item.left), 7)}=${valueText(a, isTimeOperand(item.left))}` : clip(operandText(item.left), 11)), pin(left, second, "IN2", "left", flow ? `${clip(operandText(item.right), 7)}=${valueText(b, isTimeOperand(item.right))}` : clip(operandText(item.right), 11)));
    } else if (item.kind === "calc") {
      pins.push(pin(left, firstY, item.op === "MOVE" ? "IN" : "IN1", "left", clip(operandText(item.a), 9)));
      if (item.b) pins.push(pin(left, second, "IN2", "left", clip(operandText(item.b), 9)));
      pins.push(pin(right, firstY + (item.b ? 24 : 0), "OUT", "right", flow ? valueText(values?.[item.dest]) : clip(item.dest, 9)));
    } else if (item.kind === "call") pins.push(<text key="routine" x={cx} y={top + 30} textAnchor="middle" fontSize={9} fontWeight={600} fill={TEXT} className="select-none">{clip(item.routine, 12)}</text>);
    return <g>
      <rect x={left} y={top} width={2 * BOX_HALF} height={h} fill="var(--plc-field)" stroke={on ? LIVE : TEXT} strokeWidth={on ? 2 : SYMBOL} />
      <rect x={left} y={top} width={2 * BOX_HALF} height={12} fill="var(--plc-header)" stroke={on ? LIVE : TEXT} strokeWidth={on ? 2 : SYMBOL} />
      <text x={cx} y={top + 9.5} textAnchor="middle" fontSize={9} fontWeight={700} fill={TEXT} className="select-none">{title}</text>
      {pins}
    </g>;
  };

  const drawCell = (cell: Cell): ReactNode => {
    const item = cell.node;
    const state = flow ? flow.nodes.get(item.id) : undefined;
    const selected = selectedNode === item.id;
    const { x, y, w, h } = cell;
    if (item.kind === "parallel") {
      const first = y + CELL_H / 2, last = y + h - CELL_H / 2;
      return <rect key={`${item.id}-hit`} x={x - 5} y={first - 8} width={10} height={Math.max(16, last - first + 16)} fill="transparent" role="button" tabIndex={0} aria-label={`Parallell grupp med ${item.branches.length} grenar`} data-testid="plc-ld-group" data-node={item.id}
        className="cursor-pointer outline-none" stroke={selected ? PRIMARY : "none"} strokeWidth={2} style={grab}
        onClick={pick({ nodeId: item.id })} onKeyDown={keyPick({ nodeId: item.id })} onPointerDown={(event) => onPress(event, { kind: "node", rungId: rung.id, nodeId: item.id, copy: false }, "Parallell grupp")} onContextMenu={(event) => onMenu(event, { rungId: rung.id, nodeId: item.id }, null)} />;
    }
    const cx = x + w / 2, cy = y + CELL_H / 2;
    const on = state?.out;
    const colour = flow && on ? LIVE : TEXT;
    const contact = item.kind === "no" || item.kind === "nc";
    const ncInput = contact ? ncInputOf(program, nc, item.var) : null;
    const opened = expanded.has(item.id);
    const tag = contact ? item.var : "name" in item ? item.name : item.kind === "calc" ? item.dest : null;
    const address = contact ? addressOf(program, item.var.split(".")[0]) : "";
    const liveBit = contact && flow ? (item.var.includes(".") ? blocks?.[item.var.split(".")[0]]?.outputs.Q : values?.[item.var]) : undefined;
    const aria = item.kind === "no" || item.kind === "nc" ? `${item.kind === "no" ? "Slutande" : "Brytande"} kontakt ${item.var}` : item.kind === "st" ? `ST-block: ${stBlockLines(item.text).find((line) => line.trim()) ?? ""}` : item.kind === "cmp" ? `Jämförelse ${CMP_NAMES[item.op]}` : item.kind === "calc" ? `${item.op} till ${item.dest}` : item.kind === "call" ? `CALL ${item.routine}` : item.kind === "ret" ? "RET" : `${BLOCK_NAMES[item.kind as keyof typeof BLOCK_NAMES]} ${(item as { name: string }).name}`;
    return <g key={item.id} role="button" tabIndex={0} aria-label={aria} aria-pressed={selected} data-testid="plc-ld-node" data-node={item.id} data-kind={item.kind} data-on={state ? on : undefined}
      className="cursor-grab outline-none active:cursor-grabbing" style={grab}
      onClick={pick({ nodeId: item.id })} onDoubleClick={open({ nodeId: item.id })} onKeyDown={keyPick({ nodeId: item.id })} onPointerDown={(event) => onPress(event, { kind: "node", rungId: rung.id, nodeId: item.id, copy: false }, clip(tag ?? item.kind, 24))} onContextMenu={(event) => onMenu(event, { rungId: rung.id, nodeId: item.id }, tag)}>
      <rect x={x + 3} y={y + 1} width={w - 6} height={h - 2} fill={selected ? "var(--plc-pressed)" : "transparent"} stroke={selected ? PRIMARY : "none"} strokeWidth={1.5} />
      {contact ? <g stroke={colour} strokeWidth={flow && on ? 2.5 : SYMBOL} strokeLinecap="round" fill="none">
        <line x1={cx - 7} y1={cy - 10} x2={cx - 7} y2={cy + 10} /><line x1={cx + 7} y1={cy - 10} x2={cx + 7} y2={cy + 10} />
        {item.kind === "nc" ? <line x1={cx - 5} y1={cy + 8} x2={cx + 5} y2={cy - 8} /> : null}
      </g> : item.kind === "st" ? <g>
        <rect x={x + 8} y={y + 12} width={w - 16} height={h - 18} fill="var(--plc-field)" stroke={colour} strokeWidth={SYMBOL} />
        <text x={x + 13} y={y + 22} fontSize={7.5} fontWeight={700} fill={MUTED} className="select-none">ST</text>
        {opened
          ? stBlockLines(item.text).slice(0, Math.max(1, Math.floor((h - 30) / 11))).map((line, lineIndex) => <text key={lineIndex} x={x + 13} y={y + 33 + lineIndex * 11} fontSize={8} fontFamily="ui-monospace, monospace" fill={TEXT} className="select-none">{clip(line, 34)}</text>)
          : <text x={x + 13} y={y + 34} fontSize={8} fontFamily="ui-monospace, monospace" fill={TEXT} className="select-none">{clip(stBlockLines(item.text).find((line) => line.trim())?.trim() ?? "", 30)}</text>}
        <g role="button" tabIndex={0} aria-label={opened ? "Fäll ihop ST-blocket" : `Visa alla ${stBlockLines(item.text).length} rader`} data-testid="plc-ld-st-expand" className="cursor-pointer outline-none" onClick={(event) => { event.stopPropagation(); onToggleExpand(item.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onToggleExpand(item.id); } }} onPointerDown={(event) => event.stopPropagation()}>
          <rect x={x + w - 50} y={y + 13} width={40} height={12} fill="transparent" />
          <text x={x + w - 12} y={y + 22} textAnchor="end" fontSize={7.5} fill={MUTED} className="select-none">{opened ? "▾ dölj" : `▸ ${stBlockLines(item.text).length} rader`}</text>
        </g>
      </g> : boxOf(item, cx, y, flow ? on : undefined)}
      {tag && item.kind !== "calc" ? <text x={cx} y={y + 9} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={TEXT} className="select-none" data-testid="plc-ld-tag">{clip(tag, 16)}{liveBit !== undefined ? <tspan fill={liveBit === true ? LIVE : MUTED} data-testid="plc-ld-bit"> ={valueText(liveBit)}</tspan> : null}</text> : null}
      {contact ? <text x={cx} y={y + CELL_H - 4} textAnchor="middle" fontSize={7.5} fill={MUTED} className="select-none" data-testid="plc-ld-address">{ncInput ? `${address || "–"} · ${ncInput.button ? "NC-knapp" : "NC"}` : address}</text> : null}
    </g>;
  };

  return <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={cn("block max-w-none shrink-0", rungSelected && "bg-[var(--plc-pressed)]")} role="group" aria-label={`Rung ${number}${rung.comment ? `: ${rung.comment}` : ""}`} data-testid="plc-ld-rung" data-rung={rung.id} data-number={number} data-mark={mark ?? undefined} data-selected={cursor?.rungId === rung.id || undefined}
    onClick={() => onSelect({ rungId: rung.id })} onContextMenu={(event) => onMenu(event, { rungId: rung.id }, null)}>
    <g role="button" tabIndex={0} aria-label={`Rung ${number}: dra för att flytta`} data-testid="plc-ld-rung-handle" className="cursor-grab outline-none active:cursor-grabbing" style={grab} onClick={pick({})} onKeyDown={keyPick({})} onPointerDown={(event) => onPress(event, { kind: "rung", rungId: rung.id }, `Rung ${number}`)}>
      <rect x={0} y={0} width={RAIL_X - 2} height={height} fill="transparent" />
      <text x={RAIL_X - 6} y={TOP + CELL_H / 2 + 3.5} textAnchor="end" fontSize={10} fontWeight={700} fill={MUTED} className="select-none">{number}</text>
      {mark ? <text x={3} y={11} fontSize={10} fontWeight={700} fontFamily="ui-monospace, monospace" fill="var(--plc-prog)" className="select-none" data-testid="plc-ld-mark">{mark}</text> : null}
    </g>
    {rung.comment ? <text x={RAIL_X + 5} y={11} fontSize={9} fontStyle="italic" fill={MUTED} className="select-none" data-testid="plc-ld-comment">{clip(rung.comment, Math.floor((width - RAIL_X - 40) / 4.6))}</text> : null}
    <line x1={RAIL_X} y1={0} x2={RAIL_X} y2={height} stroke={flow ? LIVE : TEXT} strokeWidth={flow ? RAIL + 1 : RAIL} />
    <line x1={width - RAIL_END} y1={0} x2={width - RAIL_END} y2={height} stroke={TEXT} strokeWidth={RAIL} />
    {geometry.wires.map((wire) => { const on = flow ? isOn(wire.flow) : undefined; return <line key={wire.key} x1={wire.x1} y1={wire.y1} x2={wire.x2} y2={wire.y2} stroke={on ? LIVE : flow ? MUTED : TEXT} strokeWidth={on ? WIRE_LIVE : WIRE} data-on={flow ? Boolean(on) : undefined} data-testid="plc-ld-wire" />; })}
    {geometry.cells.map(drawCell)}
    {geometry.outputs.map(({ output, x, y, w }) => {
      const cy = y + CELL_H / 2, cx = x + w / 2;
      const on = flow ? flow.outputs.get(output.id) : undefined;
      const selected = selectedOutput === output.id;
      const letter = output.kind === "set" ? "S" : output.kind === "reset" ? "R" : "";
      const colour = flow && on ? LIVE : TEXT;
      const liveBit = flow ? values?.[output.var] : undefined;
      return <g key={output.id} role="button" tabIndex={0} aria-label={`${output.kind === "coil" ? "Spole" : output.kind === "ncoil" ? "Negerad spole" : output.kind === "set" ? "Set" : "Reset"} ${output.var}`} aria-pressed={selected} data-testid="plc-ld-output" data-output={output.id} data-on={on} className="cursor-grab outline-none active:cursor-grabbing" style={grab}
        onClick={pick({ outputId: output.id })} onDoubleClick={open({ outputId: output.id })} onKeyDown={keyPick({ outputId: output.id })} onPointerDown={(event) => onPress(event, { kind: "output", rungId: rung.id, outputId: output.id, copy: false }, output.var)} onContextMenu={(event) => onMenu(event, { rungId: rung.id, outputId: output.id }, output.var)}>
        <rect x={x + 3} y={y + 1} width={w - 6} height={CELL_H - 2} fill={selected ? "var(--plc-pressed)" : "transparent"} stroke={selected ? PRIMARY : "none"} strokeWidth={1.5} />
        <path d={`M ${cx - 9} ${cy - 11} A 13 13 0 0 0 ${cx - 9} ${cy + 11}`} fill="none" stroke={colour} strokeWidth={flow && on ? 2.5 : SYMBOL} strokeLinecap="round" />
        <path d={`M ${cx + 9} ${cy - 11} A 13 13 0 0 1 ${cx + 9} ${cy + 11}`} fill="none" stroke={colour} strokeWidth={flow && on ? 2.5 : SYMBOL} strokeLinecap="round" />
        {output.kind === "ncoil" ? <line x1={cx - 4} y1={cy + 7} x2={cx + 4} y2={cy - 7} stroke={colour} strokeWidth={SYMBOL} strokeLinecap="round" /> : null}
        {letter ? <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={colour} className="select-none">{letter}</text> : null}
        <text x={cx} y={y + 9} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={TEXT} className="select-none" data-testid="plc-ld-tag">{clip(output.var, 14)}{liveBit !== undefined ? <tspan fill={liveBit === true ? LIVE : MUTED} data-testid="plc-ld-bit"> ={valueText(liveBit)}</tspan> : null}</text>
        <text x={cx} y={y + CELL_H - 4} textAnchor="middle" fontSize={7.5} fill={MUTED} className="select-none" data-testid="plc-ld-address">{addressOf(program, output.var)}</text>
      </g>;
    })}
    {!rung.items.length && !rung.outputs.length ? <text x={RAIL_X + 12} y={TOP + CELL_H / 2 - 7} fontSize={10} fill={MUTED} className="select-none">Tom rung: dra hit instruktioner, eller markera den och klicka på dem.</text> : null}
    {drag ? drag.marks.filter((item) => (item.legal && !item.same) || item === drag.active).map((item) => <Marker key={slotKey(item.slot)} mark={item} active={item === drag.active} />) : null}
  </svg>;
}

// ---------- the fields of what is marked ----------

/** A text field that keeps what is typed while it is being typed, and hands on only what passes `parse`. */
function Typed<T>({ id, label, value, parse, onChange, help, suggestions, className }: { id: string; label: string; value: string; parse: (text: string) => T | null; onChange: (value: T) => void; help?: string; suggestions?: string[]; className?: string }) {
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const shown = draft && draft.base === value ? draft.text : value;
  const invalid = shown !== value && parse(shown) === null;
  const list = suggestions ? `${id}-list` : undefined;
  return <label className={cn("plc-field", className)} title={invalid ? help : undefined}>
    <span>{label}</span>
    <input id={id} className="plc-input w-full" list={list} aria-invalid={invalid || undefined} value={shown} onChange={(event) => { setDraft({ base: value, text: event.target.value }); const parsed = parse(event.target.value); if (parsed !== null) onChange(parsed); }} style={invalid ? { borderColor: "var(--plc-fault)" } : undefined} />
    {suggestions ? <datalist id={list}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist> : null}
  </label>;
}

function NodeFields({ node, program, routines, update, expanded, onToggleExpand }: { node: LdNode; program: LadderProgram; routines: readonly string[]; update: (change: (rung: LdRung) => LdRung) => void; expanded: boolean; onToggleExpand: () => void }) {
  const names = useMemo(() => [...new Set([...namesInUse(program), ...allIo().map(ioName), ...Object.keys(CLOCK_VARS)])], [program]);
  const change = (next: LdNode) => update((rung) => replaceNode(rung, node.id, () => next));
  const bitOrNull = (text: string) => (isLdBit(text.trim()) ? text.trim() : null);
  const OPERAND_HELP = "En tagg, T1.ET, C1.CV eller ett tal.";
  const timeOf = (text: string) => parseTimeLiteral(text.trim().replace(/^T#/i, "").replace(",", "."));
  if (node.kind === "no" || node.kind === "nc") return <>
    <Typed className="w-36" id="plc-ld-var" label="Tagg" value={node.var} parse={bitOrNull} onChange={(name) => change({ ...node, var: name })} help={NAME_HELP} suggestions={names} />
    <LabeledSelect className="w-32" label="Kontakt" value={node.kind} options={[{ value: "no", label: "Slutande (NO)" }, { value: "nc", label: "Brytande (NC)" }]} onChange={(event) => change({ ...node, kind: event.target.value as "no" | "nc" })} data-testid="plc-ld-contact-kind" />
  </>;
  if (node.kind === "cmp") return <>
    <Typed className="w-28" id="plc-ld-left" label="IN1" value={operandText(node.left)} parse={parseOperand} onChange={(left) => change({ ...node, left })} help={OPERAND_HELP} suggestions={names} />
    <LabeledSelect className="w-20" id="plc-ld-op" label="Jämförelse" value={node.op} options={LD_CMP_OPS.map((op) => ({ value: op, label: CMP_NAMES[op] }))} onChange={(event) => change({ ...node, op: event.target.value as LdCmpOp })} />
    <Typed className="w-28" id="plc-ld-right" label="IN2" value={operandText(node.right)} parse={parseOperand} onChange={(right) => change({ ...node, right })} help={OPERAND_HELP} suggestions={names} />
  </>;
  if (node.kind === "ton" || node.kind === "tof" || node.kind === "tp") return <>
    <Typed className="w-28" id="plc-ld-name" label="Namn" value={node.name} parse={nameOrNull} onChange={(name) => change({ ...node, name })} help={NAME_HELP} />
    <Typed className="w-20" id="plc-ld-pt" label="PT" value={ptLiteral(node.ptMs)} parse={timeOf} onChange={(ptMs) => change({ ...node, ptMs })} help="Skriv 2s, 500ms eller 1m30s." />
    <LabeledSelect className="w-20" label="Block" value={node.kind} options={[{ value: "ton", label: "TON" }, { value: "tof", label: "TOF" }, { value: "tp", label: "TP" }]} onChange={(event) => change({ ...node, kind: event.target.value as "ton" | "tof" | "tp" })} />
  </>;
  if (node.kind === "ctu" || node.kind === "ctd") return <>
    <Typed className="w-28" id="plc-ld-name" label="Namn" value={node.name} parse={nameOrNull} onChange={(name) => change({ ...node, name })} help={NAME_HELP} />
    <Typed className="w-16" id="plc-ld-pv" label="PV" value={String(node.pv)} parse={(text) => (/^-?\d+$/.test(text.trim()) ? Number(text.trim()) : null)} onChange={(pv) => change({ ...node, pv })} help="Ett heltal." />
    <Typed className="w-28" id="plc-ld-aux" label={node.kind === "ctu" ? "R" : "LD"} value={node.aux ?? ""} parse={(text) => (text.trim() === "" ? "" : nameOrNull(text))} onChange={(aux) => change({ ...node, aux: aux || null })} help={NAME_HELP} suggestions={names} />
    <LabeledSelect className="w-20" label="Block" value={node.kind} options={[{ value: "ctu", label: "CTU" }, { value: "ctd", label: "CTD" }]} onChange={(event) => change({ ...node, kind: event.target.value as "ctu" | "ctd" })} />
  </>;
  if (node.kind === "r_trig" || node.kind === "f_trig") return <>
    <Typed className="w-28" id="plc-ld-name" label="Namn" value={node.name} parse={nameOrNull} onChange={(name) => change({ ...node, name })} help={NAME_HELP} />
    <LabeledSelect className="w-24" label="Block" value={node.kind} options={[{ value: "r_trig", label: "R_TRIG" }, { value: "f_trig", label: "F_TRIG" }]} onChange={(event) => change({ ...node, kind: event.target.value as "r_trig" | "f_trig" })} />
  </>;
  if (node.kind === "calc") return <>
    <LabeledSelect className="w-20" label="Block" value={node.op} options={LD_CALC_OPS.map((op) => ({ value: op, label: CALC_NAMES[op] }))} onChange={(event) => { const op = event.target.value as LdCalcOp; change({ ...node, op, b: op === "MOVE" ? null : node.b ?? { kind: "const", value: 1, type: "INT" } }); }} />
    <Typed className="w-24" id="plc-ld-a" label={node.op === "MOVE" ? "IN" : "IN1"} value={operandText(node.a)} parse={parseOperand} onChange={(a) => change({ ...node, a })} help={OPERAND_HELP} suggestions={names} />
    {node.b ? <Typed className="w-24" id="plc-ld-b" label="IN2" value={operandText(node.b)} parse={parseOperand} onChange={(b) => change({ ...node, b })} help={OPERAND_HELP} suggestions={names} /> : null}
    <Typed className="w-24" id="plc-ld-dest" label="OUT" value={node.dest} parse={nameOrNull} onChange={(dest) => change({ ...node, dest })} help={NAME_HELP} suggestions={names} />
  </>;
  if (node.kind === "call") return <LabeledSelect className="w-36" label="Rutin" value={node.routine} options={(routines.includes(node.routine) ? routines : [node.routine, ...routines]).map((name) => ({ value: name, label: name }))} onChange={(event) => change({ ...node, routine: event.target.value })} data-testid="plc-ld-call-routine" />;
  if (node.kind === "ret") return <p className="plc-help">RET avslutar rutinen när flödet är till.</p>;
  if (node.kind === "st") return <div className="grid min-w-0 flex-1 gap-1">
    <div className="flex items-center gap-2"><label htmlFor="plc-ld-st-text">ST-satser i blocket</label><ChromeButton className="ml-auto" onClick={onToggleExpand} data-testid="plc-ld-st-toggle">{expanded ? "Fäll ihop" : "Visa alla rader"}</ChromeButton></div>
    <textarea id="plc-ld-st-text" className="plc-textarea" rows={Math.min(6, Math.max(2, stBlockLines(node.text).length))} value={node.text} spellCheck={false} data-testid="plc-ld-st-text" onChange={(event) => change({ ...node, text: event.target.value })} />
  </div>;
  return <p className="plc-help">Parallell grupp med {node.kind === "parallel" ? node.branches.length : 0} grenar. Lägg till en gren med Gren; ta bort en gren genom att ta bort dess element.</p>;
}

// ---------- the panel ----------

const SYMBOL_D: Record<string, ReactNode> = {
  no: <><line x1="0" y1="8" x2="6" y2="8" /><line x1="6" y1="3" x2="6" y2="13" /><line x1="12" y1="3" x2="12" y2="13" /><line x1="12" y1="8" x2="18" y2="8" /></>,
  nc: <><line x1="0" y1="8" x2="6" y2="8" /><line x1="6" y1="3" x2="6" y2="13" /><line x1="12" y1="3" x2="12" y2="13" /><line x1="12" y1="8" x2="18" y2="8" /><line x1="7" y1="12" x2="11" y2="4" /></>,
  coil: <><line x1="0" y1="8" x2="5" y2="8" /><path d="M 7 3 A 6 6 0 0 0 7 13" fill="none" /><path d="M 11 3 A 6 6 0 0 1 11 13" fill="none" /><line x1="13" y1="8" x2="18" y2="8" /></>,
  ncoil: <><line x1="0" y1="8" x2="5" y2="8" /><path d="M 7 3 A 6 6 0 0 0 7 13" fill="none" /><path d="M 11 3 A 6 6 0 0 1 11 13" fill="none" /><line x1="13" y1="8" x2="18" y2="8" /><line x1="7" y1="12" x2="11" y2="4" /></>,
  set: <><path d="M 7 3 A 6 6 0 0 0 7 13" fill="none" /><path d="M 11 3 A 6 6 0 0 1 11 13" fill="none" /><text x="9" y="11" textAnchor="middle" fontSize="8" stroke="none" fill="currentColor" fontWeight="700">S</text></>,
  reset: <><path d="M 7 3 A 6 6 0 0 0 7 13" fill="none" /><path d="M 11 3 A 6 6 0 0 1 11 13" fill="none" /><text x="9" y="11" textAnchor="middle" fontSize="8" stroke="none" fill="currentColor" fontWeight="700">R</text></>,
};

export function LadderPanel() {
  const { runtime, desk } = useDesktop();
  const snapshot = useRuntimeSnapshot();
  const { popouts } = useDeskState();
  const phone = usePhone();
  const { layout, engine, compile, cursor, openRoutine, accepted, stUnread } = snapshot;
  const full = layout.ladder;
  const program = useMemo(() => (full ? routineView(full, openRoutine) : null), [full, openRoutine]);
  const [tab, setTab] = useState<InstructionTab>("favoriter");
  const [line, setLine] = useState("");
  const [lineProblem, setLineProblem] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; width: number; height: number; items: MenuItem[] } | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const diagramRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const pressRef = useRef<Press | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const windowsRef = useRef<(() => void) | null>(null);
  // The click that ends a drag must not also select. It is only awaited for the moment after the release: a drag that ended over no
  // shared element gives no click at all, and the flag must not then eat the person's next, real click (the old rung-jump bug).
  const suppressClick = useRef(false);
  useEffect(() => {
    const box = diagramRef.current;
    if (!box) return;
    const Observer = box.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new Observer(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, [popouts]);

  const update = useCallback((change: (current: LadderProgram) => LadderProgram, history = true) => runtime.updateLadder((current) => fromRoutineView(current, openRoutine, change(routineView(current, openRoutine))), { history }), [runtime, openRoutine]);
  const select = useCallback((next: { rungId: string; nodeId?: string; outputId?: string } | null) => runtime.setCursor(next ? { routine: openRoutine, ...next } : null), [runtime, openRoutine]);
  const toggleExpand = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const flow = useMemo<LadderFlow | null>(() => {
    if (!full || !engine.run || !engine.program || !engine.compiled) return null;
    const inputs = new Set([...engine.compiled.vars.values()].filter((info) => info.io?.kind === "DI" || info.io?.kind === "AI" || info.name.toUpperCase() in CLOCK_VARS).map((info) => info.name));
    return evaluateLadder(full, engine.varsBefore ?? engine.program.vars, engine.program.vars, inputs, engine.program.fbs, engine.forces);
  }, [full, engine.run, engine.program, engine.varsBefore, engine.compiled, engine.forces]);
  const nc = useMemo(() => ncInputs(layout), [layout]);
  const marksAll: EditMarks = useMemo(() => editMarks(accepted, full), [accepted, full]);
  const geometries = useMemo(() => new Map((program?.rungs ?? []).map((rung) => [rung.id, layoutRung(rung, { minWidth: Math.max(0, boxWidth - 2), expanded })] as const)), [program, boxWidth, expanded]);
  const payload = drag?.payload ?? null;
  const marks = useMemo(() => (payload && program ? new Map(program.rungs.map((rung) => [rung.id, rungSlots(rung, geometries.get(rung.id)!, payload)] as const)) : null), [payload, program, geometries]);
  const routineNames = useMemo(() => (full?.routines ?? []).map((routine) => routine.name), [full]);

  const selectedRung = program && cursor && cursor.routine === openRoutine ? program.rungs.find((rung) => rung.id === cursor.rungId) ?? null : null;
  const selectedNode = selectedRung && cursor?.nodeId ? findNode(selectedRung, cursor.nodeId) : null;
  const selectedOutput = selectedRung && cursor?.outputId ? selectedRung.outputs.find((output) => output.id === cursor.outputId) ?? null : null;
  // A terminal that a tag is an alias for counts as used too: a new contact on it would be refused ("DI0 används redan av A").
  const used = useMemo(() => new Set(program ? [...namesInUse(program), ...program.vars.flatMap((variable) => (variable.address ? [variable.address] : []))] : []), [program]);
  const firstOf = (kind: "DI" | "DO") => allIo().filter((point) => point.kind === kind).map(ioName).find((name) => !used.has(name)) ?? (kind === "DI" ? "DI0" : "DO0");
  const defaults = (): DropDefaults => ({ input: firstOf("DI"), analog: "AI0", output: firstOf("DO"), st: ST_DEFAULT, routine: routineNames[0] });

  const liveRef = useRef({ program, geometries, marks, openRoutine });
  useEffect(() => { liveRef.current = { program, geometries, marks, openRoutine }; });

  // A selected rung comes into view when something else marked it: an ST line, an error, a cross reference.
  useEffect(() => {
    if (!cursor) return;
    diagramRef.current?.querySelector(`[data-rung-row="${cursor.rungId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // ---------- drag and drop ----------
  const findOver = (dragged: Payload, x: number, y: number): Over | null => {
    const toolbar = toolbarRef.current?.getBoundingClientRect();
    if (toolbar && inside(toolbar, x, y)) return dragged.kind === "new" ? null : { kind: "trash" };
    const diagram = diagramRef.current;
    if (!diagram) return null;
    const rows = [...diagram.querySelectorAll<HTMLElement>("[data-rung-row]")];
    if (dragged.kind === "rung") {
      if (!inside(diagram.getBoundingClientRect(), x, y)) return null;
      return { kind: "rung", index: rungSlotAt(rows.map((row) => { const rect = row.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; }), y) };
    }
    for (const row of rows) {
      const svg = row.querySelector("svg");
      const rect = svg?.getBoundingClientRect();
      if (!svg || !rect || y < rect.top || y > rect.bottom || x < rect.left || x > rect.right) continue;
      const rungId = row.dataset.rungRow ?? "";
      const geometry = liveRef.current.geometries.get(rungId), rungMarks = liveRef.current.marks?.get(rungId);
      if (!geometry || !rungMarks) return null;
      const mark = hitSlot(geometry, rungMarks, { x: x - rect.left, y: y - rect.top });
      return mark ? { kind: "slot", rungId, mark } : null;
    }
    return null;
  };
  const drop = (state: DragState) => {
    const current = liveRef.current.program;
    const { payload: dragged, over } = state;
    if (!current || !over) return;
    if (over.kind === "trash") { if (dragged.kind !== "new") { update(() => removePayload(current, dragged)); runtime.setCursor(null); } return; }
    if (over.kind === "rung") {
      if (dragged.kind !== "rung") return;
      const result = applyDrop(current, dragged, { kind: "rung", index: over.index }, defaults());
      if (result) { update(() => result.program); select({ rungId: dragged.rungId }); }
      return;
    }
    if (!over.mark.legal) return;
    if (dragged.kind === "new") needRoutine(dragged.tool);
    const moved = dragged.kind === "node" || dragged.kind === "output" ? { ...dragged, copy: state.copy } : dragged;
    const result = applyDrop(current, moved, over.mark.slot, defaults());
    if (!result?.selection) return;
    update(() => result.program);
    const chosen = result.selection;
    select(chosen.kind === "node" ? { rungId: chosen.rungId, nodeId: chosen.nodeId } : chosen.kind === "output" ? { rungId: chosen.rungId, outputId: chosen.outputId } : { rungId: chosen.rungId });
    if (result.focus) focusInspector();
  };
  const detach = () => { windowsRef.current?.(); windowsRef.current = null; if (pressRef.current?.timer) clearTimeout(pressRef.current.timer); pressRef.current = null; dragRef.current = null; setDrag(null); };
  const startDrag = (press: Press, x: number, y: number, copy: boolean) => {
    press.started = true;
    const state: DragState = { payload: press.payload, label: press.label, x, y, copy, over: null, doc: press.target.document };
    dragRef.current = state;
    setDrag(state);
  };
  const beginPress = (event: ReactPointerEvent, dragged: Payload, label: string) => {
    if (event.button !== 0 || pressRef.current) return;
    const touch = event.pointerType === "touch";
    const target = event.currentTarget.ownerDocument.defaultView ?? window;
    const press: Press = { payload: dragged, label, x: event.clientX, y: event.clientY, pointerId: event.pointerId, touch, timer: null, started: false, target };
    pressRef.current = press;
    if (touch) press.timer = setTimeout(() => { if (pressRef.current === press && !press.started) startDrag(press, press.x, press.y, false); }, 450);
    const onMove = (next: PointerEvent) => {
      if (next.pointerId !== press.pointerId) return;
      if (!press.started) {
        if (Math.hypot(next.clientX - press.x, next.clientY - press.y) <= (press.touch ? 10 : 5)) return;
        if (press.touch) { detach(); return; }
        startDrag(press, next.clientX, next.clientY, next.ctrlKey);
      }
      next.preventDefault();
      const state = dragRef.current;
      if (!state) return;
      const moved: DragState = { ...state, x: next.clientX, y: next.clientY, copy: next.ctrlKey, over: findOver(state.payload, next.clientX, next.clientY) };
      dragRef.current = moved;
      setDrag(moved);
    };
    const onUp = (next: PointerEvent) => {
      if (next.pointerId !== press.pointerId) return;
      if (press.started && dragRef.current) {
        drop({ ...dragRef.current, copy: next.ctrlKey, over: findOver(dragRef.current.payload, next.clientX, next.clientY) });
        // The browser sends its click right after this event, or none at all: the flag lives only until the next task.
        suppressClick.current = true;
        target.setTimeout(() => { suppressClick.current = false; }, 0);
      }
      detach();
    };
    const onCancel = () => detach();
    const onKey = (next: KeyboardEvent) => { if (next.key === "Escape") detach(); };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onCancel);
    target.addEventListener("keydown", onKey);
    windowsRef.current = () => { target.removeEventListener("pointermove", onMove); target.removeEventListener("pointerup", onUp); target.removeEventListener("pointercancel", onCancel); target.removeEventListener("keydown", onKey); };
  };
  const swallowAfterDrag = (event: React.MouseEvent) => { if (suppressClick.current) { suppressClick.current = false; event.stopPropagation(); event.preventDefault(); } };
  useEffect(() => () => { if (pressRef.current?.timer) clearTimeout(pressRef.current.timer); windowsRef.current?.(); }, []);

  const focusInspector = () => requestAnimationFrame(() => { const field = inspectorRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea"); field?.focus(); field?.select(); });

  // ---------- editing ----------
  const targetRung = (): string | null => selectedRung?.id ?? program?.rungs.at(-1)?.id ?? null;
  const needRoutine = (tool: ToolKind) => {
    if (tool !== "call" || routineNames.length) return;
    runtime.updateLadder((current) => addRoutine(current).program);
    notice("Rutin1 är skapad. Välj den under Rutin för att skriva den.");
  };
  const insertTool = (tool: ToolKind) => {
    if (!program) return;
    if (tool === "parallel") { branch(); return; }
    needRoutine(tool);
    let rungId = targetRung();
    let chosen: { rungId: string; nodeId?: string; outputId?: string } | null = null;
    update((current) => {
      let next = current;
      if (!rungId) { const added = addRung(current, null); next = added.program; rungId = added.rungId; }
      if (isOutputTool(tool)) {
        next = addOutput(next, rungId!, tool, firstOf("DO"));
        chosen = { rungId: rungId!, outputId: next.rungs.find((rung) => rung.id === rungId)!.outputs.at(-1)!.id };
      } else {
        const node: LdNode = tool === "st" ? { id: freeLdId("e", next), kind: "st", text: ST_DEFAULT } : instructionNode(next, tool, defaults());
        const after = cursor?.rungId === rungId ? cursor.nodeId ?? null : null;
        next = updateRung(next, rungId!, (rung) => insertNode(rung, after, node));
        chosen = { rungId: rungId!, nodeId: node.id };
      }
      return next;
    });
    if (chosen) { select(chosen); focusInspector(); }
  };
  /**
   * Gren works whatever is marked. An element gets its branch; a coil gets a second coil, which is how outputs stand in parallel; a
   * rung's branch goes around its last element, and an empty rung (or no rung at all) gets a contact to branch around.
   */
  const branch = () => {
    if (!program) return;
    if (selectedOutput && selectedRung) { insertTool("coil"); return; }
    const rungOf = selectedRung ?? program.rungs.at(-1) ?? null;
    let rungId = rungOf?.id ?? null;
    const around = selectedNode ?? rungOf?.items.at(-1) ?? null;
    let chosen: string | null = null;
    update((current) => {
      let next = current;
      if (!rungId) { const added = addRung(current, null); next = added.program; rungId = added.rungId; }
      let targetId = around?.id ?? null;
      if (!targetId) {
        const first = instructionNode(next, "no", defaults());
        next = updateRung(next, rungId!, (rung) => insertNode(rung, null, first));
        targetId = first.id;
      }
      const inUse = new Set([...namesInUse(next), ...next.vars.flatMap((variable) => (variable.address ? [variable.address] : []))]);
      const free = allIo().filter((point) => point.kind === "DI").map(ioName).find((name) => !inUse.has(name)) ?? "DI0";
      const node = instructionNode(next, "no", { ...defaults(), input: free });
      next = updateRung(next, rungId!, (rung) => addBranch(rung, targetId!, node, freeLdId("g", { ...next, seq: Number(node.id.slice(1)) })));
      chosen = node.id;
      return next;
    });
    if (chosen && rungId) select({ rungId, nodeId: chosen });
  };
  const newRung = (before = false) => {
    if (!program) return;
    if (program.rungs.length >= MAX_RUNGS) { announce(`Högst ${MAX_RUNGS} rungar.`, true); return; }
    let rungId = "";
    update((current) => { const added = before && cursor ? addRungBefore(current, cursor.rungId) : addRung(current, selectedRung?.id ?? null); rungId = added.rungId; return added.program; });
    if (rungId) select({ rungId });
  };
  const remove = () => {
    if (!cursor || !selectedRung) return false;
    if (cursor.nodeId) { const id = cursor.nodeId; update((current) => updateRung(current, cursor.rungId, (rung) => removeNode(rung, id))); select({ rungId: cursor.rungId }); return true; }
    if (cursor.outputId) { const id = cursor.outputId; update((current) => removeOutput(current, cursor.rungId, id)); select({ rungId: cursor.rungId }); return true; }
    const at = program?.rungs.findIndex((rung) => rung.id === cursor.rungId) ?? -1;
    const neighbour = program?.rungs[at + 1]?.id ?? program?.rungs[at - 1]?.id;
    update((current) => removeRung(current, cursor.rungId));
    select(neighbour ? { rungId: neighbour } : null);
    return true;
  };
  const duplicate = () => {
    if (!program || !selectedRung) return false;
    const source = selectedRung;
    let rungId = "";
    update((current) => {
      const added = addRung(current, source.id);
      rungId = added.rungId;
      const copy = (items: readonly LdNode[], top: { n: number }): LdNode[] => items.map((node) => { top.n += 1; return node.kind === "parallel" ? { ...node, id: `g${top.n}`, branches: node.branches.map((branch) => copy(branch, top)) } : { ...node, id: `e${top.n}` }; });
      const top = { n: Number(/\d+$/.exec(added.rungId)?.[0] ?? 0) + 1 };
      const items = copy(source.items, top);
      const outputs = source.outputs.map((output) => { top.n += 1; return { ...output, id: `o${top.n}` }; });
      return updateRung(added.program, added.rungId, (rung) => ({ ...rung, comment: source.comment, items, outputs }));
    });
    if (rungId) select({ rungId });
    return true;
  };
  // Ctrl+D and Ta bort in the menu act here when this was the panel last worked in.
  const commands = useRef({ duplicate, remove });
  useEffect(() => { commands.current = { duplicate, remove }; });
  useEffect(() => { desk.setProgram({ duplicate: () => commands.current.duplicate(), remove: () => commands.current.remove() }); return () => desk.setProgram(null); }, [desk]);

  const typeLine = () => {
    const result = parseInstructionLine(line);
    if (!result.ok) { setLineProblem(result.reason); return; }
    setLineProblem(null);
    let rungId = targetRung();
    update((current) => {
      let next = current;
      if (!rungId) { const added = addRung(current, null); next = added.program; rungId = added.rungId; }
      for (const draft of result.parsed.nodes) {
        const node = { ...draft, id: freeLdId("e", next) } as LdNode;
        next = updateRung(next, rungId!, (rung) => ({ ...rung, items: [...rung.items, node] }));
      }
      for (const out of result.parsed.outputs) next = addOutput(next, rungId!, out.kind, out.var);
      return next;
    });
    setLine("");
    if (rungId) select({ rungId });
  };

  const openMenu = (event: React.MouseEvent, at: { rungId: string; nodeId?: string; outputId?: string }, tag: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    select(at);
    const box = frameRef.current?.getBoundingClientRect();
    const items: MenuItem[] = [
      { label: "Infoga rung före", onPick: () => { runtime.setCursor({ routine: openRoutine, rungId: at.rungId }); newRung(true); } },
      { label: "Infoga rung efter", hint: "Insert", onPick: () => { runtime.setCursor({ routine: openRoutine, rungId: at.rungId }); newRung(); } },
      { label: "Kommentar", onPick: () => { select({ rungId: at.rungId }); focusInspector(); } },
      { label: "Gå till ST-rad", onPick: () => { select(at); desk.set({ stFocusTick: desk.getSnapshot().stFocusTick + 1 }); } },
      ...(tag ? [
        { label: "Korsreferens", onPick: () => desk.set({ xrefTag: tag.split(".")[0], bottomTab: "xref" as const }) },
        { label: "Övervaka tagg", onPick: () => { runtime.watch(tag); desk.set({ bottomTab: "watch" as const }); } },
        { label: "Lägg till i trend", onPick: () => runtime.addTrendPen(`var:${tag}`) },
      ] : []),
      { label: "Ta bort rung", danger: true, onPick: () => { runtime.setCursor({ routine: openRoutine, rungId: at.rungId }); update((current) => removeRung(current, at.rungId)); select(null); } },
    ];
    setMenu({ x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0), width: box?.width ?? 300, height: box?.height ?? 300, items });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, textarea, select")) return;
    if (event.key === "Insert") { event.preventDefault(); newRung(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") { event.preventDefault(); branch(); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); }
    else if (event.key === "Escape") runtime.setCursor(null);
    else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && program?.rungs.length) {
      event.preventDefault();
      const at = program.rungs.findIndex((rung) => rung.id === selectedRung?.id);
      const next = program.rungs[Math.max(0, Math.min(program.rungs.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) select({ rungId: next.id });
    }
  };

  const verify = () => {
    const result = runtime.verify();
    desk.set({ bottomTab: "errors" });
    if (result.ok) notice("Programmet är verifierat och accepterat.");
    else announce(`Programmet har ett fel på rad ${result.problem.line}.`, true);
  };
  const newRoutine = () => {
    if (!full) return;
    let id = "";
    runtime.updateLadder((current) => { const added = addRoutine(current); id = added.routine.id; return added.program; });
    if (id) runtime.setOpenRoutine(id);
  };

  const problem = compile && !compile.ok ? compile.problem : null;
  const ncSelected = selectedNode && (selectedNode.kind === "no" || selectedNode.kind === "nc") ? ncInputOf(program ?? { name: "x", vars: [], rungs: [] }, nc, selectedNode.var) : null;
  const status = drag ? dragText(drag) : stUnread ? `ST-texten går inte att läsa just nu. Ladder visar den senaste version som gick. ${stUnread}` : ncSelected && selectedNode && "var" in selectedNode ? ncExplanation(selectedNode.var, ncSelected) : flow ? "RUN: grönt och tjockt är det som leder nu." : marksAll.changed ? "Ändringar väntar: Verifiera (F7) accepterar dem." : `${program?.rungs.length ?? 0} ${program?.rungs.length === 1 ? "rung" : "rungar"}.`;
  const activeGap = drag?.over?.kind === "rung" ? drag.over.index : null;
  const trashActive = drag?.over?.kind === "trash";
  const removedHere = marksAll.removed.filter((item) => item.routine === openRoutine);
  const inWindow = popouts.includes("ladder");

  return <div ref={frameRef} className="relative flex h-full min-h-0 flex-col" data-testid="plc-ladder" data-changed={marksAll.changed} data-dragging={drag ? drag.payload.kind : undefined} onKeyDown={onKeyDown}>
    <div ref={toolbarRef} className="relative flex-none border-b border-[var(--plc-line)] bg-[var(--plc-bg)]" onClickCapture={swallowAfterDrag}>
      <div className="flex flex-wrap items-center gap-1 px-1 py-0.5">
        <ChromeButton tone={marksAll.changed ? "primary" : undefined} onClick={verify} title="Kompilera, lista fel och acceptera ändringarna (F7)" data-testid="plc-ld-verify"><CheckCheck aria-hidden="true" />Verifiera</ChromeButton>
        <ToolButton label="Ny rung (Insert)" onClick={() => newRung()} data-testid="plc-ld-new-rung"><Plus aria-hidden="true" /></ToolButton>
        <ToolButton label="Flytta rungen upp" disabled={!selectedRung} onClick={() => { const id = selectedRung?.id; if (id) update((current) => moveRung(current, id, -1)); }} data-testid="plc-ld-up"><ArrowUp aria-hidden="true" /></ToolButton>
        <ToolButton label="Flytta rungen ned" disabled={!selectedRung} onClick={() => { const id = selectedRung?.id; if (id) update((current) => moveRung(current, id, 1)); }} data-testid="plc-ld-down"><ArrowDown aria-hidden="true" /></ToolButton>
        <ToolButton label="Ta bort det markerade (Delete)" disabled={!cursor} onClick={remove} data-testid="plc-ld-remove"><Trash2 aria-hidden="true" /></ToolButton>
        <span className="plc-tool-sep" />
        <select className="plc-select" aria-label="Rutin" value={openRoutine ?? ""} data-testid="plc-ld-routine" onChange={(event) => { if (event.target.value === "+") newRoutine(); else runtime.setOpenRoutine(event.target.value || null); }}>
          <option value="">Huvudrutin</option>
          {(full?.routines ?? []).map((routine) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}
          <option value="+">Ny rutin …</option>
        </select>
        <label className="flex min-w-32 flex-1 items-center gap-1">
          <span className="sr-only">Skriv instruktioner</span>
          <input className="plc-input w-full font-mono" placeholder="NO Start NC Stopp COIL Motor" value={line} data-testid="plc-ld-line" aria-invalid={lineProblem !== null} title={lineProblem ?? "Skriv instruktioner i rungens ordning. Enter lägger in dem."} onChange={(event) => { setLine(event.target.value); setLineProblem(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); typeLine(); } }} />
        </label>
        {phone || inWindow ? null : <ToolButton label="Ladder i eget fönster" onClick={() => { if (desk.dock) void popOut(desk.dock, "ladder"); }} data-testid="plc-program-popout-ladder"><ExternalLink aria-hidden="true" /></ToolButton>}
      </div>
      {lineProblem ? <p className="px-2 text-[var(--plc-fault)]" role="alert" data-testid="plc-ld-line-problem">{lineProblem}</p> : null}
      <div className="flex flex-wrap items-end gap-px px-1" role="tablist" aria-label="Instruktioner" data-testid="plc-ld-tabs">
        {INSTRUCTION_TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={cn("border border-b-0 border-transparent px-2 py-px", tab === item.id ? "border-[var(--plc-line)] bg-[var(--plc-panel)] font-semibold" : "text-[var(--plc-muted)] hover:bg-[var(--plc-hover)]")} onClick={() => setTab(item.id)} data-testid="plc-ld-tab" data-tab={item.id}>{item.label}</button>)}
      </div>
      <div className="flex min-h-7 flex-wrap items-center gap-px border-t border-[var(--plc-line)] bg-[var(--plc-panel)] p-0.5" role="toolbar" aria-label="Ladder-verktyg">
        {toolsInTab(tab).map((item) => <button key={item.tool} type="button" className="plc-tool touch-none" title={item.title} aria-label={`${item.name}: ${item.title}`} data-testid={`plc-ld-add-${item.tool}`} data-tool={item.tool} onClick={() => insertTool(item.tool)} onPointerDown={(event) => beginPress(event, { kind: "new", tool: item.tool }, item.name)}>
          {item.symbol ? <svg viewBox="0 0 18 16" width={22} height={18} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true">{SYMBOL_D[item.symbol]}</svg> : <span className="font-mono text-[11px] font-semibold">{item.name}</span>}
        </button>)}
      </div>
      {drag && drag.payload.kind !== "new" ? <div data-testid="plc-ld-trash" data-active={trashActive || undefined} className={cn("pointer-events-none absolute inset-1 flex items-center justify-center gap-1.5 border border-dashed bg-[var(--plc-panel)]", trashActive ? "border-[var(--plc-fault)] text-[var(--plc-fault)]" : "border-[var(--plc-accent)]")}><Trash2 aria-hidden="true" className="size-3.5" />Släpp här för att ta bort</div> : null}
    </div>
    <div ref={diagramRef} className="plc-scroll bg-[var(--plc-field)]" tabIndex={0} aria-label="Ladder-diagram" data-testid="plc-ld-diagram" onClickCapture={swallowAfterDrag} onClick={() => runtime.setCursor(null)}>
      {program ? <div className="min-w-max">
        {program.rungs.map((rung, index) => {
          const ghosts = removedHere.filter((item) => item.beforeRungId === rung.id);
          return <div key={rung.id}>
            {ghosts.map((item) => <RemovedRow key={`r${item.number}`} number={item.number} comment={item.comment} />)}
            <div data-gap={index} className={cn("h-1", activeGap === index && "bg-[var(--plc-accent)]")} aria-hidden="true" />
            <div data-rung-row={rung.id}>
              <Rung rung={rung} number={index} geometry={geometries.get(rung.id) ?? layoutRung(rung)} flow={flow} cursor={cursor?.routine === openRoutine ? cursor : null} mark={marksAll.marks.get(rung.id) ?? null} onSelect={select} onOpen={focusInspector} onMenu={openMenu} program={full ?? program} nc={nc} expanded={expanded} onToggleExpand={toggleExpand} onPress={beginPress}
                values={flow ? flow.vars : null} blocks={engine.run && engine.program ? engine.program.fbs : null}
                drag={drag && marks && drag.payload.kind !== "rung" ? { marks: marks.get(rung.id) ?? [], active: drag.over?.kind === "slot" && drag.over.rungId === rung.id ? drag.over.mark : null } : null} />
            </div>
          </div>;
        })}
        {removedHere.filter((item) => item.beforeRungId === null).map((item) => <RemovedRow key={`r${item.number}`} number={item.number} comment={item.comment} />)}
        <div data-gap={program.rungs.length} className={cn("h-1", activeGap === program.rungs.length && "bg-[var(--plc-accent)]")} aria-hidden="true" />
        <EndRung width={Math.max(boxWidth - 2, 200)} />
      </div> : <p className="plc-help p-2">Inget Ladder-program ännu. {stUnread ?? ""}</p>}
    </div>
    <div className="flex-none border-t border-[var(--plc-line)] px-2 py-0.5" aria-live="polite">
      {problem && !drag ? <p role="alert" className="text-[var(--plc-fault)] [overflow-wrap:anywhere]" data-testid="plc-ld-problem">Programmet går inte att köra: {problem.message} (ST-rad {problem.line}).</p>
        : <p className={cn("plc-help truncate", drag?.over?.kind === "slot" && !drag.over.mark.legal && !drag.over.mark.same && "text-[var(--plc-fault)]")} data-testid="plc-ld-status" title={status}>{status}</p>}
    </div>
    {selectedRung ? <div ref={inspectorRef} className="flex max-h-32 flex-none flex-wrap items-end gap-2 overflow-auto border-t border-[var(--plc-line)] p-1.5" data-testid="plc-ld-inspector">
      {selectedNode ? <NodeFields node={selectedNode} program={full ?? program!} routines={routineNames} update={(change) => update((current) => updateRung(current, selectedRung.id, change), false)} expanded={expanded.has(selectedNode.id)} onToggleExpand={() => toggleExpand(selectedNode.id)} />
        : selectedOutput ? <>
          <Typed className="w-36" id="plc-ld-out-var" label="Tagg" value={selectedOutput.var} parse={nameOrNull} onChange={(name) => update((current) => updateOutput(current, selectedRung.id, selectedOutput.id, (item) => ({ ...item, var: name })), false)} help={NAME_HELP} suggestions={[...new Set([...namesInUse(program!), ...allIo().filter((point) => point.kind === "DO").map(ioName)])]} />
          <LabeledSelect className="w-32" label="Utgång" value={selectedOutput.kind} data-testid="plc-ld-output-kind" options={[{ value: "coil", label: "Spole" }, { value: "ncoil", label: "Negerad spole" }, { value: "set", label: "Set (S)" }, { value: "reset", label: "Reset (R)" }]} onChange={(event) => update((current) => updateOutput(current, selectedRung.id, selectedOutput.id, (item) => ({ ...item, kind: event.target.value as LdOutput["kind"] })))} />
        </>
        : <>
          <LabeledInput className="min-w-40 flex-1" id="plc-ld-comment" label={`Rung ${program!.rungs.findIndex((rung) => rung.id === selectedRung.id)}: kommentar`} value={selectedRung.comment} onChange={(event) => update((current) => updateRung(current, selectedRung.id, (rung) => ({ ...rung, comment: event.target.value.slice(0, 80) })), false)} />
          {openRoutine ? <>
            <Typed className="w-28" id="plc-ld-routine-name" label="Rutinens namn" value={full?.routines?.find((routine) => routine.id === openRoutine)?.name ?? ""} parse={nameOrNull} onChange={(name) => runtime.updateLadder((current) => renameRoutine(current, openRoutine, name), { history: false })} help={NAME_HELP} />
            <ChromeButton tone="danger" onClick={() => { runtime.updateLadder((current) => removeRoutine(current, openRoutine)); runtime.setOpenRoutine(null); }} data-testid="plc-ld-routine-remove">Ta bort rutinen</ChromeButton>
          </> : null}
        </>}
    </div> : null}
    {menu ? <SurfaceMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} width={menu.width} height={menu.height} /> : null}
    {drag ? createPortal(<div className="pointer-events-none fixed z-50 border border-[var(--plc-accent)] bg-[var(--plc-panel)] px-2 py-1 font-mono text-xs" style={{ left: drag.x + 14, top: drag.y + 14 }} data-testid="plc-ld-ghost" aria-hidden="true">{drag.label}{drag.copy && drag.payload.kind !== "new" && drag.payload.kind !== "rung" ? " (kopia)" : ""}</div>, drag.doc.body) : null}
  </div>;
}

/** A rung that has gone since the last Verifiera: it stands struck through with its mark until then. */
function RemovedRow({ number, comment }: { number: number; comment: string }) {
  return <div className="flex items-center gap-2 px-1 text-[var(--plc-muted)] line-through" data-testid="plc-ld-removed"><span className="font-mono font-bold text-[var(--plc-prog)] no-underline" data-testid="plc-ld-mark">r</span><span>Rung {number}{comment ? `: ${comment}` : ""}</span></div>;
}

function EndRung({ width }: { width: number }) {
  return <svg width={width} height={22} className="block max-w-none" role="img" aria-label="Programmets slut" data-testid="plc-ld-end">
    <line x1={RAIL_X} y1={0} x2={RAIL_X} y2={22} stroke={TEXT} strokeWidth={RAIL} />
    <line x1={width - RAIL_END} y1={0} x2={width - RAIL_END} y2={22} stroke={TEXT} strokeWidth={RAIL} />
    <line x1={RAIL_X} y1={11} x2={width - RAIL_END} y2={11} stroke={MUTED} strokeWidth={WIRE} />
    <rect x={width / 2 - 22} y={3} width={44} height={16} fill="var(--plc-field)" />
    <text x={width / 2} y={15} textAnchor="middle" fontSize={10} fontWeight={600} fill={MUTED}>(End)</text>
  </svg>;
}

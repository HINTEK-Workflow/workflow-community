"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { MachineEventSeverity } from "@/lib/machine/intake";
import { seededRandom } from "@/lib/machine/simulator/random";
import type { EventInput } from "@/lib/machine/simulator/events";
import { stToLadder } from "@/lib/machine/simulator/ladder/convert";
import { generateSt, ladderToSt, type RungLines } from "@/lib/machine/simulator/ladder/generate";
import { emptyLadder, ladderSchema, type LadderProgram, withSeq } from "@/lib/machine/simulator/ladder/model";
import { adoptIds, cursorAtLine, type LdCursor, ladderNotes, validCursor } from "@/lib/machine/simulator/ladder/navigate";
import type { LimitAlarmDef } from "@/lib/machine/simulator/limit-alarm";
import type { PidParams } from "@/lib/machine/simulator/pid";
import { advancePidLoop, createPidLoop, type PidLoopState, type PidProcessKind } from "@/lib/machine/simulator/pid-loop";
import { createTrendBuffer, sampleTrend } from "@/lib/machine/simulator/trend";
import { compileProgram, type CompileResult, type Value } from "@/lib/machine/simulator/st/interpreter";
import type { DeviceKindId } from "@/lib/machine/simulator/surface/devices";
import { connectWire as connectWireOp, type Hit, moveJunction as moveJunctionOp, moveSegment as moveSegmentOp, moveWireEnd as moveWireEndOp, removeDevices, removeWires, setWireKind as setWireKindOp, straightenWire as straightenWireOp } from "@/lib/machine/simulator/surface/edit";
import { type AlarmChange, createEngineState, type DeviceState, type EngineState, forceTag, PLC_SUPPLY_TEXT, reloadRun, startRun, stepEngine, stopRun, type SurfaceSpeed, TICK_MS, touchDevice } from "@/lib/machine/simulator/surface/engine";
import { surfaceExampleById } from "@/lib/machine/simulator/surface/examples";
import { freePlace } from "@/lib/machine/simulator/surface/geometry";
import {
  defaultLabel, type DeviceInst, exportLayoutText, freeDeviceId, importLayoutText, type Layout, loadLayoutText, MAX_DEVICES, MAX_PROGRAM_CHARS, MAX_TREND_PENS, type Point, saveLayoutText,
  startLayout, SURFACE_STORAGE_KEY, type TerminalRef, validateLayout, type WireKind,
} from "@/lib/machine/simulator/surface/layout";
import { holdsKeyForm } from "@/lib/machine/simulator/mask";
import { announce, notice } from "@/lib/workflow/toast";
import type { Simulator } from "../use-simulator";

// PLC-simulatorn (2026-11-02): the Runtime level's runtime, beside the page's main runtime and outside React's
// state. A 50 ms tick moves the drawing surface's engine and the PID loop; React reads a snapshot. The drawing and the program are
// saved in this browser; the level choice too. Nothing here holds the key: an alarm that should reach Workflow is handed to the main
// runtime's sendLocalEvents, which decides whether the page is connected.
// v3 (2026-11-03): the drawing has a history (Ångra/Gör om over devices, wires, junctions and the Ladder program; not over the
// typing in the ST text, which has the text field's own) and the wire tool's operations.
// The program (2026-11-04): Ladder and ST are two views of one program and both can be edited. A change in Ladder writes the text anew; a
// change in the text is read back to Ladder when it can be read, and the text stays as the person wrote it. A change does not disturb a
// running program: what runs is what was last accepted, the rungs that differ carry a mark, and Verifiera (F7) accepts them.

/** One device, one wire, or several of both (ritverktyget, 2026-11-03: marquee, Shift+click, Ctrl+A). */
export type Selection = { kind: "device"; id: string } | { kind: "wire"; id: string } | { kind: "many"; devices: string[]; wires: string[] } | null;
export type AlarmRow = AlarmChange & { id: number; sent: boolean };
const MAX_ALARM_ROWS = 60;
const MAX_HISTORY = 60;
export const KEY_IN_PROGRAM_TEXT = "Programmet innehåller något som ser ut som en nyckel. Det sparas inte.";
export const SUPPLY_ADDED_TEXT = "En 24 V DC-källa lades till: PLC:n matas nu från den.";

/** A line in the Errors list. */
export type ProgramProblem = { level: "error" | "warning"; text: string; line: number | null; col: number | null; cursor: LdCursor };

export type RuntimeSnapshot = {
  /** The program last accepted by Verifiera: the edit marks show what differs from it. */
  accepted: LadderProgram | null;
  /** The last Verifiera's findings; null before the first. */
  problems: ProgramProblem[] | null;
  /** Where each rung stands in the ST text. */
  rungLines: readonly RungLines[];
  /** Why the ST text cannot be read as Ladder right now; Ladder then shows the last readable version. */
  stUnread: string | null;
  /** The element or rung marked in Ladder, and with it the ST lines; never pointing at something gone. */
  cursor: LdCursor;
  /** The routine open in the Ladder view; null is Huvudrutin. */
  openRoutine: string | null;
  /** Counts the trend's samples: the samples themselves are read with trendSamples(). */
  trendVersion: number;
  /** Tags being watched, in the Övervaka list. */
  watched: readonly string[];
  layout: Layout;
  engine: EngineState;
  /** The last compile of the program text, or null before the first. */
  compile: CompileResult | null;
  /** The text changed after the last compile. */
  programDirty: boolean;
  pid: PidLoopState;
  alarms: AlarmRow[];
  selected: Selection;
  /** The finding whose wires and devices are marked on the surface. */
  highlight: string | null;
  canUndo: boolean; canRedo: boolean;
  /** The ST text is exactly what the Ladder program generates. */
  stIsGenerated: boolean;
  storeProblem: string | null;
};

const toEvent = (alarm: AlarmChange): EventInput => ({ type: "alarm", code: alarm.code, severity: alarm.severity, state: alarm.state, text: alarm.text });

/** A text read as Ladder when it can be; what can be drawn is. */
function readText(text: string, previous: LadderProgram | null): { ladder: LadderProgram; lines: RungLines[] } | { reason: string } {
  const read = stToLadder(text);
  if (!read.ok) return { reason: read.reason };
  const adopted = adoptIds(previous, read.ladder, read.lines);
  const checked = ladderSchema.safeParse(adopted.ladder);
  return checked.success ? adopted : { reason: "Programmet går inte att visa som Ladder: det är för stort." };
}

/** An empty program opens in Ladder with one empty rung (2026-11-03); the rest of the drawing is kept as given. */
const inLadder = (base: Layout): Layout => {
  const ladder: LadderProgram = { ...emptyLadder(), rungs: [{ id: "r1", comment: "", items: [], outputs: [] }] };
  return { ...base, ladder, program: ladderToSt(ladder), language: "ld" };
};

function createRuntime(simulator: Simulator) {
  let layout = inLadder(startLayout());
  let engine = createEngineState(layout);
  let compile: CompileResult | null = null;
  let programDirty = true;
  let pid = createPidLoop("oven");
  let alarms: AlarmRow[] = [];
  let selected: Selection = null;
  let highlight: string | null = null;
  let past: Layout[] = [];
  let future: Layout[] = [];
  let storeProblem: string | null = null;
  let accepted: LadderProgram | null = layout.ladder;
  let problems: ProgramProblem[] | null = null;
  let rungLines: readonly RungLines[] = [];
  let stUnread: string | null = null;
  let cursor: LdCursor = null;
  let openRoutine: string | null = null;
  let watched: readonly string[] = [];
  const trend = createTrendBuffer();
  let nextAlarmId = 1;
  let random = seededRandom(7);
  let lastTickMs = 0;
  const listeners = new Set<() => void>();
  const stIsGenerated = () => layout.ladder !== null && layout.program === ladderToSt(layout.ladder);
  const build = (): RuntimeSnapshot => ({ trendVersion: trend.version, accepted, problems, rungLines, stUnread, cursor, openRoutine, watched, layout, engine, compile, programDirty, pid, alarms, selected, highlight, canUndo: past.length > 0, canRedo: future.length > 0, stIsGenerated: stIsGenerated(), storeProblem });
  let snapshot: RuntimeSnapshot = build();
  const emit = () => { snapshot = build(); for (const listener of listeners) listener(); };
  /** The line map and the marked rung, after any change of the program: nothing goes on pointing at what is gone. */
  const settleProgram = () => {
    if (layout.language === "ld" && layout.ladder) { rungLines = generateSt(layout.ladder).lines; stUnread = null; }
    else if (layout.program.trim()) {
      const read = readText(layout.program, layout.ladder);
      if ("reason" in read) stUnread = read.reason;
      else {
        stUnread = null;
        rungLines = read.lines;
        if (layout.language === "st") layout = { ...layout, ladder: read.ladder };
      }
    } else { rungLines = []; stUnread = null; }
    cursor = validCursor(layout.ladder, cursor);
    if (openRoutine && !layout.ladder?.routines?.some((routine) => routine.id === openRoutine)) openRoutine = null;
  };

  // The public demo's ready machine (adoptTemporary) is not saved over the drawing this browser may hold.
  let saving = true;
  function remember() {
    if (!saving) return;
    const text = saveLayoutText(layout);
    // The last guard: nothing shaped like a key is ever written to the store, whatever path it came in by.
    if (holdsKeyForm(text)) return;
    try { window.localStorage.setItem(SURFACE_STORAGE_KEY, text); } catch { /* A full or closed store only means it is not remembered. */ }
  }
  function setLayout(next: Layout, options: { reset?: boolean; history?: boolean } = {}) {
    if (next === layout) return;
    if (options.history) { past = [...past.slice(-(MAX_HISTORY - 1)), layout]; future = []; }
    // A changed program goes on running as the old one until Verifiera accepts the new: the marks in the margin show the difference.
    const sameProgram = layout.program === next.program;
    layout = next;
    if (options.reset) { engine = createEngineState(layout, engine.speed); compile = null; programDirty = true; problems = null; }
    else if (!sameProgram) programDirty = true;
    if (!sameProgram || options.reset) settleProgram();
    if (options.reset) accepted = layout.ladder;
    // A device or wire that is gone is no longer selected or marked.
    if (selected?.kind === "device") { const chosen = selected.id; if (!layout.devices.some((device) => device.id === chosen)) selected = null; }
    if (selected?.kind === "wire") { const chosen = selected.id; if (!layout.wires.some((wire) => wire.id === chosen)) selected = null; }
    if (selected?.kind === "many") {
      const devices = selected.devices.filter((id) => layout.devices.some((device) => device.id === id)), wires = selected.wires.filter((id) => layout.wires.some((wire) => wire.id === id));
      if (devices.length !== selected.devices.length || wires.length !== selected.wires.length) selected = devices.length + wires.length ? { kind: "many", devices, wires } : null;
    }
    remember();
    emit();
  }

  function noteAlarms(changes: AlarmChange[]) {
    if (!changes.length) return;
    const sent = simulator.sendLocalEvents(changes.map(toEvent));
    alarms = [...changes.map((change) => ({ ...change, id: nextAlarmId++, sent })), ...alarms].slice(0, MAX_ALARM_ROWS);
    for (const change of changes) if (change.state === "raised") announce(`Larm: ${change.text}`, change.severity !== "warning");
  }

  function tick() {
    const now = Date.now();
    const dtMs = lastTickMs ? Math.min(1000, now - lastTickMs) : TICK_MS;
    lastTickMs = now;
    const stepped = stepEngine(engine, layout, dtMs, now, () => performance.now());
    const wasRunning = engine.run;
    engine = stepped.state;
    if (wasRunning && !engine.run && engine.error) announce(engine.error, true);
    // The regulator's process runs at the same speed as everything else on the sheet.
    const loop = advancePidLoop(pid, dtMs * engine.speed, random, now);
    pid = loop.state;
    noteAlarms([...stepped.alarms, ...loop.alarms]);
    sampleTrend(trend, layout.trendPens ?? [], { engine, pid }, engine.clockMin, now);
    emit();
  }

  const stopAll = () => { engine = stopRun(engine); pid = { ...pid, running: false }; emit(); };

  const mutate = (change: (current: Layout) => Layout, history = true) => setLayout(change(layout), { history });
  /** Runs a layout operation that may refuse (null): the refusal is just no change. */
  const tryMutate = (next: Layout | null, history = true) => { if (next) setLayout(next, { history }); return next !== null; };

  // Named, so a method handed on as a callback (onRun={runtime.setRun}) still reaches the others: no `this`.
  const api = {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    mount() {
      const seed = new Uint32Array(1);
      window.crypto.getRandomValues(seed);
      random = seededRandom(seed[0]);
      let stored: string | null = null;
      if (saving) try { stored = window.localStorage.getItem(SURFACE_STORAGE_KEY); } catch { /* Same as nothing saved. */ }
      if (stored) {
        const loaded = loadLayoutText(stored);
        if (loaded.ok) {
          layout = loaded.layout.language === "st" && !loaded.layout.program.trim() && !loaded.layout.ladder ? inLadder(loaded.layout) : loaded.layout;
          settleProgram();
          accepted = layout.ladder;
          // A drawing from before the PLC was fed got a source: say so once, after the page has shown.
          if (loaded.supplyAdded) window.setTimeout(() => notice(SUPPLY_ADDED_TEXT), 300);
        } else {
          storeProblem = "Den sparade ritningen gick inte att läsa. Ritytan är tom.";
          try { window.localStorage.removeItem(SURFACE_STORAGE_KEY); } catch { /* A closed store has nothing to remove. */ }
        }
      }
      settleProgram();
      accepted = layout.ladder;
      engine = createEngineState(layout);
      lastTickMs = 0;
      const timer = setInterval(tick, TICK_MS);
      const unsubscribe = simulator.onStop(stopAll);
      emit();
      return () => { clearInterval(timer); unsubscribe(); stopAll(); };
    },

    // ---------- history ----------
    undo() { const previous = past[past.length - 1]; if (!previous) return; past = past.slice(0, -1); future = [layout, ...future].slice(0, MAX_HISTORY); setLayout(previous); },
    redo() { const next = future[0]; if (!next) return; future = future.slice(1); past = [...past, layout].slice(-MAX_HISTORY); setLayout(next); },

    // ---------- the drawing ----------
    select(next: Selection) { selected = next; highlight = null; emit(); },
    setHighlight(id: string | null) { highlight = id; emit(); },
    addDevice(kind: DeviceKindId, x: number, y: number, options: Record<string, string> = {}): string | null {
      if (layout.devices.length >= MAX_DEVICES) { announce(`Högst ${MAX_DEVICES} apparater på ritytan.`, true); return null; }
      const id = freeDeviceId(kind, layout.devices.map((device) => device.id));
      // Dropped on something else, it lands on the nearest free place on the grid.
      const wanted: DeviceInst = { id, kind, x: Math.round(x), y: Math.round(y), label: defaultLabel(kind, layout.devices), options: { ...options } };
      const device: DeviceInst = { ...wanted, ...freePlace(wanted, layout.devices) };
      mutate((current) => ({ ...current, devices: [...current.devices, device] }));
      selected = { kind: "device", id };
      emit();
      return id;
    },
    moveDevice(id: string, x: number, y: number) {
      mutate((current) => ({ ...current, devices: current.devices.map((device) => (device.id === id ? { ...device, x: Math.round(x), y: Math.round(y) } : device)) }));
    },
    removeDevice(id: string) { mutate((current) => removeDevices(current, [id])); },
    setDeviceLabel(id: string, label: string) {
      const result = validateLayout({ ...layout, devices: layout.devices.map((device) => (device.id === id ? { ...device, label } : device)) });
      if (!result.ok) { announce(result.reason, true); return; }
      setLayout(result.layout, { history: false });
    },
    setDeviceOption(id: string, key: string, value: string) {
      const result = validateLayout({ ...layout, devices: layout.devices.map((device) => (device.id === id ? { ...device, options: { ...device.options, [key]: value } } : device)) });
      if (!result.ok) { announce(result.reason, true); return; }
      setLayout(result.layout, { history: true });
    },
    /** A wire from terminal to terminal (the point-to-point way): one per pair, never to itself. Null when it could not be drawn. */
    addWire(from: TerminalRef, to: TerminalRef, kind: WireKind = "auto"): string | null {
      return api.connectWire({ kind: "terminal", ref: from }, { kind: "terminal", ref: to }, kind);
    },
    /** A wire from one hit to another: terminal, junction, a point on a wire (a branch) or empty space (a loose end); `points` are clicked corners. */
    connectWire(from: Hit, to: Hit, kind: WireKind = "auto", points: readonly Point[] = []): string | null {
      const result = connectWireOp(layout, from, to, kind, points);
      if (!result) return null;
      setLayout(result.layout, { history: true });
      return result.wireId;
    },
    /** A pure drawing operation (edit.ts) applied as one step; null from it means it refused, and nothing changes. */
    edit(operation: (current: Layout) => Layout | null, history = true) { return tryMutate(operation(layout), history); },
    moveWireEnd(id: string, which: "from" | "to", hit: Hit) { return tryMutate(moveWireEndOp(layout, id, which, hit)); },
    moveSegment(id: string, route: readonly Point[], index: number, value: number) { tryMutate(moveSegmentOp(layout, id, route, index, value)); },
    moveJunction(id: string, point: Point) { tryMutate(moveJunctionOp(layout, id, point)); },
    setWireKind(id: string, kind: WireKind) { tryMutate(setWireKindOp(layout, id, kind)); },
    straightenWire(id: string) { tryMutate(straightenWireOp(layout, id)); },
    removeWire(id: string) { mutate((current) => removeWires(current, [id])); },
    removeSelected() {
      if (!selected) return;
      if (selected.kind === "many") { const chosen = selected; mutate((current) => removeWires(removeDevices(current, chosen.devices), chosen.wires)); }
      else if (selected.kind === "wire") api.removeWire(selected.id); else api.removeDevice(selected.id);
    },
    clearSurface() { selected = null; highlight = null; cursor = null; trend.samples.length = 0; setLayout(inLadder({ ...startLayout(), outdoorC: layout.outdoorC }), { reset: true, history: true }); },
    loadExample(id: string) {
      const example = surfaceExampleById(id);
      if (!example) return;
      selected = null; highlight = null; cursor = null;
      setLayout(JSON.parse(JSON.stringify(example.layout)) as Layout, { reset: true, history: true });
      trend.samples.length = 0;
      const checked = api.verify();
      // An example with a PID block opens with its setpoint, process value and output on the trend.
      if (checked.ok) {
        const regulator = [...checked.compiled.fbs].find(([, kind]) => kind === "PID")?.[0];
        if (regulator) setLayout({ ...layout, trendPens: [`fb:${regulator}.SP`, `fb:${regulator}.PV`, `fb:${regulator}.OUT`] }, { history: false });
      }
      notice(`${example.title} är laddad. Slå över till RUN.`);
    },
    /** A drawing for this window only: shown and run as any other, and nothing is saved from here on. Only the public demo's connection uses it. */
    adoptTemporary(next: Layout) {
      saving = false;
      selected = null; highlight = null; cursor = null;
      setLayout(JSON.parse(JSON.stringify(next)) as Layout, { reset: true, history: true });
      trend.samples.length = 0;
      api.verify();
    },
    exportText: () => exportLayoutText(layout),
    importText(text: string) {
      const result = importLayoutText(text);
      if (!result.ok) { announce(result.reason, true); return; }
      selected = null; highlight = null; cursor = null;
      setLayout(result.layout, { reset: true, history: true });
      notice(result.supplyAdded ? `Ritningen är inläst. ${SUPPLY_ADDED_TEXT}` : "Ritningen är inläst.");
    },
    touch(id: string, change: Partial<Pick<DeviceState, "pressed" | "on" | "value" | "tripped">>) { engine = touchDevice(engine, id, change); emit(); },
    setOutdoorC(value: number) {
      const outdoorC = Math.min(60, Math.max(-40, value));
      engine = { ...engine, plant: { ...engine.plant, outdoorC } };
      mutate((current) => ({ ...current, outdoorC }), false);
    },
    setDoorOpen(open: boolean) { engine = { ...engine, plant: { ...engine.plant, doorOpen: open } }; emit(); },
    setSpeed(speed: SurfaceSpeed) { engine = { ...engine, speed }; emit(); },
    setClock(clockMin: number) { engine = { ...engine, clockMin }; emit(); },

    // ---------- the program ----------
    /** Text typed in ST: it stays as typed and is read back to Ladder when it can be. A slip mid-word only leaves Ladder at the last readable version. */
    setProgram(text: string) {
      if (text.length > MAX_PROGRAM_CHARS) { announce("Programmet är för långt.", true); return; }
      if (holdsKeyForm(text)) { announce(KEY_IN_PROGRAM_TEXT, true); return; }
      if (text === layout.program) return;
      programDirty = true;
      setLayout({ ...layout, program: text, language: "st" }, { history: false });
    },
    /** Verifiera (F7): compiles the program as it stands and lists what it finds. When it holds it is accepted, and a running PLC takes it over at the next cycle. */
    verify(): CompileResult {
      compile = compileProgram(layout.program);
      programDirty = false;
      const lines = rungLines;
      const atLine = (line: number) => (layout.ladder ? cursorAtLine(layout.ladder, lines, line) : null);
      const found: ProgramProblem[] = [];
      if (!compile.ok) found.push({ level: "error", text: compile.problem.message, line: compile.problem.line, col: compile.problem.col, cursor: atLine(compile.problem.line) });
      if (stUnread) found.push({ level: "warning", text: stUnread, line: null, col: null, cursor: null });
      if (layout.ladder && !stUnread) {
        const routineIds = new Map((layout.ladder.routines ?? []).map((routine) => [routine.id, routine.id]));
        for (const note of ladderNotes(layout.ladder)) found.push({ level: note.level, text: note.text, line: lines.find((item) => item.rungId === note.rungId)?.from ?? null, col: null, cursor: { routine: note.routine && routineIds.has(note.routine) ? note.routine : null, rungId: note.rungId } });
      }
      problems = found;
      if (compile.ok) {
        accepted = layout.ladder;
        if (engine.run) engine = reloadRun(engine, compile.compiled);
      }
      emit();
      return compile;
    },
    compile(): CompileResult { return api.verify(); },
    /** The RUN/STOP switch. RUN verifies first; a program with an error does not run. */
    setRun(run: boolean) {
      if (!run) { engine = stopRun(engine); emit(); return; }
      if (!engine.powered) { announce(`${PLC_SUPPLY_TEXT}.`, true); return; }
      const result = compile && !programDirty ? compile : api.verify();
      if (!result.ok) { announce(`Programmet har ett fel på rad ${result.problem.line}. Rätta det först.`, true); return; }
      engine = startRun(engine, result.compiled);
      emit();
    },
    /** A tag forced to a value in RUN, or let go with null. */
    setForce(name: string, value: Value | null) { engine = forceTag(engine, name, value); emit(); },

    // ---------- Ladder ----------
    /** Changes the Ladder program; the ST text is written anew from it and compiled, so errors show at once. */
    updateLadder(change: (current: LadderProgram) => LadderProgram, options: { history?: boolean } = {}) {
      const current = layout.ladder ?? emptyLadder();
      const next = change(current);
      if (next === current) return;
      const counted = withSeq(next);
      const result = validateLayout({ ...layout, ladder: counted, program: ladderToSt(counted), language: "ld" });
      if (!result.ok) { announce(result.reason, true); return; }
      // Typing in a field is not a step to undo one letter at a time; adding, moving and removing is.
      setLayout(result.layout, { history: options.history ?? true });
      compile = compileProgram(layout.program);
      programDirty = true;
      emit();
    },
    trendSamples: () => trend.samples,
    /** A pen on the trend: a tag, a terminal, a block's output or a process value. */
    addTrendPen(pen: string) {
      const pens = layout.trendPens ?? [];
      if (pens.includes(pen)) return;
      if (pens.length >= MAX_TREND_PENS) { announce(`Högst ${MAX_TREND_PENS} pennor i trenden.`, true); return; }
      setLayout({ ...layout, trendPens: [...pens, pen] }, { history: false });
    },
    removeTrendPen(pen: string) { setLayout({ ...layout, trendPens: (layout.trendPens ?? []).filter((item) => item !== pen) }, { history: false }); },
    /** The rung and element marked: Ladder and the ST lines follow. */
    setCursor(next: LdCursor) {
      const valid = validCursor(layout.ladder, next);
      cursor = valid;
      if (valid) openRoutine = valid.routine;
      emit();
    },
    /** A line clicked in the ST text marks its rung. */
    cursorFromLine(line: number) {
      if (!layout.ladder || stUnread) return;
      const found = cursorAtLine(layout.ladder, rungLines, line);
      if (found && found.rungId !== cursor?.rungId) { cursor = found; openRoutine = found.routine; emit(); }
    },
    setOpenRoutine(routine: string | null) { openRoutine = routine; cursor = null; emit(); },
    watch(name: string) { if (!watched.includes(name)) { watched = [...watched, name]; emit(); } },
    unwatch(name: string) { watched = watched.filter((item) => item !== name); emit(); },

    // ---------- the PID window ----------
    setPidKind(kind: PidProcessKind) { pid = { ...createPidLoop(kind), outdoorC: pid.outdoorC }; emit(); },
    /** The regulator started: its three pens on the trend, if the person has chosen none. */
    setPidRunning(running: boolean) {
      pid = { ...pid, running };
      if (running && !layout.trendPens?.length) { setLayout({ ...layout, trendPens: ["pid:sp", "pid:pv", "pid:out"] }, { history: false }); return; }
      emit();
    },
    setPidSetpoint(value: number) { pid = { ...pid, setpoint: value }; emit(); },
    setPidParams(params: PidParams) { pid = { ...pid, params }; emit(); },
    setPidSampleMs(sampleMs: number) { pid = { ...pid, sampleMs }; emit(); },
    setPidNoise(noise: number) { pid = { ...pid, noise: Math.max(0, noise) }; emit(); },
    setPidDisturbed(disturbed: boolean) { pid = { ...pid, disturbed }; emit(); },
    setPidOutdoorC(outdoorC: number) { pid = { ...pid, outdoorC }; emit(); },
    setPidAlarm(which: "high" | "low", def: LimitAlarmDef) { pid = { ...pid, alarmDefs: { ...pid.alarmDefs, [which]: def } }; emit(); },
    setPidSeverity(severity: MachineEventSeverity) { pid = { ...pid, severity }; emit(); },
    clearAlarms() { alarms = []; emit(); },
  };
  return api;
}

export type Runtime = ReturnType<typeof createRuntime>;

export function useRuntime(simulator: Simulator) {
  const [runtime] = useState(() => createRuntime(simulator));
  useEffect(() => runtime.mount(), [runtime]);
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  return [runtime, snapshot] as const;
}

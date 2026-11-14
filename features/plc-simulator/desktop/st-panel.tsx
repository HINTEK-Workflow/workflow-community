"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { linesOfRung } from "@/lib/machine/simulator/ladder/navigate";
import { ST_EXAMPLES } from "@/lib/machine/simulator/st/examples";
import { useRuntimeSnapshot, useDesktop, useDeskState, usePhone } from "./context";
import { ToolButton } from "./controls";
import { popOut } from "./dock-control";

// PLC-simulatorn, ST as a tool of its own (2026-11-04): a plain text field with line numbers, editable whichever view was changed last.
// What is typed stays as typed and is read back to Ladder when it can be read. The lines of the marked rung are lit, and a click on a
// line marks its rung: the same id-based cursor as in Ladder. No editor library.

const LINE_H = 18;

export function StPanel() {
  const { runtime, desk } = useDesktop();
  const snapshot = useRuntimeSnapshot();
  const { stFocusTick, popouts } = useDeskState();
  const phone = usePhone();
  const { layout, compile, programDirty, cursor, rungLines, stUnread } = snapshot;
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const lines = useMemo(() => layout.program.split("\n"), [layout.program]);
  const problem = compile && !compile.ok ? compile.problem : null;
  const marked = cursor ? linesOfRung(rungLines, cursor.rungId) : null;

  // A rung marked elsewhere brings its lines into view, without taking the focus from where the person is.
  useEffect(() => {
    const area = areaRef.current;
    if (!area || !marked || area.ownerDocument.activeElement === area) return;
    const top = (marked.from - 1) * LINE_H, bottom = marked.to * LINE_H;
    if (top < area.scrollTop || bottom > area.scrollTop + area.clientHeight) area.scrollTop = Math.max(0, top - LINE_H);
  }, [marked]);
  // "Gå till ST-rad": the caret goes there too.
  useEffect(() => {
    if (!stFocusTick) return;
    const area = areaRef.current;
    if (!area || !marked) return;
    const offset = lines.slice(0, marked.from - 1).reduce((sum, row) => sum + row.length + 1, 0);
    area.focus();
    area.setSelectionRange(offset, offset);
    area.scrollTop = Math.max(0, (marked.from - 1) * LINE_H - LINE_H);
    // Only when asked: not when the marked rung changes after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stFocusTick]);

  const followCaret = (area: HTMLTextAreaElement) => {
    const line = area.value.slice(0, area.selectionStart).split("\n").length;
    runtime.cursorFromLine(line);
  };
  const goToProblem = () => {
    const area = areaRef.current;
    if (!area || !problem) return;
    const offset = lines.slice(0, problem.line - 1).reduce((sum, row) => sum + row.length + 1, 0) + Math.max(0, problem.col - 1);
    area.focus();
    area.setSelectionRange(offset, offset);
  };
  const status = problem ? null : compile?.ok ? `Klart: ${compile.compiled.vars.size} variabler, ${compile.compiled.fbs.size} block.${programDirty ? " Texten är ändrad sedan dess." : ""}` : "Verifiera (F7) kompilerar.";
  const inWindow = popouts.includes("st");

  return <div className="flex h-full min-h-0 flex-col" data-testid="plc-st-card" data-language={layout.language}>
    <div className="flex flex-none flex-wrap items-center gap-1 border-b border-[var(--plc-line)] bg-[var(--plc-bg)] px-1 py-0.5">
      <span className="font-semibold">ST</span>
      <select className="plc-select ml-auto w-44 max-w-full" value="" aria-label="Exempelprogram" data-testid="plc-st-example" onChange={(event) => { const example = ST_EXAMPLES.find((candidate) => candidate.id === event.target.value); if (example) { runtime.setProgram(example.source); runtime.verify(); } }}>
        <option value="">Exempelprogram …</option>
        {ST_EXAMPLES.map((example) => <option key={example.id} value={example.id} title={example.line}>{example.title}</option>)}
      </select>
      {phone || inWindow ? null : <ToolButton label="ST i eget fönster" onClick={() => { if (desk.dock) void popOut(desk.dock, "st"); }} data-testid="plc-program-popout-st"><ExternalLink aria-hidden="true" /></ToolButton>}
    </div>
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--plc-field)] font-mono text-[12px]" style={{ lineHeight: `${LINE_H}px` }} data-testid="plc-st-editor">
      <div aria-hidden="true" className="w-9 flex-none select-none overflow-hidden border-r border-[var(--plc-line)] bg-[var(--plc-panel)] text-right text-[var(--plc-muted)]">
        <div style={{ transform: `translateY(${-scroll.top}px)`, paddingTop: 2 }}>{lines.map((_, index) => <div key={index} className="pr-1.5" data-line={index + 1} style={marked && index + 1 >= marked.from && index + 1 <= marked.to ? { background: "var(--plc-pressed)", color: "var(--plc-ink)" } : undefined}>{index + 1}</div>)}</div>
      </div>
      <div className="relative min-w-0 flex-1">
        {marked ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bg-[var(--plc-pressed)] opacity-60" style={{ top: (marked.from - 1) * LINE_H + 2 - scroll.top, height: (marked.to - marked.from + 1) * LINE_H }} data-testid="plc-st-mark" data-from={marked.from} data-to={marked.to} /> : null}
        {problem ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 opacity-25" style={{ background: "var(--plc-fault)", top: (problem.line - 1) * LINE_H + 2 - scroll.top, height: LINE_H }} /> : null}
        <textarea ref={areaRef} value={layout.program} spellCheck={false} wrap="off" aria-label="Program i strukturerad text" data-testid="plc-st-text" placeholder={"PROGRAM Namn\nVAR\n  Start AT %IX0.0 : BOOL;\n  Lampa AT %QX0.0 : BOOL;\nEND_VAR\nLampa := Start;\nEND_PROGRAM"}
          onChange={(event) => runtime.setProgram(event.target.value)}
          onScroll={(event) => setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
          onClick={(event) => followCaret(event.currentTarget)}
          onKeyUp={(event) => { if (event.key.startsWith("Arrow") || event.key === "Enter" || event.key === "PageUp" || event.key === "PageDown") followCaret(event.currentTarget); }}
          onKeyDown={(event) => { if (event.key === "Tab") { event.preventDefault(); const area = event.currentTarget; const start = area.selectionStart; const next = `${area.value.slice(0, start)}  ${area.value.slice(area.selectionEnd)}`; runtime.setProgram(next); requestAnimationFrame(() => area.setSelectionRange(start + 2, start + 2)); } }}
          className="absolute inset-0 resize-none overflow-auto whitespace-pre bg-transparent pl-1.5 pr-2 pt-0.5 text-[var(--plc-ink)] outline-none [overflow-wrap:normal]" style={{ lineHeight: `${LINE_H}px`, scrollbarWidth: "thin" }} />
      </div>
    </div>
    <div className="flex-none border-t border-[var(--plc-line)] px-2 py-0.5" aria-live="polite">
      {problem ? <p role="alert" className="text-[var(--plc-fault)] [overflow-wrap:anywhere]" data-testid="plc-st-problem">Rad {problem.line}, kolumn {problem.col}: {problem.message} <button type="button" className="underline" onClick={goToProblem}>Gå dit</button></p>
        : stUnread ? <p className="text-[var(--plc-prog)] [overflow-wrap:anywhere]" data-testid="plc-st-unread">{stUnread}</p>
          : <p className="plc-help truncate" data-testid="plc-st-status">{status}</p>}
    </div>
  </div>;
}

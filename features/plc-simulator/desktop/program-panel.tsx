"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CircleAlert, TriangleAlert, X } from "lucide-react";
import { crossReference } from "@/lib/machine/simulator/ladder/navigate";
import { tagRows } from "@/lib/machine/simulator/ladder/tags";
import { cn } from "@/lib/utils";
import { useRuntimeSnapshot, useDesktop, useDeskState, usePhone } from "./context";
import { ToolButton } from "./controls";
import { LadderPanel } from "./ladder-panel";
import { StPanel } from "./st-panel";
import { tagValueText } from "./tags-panel";

// PLC-simulatorn, skrivbordet: Program. Ladder on top and ST under it, both seen at once, with a divider to drag; each can be broken
// out to a window of its own. At the bottom what Verifiera found, a clicked row goes to its rung, and beside it the cross reference
// and the tags being watched.

function Bottom() {
  const { runtime, desk } = useDesktop();
  const { problems, layout, engine, compile, watched } = useRuntimeSnapshot();
  const { bottomTab, xrefTag } = useDeskState();
  const program = layout.ladder;
  const uses = useMemo(() => (program && xrefTag ? crossReference(program, xrefTag) : []), [program, xrefTag]);
  const rows = useMemo(() => tagRows(program, engine.run ? engine.compiled : compile?.ok ? compile.compiled : null, engine.run ? engine.program : null, engine.inputs, engine.outputs, engine.forces), [program, engine.run, engine.compiled, compile, engine.program, engine.inputs, engine.outputs, engine.forces]);
  const count = problems?.length ?? 0;
  const tabs = [{ id: "errors", label: `Fel (${count})` }, { id: "xref", label: "Korsreferens" }, { id: "watch", label: `Övervaka (${watched.length})` }] as const;
  return <div className="flex h-[84px] flex-none flex-col border-t border-[var(--plc-line)]" data-testid="plc-program-bottom">
    <div className="flex flex-none items-end gap-px bg-[var(--plc-header)] px-1" role="tablist" aria-label="Under programmet">
      {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={bottomTab === item.id} className={cn("px-2 py-px", bottomTab === item.id ? "bg-[var(--plc-panel)] font-semibold" : "text-[var(--plc-muted)] hover:bg-[var(--plc-hover)]")} onClick={() => desk.set({ bottomTab: item.id })} data-testid="plc-bottom-tab" data-tab={item.id}>{item.label}</button>)}
    </div>
    <div className="plc-scroll" tabIndex={0}>
      {bottomTab === "errors" ? <ul data-testid="plc-errors">
        {problems === null ? <li className="plc-help px-2">Verifiera (F7) kompilerar och listar fel här.</li> : !problems.length ? <li className="plc-help px-2" data-testid="plc-errors-none">Inga fel.</li> : null}
        {problems?.map((problem, index) => { const Icon = problem.level === "error" ? CircleAlert : TriangleAlert; return <li key={index}>
          <button type="button" className="plc-tree-row" data-testid="plc-error" data-level={problem.level} data-line={problem.line ?? undefined} onClick={() => { if (problem.cursor) runtime.setCursor(problem.cursor); else if (problem.line) runtime.cursorFromLine(problem.line); }}>
            <Icon aria-hidden="true" style={{ color: problem.level === "error" ? "var(--plc-fault)" : "var(--plc-prog)" }} />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{problem.line ? `Rad ${problem.line}: ` : ""}{problem.text}</span>
          </button>
        </li>; })}
      </ul> : null}
      {bottomTab === "xref" ? <ul data-testid="plc-xref">
        {!xrefTag ? <li className="plc-help px-2">Högerklicka en tagg och välj Korsreferens.</li> : !uses.length ? <li className="plc-help px-2">{xrefTag} används inte i någon rung.</li> : null}
        {uses.map((use, index) => <li key={index}><button type="button" className="plc-tree-row" data-testid="plc-xref-row" data-rung={use.rungId} onClick={() => runtime.setCursor({ routine: use.routine, rungId: use.rungId, ...(use.nodeId ? { nodeId: use.nodeId } : {}), ...(use.outputId ? { outputId: use.outputId } : {}) })}>
          <span className="tabular-nums">{use.routine ? `${program?.routines?.find((item) => item.id === use.routine)?.name ?? ""} ` : ""}Rung {use.number}</span><span className="plc-help">{xrefTag}: {use.where}</span>
        </button></li>)}
      </ul> : null}
      {bottomTab === "watch" ? <ul data-testid="plc-watch">
        {!watched.length ? <li className="plc-help px-2">Inga taggar övervakas. Högerklicka en tagg och välj Övervaka tagg.</li> : null}
        {watched.map((name) => { const row = rows.find((item) => item.name === name); return <li key={name} className="flex items-center gap-2 px-2" data-testid="plc-watch-row" data-tag={name}><span className="font-semibold">{name}</span><span className="tabular-nums" data-testid="plc-watch-value">{row ? tagValueText(row) : "–"}</span><ToolButton className="ml-auto" label={`Sluta övervaka ${name}`} onClick={() => runtime.unwatch(name)}><X aria-hidden="true" /></ToolButton></li>; })}
      </ul> : null}
    </div>
  </div>;
}

export function ProgramPanel() {
  const { desk } = useDesktop();
  const snapshot = useRuntimeSnapshot();
  const { openPanels } = useDeskState();
  const phone = usePhone();
  const [share, setShare] = useState(0.64);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const ladderApart = !phone && openPanels.includes("ladder"), stApart = !phone && openPanels.includes("st");
  const startDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (!host) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => { const box = host.getBoundingClientRect(); setShare(Math.min(0.88, Math.max(0.12, (next.clientY - box.top) / Math.max(1, box.height)))); };
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }, []);
  const apartNote = (id: "ladder" | "st", word: string) => <p className="plc-note flex flex-none items-center gap-2" role="status" data-testid={`plc-program-apart-${id}`}>{word} visas i en egen panel.<button type="button" className="underline" onClick={() => desk.dock?.getPanel(id)?.api.close()} data-testid={`plc-program-recall-${id}`}>Hämta tillbaka hit</button></p>;
  return <div className="flex h-full min-h-0 flex-col" data-testid="plc-program-card" data-language={snapshot.layout.language}>
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col">
      {ladderApart ? apartNote("ladder", "Ladder") : <section className="min-h-0 overflow-hidden" style={{ flex: `${stApart ? 1 : share} 1 0` }} aria-label="Ladder"><LadderPanel /></section>}
      {!ladderApart && !stApart ? <div role="separator" aria-orientation="horizontal" aria-label="Dra för att ändra höjden" className="h-1 flex-none cursor-row-resize touch-none bg-[var(--plc-line)]" data-testid="plc-program-split" onPointerDown={startDrag} /> : null}
      {stApart ? apartNote("st", "ST") : <section className="min-h-0 overflow-hidden" style={{ flex: `${ladderApart ? 1 : 1 - share} 1 0` }} aria-label="Strukturerad text"><StPanel /></section>}
    </div>
    <Bottom />
  </div>;
}

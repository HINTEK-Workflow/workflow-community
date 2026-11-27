"use client";

import { useState, type ReactNode } from "react";
import { Activity, ChevronDown, ChevronRight, FileCode2, GitBranch, Link2, PencilRuler, SlidersHorizontal, Tags } from "lucide-react";
import { useActions } from "./actions";
import { useRuntimeSnapshot, useDesktop } from "./context";
import type { PanelId } from "./panels";

// PLC-simulatorn, skrivbordet: the project tree. Ritning, Program with its routines, Taggar, Trend, Regulator and Maskinkoppling.
// A click marks a row, a double click (or Enter) opens it as a tab in the middle.

type Row = { id: string; label: string; icon: ReactNode; panel: PanelId; level: number; open?: () => void };

export function ProjectTree() {
  const { desk, runtime } = useDesktop();
  const actions = useActions();
  const [selected, setSelected] = useState("surface");
  const [programOpen, setProgramOpen] = useState(true);
  const { layout } = useRuntimeSnapshot();
  const routines = layout.ladder?.routines ?? [];
  const rows: Row[] = [
    { id: "surface", label: "Ritning", icon: <PencilRuler aria-hidden="true" />, panel: "surface", level: 0 },
    { id: "program", label: "Program", icon: <FileCode2 aria-hidden="true" />, panel: "program", level: 0 },
    ...(programOpen ? [
      { id: "routine-main", label: "Huvudrutin", icon: <GitBranch aria-hidden="true" />, panel: "program" as const, level: 1, open: () => runtime.setOpenRoutine(null) },
      ...routines.map((routine) => ({ id: routine.id, label: routine.name, icon: <GitBranch aria-hidden="true" />, panel: "program" as const, level: 1, open: () => runtime.setOpenRoutine(routine.id) })),
    ] : []),
    { id: "tags", label: "Taggar", icon: <Tags aria-hidden="true" />, panel: "tags", level: 0 },
    { id: "trend", label: "Trend", icon: <Activity aria-hidden="true" />, panel: "trend", level: 0 },
    { id: "regulator", label: "Regulator (PID)", icon: <SlidersHorizontal aria-hidden="true" />, panel: "properties", level: 0, open: () => desk.set({ propertiesOf: "regulator" }) },
    { id: "connection", label: "Maskinkoppling", icon: <Link2 aria-hidden="true" />, panel: "connection", level: 0 },
  ];
  const open = (row: Row) => { row.open?.(); actions.showPanel(row.panel); };
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = rows.findIndex((row) => row.id === selected);
    if (event.key === "ArrowDown" && index < rows.length - 1) { event.preventDefault(); setSelected(rows[index + 1].id); }
    else if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); setSelected(rows[index - 1].id); }
    else if (event.key === "ArrowLeft" && selected === "program") { event.preventDefault(); setProgramOpen(false); }
    else if (event.key === "ArrowRight" && selected === "program") { event.preventDefault(); setProgramOpen(true); }
    else if (event.key === "Enter" && index >= 0) { event.preventDefault(); open(rows[index]); }
  };
  return <div className="plc-scroll plc-tree" role="tree" aria-label="Projekt" tabIndex={0} data-testid="plc-tree" onKeyDown={onKey}>
    {rows.map((row) => <div key={row.id} role="treeitem" aria-selected={selected === row.id} aria-level={row.level + 1} aria-expanded={row.id === "program" ? programOpen : undefined} className="plc-tree-row" style={{ paddingLeft: 4 + row.level * 14 }} data-testid="plc-tree-row" data-node={row.id}
      onClick={() => setSelected(row.id)} onDoubleClick={() => open(row)}>
      {row.id === "program" ? <button type="button" className="plc-tab-close" aria-label={programOpen ? "Fäll ihop Program" : "Fäll ut Program"} onClick={(event) => { event.stopPropagation(); setProgramOpen(!programOpen); }}>{programOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</button> : <span style={{ width: row.level ? 0 : 16, flex: "none" }} />}
      {row.icon}<span className="truncate">{row.label}</span>
    </div>)}
  </div>;
}

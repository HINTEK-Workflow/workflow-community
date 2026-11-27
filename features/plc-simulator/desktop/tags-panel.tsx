"use client";

import { useMemo, useRef, useState } from "react";
import { Eye, Network, Plus, Trash2 } from "lucide-react";
import { renameTag } from "@/lib/machine/simulator/ladder/edit";
import { isLdName, type LdVarType } from "@/lib/machine/simulator/ladder/model";
import { TAG_TYPES, type TagRow, tagRows, typedForce } from "@/lib/machine/simulator/ladder/tags";
import type { Value } from "@/lib/machine/simulator/st/interpreter";
import { allIo, ioName } from "@/lib/machine/simulator/st/io";
import { type MenuItem, SurfaceMenu } from "../surface/surface-overlays";
import { useRuntimeSnapshot, useDesktop } from "./context";
import { ChromeButton, ToolButton } from "./controls";

// PLC-simulatorn, the tag editor (2026-11-04): name, data type, alias to a terminal, description, the value now and, in RUN, a force.
// Tags with a terminal are shown as global, the others as the program's: the program has one scope, so the choice is a filter. A name
// changed here changes everywhere it is used. A right click gives Lägg till i trend, Korsreferens and Övervaka tagg.

export const tagValueText = (row: Pick<TagRow, "value" | "outputs" | "type">) => {
  if (row.outputs) {
    const { outputs } = row;
    if (row.type === "TIMER") return `Q ${outputs.Q ? 1 : 0} · ET ${Math.round(Number(outputs.ET ?? 0))} ms`;
    if (row.type === "COUNTER") return `Q ${outputs.Q ? 1 : 0} · CV ${outputs.CV ?? 0}`;
    if (row.type === "PID") return `OUT ${Number(outputs.OUT ?? 0).toLocaleString("sv-SE", { maximumFractionDigits: 1 })}`;
    return `Q ${outputs.Q ? 1 : 0}`;
  }
  if (row.value === null) return "–";
  return typeof row.value === "boolean" ? (row.value ? "1" : "0") : row.value.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
};

function NameCell({ row, onRename }: { row: TagRow; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? row.name;
  const bad = draft !== null && !isLdName(draft);
  return <input className="plc-input w-full" aria-label={`Namn på ${row.name}`} aria-invalid={bad || undefined} value={shown} data-testid="plc-tag-name" onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== null && !bad && draft !== row.name) onRename(draft); setDraft(null); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} style={bad ? { borderColor: "var(--plc-fault)" } : undefined} />;
}

function ForceCell({ row, onForce }: { row: TagRow; onForce: (value: Value | null) => void }) {
  const [text, setText] = useState("");
  if (row.forced !== null) return <span className="flex items-center gap-1"><span className="font-semibold text-[var(--plc-prog)]" data-testid="plc-tag-forced">{typeof row.forced === "boolean" ? (row.forced ? "1" : "0") : row.forced}</span><ChromeButton onClick={() => onForce(null)} data-testid="plc-tag-unforce">Släpp</ChromeButton></span>;
  if (row.type === "BOOL") return <span className="flex gap-1"><ChromeButton onClick={() => onForce(false)} data-testid="plc-tag-force-0">0</ChromeButton><ChromeButton onClick={() => onForce(true)} data-testid="plc-tag-force-1">1</ChromeButton></span>;
  const value = typedForce(row.type, text);
  return <span className="flex gap-1"><input className="plc-input w-16" aria-label={`Tvinga ${row.name}`} value={text} data-testid="plc-tag-force-value" onChange={(event) => setText(event.target.value)} /><ChromeButton disabled={value === null} onClick={() => { if (value !== null) onForce(value); }} data-testid="plc-tag-force">Tvinga</ChromeButton></span>;
}

export function TagsPanel() {
  const { runtime, desk } = useDesktop();
  const snapshot = useRuntimeSnapshot();
  const { layout, engine, compile, watched } = snapshot;
  const program = layout.ladder;
  const [filter, setFilter] = useState<"all" | "global" | "program">("all");
  const [menu, setMenu] = useState<{ x: number; y: number; width: number; height: number; items: MenuItem[] } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const compiled = engine.run ? engine.compiled : compile?.ok ? compile.compiled : null;
  const rows = useMemo(() => tagRows(program, compiled, engine.run ? engine.program : null, engine.inputs, engine.outputs, engine.forces), [program, compiled, engine.run, engine.program, engine.inputs, engine.outputs, engine.forces]);
  const shown = rows.filter((row) => filter === "all" || row.scope === filter);
  const aliases = useMemo(() => allIo().map(ioName), []);
  const update = (change: Parameters<typeof runtime.updateLadder>[0]) => runtime.updateLadder(change, { history: false });
  const setVar = (name: string, change: Partial<NonNullable<typeof program>["vars"][number]>) => update((current) => ({ ...current, vars: current.vars.map((item) => (item.name === name ? { ...item, ...change } : item)) }));
  /** A name for a terminal, or a table row for a name the program only used: from now on it is declared. */
  const declare = (row: TagRow, name?: string) => update((current) => {
    const named = name ? renameTag(current, row.name, name) : current;
    return { ...named, vars: [...named.vars, { name: name ?? row.name, type: row.type === "BOOL" || row.type === "INT" || row.type === "REAL" || row.type === "TIME" ? row.type : "BOOL", address: row.alias, init: null }] };
  });
  const rename = (row: TagRow, name: string) => { if (row.declared) update((current) => renameTag(current, row.name, name)); else declare(row, name); };
  const openMenu = (event: React.MouseEvent, row: TagRow) => {
    event.preventDefault();
    const box = frameRef.current?.getBoundingClientRect();
    setMenu({
      x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0), width: box?.width ?? 300, height: box?.height ?? 300, items: [
        { label: "Lägg till i trend", onPick: () => runtime.addTrendPen(row.type === "TIMER" ? `fb:${row.name}.ET` : row.type === "COUNTER" ? `fb:${row.name}.CV` : row.type === "PID" ? `fb:${row.name}.OUT` : row.unnamed ? `io:${row.name}` : `var:${row.name}`) },
        { label: "Korsreferens", onPick: () => desk.set({ xrefTag: row.name, bottomTab: "xref" }) },
        { label: "Övervaka tagg", onPick: () => { runtime.watch(row.name); desk.set({ bottomTab: "watch" }); } },
      ],
    });
  };
  return <div ref={frameRef} className="relative flex h-full min-h-0 flex-col" data-testid="plc-tags">
    <div className="flex flex-none flex-wrap items-center gap-1 border-b border-[var(--plc-line)] bg-[var(--plc-bg)] p-1">
      <select className="plc-select" aria-label="Visa" value={filter} data-testid="plc-tag-filter" onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Alla taggar</option><option value="global">Globala (med plint)</option><option value="program">Programtaggar</option></select>
      <ChromeButton disabled={!program} onClick={() => update((current) => { let number = current.vars.length + 1; while (current.vars.some((item) => item.name === `Tagg${number}`)) number += 1; return { ...current, vars: [...current.vars, { name: `Tagg${number}`, type: "BOOL", address: null, init: null }] }; })} data-testid="plc-tag-add"><Plus aria-hidden="true" />Ny tagg</ChromeButton>
      {Object.keys(engine.forces).length ? <span className="font-semibold text-[var(--plc-prog)]" data-testid="plc-forces-active">{Object.keys(engine.forces).length} tvingade</span> : null}
      {!engine.run ? <span className="plc-help">Tvinga går i RUN.</span> : null}
    </div>
    <div className="plc-scroll" tabIndex={0}>
      <table className="plc-table" data-testid="plc-mapping">
        <thead><tr><th scope="col" style={{ minWidth: 110 }}>Namn</th><th scope="col">Värde</th><th scope="col">Tvinga</th><th scope="col">Datatyp</th><th scope="col">Plint</th><th scope="col" style={{ minWidth: 110 }}>Beskrivning</th><th scope="col"><span className="sr-only">Åtgärder</span></th></tr></thead>
        <tbody>{shown.map((row) => <tr key={row.name} data-testid="plc-tag-row" data-tag={row.name} data-io={row.alias ?? undefined} data-type={row.type} onContextMenu={(event) => openMenu(event, row)}>
          <td>{program && (row.declared || row.unnamed) ? <NameCell row={row} onRename={(name) => rename(row, name)} /> : row.name}</td>
          <td className="tabular-nums" data-testid="plc-tag-value">{tagValueText(row)}</td>
          <td>{row.forceable && engine.run ? <ForceCell row={row} onForce={(value) => runtime.setForce(row.name, value)} /> : null}</td>
          <td>{row.declared && program ? <select className="plc-select" aria-label={`Datatyp för ${row.name}`} value={row.type} data-testid="plc-tag-type" onChange={(event) => setVar(row.name, { type: event.target.value as LdVarType })}>{[...new Set([...TAG_TYPES, row.type as LdVarType])].map((type) => <option key={type} value={type}>{type}</option>)}</select> : row.type}</td>
          <td>{row.declared && program ? <select className="plc-select" aria-label={`Plint för ${row.name}`} value={row.alias ?? ""} data-testid="plc-tag-alias" onChange={(event) => setVar(row.name, { address: event.target.value || null })}><option value="">Ingen</option>{aliases.map((alias) => <option key={alias} value={alias}>{alias}</option>)}</select> : row.alias ?? "–"}{row.address ? <span className="plc-help"> {row.address}</span> : null}</td>
          <td>{row.declared && program ? <input className="plc-input w-full" aria-label={`Beskrivning av ${row.name}`} value={row.description} onChange={(event) => setVar(row.name, { comment: event.target.value.slice(0, 120) || undefined })} /> : row.description}</td>
          <td className="whitespace-nowrap"><ToolButton label={`Övervaka ${row.name}`} pressed={watched.includes(row.name)} onClick={() => { if (watched.includes(row.name)) runtime.unwatch(row.name); else runtime.watch(row.name); }} data-testid="plc-tag-watch"><Eye aria-hidden="true" /></ToolButton><ToolButton label={`Korsreferens för ${row.name}`} onClick={() => desk.set({ xrefTag: row.name, bottomTab: "xref" })} data-testid="plc-tag-xref"><Network aria-hidden="true" /></ToolButton>{row.declared && program ? <ToolButton label={`Ta bort ${row.name}`} onClick={() => update((current) => ({ ...current, vars: current.vars.filter((item) => item.name !== row.name) }))} data-testid="plc-tag-remove"><Trash2 aria-hidden="true" /></ToolButton> : null}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {menu ? <SurfaceMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} width={menu.width} height={menu.height} /> : null}
  </div>;
}

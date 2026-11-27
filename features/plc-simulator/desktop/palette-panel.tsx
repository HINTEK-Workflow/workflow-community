"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { DEVICE_GROUPS, deviceMatches, type DeviceGroup, GROUP_LABELS } from "@/lib/machine/simulator/surface/devices";
import { designsVersion, paletteEntries, subscribeDesigns, type PaletteEntry } from "@/lib/machine/simulator/surface/device-designs";
import { cn } from "@/lib/utils";
import { DeviceThumb } from "../surface/device-drawings";
import { SurfaceDefs } from "../surface/parts";
import { useDesktop, useDeskState } from "./context";

// PLC-simulatorn (v3, 2026-11-03: "komponenterna visas i en lång lista … onödigt mycket scrollning"; a panel of the desktop since
// 2026-11-04): a compact grid of small tiles, the full name and what it does as the tooltip, a search field and groups that fold.
// A click lays the device on a free spot; a drag lays it where the pointer lets go.

function Tile({ entry }: { entry: PaletteEntry }) {
  const { def } = entry;
  const { desk } = useDesktop();
  const { guideKinds } = useDeskState();
  return <button type="button" title={`${def.label}. ${def.short}`} data-guide={guideKinds.includes(def.id) || undefined} aria-label={`Lägg till ${def.label}`} data-testid="plc-palette-item" data-kind={def.id} data-design={entry.key}
    onPointerDown={(event) => { event.preventDefault(); desk.set({ placing: { kind: entry.kind, options: entry.options, startX: event.clientX, startY: event.clientY, doc: event.currentTarget.ownerDocument } }); }}
    className="flex min-w-0 cursor-grab touch-manipulation flex-col items-center gap-px border border-transparent bg-transparent p-px text-center text-[11px] leading-[1.15] hover:border-[var(--plc-line)] hover:bg-[var(--plc-hover)] active:cursor-grabbing">
    <DeviceThumb kind={entry.kind} options={entry.options} />
    <span className="line-clamp-2 w-full">{def.name}</span>
  </button>;
}

export function PalettePanel() {
  const [query, setQuery] = useState("");
  const [closedGroups, setClosedGroups] = useState<Set<DeviceGroup>>(() => new Set());
  const searching = query.trim().length > 0;
  // The product owner's designs (PLC-apparater) rename, regroup, hide and add devices; the palette follows when they arrive.
  const designs = useSyncExternalStore(subscribeDesigns, designsVersion, designsVersion);
  const groups = useMemo(() => { void designs; const entries = paletteEntries(); return DEVICE_GROUPS.map((group) => ({ group, defs: entries.filter((entry) => entry.def.group === group && deviceMatches(entry.def, query)) })).filter((entry) => entry.defs.length); }, [query, designs]);
  const toggleGroup = (group: DeviceGroup) => setClosedGroups((current) => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; });
  return <div className="plc-sheet flex h-full min-h-0 flex-col" data-testid="plc-palette" aria-label="Apparater">
    {/* The gradients of the small pictures, once for the whole palette. */}
    <svg width={0} height={0} className="absolute" aria-hidden="true" focusable="false"><SurfaceDefs /></svg>
    <label className="relative flex-none border-b border-[var(--plc-line)] p-1">
      <span className="sr-only">Sök apparat</span>
      <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[var(--plc-muted)]" />
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök …" data-testid="plc-palette-search" className="plc-input w-full pl-5 pr-5 [&::-webkit-search-cancel-button]:hidden" />
      {query ? <button type="button" aria-label="Rensa sökningen" onClick={() => setQuery("")} className="plc-tab-close absolute right-1.5 top-1/2 -translate-y-1/2"><X aria-hidden="true" /></button> : null}
    </label>
    <div className="plc-scroll">
      {groups.map(({ group, defs }) => {
        const open = searching || !closedGroups.has(group);
        return <section key={group}>
          <button type="button" className="plc-tree-row sticky top-0 z-[1] border-b border-[var(--plc-line)] bg-[var(--plc-header)] font-semibold" aria-expanded={open} onClick={() => toggleGroup(group)} data-testid="plc-palette-group" data-group={group}>
            <ChevronDown aria-hidden="true" className={cn(!open && "-rotate-90")} />
            <span className="min-w-0 flex-1 truncate">{GROUP_LABELS[group]}</span>
            <span className="tabular-nums plc-help">{defs.length}</span>
          </button>
          {open ? <div className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-px p-px">{defs.map((entry) => <Tile key={entry.key} entry={entry} />)}</div> : null}
        </section>;
      })}
      {!groups.length ? <p className="plc-help p-2">Inget passar sökningen.</p> : null}
    </div>
  </div>;
}

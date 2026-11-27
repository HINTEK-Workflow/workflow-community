"use client";

import { useCallback, useMemo, useState } from "react";
import { api } from "@/features/kfid/api";
import { useLoadEffect } from "@/lib/use-load-effect";
import { placeForest, type PlaceNode } from "@/lib/workflow/customer-facility";
import type { PartListItem } from "@/lib/maintenance/model";
import { placePath, type PlaceRow } from "@/lib/maintenance/place-model";

/**
 * Välj maskindel (Underhåll, 2026-10-30): one select over the company's equipment, every part with its way down from its
 * place ("Fabriken › Linje 2 › Press 4"). Used where something is linked to a part – a machine source, a signal, the alarm
 * responsibility, the operator's fault report and a work order – so all of them choose the same way. Paused parts are left
 * out unless already chosen. Reads /api/maintenance?part=tree (the module's read right; an admin always has it).
 */
export type PartOption = { id: string; label: string; name: string; path: string };

export function usePartOptions() {
  const [parts, setParts] = useState<PartListItem[] | null>(null);
  const [places, setPlaces] = useState<PlaceRow[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const tree = await api("/api/maintenance?part=tree", { cache: "no-store" }) as { parts: PartListItem[]; places?: PlaceRow[] };
      setParts(tree.parts); setPlaces(tree.places ?? []); setError("");
    }
    catch (cause) { setError((cause as Error).message); setParts([]); }
  }, []);
  useLoadEffect(load);
  const options = useMemo(() => partOptions(parts ?? [], null, places), [parts, places]);
  return { parts, places, options, error, reload: load };
}

/** The tree in reading order (each part after its parent), as options with their way down. */
export function partOptions(parts: readonly PartListItem[], keep: string | null = null, places: readonly PlaceRow[] = []): PartOption[] {
  const items = parts.map((part) => ({ ...part, customerId: part.customerId ?? "", address: "", postalCode: "", city: "", description: "" }));
  const out: PartOption[] = [];
  const walk = (nodes: PlaceNode<(typeof items)[number]>[], path: string[]) => {
    for (const node of nodes) {
      const part = node.place;
      if (part.isActive || part.id === keep) out.push({ id: part.id, name: part.name, path: path.join(" › "), label: [...path, part.name].join(" › ") + (part.isActive ? "" : " (pausad)") });
      walk(node.children, [...path, part.name]);
    }
  };
  const placesOf = (node: PlaceNode<(typeof items)[number]>) => placePath(places, node.place.placeId);
  for (const machine of placeForest(items)) walk([machine], placesOf(machine));
  return out;
}

export function MachinePartSelect({ id, label = "Maskindel", value, onChange, emptyLabel = "Ingen", disabled = false, testId }: {
  id: string; label?: string; value: string | null; onChange: (partId: string | null) => void; emptyLabel?: string; disabled?: boolean; testId?: string;
}) {
  const { parts, places, error } = usePartOptions();
  const options = useMemo(() => partOptions(parts ?? [], value, places), [parts, places, value]);
  return <div className="grid gap-1.5">
    <label htmlFor={id} className="field-label text-xs font-medium">{label}</label>
    <select id={id} className="form-select" value={value ?? ""} disabled={disabled || parts === null} onChange={(event) => onChange(event.target.value || null)} data-testid={testId}>
      <option value="">{parts === null ? "Hämtar maskinerna…" : emptyLabel}</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p>
      : parts && !parts.length ? <p className="text-xs text-muted-foreground">Inga maskiner än. Lägg till dem under Underhåll.</p> : null}
  </div>;
}

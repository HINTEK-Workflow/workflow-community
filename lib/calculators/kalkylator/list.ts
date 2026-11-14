import type { TypeKey } from "@/lib/workflow/native-mode";
import { powerModule } from "../power";
import type { CalcModule } from "../types";
import { branchLengthModule } from "./branch-length";
import { cableSizingModule } from "./cable-sizing";
import { compensationModule } from "./compensation";
import { disconnectionModule } from "./disconnection";
import { shortCircuitToolModule } from "./short-circuit";
import { transformerModule } from "./transformer";
import { voltageDropToolModule } from "./voltage-drop";

/**
 * The list of the Kalkylator (2026-10-12): the calculators the page offers, in the order of the list. One entry is
 * one row or tile in the list and one page; an entry with several parts (Effekt och ström) shows them as segments. A part
 * without a module is the compact three-phase calculator that has always been in the top bar (features/calculators/
 * three-phase-calculator.tsx), moved into the list unchanged. A new calculator is a module file in this folder and one
 * line here. Every entry has Verktyg's shared colour (`tools`, 2026-10-24, answer 7); its icon tells them apart.
 */
export type CalcPart = { id: string; label: string; /** Without a module: the compact three-phase calculator. */ module?: CalcModule };
export type CalcEntry = { id: string; name: string; summary: string; type: TypeKey; parts: readonly CalcPart[] };

export const CALC_ENTRIES: readonly CalcEntry[] = [
  {
    id: "power", name: "Effekt och ström", summary: "Trefaseffekt, P, S, Q, cos φ och kompensering.", type: "tools",
    parts: [{ id: "quick", label: "Trefaseffekt" }, { id: "power", label: "P, S, Q", module: powerModule }, { id: "compensation", label: "Kompensering", module: compensationModule }],
  },
  { id: "transformer", name: "Transformator", summary: "Märkströmmar, Zk och Ik3 på LSP.", type: "tools", parts: [{ id: "transformer", label: "Transformator", module: transformerModule }] },
  { id: "short-circuit", name: "Kortslutning", summary: "Ik3, Ik2 och Ik1 vid ledningens slut.", type: "tools", parts: [{ id: "short-circuit", label: "Kortslutning", module: shortCircuitToolModule }] },
  { id: "disconnection", name: "Frånkopplingstid", summary: "Klarar skyddet kravtiden? Zs och Ia.", type: "tools", parts: [{ id: "disconnection", label: "Frånkopplingstid", module: disconnectionModule }] },
  { id: "voltage-drop", name: "Spänningsfall", summary: "Volt, procent och största längd.", type: "tools", parts: [{ id: "voltage-drop", label: "Spänningsfall", module: voltageDropToolModule }] },
  { id: "branch-length", name: "Största gruppledningslängd", summary: "Längsta ledning med frånkoppling i tid.", type: "tools", parts: [{ id: "branch-length", label: "Gruppledningslängd", module: branchLengthModule }] },
  { id: "cable-sizing", name: "Kabeldimensionering", summary: "Area för ström, spänningsfall och kortslutning.", type: "tools", parts: [{ id: "cable-sizing", label: "Kabeldimensionering", module: cableSizingModule }] },
];
export const DEFAULT_ENTRY = CALC_ENTRIES[0]!.id;
export const entryById = (id: string | null | undefined) => CALC_ENTRIES.find((entry) => entry.id === id);
export const partOf = (entry: CalcEntry, id: string | null | undefined) => entry.parts.find((part) => part.id === id) ?? entry.parts[0]!;
/** Every module the list holds, for the tests. */
export const CALC_MODULES: readonly CalcModule[] = CALC_ENTRIES.flatMap((entry) => entry.parts.flatMap((part) => (part.module ? [part.module] : [])));

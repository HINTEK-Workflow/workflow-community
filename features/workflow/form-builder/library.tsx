"use client";

import { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { AlignLeft, Cable, Calendar, CheckSquare, ClipboardCheck, Columns3, Eye, FileText, Gauge, Grid3x3, Hash, Heading, Image as ImageIcon, Info, LayoutGrid, LayoutList, ListChecks, PenLine, PowerOff, Rows3, Ruler, Scissors, ShieldAlert, Sigma, SquareDashed, ToggleLeft, TriangleAlert, Type, Zap, type LucideIcon } from "lucide-react";
import { EditorRibbon, EditorRibbonButton, EditorRibbonSheet, type EditorRibbonGroup, type EditorRibbonItem } from "@/components/editor-ribbon";
import { cn } from "@/lib/utils";
import { LIBRARY, type LibraryType } from "@/lib/workflow/form-editor";
import { PRESET_GROUP, PRESET_LIBRARY, type PresetType } from "@/lib/workflow/form-presets";

/** A ribbon entry: a block type, or a ready-made control block from the originals (2026-10-01). */
export type RibbonType = LibraryType | PresetType;

export const LIBRARY_ICON: Record<RibbonType, LucideIcon> = {
  section: SquareDashed, heading: Heading, text: AlignLeft, pagebreak: Scissors, text_field: Type, long_text: FileText, number: Hash, measurement: Ruler, datetime: Calendar,
  yesno: ToggleLeft, single_choice: LayoutList, multiple_choice: CheckSquare, checklist: ListChecks, table: Columns3, attachment: ImageIcon, signature: PenLine, computed: Sigma,
  note: Info, summary: ClipboardCheck, matrix: Grid3x3,
  // The control's own blocks, so JFB-prov and the others are found in the ribbon where the product owner looked for them.
  kfid_iso: Zap, kfid_cont: Cable, kfid_volt: Gauge, kfid_rcd: ShieldAlert, kfid_zs: PowerOff, kfid_vis: Eye, risk_table: TriangleAlert, measurement_rows: Rows3, object_cards: LayoutGrid,
};
const GROUPS = ["Struktur", "Fält", "Resultat", PRESET_GROUP] as const;
/** Everything the ribbon offers: the block types and, in the group Kontroll, the ready-made control blocks. */
export const RIBBON: { type: RibbonType; label: string; hint: string; group: (typeof GROUPS)[number] }[] = [...LIBRARY, ...PRESET_LIBRARY];

/** The building blocks as the shared ribbon's groups (components/editor-ribbon.tsx). */
function useBlockGroups(onAdd: (type: RibbonType) => void): EditorRibbonGroup[] {
  return useMemo(() => GROUPS.map((group) => ({
    label: group,
    items: RIBBON.filter((item) => item.group === group).map((item) => ({ key: item.type, label: item.label, icon: LIBRARY_ICON[item.type], hint: `${item.label} – ${item.hint}. Dra till arket eller klicka.`, ariaLabel: `Lägg till ${item.label}`, onSelect: () => onAdd(item.type) })),
  })), [onAdd]);
}

/** A block in the ribbon can also be dragged onto the sheet. */
function DraggableBlock({ item, testId }: { item: EditorRibbonItem; testId: string }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `library:${item.key}`, data: { kind: "library", type: item.key }, disabled: item.disabled });
  return <EditorRibbonButton ref={setNodeRef} {...attributes} {...listeners} icon={item.icon} label={item.label} title={item.hint} aria-label={item.ariaLabel} onClick={item.onSelect} disabled={item.disabled}
    className={cn("touch-none", isDragging && "opacity-40")} data-tour={`block-${item.key}`} data-testid={testId} />;
}

/**
 * The field ribbon (2026-09-26): every block type as an icon above the sheet, like a word processor's toolbar.
 * Drag an icon onto the sheet, or click it to add after the selected block. It is the only way to add blocks, so there
 * are no duplicate "Lägg till" menus. Drawn by the shared EditorRibbon, like the landing and self-inspection editors.
 * The fourth group, Kontroll (2026-10-01), holds the ready-made blocks of the control and the risk assessment.
 */
export function FieldRibbon({ onAdd, disabled }: { onAdd: (type: RibbonType) => void; /** Förhandsgranska: the ribbon stays in place, switched off. */ disabled?: boolean }) {
  return <EditorRibbon label="Fält att lägga till" disabled={disabled} groups={useBlockGroups(onAdd)} testId="field-ribbon" itemTestId="library-item" Item={DraggableBlock} />;
}

/** On a phone (2026-09-27): the floating "Lägg till" with the building blocks in a panel from below. */
export function FieldSheetButton({ onAdd }: { onAdd: (type: RibbonType) => void }) {
  return <EditorRibbonSheet groups={useBlockGroups(onAdd)} label="Lägg till" description="Hamnar efter det markerade blocket." testId="field-sheet" />;
}

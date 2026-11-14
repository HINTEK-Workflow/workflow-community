/**
 * Hantera anläggningar (2026-10-24, docs/proposals/kundsida-anlaggningar-2026-10-24.md): the customer page's
 * facility actions sit in one compact action card above the tree and the information card, and follow the level chosen in
 * the tree – Adress → Objekt → Underobjekt. Ny adress is always there; Nytt objekt / Nytt underobjekt adds under the chosen
 * level; Redigera, Pausa/Aktivera and Ta bort act on the chosen level. A button that does not fit the choice is inactive
 * with its reason, never removed, so the card never changes its shape (editor-bar-never-shifts); only what the person may
 * not do at all is left out. Pure, so the card, the tests and the screen test read the same rule.
 */
export type PlaceLevelName = "Adress" | "Objekt" | "Underobjekt";

export type PlaceActionState = { enabled: boolean; reason?: string };

export type PlaceActionsInput = {
  /** The level chosen in the tree, or null when none is. */
  selected: {
    /** 0 = an address, 1 = an object, 2+ = a sub-object. */
    depth: number;
    name: string;
    isActive: boolean;
    /** Something under it (it stays until they are removed). */
    hasChildren: boolean;
    /** Jobs, rounds, quotes or limit values point to it; null while that is still being read. */
    inUse: boolean | null;
  } | null;
  /** May add and change places (the customers permission, the customer not in the papperskorg). */
  canEdit: boolean;
  /** May pause and activate places (an admin). */
  canManage: boolean;
  /** The deepest level a place may have (PLACE_MAX_DEPTH). */
  maxDepth: number;
};

export type PlaceActions = {
  /** The chosen level's name for the card's line ("Vald nivå: Objekt · E12"), null when none is chosen. */
  level: PlaceLevelName | null;
  /** The card's line under its title. */
  line: string;
  /** Left out entirely when the person may not change places (read only), so no button promises what cannot be done. */
  newAddress: PlaceActionState | null;
  /** "Nytt objekt" under an address, "Nytt underobjekt" under an object; the label is kept when nothing is chosen. */
  newChild: (PlaceActionState & { label: "Nytt objekt" | "Nytt underobjekt" }) | null;
  edit: PlaceActionState | null;
  /** Pausa or Aktivera (admin only). */
  pause: (PlaceActionState & { label: "Pausa" | "Aktivera" }) | null;
  remove: PlaceActionState | null;
};

export const placeLevelName = (depth: number): PlaceLevelName => depth <= 0 ? "Adress" : depth === 1 ? "Objekt" : "Underobjekt";

/** Both labels of the add button, so the card reserves the longer one and never changes width. */
export const NEW_CHILD_LABELS = ["Nytt objekt", "Nytt underobjekt"] as const;

const CHOOSE = "Välj en adress eller ett objekt i trädet först.";

export function placeActions({ selected, canEdit, canManage, maxDepth }: PlaceActionsInput): PlaceActions {
  const level = selected ? placeLevelName(selected.depth) : null;
  const line = selected ? `Vald nivå: ${level} · ${selected.name}` : "Välj en adress i trädet.";
  const onChosen = (check: () => PlaceActionState): PlaceActionState => selected ? check() : { enabled: false, reason: CHOOSE };
  const newChild = canEdit ? {
    label: selected && selected.depth >= 1 ? "Nytt underobjekt" as const : "Nytt objekt" as const,
    ...onChosen(() => !selected!.isActive ? { enabled: false, reason: `${selected!.name} är pausad. Aktivera den först.` }
      : selected!.depth + 1 >= maxDepth ? { enabled: false, reason: `Högst ${maxDepth} nivåer – här kan inget läggas till under.` }
      : { enabled: true }),
  } : null;
  const remove = canEdit ? onChosen(() => selected!.hasChildren ? { enabled: false, reason: "Ta först bort det som ligger under." }
    : selected!.inUse === null ? { enabled: false, reason: "Kontrollerar om platsen används…" }
    : selected!.inUse ? { enabled: false, reason: "Platsen används av jobb, ronder eller gränsvärden och kan inte tas bort. Pausa den i stället." }
    : { enabled: true }) : null;
  return {
    level,
    line,
    newAddress: canEdit ? { enabled: true } : null,
    newChild,
    edit: canEdit ? onChosen(() => ({ enabled: true })) : null,
    pause: canManage ? { label: selected && !selected.isActive ? "Aktivera" : "Pausa", ...onChosen(() => ({ enabled: true })) } : null,
    remove,
  };
}

/**
 * Bottenraden på mobil och surfplatta (2026-10-09): one shared bar that follows the working mode. Hem and Sök are
 * always there. The other places show what fits the moment – Ny and Meny on an ordinary page, and Spara in an open
 * editor or form page (FormPage presses the form's own main button). There is no separate mode for a temporary view any
 * more (plan 1O, 2026-10-11): large forms are pages, so the bar is the same on every page. Never two buttons that
 * do the same.
 */
export type BottomBarMode = "standard" | "editor";
export type BottomBarSlotKey = "home" | "search" | "new" | "save" | "menu";
export type BottomBarSlot = { key: BottomBarSlotKey; label: string; disabled?: boolean; busy?: boolean; dirty?: boolean };

export type BottomBarEditor = { canSave: boolean; busy: boolean; dirty: boolean };
export type BottomBarInput = { editor?: BottomBarEditor | null };

export function bottomBarMode({ editor }: BottomBarInput): BottomBarMode {
  return editor?.canSave ? "editor" : "standard";
}

export function resolveBottomBar(input: BottomBarInput): BottomBarSlot[] {
  const editor = input.editor;
  return [
    { key: "home", label: "Hem" },
    { key: "search", label: "Sök" },
    { key: "new", label: "Ny" },
    // Spara keeps its place on an ordinary page so the bar does not jump between pages; it is active in an editor.
    { key: "save", label: editor?.busy ? "Arbetar…" : "Spara", disabled: !editor?.canSave || editor.busy, busy: Boolean(editor?.busy), dirty: Boolean(editor?.dirty) },
    { key: "menu", label: "Meny" },
  ];
}

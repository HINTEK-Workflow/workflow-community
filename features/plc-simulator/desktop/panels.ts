import { Activity, Boxes, CircleCheck, CircleHelp, Code2, FileCode2, FolderTree, GitBranch, Link2, type LucideIcon, PencilRuler, ScrollText, SlidersHorizontal, Tags } from "lucide-react";

// PLC-simulatorn, skrivbordet: the panels. One table, read by the dock, Visa, Fönster, the project tree and the phone's tabs, so
// a panel cannot exist in one and be missing in another. The order is Ctrl+1 … Ctrl+9 (Projekt and Palett last: they are
// reached with the pointer; there are ten panels and nine digits, so Palett has no digit).

export const PANEL_IDS = ["surface", "program", "tags", "check", "properties", "trend", "connection", "log", "tree", "palette", "ladder", "st", "help"] as const;
/** Ladder and ST each stand in Program; these two are for when one of them is broken out on its own. */
export const PHONE_PANELS = PANEL_IDS.filter((id) => id !== "ladder" && id !== "st");
export type PanelId = (typeof PANEL_IDS)[number];
export type PanelDef = { id: PanelId; title: string; icon: LucideIcon; line: string };
export const PANELS: Record<PanelId, PanelDef> = {
  surface: { id: "surface", title: "Rityta", icon: PencilRuler, line: "Apparater, ledningar och PLC:n." },
  program: { id: "program", title: "Program", icon: FileCode2, line: "Ladder och ST." },
  tags: { id: "tags", title: "Taggar", icon: Tags, line: "Namn, datatyp, plint och värde." },
  check: { id: "check", title: "Kontroll", icon: CircleCheck, line: "Kontroll av kopplingen." },
  properties: { id: "properties", title: "Egenskaper", icon: SlidersHorizontal, line: "Det som är markerat." },
  trend: { id: "trend", title: "Trend", icon: Activity, line: "Kurvor för valda taggar." },
  connection: { id: "connection", title: "Maskinkoppling", icon: Link2, line: "Provkör kopplingen mot Workflow." },
  log: { id: "log", title: "Logg", icon: ScrollText, line: "Skickade händelser och intagets svar." },
  tree: { id: "tree", title: "Projekt", icon: FolderTree, line: "Projektets delar." },
  palette: { id: "palette", title: "Palett", icon: Boxes, line: "Apparater att dra in." },
  ladder: { id: "ladder", title: "Ladder", icon: GitBranch, line: "Ladder ensam." },
  st: { id: "st", title: "ST", icon: Code2, line: "Strukturerad text ensam." },
  help: { id: "help", title: "Hjälp", icon: CircleHelp, line: "Guide, larm och API-koppling." },
};
export const isPanelId = (value: string): value is PanelId => (PANEL_IDS as readonly string[]).includes(value);

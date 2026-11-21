/**
 * Tavlornas flikar (2026-11-18, fråga 2): Tavlor · Tabeller · Skärmar · Länkar on one page (view=boards), each with its own
 * address (`&tab=`), drawn by the shell under the heading like Underhåll's. A tab is offered by its own right. Pure.
 */
export const BOARDS_TABS = ["boards", "tables", "screens", "links"] as const;
export type BoardsTab = (typeof BOARDS_TABS)[number];
/** Fasta skärmar and Delade länkar (2026-11-19): two different ways out, so the names say which. */
export const BOARDS_TAB_LABEL: Record<BoardsTab, string> = { boards: "Tavlor", tables: "Tabeller", screens: "Fasta skärmar", links: "Delade länkar" };
export const boardsTabOf = (value: string | null | undefined): BoardsTab => (BOARDS_TABS as readonly string[]).includes(value ?? "") ? value as BoardsTab : "boards";
export const boardsTabHref = (tab: string) => tab === "boards" || !(BOARDS_TABS as readonly string[]).includes(tab) ? "/?view=boards" : `/?view=boards&tab=${tab}`;
/** The tabs the person is offered: Tavlor and Tabeller with the right to see boards, Skärmar with the right Skärmar, Länkar with the right to publish. */
export function boardsTabsFor(access: { read: boolean; screens: boolean; publish: boolean }): BoardsTab[] {
  return BOARDS_TABS.filter((tab) => tab === "boards" || tab === "tables" ? access.read : tab === "screens" ? access.screens : access.publish);
}
/** The one sentence that tells the two apart, under the title, in the empty list and in the Ny-dialog (2026-11-19; sharper 2026-11-20). */
export const SCREENS_SENTENCE = "Fasta skärmar är era egna skärmar, godkända en i taget med en kod.";
export const LINKS_SENTENCE = "Delade länkar är adresser ni ger till personer som ska kunna titta; alla som har länken ser tavlan.";
/** Tabeller (förenkling 0.77.0, kvar-till-2026-12-31 F): what the tab is for, in the same pattern as the two sentences above. */
export const TABLES_SENTENCE = "Tabeller är värden ni skriver själva, till exempel dagens mål eller veckans meddelande, som tavlornas kort sedan visar.";

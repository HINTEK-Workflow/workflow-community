/**
 * The menu buttons each person may hide under Inställningar (2026-09-30). Only what is shown changes – never
 * what the person may do. Översikt, Hjälp and Inställningar always stay, so the way back is never hidden, and a hidden
 * page that is open is still shown while it is open. Grouped like the menu itself.
 */
export const MENU_ITEM_GROUPS = [
  { title: "Arbete", items: [
    { key: "tasks", label: "Ny uppgift och Mina uppgifter" },
    { key: "work_orders", label: "Ny arbetsorder och Mina arbetsordrar" },
    { key: "projects", label: "Nytt projekt och Mina projekt" },
  ] },
  { title: "Planering och uppföljning", items: [
    { key: "planning", label: "Planering" },
    { key: "rounds", label: "Driftronder" },
    { key: "time", label: "Tidrapport" },
  ] },
  { title: "Register", items: [
    { key: "customers", label: "Kundregister" },
    { key: "facilities", label: "Platser" },
  ] },
  { title: "Verktyg", items: [
    { key: "ai", label: "HINTEK AI" },
    { key: "import", label: "Import" },
    { key: "forms", label: "Skapa formulär" },
  ] },
  { title: "Företag", items: [
    { key: "credits", label: "Krediter" },
  ] },
] as const;
export const MENU_HIDEABLE = MENU_ITEM_GROUPS.flatMap((group) => group.items.map((item) => item.key)) as [MenuHideable, ...MenuHideable[]];
export type MenuHideable = (typeof MENU_ITEM_GROUPS)[number]["items"][number]["key"];
export const MENU_VISIBILITY_EVENT = "hintek:menu-visibility";

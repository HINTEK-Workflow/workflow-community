"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Archive, Bell, BookOpen, Bot, Calculator, ClipboardCheck, ClipboardList, Clock3, FolderKanban, Info, Lightbulb, Network, Repeat, ShieldAlert, Sparkles, ToggleRight } from "lucide-react";
import { ListEmpty, ListGroup, ListRow, NativeMenuPage, NativeScreenIndex, NativeSearch, useNativeScreen, useNativeTopBar } from "@/components/native";
import { helpPlainText, searchHelpEntries, type HelpHit } from "@/lib/workflow/help-search";
import { currentAppVersion } from "@/lib/release-notes";
import type { TypeKey } from "@/lib/workflow/native-mode";

/**
 * Hjälp at level 1 on a phone (2026-10-10: the phone's own lists): a menu of rows, each part of the help a screen
 * of its own (`&step=`, so Bakåt works). The texts are the page's own panels, wrapped in `NativeScreen` where they are
 * (features/kfid/workspace.tsx, features/workflow/workflow-guide.tsx); nothing of the help is left out at any level.
 * A search field under the tiles (D6, UX punkt 8) finds a chapter by its title, its line and the words it explains, and
 * since svar 5 (2026-10-24) by its whole text: the page's chapters are drawn out of sight while something is typed
 * and their text is read (`NativeScreenIndex`); a hit in the text shows an excerpt.
 */
type HelpScreen = { key: string; title: string; subtitle?: string; icon: LucideIcon; type: TypeKey; words?: string };
export const HELP_GROUPS: { title?: string; rows: HelpScreen[] }[] = [
  { rows: [{ key: "nytt", title: "Nytt i versionen", icon: Sparkles, type: "project", words: "version nyheter ändringar uppdatering" }] },
  { title: "Så fungerar Workflow", rows: [
    { key: "modell", title: "Så hänger det ihop", subtitle: "Projekt, jobb, steg, tid och riskbedömning", icon: Network, type: "project", words: "arbetsorder uppgift kund plats" },
    { key: "arbetsflode", title: "Så fungerar arbetsflödet", subtitle: "Stegen i en arbetsorder", icon: BookOpen, type: "work-order", words: "arbetsorder steg beställning utförande slutförande material" },
    { key: "riskbedomning", title: "Riskbedömning", icon: ShieldAlert, type: "risk", words: "risk säkerhet frågor åtgärder" },
    { key: "protokoll", title: "Kontroll och protokoll", icon: ClipboardCheck, type: "control", words: "mätning mätvärden formulär rapport pdf" },
    { key: "projekt", title: "Projekt", icon: FolderKanban, type: "project", words: "planering tidplan avsluta arkivera" },
    { key: "tid", title: "Tid", icon: Clock3, type: "time", words: "tidrapport tidtagning timmar vecka starta stoppa" },
    { key: "ronder", title: "Driftronder och Kalender", icon: Repeat, type: "round", words: "rond tillsyn qr kalender återkommande" },
  ] },
  { title: "Funktioner och tips", rows: [
    { key: "funktioner", title: "Funktioner att slå på", icon: ToggleRight, type: "neutral", words: "inställningar arbetssätt objektdata brytare" },
    { key: "tips", title: "Tips i arbetsflödet", icon: Lightbulb, type: "quote", words: "förslag råd" },
    { key: "notiser", title: "Notiser", icon: Bell, type: "work-order", words: "påminnelse klockan push förfallen" },
    { key: "rapportarkiv", title: "Rapportarkiv", icon: Archive, type: "neutral", words: "rapport pdf arkiv sök" },
    { key: "kfid", title: "Kontroll före idrifttagning", icon: ClipboardList, type: "control", words: "kfid mätvärde gräns jordfelsbrytare" },
    { key: "kalkylator", title: "Kalkylator", icon: Calculator, type: "neutral", words: "trefas effekt ström spänning räkna" },
    // Workflow AI (UX-granskningen C4, 2026-10-22): what AI does and never does, and the aliases; only with AI in the installation.
    { key: "ai", title: "Workflow AI", subtitle: "Vad AI gör och aldrig gör", icon: Sparkles, type: "neutral", words: "ai assistent alias" },
    // Din egen AI-app (2026-11-27): ChatGPT, Claude and Copilot over MCP; in every installation.
    { key: "egen-ai", title: "Din egen AI-app", subtitle: "ChatGPT, Claude eller Copilot via MCP", icon: Bot, type: "neutral", words: "mcp chatgpt claude copilot oauth nyckel koppla ansluta egen ai" },
  ] },
  { rows: [{ key: "om", title: "Om Workflow", subtitle: "Version, villkor och licenser", icon: Info, type: "neutral", words: "villkor integritet licenser källor karta" }] },
];
/** The two big tiles of Hjälp (M2). */
const HELP_TILES = ["nytt", "modell"];
const TITLE = new Map(HELP_GROUPS.flatMap((group) => group.rows.map((row) => [row.key, row.title] as const)));

/** The chapters a search finds: every word typed is in the chapter's title, its line, its words or its text (not case sensitive). */
export function searchHelp(query: string, ai = true, texts?: ReadonlyMap<string, string>): HelpHit<HelpScreen>[] {
  return searchHelpEntries(HELP_GROUPS.flatMap((group) => group.rows).filter((row) => ai || row.key !== "ai"), query, texts);
}

/** Every text node of the drawn chapters, joined with spaces (textContent would glue "steg.Nästa"). */
function chapterTexts(node: HTMLElement): Map<string, string> {
  const texts = new Map<string, string>();
  for (const chapter of node.querySelectorAll<HTMLElement>("[data-native-screen]")) {
    const parts: string[] = [];
    const walker = document.createTreeWalker(chapter, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) parts.push(text.textContent ?? "");
    const key = chapter.dataset.nativeScreen ?? "";
    texts.set(key, helpPlainText(`${texts.get(key) ?? ""} ${parts.join(" ")}`));
  }
  return texts;
}

/** The help's menu of rows at level 1 (nothing elsewhere), and the top bar's title on one of its screens. */
export function NativeHelpMenu({ ai = true, chapters }: { ai?: boolean; /** The page's help chapters, read as the search's text. */ chapters?: ReactNode } = {}) {
  const { native, step } = useNativeScreen();
  const [query, setQuery] = useState("");
  const [texts, setTexts] = useState<Map<string, string> | null>(null);
  // Read once when the out-of-sight chapters are drawn (the first letter typed); kept while the page is open.
  const readChapters = useCallback((node: HTMLDivElement | null) => { if (node) setTexts(chapterTexts(node)); }, []);
  useNativeTopBar(native && step ? { title: TITLE.get(step) ?? "Hjälp" } : null);
  if (!native || step) return null;
  const version = currentAppVersion();
  // M2 (2026-10-12): the two first parts as big tiles, the rest as rows; the title is the top bar's.
  const all = HELP_GROUPS.flatMap((group) => group.rows);
  const tileKeys = HELP_TILES;
  const open = (row: HelpScreen) => ({ type: row.type, icon: row.icon, title: row.key === "nytt" && version ? `Nytt i version ${version}` : row.title, subtitle: row.subtitle,
    href: `/?view=help&step=${row.key}`, testId: `native-help-${row.key}` });
  const search = <NativeSearch value={query} onChange={setQuery} label="Sök i hjälpen" placeholder="Sök i hjälpen" />;
  // While something is typed the tiles and groups give way to the chapters it finds.
  if (query.trim()) {
    const found = searchHelp(query, ai, texts ?? undefined);
    return <NativeMenuPage testId="native-help">
      {search}
      <ListGroup title="Träffar" testId="native-help-results">
        {found.length ? found.map(({ entry, excerpt }) => <ListRow key={entry.key} {...open(entry)} {...(excerpt ? { subtitle: <span data-testid="native-help-excerpt">{excerpt}</span> } : {})} />)
          : <ListEmpty>Inget kapitel matchar ”{query.trim()}”.</ListEmpty>}
      </ListGroup>
      {chapters && !texts ? <div hidden aria-hidden="true" ref={readChapters} data-testid="native-help-index"><NativeScreenIndex.Provider value>{chapters}</NativeScreenIndex.Provider></div> : null}
    </NativeMenuPage>;
  }
  return <NativeMenuPage testId="native-help"
    tiles={tileKeys.map((key) => all.find((row) => row.key === key)).filter((row): row is HelpScreen => Boolean(row)).map((row) => row.key === "nytt" ? { ...open(row), title: "Nytt", subtitle: version ? `Version ${version}` : undefined } : { ...open(row), subtitle: undefined })}
    groups={HELP_GROUPS.map((group) => ({ title: group.title, rows: group.rows.filter((row) => !tileKeys.includes(row.key) && (ai || row.key !== "ai")).map((row) => ({ key: row.key, ...open(row) })) })).filter((group) => group.rows.length)}>
    {search}
  </NativeMenuPage>;
}

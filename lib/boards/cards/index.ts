import { z } from "zod";
import { calendarSourceSchema } from "./calendar";
import { faultsSourceSchema } from "./faults";
import { pdfSourceSchema, sheetSourceSchema } from "./file";
import { machineEventsSourceSchema, machineSignalSourceSchema, machineSourceSchema, machinesSourceSchema } from "./machines";
import { trendSourceSchema } from "./trend";
import { upkeepSourceSchema } from "./upkeep";
import type { ShapeKind } from "../shapes";

/**
 * Tavlans nyare kort (2026-11-19): files, the calendar, the machines, Underhåll, Felanmälan and Trend. Each reads one of
 * Workflow's own sources, chosen in the card's `data` as `{ kind: "source", source }`; the source's `type` is the card's type. The
 * register below is joined to the card types in lib/boards/model.ts, so the editor's library, the properties panel and the server
 * find them like the other cards. Pure.
 */
export const SOURCE_CARD_TYPES = ["pdf", "sheet", "calendar", "machine", "machine_events", "machine_signal", "machines", "upkeep", "faults", "trend"] as const;
export type SourceCardType = (typeof SOURCE_CARD_TYPES)[number];
export const isSourceCardType = (type: string): type is SourceCardType => (SOURCE_CARD_TYPES as readonly string[]).includes(type);

export const sourceConfigSchema = z.discriminatedUnion("type", [
  pdfSourceSchema, sheetSourceSchema, calendarSourceSchema, machineSourceSchema, machineEventsSourceSchema, machineSignalSourceSchema, machinesSourceSchema,
  upkeepSourceSchema, faultsSourceSchema, trendSourceSchema,
]);
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export const sourceRefSchema = z.object({ kind: z.literal("source"), source: sourceConfigSchema });
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type SourceOf<T extends SourceCardType> = Extract<SourceConfig, { type: T }>;

export type SourceCardIcon = "FileText" | "FileSpreadsheet" | "CalendarDays" | "Factory" | "BellRing" | "Activity" | "LayoutGrid" | "Wrench" | "MessageSquareWarning" | "TrendingUp";
export type SourceCardDefinition = {
  type: SourceCardType; label: string; icon: SourceCardIcon; description: string; shapes: readonly ShapeKind[];
  size: { minW: number; minH: number }; start: { w: number; h: number };
};

export const SOURCE_CARDS: readonly SourceCardDefinition[] = [
  { type: "trend", label: "Trend", icon: "TrendingUp", description: "Ett eller flera mått över de senaste perioderna, med mållinje.", shapes: ["series"], size: { minW: 6, minH: 4 }, start: { w: 12, h: 6 } },
  { type: "calendar", label: "Kalender", icon: "CalendarDays", description: "Dagens eller veckans bokningar från Planering, som lista eller schema.", shapes: ["calendar"], size: { minW: 6, minH: 4 }, start: { w: 12, h: 8 } },
  { type: "machine", label: "Maskinläge", icon: "Factory", description: "En maskins läge nu: i drift, stoppad eller larm.", shapes: ["machines"], size: { minW: 3, minH: 3 }, start: { w: 6, h: 4 } },
  { type: "machines", label: "Maskinöversikt", icon: "LayoutGrid", description: "Flera maskiners läge som små rutor.", shapes: ["machines"], size: { minW: 6, minH: 3 }, start: { w: 12, h: 6 } },
  { type: "machine_events", label: "Maskinlarm", icon: "BellRing", description: "De senaste larmen och händelserna från maskinkopplingen.", shapes: ["events"], size: { minW: 6, minH: 3 }, start: { w: 8, h: 6 } },
  { type: "machine_signal", label: "Mätvärde", icon: "Activity", description: "Ett mätvärde från maskinen, eller stopp och larm per dag, som diagram.", shapes: ["series"], size: { minW: 6, minH: 4 }, start: { w: 12, h: 6 } },
  { type: "upkeep", label: "Underhållsjobb", icon: "Wrench", description: "Förfallna och kommande underhållsjobb med antal och en kort lista.", shapes: ["summary"], size: { minW: 6, minH: 4 }, start: { w: 8, h: 7 } },
  { type: "faults", label: "Felanmälningar", icon: "MessageSquareWarning", description: "Nya och öppna felanmälningar från operatörerna.", shapes: ["summary"], size: { minW: 6, minH: 4 }, start: { w: 8, h: 7 } },
  { type: "pdf", label: "PDF", icon: "FileText", description: "Sidorna i en PDF, en vald sida eller en i taget i tur och ordning.", shapes: ["document"], size: { minW: 4, minH: 4 }, start: { w: 8, h: 10 } },
  { type: "sheet", label: "Kalkylblad", icon: "FileSpreadsheet", description: "En CSV- eller Excelfil som tabell eller diagram.", shapes: ["table", "series"], size: { minW: 6, minH: 3 }, start: { w: 12, h: 6 } },
];

/** What a new card of the type reads before anything is chosen; a file card waits for its file. */
export function defaultSource(type: SourceCardType): SourceConfig | null {
  switch (type) {
    case "pdf": case "sheet": return null;
    case "calendar": return { type, range: "today", view: "list" };
    case "machine": case "machines": return { type };
    case "machine_events": return { type, alarmsOnly: false };
    case "machine_signal": return { type, measure: "signal", period: "today" };
    case "upkeep": return { type, horizon: "30d" };
    case "faults": return { type, period: "week" };
    case "trend": return { type, metrics: ["tasks_completed_week"], period: "week" };
  }
}

/** The card's source as stored, or its type's default; a source of another type than the card is not read. */
export function sourceOfCard(card: { type: string; data?: { kind: string } | null }): SourceConfig | null {
  if (!isSourceCardType(card.type)) return null;
  const data = card.data as SourceRef | { kind: string } | null | undefined;
  if (data?.kind === "source") return (data as SourceRef).source.type === card.type ? (data as SourceRef).source : null;
  return defaultSource(card.type);
}

/** The columns of a source that hold people's names: only the calendar's people. */
export const sourcePersonalColumns = (source: SourceConfig): readonly string[] => source.type === "calendar" ? ["people"] : [];

/** The pictures and files a source shows through the board's file route (a screen or a link answers only for these). */
export const sourceFileIds = (source: SourceConfig | null): string[] => source?.type === "pdf" ? [source.fileId] : [];

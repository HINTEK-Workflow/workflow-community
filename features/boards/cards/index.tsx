"use client";

import { sourceOfCard, type SourceConfig, type SourceOf } from "@/lib/boards/cards";
import type { BoardCard } from "@/lib/boards/model";
import type { Shape } from "@/lib/boards/shapes";
import type { MetricOption } from "../boards-api";
import { Placeholder, type Shown } from "../board-card";
import { CalendarBody, CalendarSettings } from "./calendar";
import { PdfBody, PdfSettings, SheetSettings } from "./file";
import { MachineEventsSettings, MachineSettings, MachinesBody, MachineSignalSettings, MachinesSettings } from "./machines";
import { FaultsSettings, SummaryBody, UpkeepSettings } from "./summary";
import { TrendSettings } from "./trend";

/**
 * Tavlans nyare kort i webbläsaren (2026-11-19): the drawing of the shapes only these cards have (a PDF, the calendar, the machines,
 * counts with a short list) and each type's choices in Egenskaper. The cards that give a chart, a table or events are drawn by the
 * shared parts in ../board-card.tsx like every other card.
 */
export function SourceCardBody({ card, data, onShown }: { card: BoardCard; data: Shape; onShown: (shown: Shown | null) => void }) {
  const source = sourceOfCard(card);
  switch (data.kind) {
    case "document": return <PdfBody data={data} source={source?.type === "pdf" ? source : null} />;
    case "calendar": return <CalendarBody data={data} onShown={onShown} />;
    case "machines": return <MachinesBody card={card} data={data} onShown={onShown} />;
    case "summary": return <SummaryBody data={data} onShown={onShown} empty={card.type === "faults" ? "Inga öppna felanmälningar." : "Inga förfallna eller kommande underhållsjobb."} />;
    case "series": return <Placeholder text={card.type === "machine_signal" ? "Det finns inga mätvärden att visa ännu." : "Inget att visa just nu."} />;
    default: return null;
  }
}

/** The chart kind a newer card draws until the person chooses another. */
export function defaultChartOf(card: BoardCard): "line" | "bar" {
  const source = sourceOfCard(card);
  if (source?.type === "trend") return "line";
  if (source?.type === "machine_signal") return (source.measure ?? "signal") === "signal" ? "line" : "bar";
  return "bar";
}

/** The card's own choices in Egenskaper → Innehåll. */
export function SourceCardSettings({ card, metrics, onChange }: { card: BoardCard; metrics: MetricOption[]; onChange: (card: BoardCard) => void }) {
  const source = sourceOfCard(card);
  const onSource = (next: SourceConfig) => onChange({ ...card, data: { kind: "source", source: next } });
  switch (card.type) {
    case "pdf": return <PdfSettings source={source as SourceOf<"pdf"> | null} onSource={onSource} />;
    case "sheet": return <SheetSettings card={card} source={source as SourceOf<"sheet"> | null} onSource={onSource} onChange={onChange} />;
    case "calendar": return <CalendarSettings source={source as SourceOf<"calendar">} onSource={onSource} />;
    case "machine": return <MachineSettings source={source as SourceOf<"machine">} onSource={onSource} />;
    case "machines": return <MachinesSettings source={source as SourceOf<"machines">} onSource={onSource} />;
    case "machine_events": return <MachineEventsSettings source={source as SourceOf<"machine_events">} onSource={onSource} />;
    case "machine_signal": return <MachineSignalSettings card={card} source={source as SourceOf<"machine_signal">} onSource={onSource} onChange={onChange} />;
    case "upkeep": return <UpkeepSettings source={source as SourceOf<"upkeep">} onSource={onSource} />;
    case "faults": return <FaultsSettings source={source as SourceOf<"faults">} onSource={onSource} />;
    case "trend": return <TrendSettings card={card} source={source as SourceOf<"trend">} metrics={metrics} onSource={onSource} onChange={onChange} />;
    default: return null;
  }
}

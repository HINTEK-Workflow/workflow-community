"use client";

import { TriangleAlert } from "lucide-react";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { boardReadability, issueCardName, SCREEN_SIZES, screenSize, tvInches, type ScreenSizeKey, type ScreenTurn } from "@/lib/boards/capacity";
import { DISTANCE, type BoardLayout, type Distance } from "@/lib/boards/model";
import { cn } from "@/lib/utils";

/**
 * Går tavlan att läsa? (2026-11-20): the editor's warning when the board has more cards than can be read on the chosen screen at
 * its distance, when a card's text gets too small there, or when one figure fills a quarter of the board. Each line names the card
 * (a click chooses it) and says what to do. It is the app's notice, never a dialog, and it never stops Publicera. A tv is counted at
 * the size chosen in Förhandsgranska (`inches`), else at its distance's usual size. The counting is in lib/boards/capacity.ts.
 */
const ON_SCREEN: Record<ScreenSizeKey, string> = { ipad: "en iPad", laptop: "en dator", tv1080: "en TV 1080p", tv4k: "en TV 4K" };
const MAX_LINES = 5;
/** "en TV 1080p på 86 tum", "en iPad". */
const onScreen = (size: ScreenSizeKey, distance: Distance, inches?: number | null) => screenSize(size).tv ? `${ON_SCREEN[size]} på ${tvInches(distance, inches)} tum` : ON_SCREEN[size];

export function ReadabilityWarning({ layout, size, turn, distance, inches, labels, onSelect, testId = "board-readability" }: {
  layout: BoardLayout; size: ScreenSizeKey; turn: ScreenTurn; distance: Distance; labels: Record<string, string>;
  /** A tv's chosen size; null is the distance's usual size. */
  inches?: number | null;
  onSelect: (id: string) => void; testId?: string;
}) {
  if (!layout.cards.length) return null;
  const result = boardReadability(layout, size, turn, distance, inches);
  if (!result.tooMany && !result.issues.length) return null;
  const at = DISTANCE[distance].label;
  const where = onScreen(size, distance, inches);
  const nearer = distance !== "near" ? " eller välj avståndet Nära om skärmen sitter nära" : "";
  const cardOf = (id: string) => layout.cards.find((card) => card.id === id)!;
  const lines = result.issues.slice(0, MAX_LINES);
  return <div className="notice flex gap-3" role="status" data-testid={testId} data-size={size} data-distance={distance} data-inches={screenSize(size).tv ? tvInches(distance, inches) : undefined}>
    <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
    <div className="min-w-0 space-y-1.5">
      <p className="font-medium">{result.readable ? `Några kort kan bli onödigt stora på ${where} på avståndet ${at}.` : `Tavlan kan bli svår att läsa på ${where} på avståndet ${at}.`}</p>
      {result.capacity.cards === 0
        ? <p data-testid="board-readability-none">På {where} går texten inte att läsa på avståndet {at}, inte ens med ett enda stort kort. Välj avståndet Nära eller en större skärm.</p>
        : result.tooMany ? <p data-testid="board-readability-many">Tavlan har {layout.cards.length} kort, men ungefär {result.capacity.cards} går att läsa här. Ta bort ett kort{nearer}.</p> : null}
      {result.capacity.cards > 0 && lines.length ? <ul className="space-y-1">
        {lines.map((issue) => {
          const card = cardOf(issue.cardId);
          const name = <button type="button" className="font-semibold underline underline-offset-2" onClick={() => onSelect(card.id)}>{issueCardName(card, labels[card.id])}</button>;
          return <li key={issue.cardId} data-testid="board-readability-issue" data-card-id={issue.cardId} data-kind={issue.kind}>
            {issue.kind === "small"
              ? <>{name}: texten blir för liten för att läsas här. Gör kortet större{card.settings.textSize !== "large" ? ", välj Textstorlek Större" : ""}{nearer}.</>
              : <>{name}: kortet tar en fjärdedel av tavlan, och texten blir mycket större än den behöver vara. Gör kortet mindre, så får fler kort plats.</>}
          </li>;
        })}
        {result.issues.length > MAX_LINES ? <li>Och {result.issues.length - MAX_LINES} kort till.</li> : null}
      </ul> : null}
      <p className="text-xs opacity-80">Du kan publicera ändå. Skärmen och tv:ns storlek väljer du i Förhandsgranska.</p>
    </div>
  </div>;
}

/** Förhandsgranska: for each screen, whether the board can be read there at the distance shown (a tv at the chosen size). */
export function ReadabilityBySize({ layout, turn, distance, inches }: { layout: BoardLayout; turn: ScreenTurn; distance: Distance; inches?: number | null }) {
  if (!layout.cards.length) return null;
  return <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="board-preview-readability">
    <span className="text-muted-foreground">Läsbar på avståndet {DISTANCE[distance].label}:</span>
    {SCREEN_SIZES.map((size) => {
      const result = boardReadability(layout, size.key, turn, distance, inches);
      const where = onScreen(size.key, distance, inches);
      return <span key={size.key} className={cn("rounded-full px-2 py-0.5 font-medium", indicatorBadge(result.readable ? "success" : "warning"))}
        title={result.capacity.cards ? `Ungefär ${result.capacity.cards} kort går att läsa på ${where}.` : `Texten går inte att läsa på ${where} på det här avståndet.`}
        data-testid="board-preview-readable" data-size={size.key} data-readable={result.readable ? "yes" : "no"}>
        {size.label}{size.tv ? `, ${tvInches(distance, inches)} tum` : ""}: {result.readable ? "läsbar" : "svår att läsa"}
      </span>;
    })}
  </div>;
}

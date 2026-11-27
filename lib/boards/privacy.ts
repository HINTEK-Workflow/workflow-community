import { z } from "zod";
import { metricDefinition } from "./metrics";
import { sourcePersonalColumns } from "./cards";
import { maskCalendar } from "./cards/calendar";
import type { BoardCard, BoardLayout } from "./model";
import type { Shape } from "./shapes";

/**
 * Personuppgifter på skärmar och länkar (2026-11-18, fråga 6: dolda som förval). Inside the app a card shows names as the
 * page it comes from does. Outside it – a connected screen or a shared link – a card's personal data is hidden unless the publisher
 * chose initials or names for that card in "Det här syns"; a link without a code and an end date always hides them, whatever was
 * chosen (a rule on the server, lib/boards/feed-server.ts). A reason for absence is never part of any measure. Pure.
 */
export const PEOPLE_CHOICES = ["hidden", "initials", "names"] as const;
export type PeopleChoice = (typeof PEOPLE_CHOICES)[number];
export const PEOPLE_CHOICE_LABEL: Record<PeopleChoice, string> = { hidden: "Dolt", initials: "Initialer", names: "Namn" };
export const visibilitySchema = z.record(z.string().max(40), z.enum(PEOPLE_CHOICES)).default({});
export type Visibility = Record<string, PeopleChoice>;

/** The columns of a card's source that hold people's names (only Workflow's own measures mark any). */
export function personalColumns(card: Pick<BoardCard, "data">): readonly string[] {
  if (card.data?.kind === "source") return sourcePersonalColumns(card.data.source);
  return card.data?.kind === "metric" ? metricDefinition(card.data.metric).personal ?? [] : [];
}
export const cardHasPersonalData = (card: Pick<BoardCard, "data">) => personalColumns(card).length > 0;
export const layoutHasPersonalData = (layout: Pick<BoardLayout, "cards">) => layout.cards.some(cardHasPersonalData);

/** The choice for a card: what was stored, else hidden. */
export const peopleChoiceOf = (visibility: Visibility | null | undefined, cardId: string): PeopleChoice => visibility?.[cardId] ?? "hidden";

/** Initials of one name or of several separated by commas ("Elna Strömtång, Elis Hammarström" → "ES, EH"). */
export function initialsOf(text: string): string {
  return text.split(",").map((name) => name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]!.toUpperCase()).join("").slice(0, 3)).filter(Boolean).join(", ");
}

/** The card's data with its personal columns hidden or shortened; a table without the column when hidden. */
export function maskPeople(shape: Shape, columns: readonly string[], choice: PeopleChoice): Shape {
  if (shape.kind === "calendar" && columns.length) return maskCalendar(shape, choice, initialsOf);
  if (!columns.length || choice === "names" || shape.kind !== "table") return shape;
  if (choice === "initials") {
    return { ...shape, rows: shape.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, columns.includes(key) && typeof value === "string" ? initialsOf(value) : value]))) };
  }
  return {
    ...shape,
    columns: shape.columns.filter((column) => !columns.includes(column.key)),
    rows: shape.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !columns.includes(key)))),
  };
}

/** What "Det här syns" lists per card: the card, whether it has names, and the choice the publisher makes. */
export function visibilitySummary(layout: Pick<BoardLayout, "cards">, visibility: Visibility) {
  return layout.cards.map((card) => ({ id: card.id, personal: cardHasPersonalData(card), people: peopleChoiceOf(visibility, card.id) }));
}

/** Only choices for cards that exist and have personal data are kept. */
export function cleanVisibility(layout: Pick<BoardLayout, "cards">, visibility: Visibility): Visibility {
  return Object.fromEntries(layout.cards.filter(cardHasPersonalData).map((card) => [card.id, peopleChoiceOf(visibility, card.id)]));
}

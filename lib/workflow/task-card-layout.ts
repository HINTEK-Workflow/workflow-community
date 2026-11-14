import { z } from "zod";

/**
 * The person's own arrangement of the cards under Ny uppgift (2026-09-27): order and which cards are shown.
 * Cards are identified as `type:<task type>` or `form:<form id>`. Stored in the user's preferences, so it follows the
 * person across devices; it never grants or removes access, it only arranges what the person may already create.
 *
 * Free placement (2026-09-29): `slots` places a card on a chosen place – one of 3 favourite places at the top or
 * one of 6 places in any category, also another category than the form's own. Keyed `<section>:<index>`. A card without
 * a place (for example a newly published form) takes the first free place in its own category, after the saved `order`.
 */
export const FAVORITES = "FAVORITES";
export const FAVORITE_SLOTS = 3;
export const CATEGORY_SLOTS = 6;
/** A category grows past its 6 places only when more cards than that land in it on their own, so no card is lost. */
const MAX_SLOT_INDEX = 40;

export const taskCardLayoutSchema = z.object({
  order: z.array(z.string().max(120)).max(200).default([]),
  hidden: z.array(z.string().max(120)).max(200).default([]),
  slots: z.record(z.string().max(60), z.string().max(120)).refine((value) => Object.keys(value).length <= 200).default({}),
});
export type TaskCardLayout = z.infer<typeof taskCardLayoutSchema>;
export const emptyTaskCardLayout: TaskCardLayout = { order: [], hidden: [], slots: {} };

/** Saved order first; cards the person has not arranged yet (for example a newly published form) keep their default place at the end. */
export function arrangeTaskCards<T extends { key: string }>(cards: T[], layout: Partial<TaskCardLayout> = emptyTaskCardLayout) {
  const order = layout.order ?? [];
  const position = new Map(order.map((key, index) => [key, index]));
  const ordered = cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (position.get(a.card.key) ?? order.length + a.index) - (position.get(b.card.key) ?? order.length + b.index))
    .map(({ card }) => card);
  const hidden = new Set(layout.hidden ?? []);
  return { all: ordered, visible: ordered.filter((card) => !hidden.has(card.key)), hidden: ordered.filter((card) => hidden.has(card.key)) };
}

/** Moves one card to a new index. */
export function moveTaskCard(keys: string[], key: string, to: number) {
  const from = keys.indexOf(key);
  if (from < 0) return keys;
  const next = [...keys];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, key);
  return next;
}

export const slotId = (section: string, index: number) => `${section}:${index}`;
export function parseSlotId(id: string) {
  const at = id.lastIndexOf(":");
  const index = Number(id.slice(at + 1));
  return at > 0 && Number.isInteger(index) && index >= 0 ? { section: id.slice(0, at), index } : null;
}
export const slotCapacity = (section: string) => (section === FAVORITES ? FAVORITE_SLOTS : CATEGORY_SLOTS);

export type PlacedSection<T> = { section: string; slots: (T | null)[] };

/**
 * Every card on a place: the favourites first, then the categories in the given order. Saved places win; the rest fill
 * the first free place of their own category in the saved order. Hidden cards keep their place (shown dimmed in Anpassa).
 */
export function placeTaskCards<T extends { key: string }>(cards: T[], layout: Partial<TaskCardLayout>, categoryOf: (card: T) => string, categories: string[]): PlacedSection<T>[] {
  const sections = [FAVORITES, ...categories];
  const known = new Set(sections);
  const byKey = new Map(cards.map((card) => [card.key, card]));
  const places = new Map<string, Map<number, T>>(sections.map((section) => [section, new Map()]));
  const placed = new Set<string>();
  for (const [id, key] of Object.entries(layout.slots ?? {})) {
    const slot = parseSlotId(id);
    const card = byKey.get(key);
    if (!slot || !card || placed.has(key) || !known.has(slot.section)) continue;
    const limit = slot.section === FAVORITES ? FAVORITE_SLOTS : MAX_SLOT_INDEX;
    const section = places.get(slot.section)!;
    if (slot.index >= limit || section.has(slot.index)) continue;
    section.set(slot.index, card);
    placed.add(key);
  }
  for (const card of arrangeTaskCards(cards, layout).all) {
    if (placed.has(card.key)) continue;
    const own = categoryOf(card);
    const section = places.get(known.has(own) && own !== FAVORITES ? own : categories[categories.length - 1])!;
    let index = 0;
    while (section.has(index)) index += 1;
    section.set(index, card);
    placed.add(card.key);
  }
  return sections.map((section) => {
    const filled = places.get(section)!;
    const length = Math.max(slotCapacity(section), ...[...filled.keys()].map((index) => index + 1));
    return { section, slots: Array.from({ length }, (_, index) => filled.get(index) ?? null) };
  });
}

/** The places of a placement, as saved. */
export function slotsOfPlacement<T extends { key: string }>(placement: PlacedSection<T>[]) {
  const slots: Record<string, string> = {};
  for (const { section, slots: list } of placement) list.forEach((card, index) => { if (card) slots[slotId(section, index)] = card.key; });
  return slots;
}

/** Puts a card on a place; a card already there swaps to the moved card's old place. */
export function moveCardToSlot(slots: Record<string, string>, key: string, target: string) {
  const from = Object.entries(slots).find(([, value]) => value === key)?.[0];
  if (!from || from === target || !parseSlotId(target)) return slots;
  const next = { ...slots };
  const occupant = next[target];
  next[target] = key;
  if (occupant) next[from] = occupant;
  else delete next[from];
  return next;
}

/** The first free place of a section within its places, or null when it is full. */
export function firstFreeSlot(slots: Record<string, string>, section: string) {
  for (let index = 0; index < slotCapacity(section); index += 1)
    if (!slots[slotId(section, index)]) return slotId(section, index);
  return null;
}

/**
 * The layout to save. Cards not offered right now (for example a form that may not be used in a project, when the
 * page is opened from a project) keep their saved place and visibility instead of being forgotten, unless the place
 * was taken by another card.
 */
export function saveableTaskCardLayout(keys: string[], hidden: Set<string>, previous: Partial<TaskCardLayout> = emptyTaskCardLayout, slots: Record<string, string> = {}): TaskCardLayout {
  const shown = new Set(keys);
  const keptSlots = Object.fromEntries(Object.entries(previous.slots ?? {}).filter(([id, key]) => !shown.has(key) && !(id in slots)));
  return {
    order: [...keys, ...(previous.order ?? []).filter((key) => !shown.has(key))].slice(0, 200),
    hidden: [...keys.filter((key) => hidden.has(key)), ...(previous.hidden ?? []).filter((key) => !shown.has(key))].slice(0, 200),
    slots: Object.fromEntries(Object.entries({ ...slots, ...keptSlots }).slice(0, 200)),
  };
}

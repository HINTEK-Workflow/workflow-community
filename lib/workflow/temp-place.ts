import { z } from "zod";

/**
 * Tillfällig plats (2026-10-08): one extra place on a job – a temporary address, a site hut, a car park – with
 * just an address and an optional pin. It belongs to the task alone, is stored in the task's own data (`data.tempPlace`,
 * so no migration: Cloud, Local/.hwf, export and the demo carry it like any other task data) and never becomes a place
 * in the customer register. It has no id and no customer of its own, so nothing can link to it.
 */
const text = (max: number) => z.string().trim().max(max).default("");
const coordinate = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().default(null);
export const tempPlaceSchema = z.object({
  address: text(200),
  postalCode: text(20),
  city: text(120),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
}).superRefine((value, context) => {
  if ((value.latitude === null) !== (value.longitude === null)) context.addIssue({ code: "custom", path: ["latitude"], message: "Ange både latitud och longitud, eller ingen av dem." });
});
export type TempPlace = z.output<typeof tempPlaceSchema>;

export const emptyTempPlace = (): TempPlace => ({ address: "", postalCode: "", city: "", latitude: null, longitude: null });

/** Nothing written and no pin: the same as no temporary place. */
export function tempPlaceIsEmpty(place: Partial<TempPlace> | null | undefined) {
  return !place || (!place.address?.trim() && !place.postalCode?.trim() && !place.city?.trim() && (place.latitude ?? null) === null);
}

/** The task's temporary place from its data, or null (older tasks and anything malformed have none). */
export function tempPlaceOf(data: unknown): TempPlace | null {
  const raw = data && typeof data === "object" ? (data as { tempPlace?: unknown }).tempPlace : undefined;
  if (!raw) return null;
  const parsed = tempPlaceSchema.safeParse(raw);
  return parsed.success && !tempPlaceIsEmpty(parsed.data) ? parsed.data : null;
}

/** "Bodvägen 2, 123 45 Elstad", or the coordinates when only a pin is set – for the field, lists and reports. */
export function tempPlaceLabel(place: TempPlace | null | undefined) {
  if (!place) return "";
  const line = [place.address.trim(), [place.postalCode.trim(), place.city.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (line) return line;
  return place.latitude !== null && place.longitude !== null ? `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}` : "";
}

/** The pin, when there is one. */
export function tempPlacePosition(place: TempPlace | null | undefined) {
  return place && place.latitude !== null && place.longitude !== null ? { latitude: place.latitude, longitude: place.longitude } : null;
}

/** The task data with the temporary place set, or removed when it is empty. */
export function withTempPlace<T extends object>(data: T, place: TempPlace | null): T {
  const { tempPlace: _old, ...rest } = data as T & { tempPlace?: unknown };
  void _old;
  return (place && !tempPlaceIsEmpty(place) ? { ...rest, tempPlace: place } : rest) as T;
}

/**
 * The place a list shows for a task (2026-10-08): the register place, the temporary place marked "Tillfällig:"
 * when no register place is chosen, and both compactly when the task has both. One text, so rows keep their columns.
 */
export function listPlaceLabel(registerPlace: string | null | undefined, temp: TempPlace | null | undefined) {
  const register = registerPlace?.trim() ?? "";
  const label = tempPlaceLabel(temp);
  if (!label) return register;
  return register ? `${register} · Tillfällig: ${label}` : `Tillfällig: ${label}`;
}

/** A copy of a task (Spara som, a follow-up) keeps the source's temporary place; a source without one leaves none. */
export function copyTempPlace<T extends object>(target: T, sourceData: unknown): T {
  return withTempPlace(target, tempPlaceOf(sourceData));
}

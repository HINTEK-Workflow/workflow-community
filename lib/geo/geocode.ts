import type { PlacePosition } from "@/lib/workflow/place-position";

/**
 * Address → position. Not wired yet: the coordinator connects this to the Lantmäteriet address lookup that is being
 * built in parallel (2026-10-08, item 1 of the same specification). Until then every lookup answers null and
 * the UI says "Startadress kan inte slås upp ännu – välj plats eller ange sträckan". Nothing is sent anywhere.
 */
export async function geocodeAddress(text: string): Promise<PlacePosition | null> {
  void text;
  return null;
}

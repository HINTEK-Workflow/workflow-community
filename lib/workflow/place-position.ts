/**
 * A place's position (2026-10-04, Platser etapp 2): optional, in WGS 84 decimal degrees as phones and map
 * services give it. Pasted text may use a comma or a point as decimal mark and may carry N/S/E/Ö/W letters; nothing
 * is looked up anywhere.
 */
export type PlacePosition = { latitude: number; longitude: number };

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export function parseCoordinates(text: string): PlacePosition | null {
  const cleaned = text.trim().replace(/[°′″'"]/g, " ");
  if (!cleaned) return null;
  // Two numbers: "57.7089, 11.9746", "57,7089 11,9746", "N 57.7089 E 11.9746", "57.7089N 11.9746E".
  const numbers = [...cleaned.matchAll(/([NSEÖOWV])?\s*(-?\d{1,3}(?:[.,]\d+)?)\s*([NSEÖOWV])?/gi)]
    .map((match) => ({ value: Number(match[2].replace(",", ".")), letter: (match[1] || match[3] || "").toUpperCase() }))
    .filter((item) => Number.isFinite(item.value));
  if (numbers.length !== 2) return null;
  let [first, second] = numbers;
  // Letters decide which is which; without them the order is latitude, longitude (as Google and Apple show it).
  if (["E", "Ö", "O", "W", "V"].includes(first.letter) || ["N", "S"].includes(second.letter)) [first, second] = [second, first];
  const latitude = first.letter === "S" ? -Math.abs(first.value) : first.value;
  const longitude = ["W", "V"].includes(second.letter) ? -Math.abs(second.value) : second.value;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude: round(latitude), longitude: round(longitude) };
}

export const formatCoordinates = (position: PlacePosition) => `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}`;

/** Links that open the position in the person's own map service, in a new tab; the page itself loads nothing. */
export function mapLinks(position: PlacePosition, label = "") {
  const point = `${position.latitude},${position.longitude}`;
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point)}`,
    apple: `https://maps.apple.com/?ll=${encodeURIComponent(point)}&q=${encodeURIComponent(label || point)}`,
  };
}

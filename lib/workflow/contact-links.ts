/**
 * Ring och Navigera (2026-10-12, elektrikerns dag i fält): links a technician on the way to a job taps to call the
 * customer's contact or to open the place in the phone's map service. Only links – nothing is loaded and no map API is
 * used; the https map link opens the map app on iOS and Android and the browser on a computer. Only what exists gives a
 * link: no number, no call; no address and no position, no navigation (nothing is invented).
 */

/** `tel:` link for a phone number, or null when it holds no digits. A leading + is kept. */
export function callHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").trim().replace(/(?!^\+)[^\d]/g, "");
  return /\d/.test(digits) ? `tel:${digits}` : null;
}

export type CallTarget = { key: "phone" | "mobile"; number: string; href: string; label: string };

/** The numbers a person can call, mobile first (the one answered in the field), the same number once. `name` makes "Ring <namn>". */
export function callTargets(contact: { name?: string | null; phone?: string | null; mobile?: string | null }): CallTarget[] {
  const name = contact.name?.trim() ?? "";
  const targets: CallTarget[] = [];
  const mobile = contact.mobile?.trim() ?? "";
  const phone = contact.phone?.trim() ?? "";
  const mobileHref = callHref(mobile);
  const phoneHref = callHref(phone);
  const label = (kind: string) => (name ? `Ring ${name}` : `Ring ${kind}`) + (name && mobileHref && phoneHref && mobileHref !== phoneHref ? ` (${kind})` : "");
  if (mobileHref) targets.push({ key: "mobile", number: mobile, href: mobileHref, label: label("mobil") });
  if (phoneHref && phoneHref !== mobileHref) targets.push({ key: "phone", number: phone, href: phoneHref, label: label("telefon") });
  return targets;
}

export type Destination = { address?: string | null; postalCode?: string | null; city?: string | null; latitude?: number | null; longitude?: number | null };

/** One line for the map search: "Gata 1, 123 45 Stad". */
export function destinationText(place: Destination): string {
  const town = [place.postalCode?.trim(), place.city?.trim()].filter(Boolean).join(" ");
  return [place.address?.trim(), town].filter(Boolean).join(", ");
}

/** A map search for an address without a position (UT7, 2026-11-01): the phone's or browser's map service, no map API; null without an address. */
export function mapSearchHref(place: Destination | null | undefined): string | null {
  const text = place ? destinationText(place) : "";
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null;
}

/** Navigation link (route to the destination), by position when the place has one, else by address text; null with neither. */
export function navigateHref(place: Destination | null | undefined): string | null {
  if (!place) return null;
  const { latitude, longitude } = place;
  const target = typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude},${longitude}` : destinationText(place);
  return target ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}` : null;
}

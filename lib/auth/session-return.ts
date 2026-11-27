/** Where the new tab lands after signing in again: a page that only says it is done, so the work stays in the first tab. */
export const SESSION_BACK_PATH = "/login/klar";

/** The sign-in in a new tab. */
export const sessionBackHref = () => `/login?returnTo=${encodeURIComponent(SESSION_BACK_PATH)}`;

/** The sign-in in this tab, returning to the address the person is on. */
export const signInHere = (pathname: string, search: string) => `/login?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;

/**
 * Where a signed-out visit to the app comes back after signing in (2026-11-20: a screen's QR code scanned while signed out
 * landed on the start page, and the code was lost): the same page with its whole query – `view` first, as the page resolved
 * it, then the rest in order (the pair code `koppla`, a tab, an id). Only the app's own start address. Pure.
 */
export function appReturnAddress(view: string, params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams({ view });
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (key !== "view" && typeof first === "string") query.append(key, first);
  }
  return `/?${query.toString()}`;
}

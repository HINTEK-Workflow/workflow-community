/** Where the new tab lands after signing in again: a page that only says it is done, so the work stays in the first tab. */
export const SESSION_BACK_PATH = "/login/klar";

/** The sign-in in a new tab. */
export const sessionBackHref = () => `/login?returnTo=${encodeURIComponent(SESSION_BACK_PATH)}`;

/** The sign-in in this tab, returning to the address the person is on. */
export const signInHere = (pathname: string, search: string) => `/login?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;

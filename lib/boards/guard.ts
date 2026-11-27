/**
 * Skärmar och länkar når aldrig /api (Tavlor etapp 2, 2026-11-18; plan 4.7.3), the same three layers as the operator page
 * (lib/operator/guard.ts): (1) the screen's and the link's cookies have the paths /skarm and /visa, so a browser never sends them
 * to /api; (2) only the routes under /skarm/api and /visa/api read them, and they only read the finished figures of what was
 * published – nothing can be changed through them; (3) proxy.ts refuses a request to /api that carries one of them and no person's
 * session (only a hand-made request can look like that). Without other imports, so proxy.ts stays small.
 */
export const SCREEN_BASE_PATH = "/skarm";
export const LINK_BASE_PATH = "/visa";
export const SCREEN_COOKIE = "wf_screen";
export const SCREEN_PAIR_COOKIE = "wf_screen_pair";
export const LINK_COOKIE = "wf_board_link";
const VIEWER_COOKIES = [SCREEN_COOKIE, SCREEN_PAIR_COOKIE, LINK_COOKIE];
const NEXT_AUTH_SESSION = /(^|\.)next-auth(\.[a-z-]+)?\.session-token(\.\d+)?$/;

export function boardViewerRequestRefused(pathname: string, cookieNames: readonly string[]): boolean {
  if (!pathname.startsWith("/api/")) return false;
  const names = cookieNames.map((name) => name.replace(/^__(Secure|Host)-/, ""));
  if (!names.some((name) => VIEWER_COOKIES.includes(name))) return false;
  return !names.some((name) => NEXT_AUTH_SESSION.test(name));
}
export const BOARD_VIEWER_REFUSAL = "En skärm eller en delad länk kan bara visa sin tavla.";

/**
 * Rollen Operatör på serversidan (2026-10-30): an operator reaches the operator endpoints and nothing else. Without
 * other imports, so proxy.ts stays small.
 *
 * Three layers. (1) The operator's cookies have the path /operator, so a browser never sends them to /api/… at all; the
 * page and its endpoints (/operator/<key>, /operator/api/…) are the only places that see them. (2) The operator endpoints
 * read only the operator cookie (lib/operator/session.ts) and every other route reads only a person's session (NextAuth,
 * lib/auth/session.ts) – an operator account is never a User, so no existing helper can ever turn it into one. (3) This
 * early refusal in proxy.ts: a request to /api/… that carries an operator session and no person's session is refused
 * before any route runs (only a hand-made request can look like that).
 */
export const OPERATOR_BASE_PATH = "/operator";
export const OPERATOR_API_PREFIX = "/operator/api/";
export const OPERATOR_SESSION_COOKIE = "wf_operator";
export const OPERATOR_DEVICE_COOKIE = "wf_operator_device";
const NEXT_AUTH_SESSION = /(^|\.)next-auth(\.[a-z-]+)?\.session-token(\.\d+)?$/;

/** True when the request must be refused: an /api route, an operator session, and no person's session beside it. */
export function operatorRequestRefused(pathname: string, cookieNames: readonly string[]): boolean {
  if (!pathname.startsWith("/api/")) return false;
  const names = cookieNames.map((name) => name.replace(/^__(Secure|Host)-/, ""));
  if (!names.includes(OPERATOR_SESSION_COOKIE)) return false;
  return !names.some((name) => NEXT_AUTH_SESSION.test(name));
}
export const OPERATOR_ONLY_REFUSAL = "Operatörskonton når bara felanmälan.";

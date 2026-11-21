/**
 * Where a person may be sent after signing in or after a sub-page (säkerhetsgranskning 2026-11-20, M1): only a path on
 * Workflow's own address, never another site. `returnTo` comes from the address bar, so anything a browser could read as
 * another host is refused:
 * - control characters (tab, CR, LF and all of U+0000–U+001F, U+007F) – the browser removes them, so `/\t/evil` becomes `//evil`;
 * - a backslash – read as a slash, so `/\evil` becomes `//evil`;
 * - anything that does not start with exactly one "/" (`//evil`, `https://evil`, `javascript:`), also once decoded;
 * - anything that, read against a placeholder origin, changes the origin.
 * Pure: the login page, the login form and the way back from sub-pages (`safeReturnTo`, lib/workflow/navigation.ts) read the same rule.
 */
const BASE = "https://workflow.invalid";
const CONTROL = /[\u0000-\u001F\u007F]/;
const MAX_LENGTH = 2000;

function looksForeign(text: string): boolean {
  return CONTROL.test(text) || text.includes("\\") || !text.startsWith("/") || text.startsWith("//");
}

/** The path itself when it stays on Workflow's own address, otherwise null. */
export function safeLocalPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value || value.length > MAX_LENGTH) return null;
  if (looksForeign(value)) return null;
  // An encoded slash, backslash or control character in the path (`/%2F%2Fevil`, `/%09/evil`) is refused too, in case a
  // later step decodes it once more.
  const path = value.split(/[?#]/, 1)[0];
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (looksForeign(decoded)) return null;
  let url: URL;
  try { url = new URL(value, BASE); } catch { return null; }
  if (url.origin !== BASE || !url.pathname.startsWith("/") || url.pathname.startsWith("//")) return null;
  return value;
}

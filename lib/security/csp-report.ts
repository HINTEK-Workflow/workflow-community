// S2 (review 2026-10-20): what the report-only Content-Security-Policy (lib/security/csp.ts) would have blocked. The browser
// sends it to POST /api/csp-report, either as a classic report (application/csp-report, report-uri) or through the Reporting
// API (application/reports+json, report-to). Only three things are kept and logged: the directive, the blocked source and
// the page (the line says "CSP blocked" instead once CSP_ENFORCE=true) – addresses without query string or fragment and with
// long identifiers in the path replaced, so no token, quote link, e-mail address or other personal data reaches the log.
// The script sample, referrer, user agent and the visitor's address are never logged. Pure apart from the clock, so the
// unit tests read the same rules.

/** A report is a few hundred bytes; a batch from the Reporting API a few kilobytes. */
export const MAX_CSP_REPORT_BYTES = 16 * 1024;
/** Reports in one Reporting API batch that are looked at; the rest are dropped. */
export const MAX_REPORTS_PER_BATCH = 10;
/** Per visitor address (hashed): reports accepted in a window. */
export const CSP_REPORTS_PER_ADDRESS = 60;
/** All addresses together: log lines written in a window, so a flood can never fill the log. */
export const CSP_LOG_LINES_PER_WINDOW = 200;
/** The window for both counts, and how long the same report is written only once. */
export const CSP_WINDOW_MS = 10 * 60_000;

/** enforced: the browser blocked it (CSP_ENFORCE=true); without it the report-only policy only reported it. */
export type CspViolation = { directive: string; blocked: string; page: string; enforced?: true };

/** The CSP keywords a browser puts in blockedURL instead of an address. */
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink", "data", "blob", "self"]);

/** A path segment that may be an id, a token, a number or an e-mail address is replaced. */
function redactSegment(segment: string): string {
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { /* keep as sent */ }
  if (decoded.includes("@")) return ":x";
  if (/\d/.test(decoded) && decoded.length >= 6) return ":x";
  if (decoded.length > 24) return ":x";
  return /^[A-Za-z0-9._~-]*$/.test(decoded) ? decoded : ":x";
}

/** An address as it may be logged: scheme, host and a redacted path – never the query string, fragment or user info. */
export function safeAddress(value: unknown, pathOnly = false): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim().slice(0, 2048);
  const keyword = raw.replace(/^'|'$/g, "").toLowerCase();
  if (KEYWORDS.has(keyword)) return keyword;
  let url: URL;
  try { url = new URL(raw); } catch { return "other"; }
  if (url.protocol === "data:" || url.protocol === "blob:") return url.protocol.slice(0, -1);
  if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "ws:" && url.protocol !== "wss:") return `${url.protocol}`.slice(0, 20);
  const path = url.pathname.split("/").map(redactSegment).join("/").slice(0, 200);
  return pathOnly ? path || "/" : `${url.protocol}//${url.host}${path}`;
}

/** The directive names a report may carry; anything else is not a report. */
const DIRECTIVES = new Set([
  "default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr", "img-src",
  "font-src", "connect-src", "media-src", "worker-src", "manifest-src", "frame-src", "child-src", "object-src", "base-uri",
  "form-action", "frame-ancestors", "require-trusted-types-for", "trusted-types", "fenced-frame-src", "prefetch-src",
]);

const directiveOf = (value: unknown) => {
  const first = typeof value === "string" ? value.trim().split(/\s+/)[0]?.toLowerCase() ?? "" : "";
  return DIRECTIVES.has(first) ? first : "";
};

function violationFrom(body: Record<string, unknown>): CspViolation | null {
  const directive = directiveOf(body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"] ?? body.violatedDirective);
  if (!directive) return null;
  return {
    directive,
    blocked: safeAddress(body["blocked-uri"] ?? body.blockedURL) || "unknown",
    page: safeAddress(body["document-uri"] ?? body.documentURL, true) || "unknown",
    ...(body.disposition === "enforce" ? { enforced: true as const } : {}),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The violations in a body of either format; anything else gives an empty list (never an error). */
export function parseCspReports(text: string): CspViolation[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  // report-uri: { "csp-report": { … } }
  if (isObject(data) && isObject(data["csp-report"])) {
    const one = violationFrom(data["csp-report"]);
    return one ? [one] : [];
  }
  // report-to: [{ type: "csp-violation", body: { … } }, …]
  if (Array.isArray(data)) {
    return data.slice(0, MAX_REPORTS_PER_BATCH)
      .filter((entry): entry is Record<string, unknown> => isObject(entry) && entry.type === "csp-violation" && isObject(entry.body))
      .map((entry) => violationFrom(entry.body as Record<string, unknown>))
      .filter((entry): entry is CspViolation => entry !== null);
  }
  return [];
}

/** The content types a browser uses for CSP reports. */
export const isCspReportType = (type: string | null) => /^\s*application\/(csp-report|reports\+json|json)\b/i.test(type ?? "");

type Window = { count: number; start: number };
const MAX_KEYS = 5_000;

/**
 * The receiver's memory: a window per (hashed) address, one for the log as a whole, and the reports already written in this
 * window. Per process and bounded; it forgets on restart. The reports are only log lines, so no database row is written per
 * report (the shared limiter in lib/security/rate-limit.ts writes one per call).
 */
export function createCspReportSink(options: { now?: () => number; write?: (line: string) => void } = {}) {
  const now = options.now ?? Date.now;
  const write = options.write ?? ((line: string) => console.warn(line));
  const addresses = new Map<string, Window>();
  const seen = new Map<string, number>();
  let log: Window = { count: 0, start: now() };

  const prune = (map: Map<string, unknown>, expired: (value: never) => boolean) => {
    if (map.size < MAX_KEYS) return;
    for (const [key, value] of map) if (expired(value as never)) map.delete(key);
    for (const key of map.keys()) { if (map.size < MAX_KEYS) break; map.delete(key); }
  };

  return {
    /** Counts one request from an address; false when the address is over its limit (answer 429). */
    allow(addressKey: string): boolean {
      const at = now();
      let window = addresses.get(addressKey);
      if (!window || at - window.start >= CSP_WINDOW_MS) {
        prune(addresses, (old: Window) => at - old.start >= CSP_WINDOW_MS);
        window = { count: 0, start: at };
        addresses.set(addressKey, window);
      }
      window.count += 1;
      return window.count <= CSP_REPORTS_PER_ADDRESS;
    },
    /** Writes each new violation once per window, while the log's own limit allows; returns how many were written. */
    record(violations: CspViolation[]): number {
      const at = now();
      if (at - log.start >= CSP_WINDOW_MS) log = { count: 0, start: at };
      let written = 0;
      for (const violation of violations) {
        const key = `${violation.enforced ? "!" : ""}${violation.directive} ${violation.blocked} ${violation.page}`;
        const last = seen.get(key);
        if (last !== undefined && at - last < CSP_WINDOW_MS) continue;
        if (log.count >= CSP_LOG_LINES_PER_WINDOW) break;
        prune(seen, (time: number) => at - time >= CSP_WINDOW_MS);
        seen.set(key, at);
        log.count += 1;
        written += 1;
        const { enforced, ...line } = violation;
        write(`${enforced ? "CSP blocked" : "CSP report-only"}: ${JSON.stringify(line)}`);
      }
      return written;
    },
  };
}

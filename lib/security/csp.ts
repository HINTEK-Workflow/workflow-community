// S2 (review 2026-10-20, arbetslistan 15 and 22): a Content-Security-Policy with a nonce per request – in REPORT-ONLY mode
// unless CSP_ENFORCE=true (cspMode). The thin policy in next.config.ts (frame-ancestors, base-uri, object-src) stays; the
// full one reports what it would have blocked to /api/csp-report. How to switch it on for real: docs/drift/CSP.md.
//
// Pure and free of Node imports, so proxy.ts and the unit tests read the same rules.

/** Where the browser sends what the report-only policy would have blocked (also named in Reporting-Endpoints). */
export const CSP_REPORT_PATH = "/api/csp-report";
/** The Reporting API endpoint's name (report-to), declared in the Reporting-Endpoints answer header. */
export const CSP_REPORT_GROUP = "csp";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
export const CSP_ENFORCE_HEADER = "Content-Security-Policy";

/**
 * Report-only (the default) or enforced. The server's environment variable CSP_ENFORCE=true switches the same policy on
 * for real; anything else, or nothing, keeps report-only. Read per request, so a restart with the new value is enough.
 */
export type CspMode = "report-only" | "enforce";
export function cspMode(value: string | undefined): CspMode {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim()) ? "enforce" : "report-only";
}

/**
 * The answer header for a mode. On page paths the proxy's header replaces the thin policy from next.config.ts when the
 * names match (Next applies config headers first and the proxy's after), which is safe: the full policy has the thin
 * one's three directives too.
 */
export function cspHeaderName(mode: CspMode): string {
  return mode === "enforce" ? CSP_ENFORCE_HEADER : CSP_REPORT_ONLY_HEADER;
}

/** 16 random bytes in base64 (the CSP grammar: base64 or base64url), new for every request. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export type PolicyOptions = {
  nonce: string;
  /** next dev: React and the bundler evaluate code and the hot reload talks over a WebSocket. Never in production. */
  development?: boolean;
};

/**
 * The directives, in the order they are sent. Why each source is there:
 * - script-src: only scripts carrying this request's nonce (Next puts it on its own inline and chunk scripts when it finds it
 *   in the request's CSP header), and what those load ('strict-dynamic'). 'self' only matters to browsers without CSP 3.
 * - style-src 'unsafe-inline': React's style={} attributes, Recharts, Leaflet, driver.js and the mailing preview's own HTML
 *   draw with inline styles; a nonce cannot cover style attributes (and a nonce in style-src would switch 'unsafe-inline' off).
 * - img-src: only our own server (2026-11-02): product pictures come through /api/product-image and the map's tiles through
 *   /api/map/tiles, so no page loads a picture from anyone else; data: and blob: for QR codes, signatures and pictures chosen before upload.
 *   A sent mailing's web version (/m/…) has its own policy, since a mail's pictures may be anywhere.
 * - connect-src 'self': every fetch goes to the app's own API; outside services are called by the server only.
 * - frame-src 'self': the form builder's phone preview and the app column; the mailing preview is a sandboxed srcdoc frame.
 */
export function cspDirectives({ nonce, development = false }: PolicyOptions): [string, string[]][] {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(nonce)) throw new Error("Invalid CSP nonce");
  return [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(development ? ["ws:", "wss:"] : [])]],
    ["media-src", ["'self'", "blob:"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'self'"]],
    ["report-uri", [CSP_REPORT_PATH]],
    ["report-to", [CSP_REPORT_GROUP]],
  ];
}

export function buildCspPolicy(options: PolicyOptions): string {
  return cspDirectives(options).map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/** Reporting-Endpoints value for report-to (Chromium); other browsers use report-uri. */
export const reportingEndpoints = () => `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;

/**
 * Whether an answer gets the report-only policy. Not the API (JSON, files and PDFs opened inline are not pages), and not the
 * answers that set a stricter policy of their own: the sandboxed web version of a mailing (/m/…). Next's static files never
 * reach the proxy (its matcher).
 */
export function wantsPagePolicy(pathname: string): boolean {
  return !/^\/(api|m)(\/|$)/.test(pathname);
}

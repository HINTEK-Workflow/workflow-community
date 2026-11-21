// Host routing (2026-10-15): the separate public address for the landing page (PUBLIC_SITE_URL, see lib/public-site.ts).
// Without it, or on the app's own address, every request passes untouched. Next 16 calls this file "proxy" (formerly
// middleware); it runs in the Node.js runtime before the routes.
import { NextResponse, type NextRequest } from "next/server";
import { publicSite, routePublicSite, siteOfHost } from "@/lib/public-site";
import { robotsHeaderFor } from "@/lib/seo/indexing";
import { ADDRESS_HEADER } from "@/lib/workflow/first-frame";
import { buildCspPolicy, createNonce, cspHeaderName, cspMode, reportingEndpoints, wantsPagePolicy } from "@/lib/security/csp";
import { OPERATOR_ONLY_REFUSAL, operatorRequestRefused } from "@/lib/operator/guard";
import { BOARD_VIEWER_REFUSAL, boardViewerRequestRefused } from "@/lib/boards/guard";
import { REQUEST_METHOD_HEADER } from "@/lib/kfid/paused-company";

export function proxy(request: NextRequest) {
  // nginx passes the visitor's Host header on (proxy_set_header Host $host); X-Forwarded-Host is not trusted here.
  const site = publicSite();
  const decision = routePublicSite(
    { host: request.headers.get("host"), pathname: request.nextUrl.pathname, search: request.nextUrl.search },
    site,
  );
  if (decision.kind === "redirect") return NextResponse.redirect(decision.location, decision.status);
  if (decision.kind === "not-found") return new NextResponse(null, { status: 404 });
  // Rollen Operatör (2026-10-30, lib/operator/guard.ts): an operator session alone never reaches an /api route.
  if (operatorRequestRefused(request.nextUrl.pathname, request.cookies.getAll().map((cookie) => cookie.name)))
    return NextResponse.json({ error: OPERATOR_ONLY_REFUSAL }, { status: 403, headers: { "Cache-Control": "no-store" } });
  // Skärmar och länkar (Tavlor etapp 2, lib/boards/guard.ts): a screen's or a link's cookie alone never reaches an /api route.
  if (boardViewerRequestRefused(request.nextUrl.pathname, request.cookies.getAll().map((cookie) => cookie.name)))
    return NextResponse.json({ error: BOARD_VIEWER_REFUSAL }, { status: 403, headers: { "Cache-Control": "no-store" } });
  // Telefonens första bild (lib/workflow/first-frame.ts): the root layout does not know its route, so the address is
  // passed on to it – always set here, never what the browser sent. Display only: it picks the first frame's layout.
  const forwarded = new Headers(request.headers);
  forwarded.set(ADDRESS_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  // Pausat företag (lib/kfid/paused-company.ts): the request's method for context(), always set here, never what the browser sent.
  forwarded.set(REQUEST_METHOD_HEADER, request.method);
  // S2 (review 2026-10-20): a nonce per request and a Content-Security-Policy, report-only unless CSP_ENFORCE=true
  // (lib/security/csp.ts, docs/drift/CSP.md). Next reads the nonce from the request's CSP header and puts it on its own
  // scripts; what the browser sent is never trusted, so both header names are removed first.
  forwarded.delete("content-security-policy");
  forwarded.delete("content-security-policy-report-only");
  // Sökmotorer (2026-11-10, lib/seo/indexing.ts): every answer on the app's address – pages, files, PDFs and the API alike –
  // says noindex, also where there is no HTML to say it in. The public site's pages decide for themselves.
  const robots = robotsHeaderFor(siteOfHost(request.headers.get("host"), site));
  if (!wantsPagePolicy(request.nextUrl.pathname)) {
    const plain = NextResponse.next({ request: { headers: forwarded } });
    if (robots) plain.headers.set("X-Robots-Tag", robots);
    return plain;
  }
  const header = cspHeaderName(cspMode(process.env.CSP_ENFORCE));
  const policy = buildCspPolicy({ nonce: createNonce(), development: process.env.NODE_ENV === "development" });
  forwarded.set(header.toLowerCase(), policy);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set(header, policy);
  response.headers.set("Reporting-Endpoints", reportingEndpoints());
  if (robots) response.headers.set("X-Robots-Tag", robots);
  return response;
}

export const config = {
  // Next's own static files never need a decision (they pass on the public site too).
  matcher: ["/((?!_next/static|_next/image).*)"],
};

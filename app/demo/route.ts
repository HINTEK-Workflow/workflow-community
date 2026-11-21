import { NextResponse } from "next/server";
import { DEMO_COOKIE, DEMO_PAGE_HREF } from "@/lib/demo";
import { isAutomatedVisitor } from "@/lib/analytics/bots";
import { demoSourceKey, demoStartKey } from "@/lib/analytics/catalog";
import { recordDemoEvent } from "@/lib/analytics/record";
import { optedOut } from "@/lib/analytics/exclusion";
import { instanceAppUrl } from "@/lib/instance-server";
import { publicSite, startHref } from "@/lib/public-site";

export const dynamic = "force-dynamic";

const hostOf = (value: string) => { try { return new URL(value).host; } catch { return ""; } };

/**
 * Starts or ends the public demo (2026-09-26). The cookie only switches the page rendering to the in-browser
 * demo; it carries no identity or access and every /api request in the demo is answered in the browser. A start is
 * counted as one anonymous number per day by how the visitor came (`?via=button|login` or the operator website's own value, otherwise the direct
 * link; `simulator` from the landing page's simulator button, 2026-11-16) and by the group its Referer belongs to (Workflow's own pages, the public website, a search engine, another site or none,
 * 2026-11-11). The Referer is looked at for that one question and never kept.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const exit = url.searchParams.get("exit") === "1";
  // A browser the owner switched off under Beteendeanalys (wf-no-stats, 2026-11-16) is not counted.
  if (!exit && !isAutomatedVisitor(request.headers.get("user-agent")) && !optedOut(request.headers.get("cookie"))) {
    recordDemoEvent(demoStartKey(url.searchParams.get("via")));
    const site = publicSite();
    recordDemoEvent(demoSourceKey(request.headers.get("referer"), [request.headers.get("host"), url.host, hostOf(instanceAppUrl()), site?.siteHost, site?.appHost, ...(site?.aliasHosts ?? [])]));
  }
  // A relative Location keeps the visitor on the public host even behind the reverse proxy.
  // Avsluta demon leads to the start page: the public site when there is one (2026-11-06: "/" on the app sent the visitor to the login).
  const response = new NextResponse(null, { status: 303, headers: { Location: exit ? startHref() : DEMO_PAGE_HREF } });
  if (exit) response.cookies.delete(DEMO_COOKIE);
  else response.cookies.set(DEMO_COOKIE, "1", { path: "/", sameSite: "lax", httpOnly: true, secure: url.protocol === "https:" });
  return response;
}

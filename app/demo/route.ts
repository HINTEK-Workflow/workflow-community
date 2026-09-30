import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo";

export const dynamic = "force-dynamic";

/**
 * Starts or ends the public demo (Daniel 2026-09-26). The cookie only switches the page rendering to the in-browser
 * demo; it carries no identity or access and every /api request in the demo is answered in the browser.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const exit = url.searchParams.get("exit") === "1";
  // A relative Location keeps the visitor on the public host even behind the reverse proxy.
  const response = new NextResponse(null, { status: 303, headers: { Location: exit ? "/" : "/?view=stats" } });
  if (exit) response.cookies.delete(DEMO_COOKIE);
  else response.cookies.set(DEMO_COOKIE, "1", { path: "/", sameSite: "lax", httpOnly: true, secure: url.protocol === "https:" });
  return response;
}

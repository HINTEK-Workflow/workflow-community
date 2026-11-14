// The core's single door to ee/ on the server (Fas 2, 2026-09-30).
import { NextResponse } from "next/server";
import { serverExtensions } from "@ee/server";
import type { EeRouteKey, RouteContext, RouteHandlers } from "@/lib/extensions/types";

export { serverExtensions };

const notFound = () => NextResponse.json({ error: "Finns inte i den här installationen." }, { status: 404 });

/**
 * The handlers for a route that lives in ee/. Every method is a function, so the route file in app/ can export exactly
 * the methods it always had; without ee/ (or without that method) they answer 404.
 */
export function eeRoute(key: EeRouteKey): Required<RouteHandlers> {
  const pick = (method: keyof RouteHandlers) => async (request: Request, context: RouteContext) => {
    const load = serverExtensions.routes[key];
    const handler = load ? (await load())[method] : undefined;
    return handler ? handler(request, context) : notFound();
  };
  return { GET: pick("GET"), POST: pick("POST"), PUT: pick("PUT"), PATCH: pick("PATCH"), DELETE: pick("DELETE"), OPTIONS: pick("OPTIONS") };
}

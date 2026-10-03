import { env } from "@/lib/env";

/** A tool call that the route refused, with the route's own status and Swedish message. */
export class ToolError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Handler = (request: Request) => Promise<Response>;

/**
 * Runs one of Workflow's ordinary API route handlers in the same process (2026-09-30: MCP and the API never go to
 * the database on their own – they use the same routes, services and checks as the app). The caller has already set
 * the key's principal, so `context()` in the handler loads the member the key acts for. The request carries the app's
 * own origin so the handler's CSRF check (meant for browsers) passes; the key itself was verified before this.
 */
export async function callRoute(handler: Handler, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
  const origin = new URL(env.APP_URL).origin;
  const request = new Request(new URL(path, origin), {
    method,
    headers: { origin, "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request);
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new ToolError(response.status, (data as { error?: string } | null)?.error ?? "Åtgärden kunde inte slutföras.");
  return data as Record<string, unknown>;
}

/** Keeps the listed fields of an object (the tools answer with what a client needs, not every internal column). */
export function pick<T extends Record<string, unknown>>(value: T | null | undefined, keys: string[]) {
  if (!value) return null;
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}

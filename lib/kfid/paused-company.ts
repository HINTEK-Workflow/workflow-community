/**
 * Pausat företag (beslut 11, 2026-11-01): a paused company gets read mode. Its people sign in, read and export their
 * own data, but nothing changes. The rule sits in context(), so a route cannot forget it: every request that is not a read
 * stops there unless the route has said that it is a read by POST, or the way to pay and to accept the terms.
 *
 * The request's method comes from proxy.ts, which always sets the header itself and never trusts what the browser sent; a
 * request without it counts as a write. An API or MCP key still does not work for a paused company (lib/integrations/
 * authenticate.ts), and an erased company stays closed.
 */
export const REQUEST_METHOD_HEADER = "x-workflow-request-method";
export const PAUSED_COMPANY_TEXT = "Företaget är pausat. Du kan läsa och exportera, men inget kan ändras. Kontakta installationens administratör för att återaktivera företaget.";
export const NO_ACTIVE_COMPANY_TEXT = "Du saknar ett aktivt företag.";
const READ_METHODS = new Set(["GET", "HEAD"]);

export const isErasedCompany = (organization: { slug: string }) => organization.slug.startsWith("raderat-");

export function pausedCompanyRefusal(input: { method: string | null; integration: boolean; erased: boolean; allowedWhenPaused: boolean }): { status: 403 | 423; message: string } | null {
  if (input.integration || input.erased) return { status: 403, message: NO_ACTIVE_COMPANY_TEXT };
  if (input.allowedWhenPaused || (input.method && READ_METHODS.has(input.method))) return null;
  return { status: 423, message: PAUSED_COMPANY_TEXT };
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, context, failure } from "@/lib/kfid/server";
import { isSupportPart, SUPPORT_PART_LABEL } from "@/lib/security/access-rules";
import { activeSupportGrant, logSupportRead } from "@/lib/security/support-access";
import { readSupportPart } from "@/lib/security/support-reads";

export const dynamic = "force-dynamic";

/**
 * Supportläsning (K2.3, beslut 2026-11-28): the installation's superadmin reads a customer company's data ONLY here, and only
 * while that company's own admin has an open grant. This is the one path from support to a company's business data: context()
 * still demands a membership for everything else, so without a grant there is nothing. Read only – the route has no POST,
 * and every read is a line the company's admin sees under Säkerhet. Never through an API or MCP key, and never the
 * superadmin's own company (where the person is a member anyway).
 */
async function support() {
  const ctx = await context({ skipLegal: true });
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  if (ctx.integration) throw new ApiError(403, "Supportläsning görs bara inloggad, aldrig med en nyckel.");
  return ctx;
}

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: Request) {
  try {
    const ctx = await support();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get("organizationId") ?? "";
    if (!organizationId || organizationId.length > 100) throw new ApiError(400, "Ogiltigt kundföretag.");
    if (organizationId === ctx.organizationId) throw new ApiError(404, "Kundföretaget hittades inte.");
    const company = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, storageMode: true } });
    if (!company) throw new ApiError(404, "Kundföretaget hittades inte.");
    const part = params.get("part");
    if (part === null) {
      // Only whether the company has given access and until when: metadata, no read is logged.
      const open = await activeSupportGrant(organizationId);
      return NextResponse.json({ open: open ? { expiresAt: open.expiresAt.toISOString(), hours: open.hours } : null, parts: Object.entries(SUPPORT_PART_LABEL).map(([key, label]) => ({ key, label })) }, noStore);
    }
    if (!isSupportPart(part)) throw new ApiError(400, "Den delen kan supporten inte läsa.");
    // The grant is looked up for THIS company before anything is read, and the read is logged against it before anything is
    // returned; a grant that ended in between returns nothing.
    const refused = new ApiError(403, "Företaget har inte gett supporten åtkomst, eller så har den gått ut eller återkallats.");
    if (!(await activeSupportGrant(organizationId))) throw refused;
    const rows = await readSupportPart(organizationId, part);
    const grant = await logSupportRead({ organizationId, userId: ctx.user.id, part, detail: `${rows.rows.length} av ${rows.total} rader`, headers: request.headers });
    if (!grant) throw refused;
    return NextResponse.json({ part, label: SUPPORT_PART_LABEL[part], ...rows, expiresAt: grant.expiresAt.toISOString() }, noStore);
  } catch (error) {
    return failure(error);
  }
}

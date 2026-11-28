import { NextResponse } from "next/server";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { describeIssue, type IssueLike } from "@/lib/tools/issue-text";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { recordSecurityEvent } from "@/lib/security/security-log";
import { companyKeyInputSchema } from "@/lib/ai/company-key";
import { CompanyKeyError, checkCompanyKey, companyKeyOn, companyKeyView, saveCompanyKey } from "@/lib/ai/company-key-server";
import { serverExtensions } from "@/lib/extensions/server";

export const dynamic = "force-dynamic";

/**
 * Använd företagets egen AI-nyckel (2026-11-27) under Inställningar → Arbetssätt → Workflow AI. Every request checks the
 * server session and the company membership (context()); only the company's admin reads the settings and changes them, a change
 * also checks Origin, and a pasted key needs a fresh sign-in, like every other key. The key itself never comes back – only its last
 * characters.
 */
async function admin() {
  const ctx = await context();
  if (!ctx.admin) throw new ApiError(403, "Bara en företagsadministratör kan ändra företagets egen AI-nyckel.");
  return ctx;
}

export async function GET() {
  try {
    const ctx = await admin();
    return NextResponse.json({ companyKey: await companyKeyView(ctx.organizationId), canManage: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await admin();
    const parsed = companyKeyInputSchema.safeParse(await body(request));
    if (!parsed.success) throw new ApiError(400, describeIssue(parsed.error.issues[0] as IssueLike));
    const input = parsed.data;
    const actor = { userId: ctx.user.id, label: ctx.user.name || ctx.user.email };
    if (input.action === "check") {
      const result = await checkCompanyKey(ctx.organizationId, actor);
      return NextResponse.json({ ...result, companyKey: await companyKeyView(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
    }
    const pasted = Boolean(input.apiKey?.trim());
    // Färsk inloggning (2026-10-10): a new key value needs a password or code within ten minutes, as under Kopplingar.
    if (pasted || input.removeKey) await requireFreshAuth(ctx.user.id, ctx.auth);
    const wasOn = await companyKeyOn(ctx.organizationId);
    let view;
    try { view = await saveCompanyKey(ctx.organizationId, actor, input); }
    catch (error) { if (error instanceof CompanyKeyError) throw new ApiError(400, error.message); throw error; }
    // Priset med egen AI-nyckel (2026-11-27): with billing (ee/), the Cloud subscription follows the switch – the own-key
    // price when it goes on, the ordinary price when it goes off, from the next invoice. A pause never reaches here, so a broken
    // key keeps the price until the admin turns the switch off. A billing failure is logged there and never undoes the switch.
    const billing = view.on !== wasOn
      ? await serverExtensions.ownAiKeyChanged?.({ organizationId: ctx.organizationId, actorId: ctx.user.id, on: view.on }).catch(() => undefined)
      : undefined;
    if (pasted) await recordSecurityEvent({ type: "api_key_created", actorId: ctx.user.id, organizationId: ctx.organizationId, platform: false, detail: "Extern nyckel", headers: request.headers });
    return NextResponse.json({ companyKey: view, ...(billing?.note ? { billingNote: billing.note } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import {
  createOperatorAccount, newOperatorAddress, operatorAdminAction, operatorAdminView, removeOperatorAccount, saveOperatorMicrosoft, saveOperatorSettings,
  setOperatorPassword, updateOperatorAccount,
} from "@/lib/operator/accounts-server";
import { decidePendingReport } from "@/lib/operator/reports-server";
import { checkGroup } from "@/lib/operator/microsoft-group-server";
import { ensureOperatorSettings } from "@/lib/operator/settings-server";

export const dynamic = "force-dynamic";

/**
 * Administration › Operatörskonton (2026-10-30): the company's admin, in Cloud. Reads and changes only the active
 * company's accounts, settings and approval list (lib/operator/accounts-server.ts); Origin on every change.
 */
async function admin() {
  const ctx = await context();
  requireAdmin(ctx);
  requireCloudStorage(ctx);
  return ctx;
}

export async function GET() {
  try {
    const ctx = await admin();
    return NextResponse.json(await operatorAdminView(ctx), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await admin();
    const raw = await body(request);
    // Kontrollera (Microsoft Graph): whether the app may read the chosen group in the connected directory.
    if ((raw as { action?: unknown })?.action === "check_microsoft") {
      const row = await ensureOperatorSettings(ctx.organizationId);
      if (!row.microsoftTenantId || !row.microsoftGroupId) throw new ApiError(409, "Koppla katalogen och välj grupp först.");
      const result = await checkGroup({ tenant: row.microsoftTenantId, groupId: row.microsoftGroupId });
      await prisma.operatorSettings.update({ where: { organizationId: ctx.organizationId }, data: { microsoftCheck: { ok: result.ok, message: result.message, at: result.at }, ...(result.name ? { microsoftGroupName: result.name } : {}) } });
      return NextResponse.json({ ok: result.ok, message: result.message });
    }
    const input = operatorAdminAction.parse(raw);
    let result: unknown = { ok: true };
    switch (input.action) {
      case "create": result = await createOperatorAccount(ctx, input); break;
      case "update": await updateOperatorAccount(ctx, input); break;
      case "password": await setOperatorPassword(ctx, input); break;
      case "remove": await removeOperatorAccount(ctx, input); break;
      case "settings": await saveOperatorSettings(ctx, input); break;
      case "microsoft": await saveOperatorMicrosoft(ctx, input); break;
      case "new_address": await newOperatorAddress(ctx); break;
      case "approve": result = await decidePendingReport(ctx, input.reportId, true); break;
      case "reject": result = await decidePendingReport(ctx, input.reportId, false); break;
    }
    return NextResponse.json(result ?? { ok: true });
  } catch (error) {
    return failure(error);
  }
}

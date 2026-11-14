import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, body, checkOrigin, failure } from "@/lib/kfid/server";
import { requireOperator } from "@/lib/operator/session";
import { listOperatorMachines } from "@/lib/operator/reports-server";
import { maintenancePort } from "@/lib/operator/maintenance-port";
import { productOperatorSettings } from "@/lib/operator/settings-server";
import { aiTroubleshootingOn, AI_SUGGESTION_NOTE } from "@/lib/operator/rules";
import { troubleshootSuggestions } from "@/lib/operator/troubleshoot";

export const dynamic = "force-dynamic";

/**
 * AI-felsökning före felanmälan (prepared, off): 404 unless both the product owner's and the company's switch are on, so
 * nothing is read or asked while it is off. Rules only for now (lib/operator/troubleshoot.ts); no model is called.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const operator = await requireOperator();
    if (!aiTroubleshootingOn({ product: (await productOperatorSettings()).aiTroubleshooting, company: operator.settings.aiTroubleshooting })) throw new ApiError(404, "Finns inte.");
    const input = z.object({ machineId: z.string().min(1).max(120), cause: z.string().max(60) }).strict().parse(await body(request));
    const machine = (await listOperatorMachines(operator)).find((node) => node.id === input.machineId);
    if (!machine || !machine.reportable) throw new ApiError(404, "Maskinen finns inte bland dina maskiner.");
    const history = await maintenancePort().history(operator.organizationId, machine.id, new Date());
    return NextResponse.json({ suggestions: troubleshootSuggestions({ cause: input.cause, history }), note: AI_SUGGESTION_NOTE }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

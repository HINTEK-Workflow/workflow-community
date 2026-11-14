import { NextResponse } from "next/server";
import { z } from "zod";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { SelfInspectionError } from "@/lib/self-inspection/model";
import { cloudWorkContext } from "@/lib/self-inspection/server";

export const dynamic = "force-dynamic";

/**
 * Egenkontroll in the daily work (etapp 2–3, 2026-10-06): what a project or a task needs from the programme –
 * candidates for performing and inspecting, the kind of work, the customer's requirements, deviations taken from the
 * protocol and the instruments. Since 2026-10-07 also the task's risk class and everyone's level, so the page can explain
 * before it is tried what a person's level lets them do (the routes decide). Read with the right to read that project or
 * task, or – for a new task – the right to create it from `formId` (a protocol) or `kind` (a work order or risk
 * assessment); changes go through POST /api/self-inspection (set_assignment, save_deviation).
 */
const query = z.object({
  projectId: z.string().min(1).max(120).optional(), taskId: z.string().min(1).max(120).optional(),
  formId: z.string().min(1).max(120).optional(), kind: z.enum(["WORK_ORDER", "RISK_ASSESSMENT"]).optional(), planning: z.boolean().default(false),
}).refine((value) => value.projectId || value.taskId || value.formId || value.kind, "Ange ett projekt, en uppgift eller ett formulär.");

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const params = new URL(request.url).searchParams;
    // `planning=1`: a protocol also asks for the scope its project's planning protocol selects (the control's moments).
    const input = query.parse({ projectId: params.get("projectId") || undefined, taskId: params.get("taskId") || undefined, formId: params.get("formId") || undefined, kind: params.get("kind") || undefined,
      planning: params.get("planning") === "1" });
    const work = await cloudWorkContext(ctx, input);
    // Företagets moduler (0.39.0): the same as the routes' gate, so a page does not stop what the server would let through.
    return NextResponse.json(organizationModuleOn(ctx.organization, "self_inspection") ? work : { ...work, levels: { ...work.levels, enforced: false } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SelfInspectionError) return NextResponse.json({ error: error.message }, { status: error.status });
    return failure(error);
  }
}

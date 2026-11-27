import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { hasWorkflowPermission, workflowSubjectForTask } from "@/lib/workflow/permissions";
import { readRiskExceptionAllowed, riskStepOf } from "@/lib/workflow/risk-step-server";
import { roundSafetyRequired } from "@/lib/workflow/round-safety";
import { loadRoundSafetyRisk } from "@/lib/workflow/round-safety-server";

export const dynamic = "force-dynamic";

/**
 * Riskbedömning som steg (2026-10-08): the task's risk step as the server sees it – the risk class, the linked
 * extended risk assessment and the work order the task belongs to – so the page explains the step exactly as the route
 * will decide it. Read within the company and the reader's permission to read the task; a linked task the reader may not
 * read is shown without its title. A round occurrence also gets its work order's risk assessment for the short check
 * (Säkerhetsavstämning, 2026-10-27, punkt 4): when it was last confirmed or completed. Every answer also says whether the company
 * allows Arbetet är redan utfört; a new work order, which has no id to ask about, asks for that alone with ?setting=1.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const params = new URL(request.url).searchParams;
    const canRead = (kind: string, formArea: string | null | undefined) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(kind, formArea), "read");
    const exceptionAllowed = await readRiskExceptionAllowed(ctx.organizationId);
    if (params.get("setting") === "1") return NextResponse.json({ exceptionAllowed });
    // A new, unsaved task opened in a work order (Starta ronden, Ny uppgift, Koppla till arbetsorder) has no row yet: it
    // follows its work order's risk step, so the page asks with the order's id and gets the context a saved task in that
    // order gets (2026-10-29; "riskbedömning görs i arbetsordern och gäller dess uppgifter och ronder", 2026-10-27).
    if (!params.get("taskId") && params.get("workOrderId")) {
      const workOrderId = z.string().min(1).max(100).parse(params.get("workOrderId"));
      const order = await prisma.workflowTask.findFirst({ where: { id: workOrderId, organizationId: ctx.organizationId, kind: "WORK_ORDER" }, select: { id: true } });
      if (!order) throw new ApiError(404, "Arbetsordern hittades inte.");
      const { context: riskContext } = await riskStepOf(ctx.organizationId, { kind: "FORM", status: "PLANNED", data: {}, workOrderId });
      const roundRisk = await loadRoundSafetyRisk(ctx.organizationId, workOrderId);
      const readable = canRead("WORK_ORDER", null);
      const workOrder = riskContext.workOrder && !readable ? { ...riskContext.workOrder, title: "" } : riskContext.workOrder;
      return NextResponse.json({ exceptionAllowed, context: { extended: null, workOrder }, roundRisk: roundRisk && !readable ? { ...roundRisk, title: "" } : roundRisk });
    }
    const taskId = z.string().min(1).max(100).parse(params.get("taskId"));
    const task = await prisma.workflowTask.findFirst({ where: { id: taskId, organizationId: ctx.organizationId } });
    if (!task || !canRead(task.kind, task.formArea)) throw new ApiError(404, "Uppgiften hittades inte.");
    const { state, context: riskContext } = await riskStepOf(ctx.organizationId, task);
    const visible = async <T extends { id: string; title: string }>(linked: T | null) => {
      if (!linked) return null;
      const row = await prisma.workflowTask.findFirst({ where: { id: linked.id, organizationId: ctx.organizationId }, select: { kind: true, formArea: true } });
      return row && canRead(row.kind, row.formArea) ? linked : { ...linked, title: "" };
    };
    const roundRisk = roundSafetyRequired(task) ? await loadRoundSafetyRisk(ctx.organizationId, task.workOrderId) : null;
    const workOrder = await visible(riskContext.workOrder);
    return NextResponse.json({ exceptionAllowed, state, context: { ...riskContext, extended: await visible(riskContext.extended), workOrder }, roundRisk: roundRisk && workOrder && !workOrder.title ? { ...roundRisk, title: "" } : roundRisk });
  } catch (error) {
    return failure(error);
  }
}

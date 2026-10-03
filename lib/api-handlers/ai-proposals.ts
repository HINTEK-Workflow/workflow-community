import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import * as tasksRoute from "@/app/api/workflow-tasks/route";
import { runStructuredAgent } from "@/lib/ai/agent-run";
import { AliasMap } from "@/lib/ai/alias";
import {
  applyWorkOrderEdits, parseProposalRequest, planningLastDay, planningMaterial, planningOutputSchema, planningPayload, riskMaterial, riskMeasuresOutputSchema,
  riskMeasuresPayload, summaryOutputSchema, taskDeviations, unplannedTasks, workOrderMaterial, workOrderOutputSchema, workOrderPayload,
  writerInstructions, type PlanningPayload, type ProposalKind, type WorkOrderPayload,
} from "@/lib/ai/proposals";
import { readCachedResult, resultCacheKey, storeCachedResult } from "@/lib/ai/result-cache";
import { routeAiModel } from "@/lib/ai/model-catalog";
import { sharesWork } from "@/lib/ai/sharing-policy";
import { callRoute, ToolError } from "@/lib/tools/call-route";
import { runTool } from "@/lib/tools/registry";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, type Context } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

/** A proposal can be used for a day; after that the material may have changed and a new one is made. */
const FRESH_MS = 24 * 60 * 60 * 1000;
type Row = Record<string, unknown>;

/** The route's own refusals as the API's errors, in their own words. */
async function tool<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof ToolError) throw new ApiError(error.status, error.message);
    throw error;
  }
}

async function save(ctx: Context, kind: ProposalKind, source: { type: string; id: string }, payload: unknown, runId: string | null) {
  return prisma.aiProposal.create({
    data: { organizationId: ctx.organizationId, createdById: ctx.user.id, moduleId: "workflow", kind, resourceType: source.type, resourceId: source.id, payload: payload as never, runId },
    select: { id: true, kind: true, status: true, payload: true },
  });
}

/** The person's own proposal, in their company. */
async function own(ctx: Context, proposalId: string) {
  const proposal = await prisma.aiProposal.findFirst({ where: { id: proposalId, organizationId: ctx.organizationId, createdById: ctx.user.id } });
  if (!proposal) throw new ApiError(404, "Förslaget finns inte.");
  return proposal;
}

/** PENDING → APPLIED or REJECTED (dismissed); APPLIED → UNDONE. Who decided and when is kept on the proposal. */
const decide = (ctx: Context, proposalId: string, status: "APPLIED" | "REJECTED" | "UNDONE", result?: unknown) =>
  prisma.aiProposal.update({
    where: { id: proposalId },
    data: { status, reviewedById: ctx.user.id, reviewedAt: new Date(), ...(status === "APPLIED" ? { appliedAt: new Date() } : {}), ...(result === undefined ? {} : { result: result as never }) },
    select: { id: true, kind: true, status: true, result: true },
  });

/**
 * Workflow AI's proposals (plan 2026-10-01, fas 2). `create` lets the writer agent word a proposal from material the
 * rules prepared, in the person's own session; nothing is created. `apply` carries a proposal out with the ordinary
 * tool – the same permission, validation and history as doing it by hand – once the person has clicked. `undo` takes
 * back what an applied proposal created, and `dismiss` records that it was not wanted. A proposal belongs to the
 * person who asked for it.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Förslag från Workflow AI kräver serverlagring.");
    const input = parseProposalRequest(await body(request));

    if (input.action === "create") {
      const alias = new AliasMap();
      const base = { organizationId: ctx.organizationId, actorId: ctx.user.id, agentId: "workflow-writer" as const, taskKind: "WRITING" as const, requestKey: `proposal:${randomUUID()}`, instructions: writerInstructions(input.kind) };

      if (input.kind === "SUMMARY") {
        // The same material gives the same text for a day, without a new call or credits (fas 0).
        const cacheKey = resultCacheKey({ organizationId: ctx.organizationId, agentId: "workflow-writer", model: routeAiModel("WRITING").model, material: `${input.label}\n${input.draft}` });
        const cached = readCachedResult(cacheKey);
        const source = { type: "SUMMARY", id: input.sourceId ?? "unsaved" };
        if (cached) return NextResponse.json({ proposal: await save(ctx, "SUMMARY", source, { text: cached.answer }, null), chargedCredits: 0, reused: true });
        const outcome = await runStructuredAgent({ ...base, surface: "summary", subject: { type: "WORKFLOW_TASK", id: source.id }, shared: (policy) => policy.shareChatContent,
          input: JSON.stringify({ label: input.label, draft: alias.text(input.draft) }), schema: summaryOutputSchema, schemaName: "hintek_summary" });
        if (!outcome.used) return NextResponse.json({ proposal: null, reason: outcome.reason });
        const text = alias.restore(outcome.output.text);
        storeCachedResult(cacheKey, text, outcome.model);
        return NextResponse.json({ proposal: await save(ctx, "SUMMARY", source, { text }, outcome.runId), chargedCredits: outcome.chargedCredits, reused: false });
      }

      if (input.kind === "WORK_ORDER") {
        // The whole task as the person may read it (the form's own document is needed to find its deviations).
        const task = ((await tool(() => callRoute(tasksRoute.GET, "GET", `/api/workflow-tasks?id=${encodeURIComponent(input.sourceTaskId)}`))).tasks as Row[] | undefined)?.[0];
        if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
        const deviations = taskDeviations(task);
        if (!deviations.length) return NextResponse.json({ proposal: null, reason: "Uppgiften har inga avvikelser att åtgärda. Skapa en vanlig arbetsorder om något ändå ska göras." });
        for (const [kind, value] of [["Projekt", (task.project as Row | null)?.name], ["Kund", (task.customer as Row | null)?.name], ["Person", task.assignedToName]] as const) if (typeof value === "string") alias.add(kind, value);
        const outcome = await runStructuredAgent({ ...base, surface: "proposal-work-order", subject: { type: "WORKFLOW_TASK", id: String(task.id) }, shared: sharesWork,
          input: JSON.stringify(alias.deep(workOrderMaterial(task, deviations))), schema: workOrderOutputSchema, schemaName: "hintek_work_order_proposal" });
        if (!outcome.used) return NextResponse.json({ proposal: null, reason: outcome.reason });
        const payload = workOrderPayload(task, { ...outcome.output, title: alias.restore(outcome.output.title), description: alias.restore(outcome.output.description) });
        return NextResponse.json({ proposal: await save(ctx, "WORK_ORDER", { type: "WORKFLOW_TASK", id: String(task.id) }, payload, outcome.runId), chargedCredits: outcome.chargedCredits });
      }

      if (input.kind === "RISK_MEASURES") {
        // A saved assessment must be one the person may read; an unsaved one has only what the person just typed.
        if (input.sourceTaskId) await tool(() => runTool("get_task", { taskId: input.sourceTaskId }));
        const outcome = await runStructuredAgent({ ...base, surface: "proposal-risk-measures", subject: { type: "WORKFLOW_TASK", id: input.sourceTaskId ?? "unsaved" }, shared: sharesWork,
          input: JSON.stringify(alias.deep(riskMaterial(input.title, input.risks))), schema: riskMeasuresOutputSchema, schemaName: "hintek_risk_measures" });
        if (!outcome.used) return NextResponse.json({ proposal: null, reason: outcome.reason });
        const measures = riskMeasuresPayload(input.risks, outcome.output).map((item) => ({ ...item, measure: alias.restore(item.measure) }));
        if (!measures.length) return NextResponse.json({ proposal: null, reason: "Workflow AI hade inga förslag för de här riskerna." });
        return NextResponse.json({ proposal: await save(ctx, "RISK_MEASURES", { type: "WORKFLOW_TASK", id: input.sourceTaskId ?? "unsaved" }, { measures }, outcome.runId), chargedCredits: outcome.chargedCredits });
      }

      // PROJECT_PLANNING
      const project = await tool(() => runTool("get_project", { projectId: input.projectId })) as Row;
      const planned = await tool(() => runTool("list_planned_activities", { projectId: input.projectId })) as { activities?: Row[] };
      const tasks = unplannedTasks(project, planned.activities ?? []);
      if (!tasks.length) return NextResponse.json({ proposal: null, reason: "Projektets öppna uppgifter är redan planerade." });
      alias.add("Projekt", String(project.name ?? ""));
      const lastDay = planningLastDay(project);
      const outcome = await runStructuredAgent({ ...base, surface: "proposal-planning", subject: { type: "PROJECT", id: String(project.id) }, shared: sharesWork,
        input: JSON.stringify(alias.deep(planningMaterial(project, tasks))), schema: planningOutputSchema, schemaName: "hintek_planning_proposal" });
      if (!outcome.used) return NextResponse.json({ proposal: null, reason: outcome.reason });
      const activities = planningPayload(String(project.id), tasks, outcome.output, lastDay);
      if (!activities.length) return NextResponse.json({ proposal: null, reason: "Workflow AI:s förslag höll sig inte inom projektets ram. Planera uppgifterna i Planering." });
      return NextResponse.json({ proposal: await save(ctx, "PROJECT_PLANNING", { type: "PROJECT", id: String(project.id) }, { activities, note: alias.restore(outcome.output.note) }, outcome.runId), chargedCredits: outcome.chargedCredits });
    }

    const proposal = await own(ctx, input.id);

    if (input.action === "dismiss") {
      if (proposal.status !== "PENDING") throw new ApiError(409, "Förslaget är redan hanterat.");
      return NextResponse.json({ proposal: await decide(ctx, proposal.id, "REJECTED") });
    }

    if (input.action === "apply") {
      if (proposal.status !== "PENDING") throw new ApiError(409, "Förslaget är redan hanterat.");
      if (Date.now() - proposal.createdAt.getTime() > FRESH_MS) throw new ApiError(409, "Förslaget är för gammalt. Be om ett nytt.");
      if (proposal.kind === "WORK_ORDER") {
        // The person's own changes to title, description and date; the links stay those of the source task.
        const payload = applyWorkOrderEdits(proposal.payload as WorkOrderPayload, input.edits ?? {});
        const created = await tool(() => runTool("create_work_order", payload)) as { id: string; version: number; url: string };
        return NextResponse.json({ proposal: await decide(ctx, proposal.id, "APPLIED", { taskId: created.id, version: created.version, url: created.url }) });
      }
      if (proposal.kind === "PROJECT_PLANNING") {
        const all = (proposal.payload as { activities: PlanningPayload }).activities;
        const chosen = input.selected ? all.filter((_, index) => input.selected!.includes(index)) : all;
        if (!chosen.length) throw new ApiError(400, "Välj minst en aktivitet.");
        const activityIds: string[] = [];
        try {
          for (const activity of chosen) activityIds.push(String((await runTool("create_planned_activity", activity) as { id: string }).id));
        } catch (error) {
          // Nothing half-done: what was created before the refusal is taken back.
          for (const activityId of activityIds) await runTool("delete_planned_activity", { activityId }).catch(() => {});
          throw error instanceof ToolError ? new ApiError(error.status, error.message) : error;
        }
        return NextResponse.json({ proposal: await decide(ctx, proposal.id, "APPLIED", { activityIds }) });
      }
      // A text or a measure is put in the open editor by the page itself and saved with the person's own Spara.
      return NextResponse.json({ proposal: await decide(ctx, proposal.id, "APPLIED") });
    }

    // undo
    if (proposal.status !== "APPLIED") throw new ApiError(409, "Det finns inget att ångra för det här förslaget.");
    const result = proposal.result as { taskId?: string; version?: number; activityIds?: string[] };
    if (proposal.kind === "WORK_ORDER" && result.taskId) {
      const task = await tool(() => runTool("get_task", { taskId: result.taskId })) as Row;
      // Only a work order nobody has touched since it was created is taken back; anything else is the person's to remove.
      // (Every save raises the version, so the same version means nobody has changed it.)
      if (task.version !== result.version || task.status === "COMPLETED" || Number(task.totalDurationSec ?? 0) > 0)
        throw new ApiError(409, "Arbetsordern har ändrats sedan den skapades och tas inte bort automatiskt. Ta bort den i Workflow om den inte ska finnas.");
      await tool(() => callRoute(tasksRoute.DELETE, "DELETE", `/api/workflow-tasks?id=${encodeURIComponent(result.taskId!)}`));
    }
    if (proposal.kind === "PROJECT_PLANNING") for (const activityId of result.activityIds ?? []) await tool(() => runTool("delete_planned_activity", { activityId })).catch((error) => { if (!(error instanceof ApiError && error.status === 404)) throw error; });
    return NextResponse.json({ proposal: await decide(ctx, proposal.id, "UNDONE") });
  } catch (error) {
    return failure(error);
  }
}

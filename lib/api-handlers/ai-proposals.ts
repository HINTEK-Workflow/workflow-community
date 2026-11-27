import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import * as tasksRoute from "@/app/api/workflow-tasks/route";
import * as quotesRoute from "@/app/api/quotes/route";
import * as timeRoute from "@/app/api/workflow-time/route";
import * as placesRoute from "@/app/api/places/route";
import { addHazardRows, applyNameplate, fillWorkOrderDetails, nameplateUntouched, riskTableKey, undoHazardRows, undoWorkOrderFill, type PlaceNameplate, type WorkOrderFill } from "@/lib/ai/chat-proposals";
import { PLACE_ATTRIBUTE_LIMIT, placeObjectOf } from "@/lib/workflow/maintenance";
import type { FormDocument, FormValues } from "@/lib/workflow/form-document";
import { runStructuredAgent } from "@/lib/ai/agent-run";
import { AliasMap } from "@/lib/ai/alias";
import {
  applyWorkOrderEdits, parseProposalRequest, planningLastDay, planningMaterial, planningOutputSchema, planningPayload, riskMaterial, riskMeasuresOutputSchema,
  riskMeasuresPayload, summaryOutputSchema, taskDeviations, unplannedTasks, workOrderMaterial, workOrderOutputSchema, workOrderPayload,
  writerInstructions, type PlanningPayload, type ProposalKind, type WorkOrderPayload,
} from "@/lib/ai/proposals";
import { readCachedResult, resultCacheKey, storeCachedResult } from "@/lib/ai/result-cache";
import { routeAiModel } from "@/lib/ai/model-catalog";
import { aiMay, getAiSharingPolicy, sharesWork } from "@/lib/ai/sharing-policy";
import { callRoute, ToolError } from "@/lib/tools/call-route";
import { readWholeTask, runTool, savedTaskShape } from "@/lib/tools/registry";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireModule, type Context } from "@/lib/kfid/server";
import { assertSystemAgentOn, withExtraInstruction } from "@/lib/agents/system-agents-server";

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

const CLOSED = new Set(["COMPLETED", "CANCELLED"]);
type TaskData = { kind: string; details: Row };
/** A task saved again through the tasks route with new details (the version, permission and rules are the route's). */
const saveDetails = (task: Row, details: Row) => tool(() => callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "save", task: { ...savedTaskShape(task), data: { ...(task.data as TaskData), details } } }));
const taskUrl = (task: Row) => `/?view=workflow_task&taskId=${encodeURIComponent(String(task.id))}&taskType=${encodeURIComponent(String(task.kind))}`;
/** Only what nobody has touched since it was applied is taken back (every save raises the version). */
async function untouched(taskId: string, version: unknown) {
  const task = await tool(() => readWholeTask(taskId));
  if (task.version !== version || CLOSED.has(String(task.status))) throw new ApiError(409, "Uppgiften har ändrats sedan förslaget användes och ångras inte automatiskt. Ändra den i Workflow.");
  return task;
}

/** A place as the person may read it (the places route in the person's own session). */
async function readPlace(placeId: string) {
  const place = (await tool(() => callRoute(placesRoute.GET, "GET", `/api/places?id=${encodeURIComponent(placeId)}`))).place as Row | undefined;
  if (!place?.id) throw new ApiError(404, "Platsen hittades inte.");
  return place;
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
      // De inbyggda agenterna (2026-11-21): an agent the company's admin switched off makes no proposal.
      // The company's extra instruction for the agent (2026-11-23) goes after its own instructions, as data.
      const extra = await assertSystemAgentOn(ctx.organizationId, ({ SUMMARY: "summary", WORK_ORDER: "work-order-proposal", RISK_MEASURES: "risk", PROJECT_PLANNING: "planning" } as Record<string, string>)[input.kind] ?? "");
      const alias = new AliasMap();
      const base = { organizationId: ctx.organizationId, actorId: ctx.user.id, agentId: "workflow-writer" as const, taskKind: "WRITING" as const, requestKey: `proposal:${randomUUID()}`, instructions: withExtraInstruction(writerInstructions(input.kind), extra) };

      if (input.kind === "SUMMARY") {
        // The same material gives the same text for a day, without a new call or credits (fas 0).
        const cacheKey = resultCacheKey({ organizationId: ctx.organizationId, agentId: "workflow-writer", model: routeAiModel("WRITING").model, material: `${extra}\n${input.label}\n${input.draft}` });
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

    if (input.action === "apply") return NextResponse.json(await applyProposal(ctx, proposal, { edits: input.edits, selected: input.selected }));

    // undo
    return NextResponse.json(await undoProposal(ctx, proposal));
  } catch (error) {
    return failure(error);
  }
}

type ProposalRow = Awaited<ReturnType<typeof own>>;

/**
 * Använd – and Auto (2026-11-21), which uses the same path at once for the kinds Ångra takes back: the proposal carried out
 * with the ordinary tool in the person's own session, with the same permission, validation and history as doing it by hand.
 * `auto` marks the result, so the card says what was saved instead of offering Använd.
 */
export async function applyProposal(ctx: Context, proposal: ProposalRow, input: { edits?: Parameters<typeof applyWorkOrderEdits>[1]; selected?: number[]; auto?: boolean }) {
  const mark = (result: Record<string, unknown>) => (input.auto ? { ...result, auto: true } : result);
  {
    {
      if (proposal.status !== "PENDING") throw new ApiError(409, "Förslaget är redan hanterat.");
      if (Date.now() - proposal.createdAt.getTime() > FRESH_MS) throw new ApiError(409, "Förslaget är för gammalt. Be om ett nytt.");
      if (proposal.kind === "ACTION") {
        // Any catalog tool but the deny-list, run as the person; what it changed is kept so Ångra can put it back where it can.
        const payload = proposal.payload as { tool: string; input: Row; title: string };
        const { agentToolAllowed } = await import("@/lib/agents/tool-policy");
        const allowed = agentToolAllowed(payload.tool);
        if (!allowed.ok) throw new ApiError(403, allowed.reason);
        const before = await snapshotBefore(payload.tool, payload.input);
        const result = await tool(() => runTool(payload.tool as never, payload.input)) as Row;
        await prisma.administrationEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.user.id, action: "ai_action", detail: `Workflow AI körde ${payload.title.toLowerCase()} (${payload.tool})${input.auto ? " i Auto" : " efter Använd"}.` } }).catch(() => undefined);
        const url = typeof result.url === "string" ? result.url : typeof payload.input.taskId === "string" ? `/?view=workflow_task&taskId=${encodeURIComponent(payload.input.taskId)}&taskType=WORK_ORDER` : typeof payload.input.projectId === "string" ? `/?view=project&projectId=${encodeURIComponent(payload.input.projectId)}` : "";
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ tool: payload.tool, created: result, before, url, message: `${payload.title} är gjort.` })) };
      }
      if (proposal.kind === "POST_DRAFT") {
        // Inlägg: the company's admin, the module on; saved as a draft and never published from here.
        if (!ctx.admin) throw new ApiError(403, "Bara en företagsadministratör kan göra det.");
        requireModule(ctx, "web_posts");
        const payload = proposal.payload as { heading: string; body: string; caption: string };
        const { createPost } = await import("@/lib/meta/server");
        const post = await createPost({ userId: ctx.user.id, organizationId: ctx.organizationId }, { heading: payload.heading, body: payload.body, caption: payload.caption, link: null });
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ postId: post.id, url: `/?view=company_posts&post=${encodeURIComponent(post.id)}`, message: `Utkastet ”${payload.heading}” är sparat under Inlägg.` })) };
      }
      if (proposal.kind === "AGENT_MISSION") {
        // An agent mission (2026-11-21): checked again now; one that would publish by itself is saved paused, to be switched on
        // under Agenter where its target is shown in full.
        const payload = proposal.payload as { draft: unknown; autoPublish?: boolean };
        const { createMission } = await import("@/lib/agents/server");
        const created = await createMission(ctx, payload.draft, { active: !payload.autoPublish, via: "chat" });
        const mission = created.mission;
        const next = mission.nextRunAt ? new Date(mission.nextRunAt) : null;
        const { runTimeText } = await import("@/lib/agents/model");
        const message = payload.autoPublish
          ? `Uppdraget ”${mission.name}” ligger pausat under Agenter. Det ska publicera automatiskt, så du slår på det där när du har sett var det publicerar.`
          : `Uppdraget ”${mission.name}” ligger under Agenter. Det körs ${mission.scheduleText.toLocaleLowerCase("sv")}${next ? `, första gången ${runTimeText(next)}` : ""}.`;
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ missionId: mission.id, url: `/?view=agents&mission=${encodeURIComponent(mission.id)}`, message })) };
      }
      if (proposal.kind === "WORK_ORDER") {
        // The person's own changes to title, description and date; the links stay those of the source task.
        const payload = applyWorkOrderEdits(proposal.payload as WorkOrderPayload, input.edits ?? {});
        const created = await tool(() => runTool("create_work_order", payload)) as { id: string; version: number; url: string };
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ taskId: created.id, version: created.version, url: created.url, message: `Arbetsordern ”${String(payload.title ?? "")}” är sparad som Planerad, utan ansvarig.` })) };
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
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ activityIds, message: `${activityIds.length} uppgifter är planerade.` })) };
      }
      // Förslag från chatten (2026-10-09, AI-beslut 1 och 4), carried out with the ordinary tools in the person's
      // session. The admin's switch is checked again here: a proposal made before it was switched off is not applied.
      if (proposal.conversationId && ["WORK_ORDER_FILL", "TIME_ENTRY", "QUOTE", "RISK_HAZARDS", "WORK_ORDER", "PROJECT_PLANNING", "PLACE_NAMEPLATE", "FORM_DRAFT"].includes(proposal.kind)) {
        const policy = await getAiSharingPolicy(ctx.organizationId);
        if (proposal.kind === "RISK_HAZARDS" ? !aiMay(policy, "riskTogether") : !aiMay(policy, "chatProposals")) throw new ApiError(403, "Företagets admin har stängt av den här sortens förslag från Workflow AI.");
      }
      if (proposal.kind === "FORM_DRAFT") {
        // Formulär med Workflow AI (2026-11-25): Skapa utkast – read again by the import's checks and saved as a draft by the forms
        // route itself; never published, and a change only to the draft it was made on.
        const { applyFormDraft } = await import("@/lib/ai/form-ai-server");
        return { proposal: await decide(ctx, proposal.id, "APPLIED", await applyFormDraft(ctx, proposal.payload as never)) };
      }
      if (proposal.kind === "WORK_ORDER_FILL") {
        const payload = proposal.payload as WorkOrderFill & { taskId: string };
        const task = await tool(() => readWholeTask(payload.taskId));
        if (task.kind !== "WORK_ORDER" || CLOSED.has(String(task.status))) throw new ApiError(409, "Arbetsordern är färdigställd eller har utgått och ändras inte.");
        const filled = fillWorkOrderDetails((task.data as TaskData).details, { executionNotes: payload.executionNotes, deviations: payload.deviations, materials: payload.materials ?? [] });
        const saved = await saveDetails(task, filled.details);
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ taskId: String(task.id), version: saved.version, undo: filled.undo, url: taskUrl(task) })) };
      }
      if (proposal.kind === "TIME_ENTRY") {
        const payload = proposal.payload as { taskId: string; startedAt: string; endedAt: string; note?: string };
        const created = await tool(() => runTool("report_time", { taskId: payload.taskId, startedAt: payload.startedAt, endedAt: payload.endedAt, ...(payload.note ? { note: payload.note } : {}) })) as { id: string; warning?: unknown };
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ entryId: created.id, warning: created.warning ?? null, url: "/?view=time" })) };
      }
      if (proposal.kind === "RISK_HAZARDS") {
        const payload = proposal.payload as { taskId: string; hazards: { hazard: string; measure: string }[] };
        const task = await tool(() => readWholeTask(payload.taskId));
        const details = (task.data as TaskData).details;
        const key = riskTableKey(details.document as FormDocument | undefined);
        if (!key || CLOSED.has(String(task.status))) throw new ApiError(409, "Riskbedömningen kan inte ta emot faror just nu.");
        const added = addHazardRows(details.values as FormValues, key, payload.hazards);
        const saved = await saveDetails(task, { ...details, values: added.values });
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ taskId: String(task.id), version: saved.version, undo: added.undo, url: taskUrl(task) })) };
      }
      if (proposal.kind === "PLACE_NAMEPLATE") {
        // Märkskylt (2026-11-21): the fields the plate gave, written to the place with the ordinary tool; the old values are kept for Ångra.
        const payload = proposal.payload as PlaceNameplate & { placeId: string };
        const { next, before } = applyNameplate(placeObjectOf(await readPlace(payload.placeId)), payload, PLACE_ATTRIBUTE_LIMIT);
        const saved = await tool(() => runTool("update_place", { placeId: payload.placeId, ...next })) as { url?: string };
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ placeId: payload.placeId, applied: next, undo: before, url: saved.url ?? `/?view=place&placeId=${encodeURIComponent(payload.placeId)}` })) };
      }
      if (proposal.kind === "QUOTE") {
        // A draft only; sending it to the customer is always the person's own step in Offerter.
        const created = await tool(() => callRoute(quotesRoute.POST, "POST", "/api/quotes", { action: "create", quote: (proposal.payload as { quote: unknown }).quote })) as { id: string };
        return { proposal: await decide(ctx, proposal.id, "APPLIED", mark({ quoteId: created.id, url: `/?view=quote&quoteId=${encodeURIComponent(created.id)}`, message: "Offertutkastet är sparat. Du skickar det själv från Offerter." })) };
      }
      // A text or a measure is put in the open editor by the page itself and saved with the person's own Spara.
      return { proposal: await decide(ctx, proposal.id, "APPLIED") };
    }
  }
}

/** Ångra: takes back what an applied proposal (or Auto) made, while nobody has changed it since. */
export async function undoProposal(ctx: Context, proposal: ProposalRow) {
  {
    if (proposal.status !== "APPLIED") throw new ApiError(409, "Det finns inget att ångra för det här förslaget.");
    if (proposal.kind === "ACTION") {
      const done = proposal.result as { tool: string; created: Row; before: Row | null };
      await undoAction(done.tool, done.created ?? {}, done.before, (proposal.payload as { input: Row }).input);
      return { proposal: await decide(ctx, proposal.id, "UNDONE") };
    }
    if (proposal.kind === "FORM_DRAFT") {
      const { undoFormDraft } = await import("@/lib/ai/form-ai-server");
      await undoFormDraft(ctx, (proposal.result ?? {}) as never);
      return { proposal: await decide(ctx, proposal.id, "UNDONE") };
    }
    const made = proposal.result as { postId?: string; missionId?: string };
    if (proposal.kind === "POST_DRAFT" && made.postId) {
      const { getPost, deletePost } = await import("@/lib/meta/server");
      const post = await getPost(ctx.organizationId, made.postId).catch(() => null);
      if (post && post.status !== "draft") throw new ApiError(409, "Inlägget är redan publicerat och tas inte bort härifrån.");
      if (post) await deletePost({ userId: ctx.user.id, organizationId: ctx.organizationId }, made.postId);
    }
    if (proposal.kind === "AGENT_MISSION" && made.missionId) {
      const { deleteMission } = await import("@/lib/agents/server");
      await deleteMission(ctx, made.missionId).catch((error) => { if (!(error instanceof ApiError && error.status === 404)) throw error; });
    }
    const result = proposal.result as { taskId?: string; version?: number; activityIds?: string[] };
    if (proposal.kind === "WORK_ORDER" && result.taskId) {
      const task = await tool(() => runTool("get_task", { taskId: result.taskId })) as Row;
      // Only a work order nobody has touched since it was created is taken back; anything else is the person's to remove.
      // (Every save raises the version, so the same version means nobody has changed it.)
      if (task.version !== result.version || task.status === "COMPLETED" || Number(task.totalDurationSec ?? 0) > 0)
        throw new ApiError(409, "Arbetsordern har ändrats sedan den skapades och tas inte bort automatiskt. Ta bort den i Workflow om den inte ska finnas.");
      await tool(() => callRoute(tasksRoute.DELETE, "DELETE", `/api/workflow-tasks?id=${encodeURIComponent(result.taskId!)}`));
    }
    if (proposal.kind === "WORK_ORDER_FILL" && result.taskId) {
      const task = await untouched(result.taskId, result.version);
      await saveDetails(task, undoWorkOrderFill((task.data as TaskData).details, (proposal.result as { undo: { executionNotes: string; deviations: string; rowIds: string[] } }).undo));
    }
    if (proposal.kind === "RISK_HAZARDS" && result.taskId) {
      const task = await untouched(result.taskId, result.version);
      const details = (task.data as TaskData).details;
      await saveDetails(task, { ...details, values: undoHazardRows(details.values as FormValues, (proposal.result as { undo: { key: string; filled: string[]; appended: string[] } }).undo) });
    }
    if (proposal.kind === "PLACE_NAMEPLATE") {
      const plate = proposal.result as { placeId: string; applied: ReturnType<typeof applyNameplate>["next"]; undo: ReturnType<typeof applyNameplate>["before"] };
      // Only what nobody has changed since: otherwise the person changes the place by hand.
      if (!nameplateUntouched(placeObjectOf(await readPlace(plate.placeId)), plate.applied)) throw new ApiError(409, "Platsen har ändrats sedan förslaget användes och ångras inte automatiskt. Ändra den i Workflow.");
      await tool(() => runTool("update_place", { placeId: plate.placeId, ...plate.undo }));
    }
    const chat = proposal.result as { entryId?: string; quoteId?: string };
    if (proposal.kind === "TIME_ENTRY" && chat.entryId) await tool(() => callRoute(timeRoute.POST, "POST", "/api/workflow-time", { action: "delete", id: chat.entryId, reason: "" }));
    // Only a draft can be taken back; a quote that has been sent stays as it was sent.
    if (proposal.kind === "QUOTE" && chat.quoteId) await tool(() => callRoute(quotesRoute.POST, "POST", "/api/quotes", { action: "delete", id: chat.quoteId }));
    if (proposal.kind === "PROJECT_PLANNING") for (const activityId of result.activityIds ?? []) await tool(() => runTool("delete_planned_activity", { activityId })).catch((error) => { if (!(error instanceof ApiError && error.status === 404)) throw error; });
    return { proposal: await decide(ctx, proposal.id, "UNDONE") };
  }
}

/** The fields an update will change, as they are now, so Ångra can put them back (null: nothing to keep). */
async function snapshotBefore(name: string, input: Row): Promise<Row | null> {
  const keys = Object.keys(input).filter((key) => !/Id$/.test(key) || key === "assignedToUserId" || key === "workOrderId" || key === "responsibleUserId");
  const pickOf = (row: Row) => Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key] ?? null]));
  if (name === "update_task" && typeof input.taskId === "string") return pickOf(await tool(() => readWholeTask(String(input.taskId))));
  if (name === "update_project" && typeof input.projectId === "string") return pickOf(await tool(() => runTool("get_project", { projectId: input.projectId })) as Row);
  if (name === "update_customer" && typeof input.customerId === "string") return pickOf(await tool(() => runTool("get_customer", { customerId: input.customerId })) as Row);
  return null;
}

/** Ångra for a catalog action: the opposite tool, or the fields as they were. Anything else is refused plainly. */
async function undoAction(name: string, created: Row, before: Row | null, input: Row) {
  const id = typeof created.id === "string" ? created.id : null;
  switch (name) {
    case "create_work_order": {
      if (!id) break;
      const task = await tool(() => runTool("get_task", { taskId: id })) as Row;
      if (task.version !== created.version || task.status === "COMPLETED" || Number(task.totalDurationSec ?? 0) > 0) throw new ApiError(409, "Arbetsordern har ändrats sedan den skapades och tas inte bort automatiskt.");
      await tool(() => callRoute(tasksRoute.DELETE, "DELETE", `/api/workflow-tasks?id=${encodeURIComponent(id)}`));
      return;
    }
    case "create_planned_activity": if (id) await tool(() => runTool("delete_planned_activity", { activityId: id })); return;
    case "report_time": if (id) await tool(() => callRoute(timeRoute.POST, "POST", "/api/workflow-time", { action: "delete", id, reason: "" })); return;
    case "cancel_task": await tool(() => runTool("restore_task", { taskId: input.taskId })); return;
    case "report_obstacle": await tool(() => runTool("resolve_obstacle", { taskId: input.taskId })); return;
    case "update_task": if (before) await tool(() => runTool("update_task", { taskId: input.taskId, ...Object.fromEntries(Object.entries(before).filter(([, value]) => value !== undefined)) })); return;
    case "update_project": if (before) await tool(() => runTool("update_project", { projectId: input.projectId, ...before })); return;
    case "update_customer": if (before) await tool(() => runTool("update_customer", { customerId: input.customerId, ...before })); return;
  }
  throw new ApiError(409, "Den här ändringen går inte att ångra automatiskt. Ändra tillbaka den i Workflow.");
}

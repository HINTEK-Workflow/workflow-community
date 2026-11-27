import "server-only";
import { prisma } from "@/lib/db";
import {
  chatProposalInput, chatProposalSummary, chatWorkOrderPayload, isChatProposalTool, quoteFromProjectMaterials, riskTableKey, timeProposalProblem,
  type ChatProposalTool,
} from "@/lib/ai/chat-proposals";
import { planningLastDay, planningPayload, unplannedTasks } from "@/lib/ai/proposals";
import { aiMay, type AiSharingPolicy } from "@/lib/ai/sharing-policy";
import { ApiError, requireModule, requireWorkflowPermission, type Context } from "@/lib/kfid/server";
import * as projectsRoute from "@/app/api/projects/route";
import * as placesRoute from "@/app/api/places/route";
import { callRoute, ToolError } from "@/lib/tools/call-route";
import { readWholeTask, runTool } from "@/lib/tools/registry";
import { isRiskAssessmentTask } from "@/lib/workflow/risk-step";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import type { FormDocument } from "@/lib/workflow/form-document";

type Row = Record<string, unknown>;

/** A refusal the model reads as data (and says in its own words); nothing is saved. */
const refusal = (error: string): Row => ({ error });
const CLOSED = new Set(["COMPLETED", "CANCELLED"]);

/** The server's own check: the route's refusal in its own words, anything else stays inside. */
async function checked<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof ToolError || error instanceof ApiError) throw Object.assign(new Error(error.message), { status: error.status });
    throw error;
  }
}

/**
 * The proposal tools' server side (2026-10-09, AI-beslut 1 och 4). Each call is checked again here, whatever
 * the model asked for: the company's switches, the input schema, the person's own permission for the change, that
 * every linked record was read by the server in the person's session (an id the model invented is refused) and the
 * rules of the kind (open work order, time within bounds, an extended risk assessment). Then only an `AiProposal` is
 * saved for the person who asked, in the conversation; nothing else is changed.
 */
export function createChatProposer(options: { ctx: Context; policy: AiSharingPolicy; conversationId: string; runId: string | null; openTaskId?: string | null; now?: Date }) {
  const { ctx, policy } = options;
  const created: { id: string; kind: string; status: string; payload: unknown }[] = [];

  async function save(kind: string, resource: { type: string; id: string }, payload: Row) {
    const proposal = await prisma.aiProposal.create({
      data: { organizationId: ctx.organizationId, createdById: ctx.user.id, conversationId: options.conversationId, runId: options.runId, moduleId: "workflow", kind, resourceType: resource.type, resourceId: resource.id, payload: payload as never },
      select: { id: true, kind: true, status: true, payload: true },
    });
    created.push(proposal);
    return { proposal: { id: proposal.id, kind, summary: chatProposalSummary(kind, payload) }, note: "Förslaget visas för personen med Använd och Avfärda. Inget är sparat förrän personen klickar Använd." };
  }

  async function handle(name: string, raw: Row, seen: ReadonlySet<string>): Promise<Row> {
    if (!isChatProposalTool(name)) return refusal("Verktyget är inte tillåtet här.");
    const tool = name as ChatProposalTool;
    if (tool === "propose_risk_hazards" ? !aiMay(policy, "riskTogether") : !aiMay(policy, "chatProposals")) return refusal("Företagets admin har inte tillåtit det här förslaget.");
    const parsed = chatProposalInput[tool].safeParse(raw);
    if (!parsed.success) return refusal(parsed.error.issues[0]?.message ?? "Förslagets indata stämmer inte.");
    // Links only to what the server itself read in this answer, or the task the person has open.
    const known = (value: string | null | undefined) => !value || value === options.openTaskId || seen.has(value);

    if (tool === "propose_work_order") {
      const input = chatProposalInput.propose_work_order.parse(raw);
      if (![input.sourceTaskId, input.projectId, input.customerId].every(known)) return refusal("Kopplingen måste vara en uppgift, ett projekt eller en kund som du har hämtat med ett verktyg.");
      requireWorkflowPermission(ctx, "work-order", "create");
      let links: { projectId?: string | null; customerId?: string | null; facilityId?: string | null; sourceTaskId?: string | null } = {};
      if (input.sourceTaskId) {
        const source = await checked(() => readWholeTask(input.sourceTaskId!));
        links = { projectId: source.projectId as string | null, customerId: source.customerId as string | null, facilityId: source.facilityId as string | null, sourceTaskId: String(source.id) };
      } else if (input.projectId) {
        const project = await checked(() => runTool("get_project", { projectId: input.projectId })) as Row;
        links = { projectId: String(project.id), customerId: (project.customerId as string | null) ?? null, facilityId: (project.facilityId as string | null) ?? null };
      } else if (input.customerId) {
        await checked(() => runTool("get_customer", { customerId: input.customerId }));
        links = { customerId: input.customerId };
      }
      const payload = chatWorkOrderPayload(input, links);
      return save("WORK_ORDER", { type: links.sourceTaskId ? "WORKFLOW_TASK" : links.projectId ? "PROJECT" : links.customerId ? "CUSTOMER" : "CHAT", id: links.sourceTaskId ?? links.projectId ?? links.customerId ?? options.conversationId }, payload);
    }

    if (tool === "propose_work_order_fill") {
      const input = chatProposalInput.propose_work_order_fill.parse(raw);
      if (!known(input.taskId)) return refusal("Arbetsordern måste vara den öppna eller en som du har hämtat med get_task.");
      const task = await checked(() => readWholeTask(input.taskId));
      if (task.kind !== "WORK_ORDER") return refusal("Bara en arbetsorder kan fyllas i så här.");
      if (CLOSED.has(String(task.status))) return refusal("Arbetsordern är färdigställd eller har utgått och ändras inte.");
      requireWorkflowPermission(ctx, "work-order", "edit");
      return save("WORK_ORDER_FILL", { type: "WORKFLOW_TASK", id: String(task.id) }, { taskId: String(task.id), title: String(task.title ?? ""), version: task.version, executionNotes: input.executionNotes, deviations: input.deviations, materials: input.materials });
    }

    if (tool === "propose_time_entry") {
      const input = chatProposalInput.propose_time_entry.parse(raw);
      if (!known(input.taskId)) return refusal("Uppgiften måste vara den öppna eller en som du har hämtat med ett verktyg.");
      const problem = timeProposalProblem(input.startedAt, input.endedAt, options.now);
      if (problem) return refusal(problem);
      const clicked = await checked(() => readWholeTask(input.taskId));
      // Arbetsordern styr (2026-10-26): the proposal is for the work order the time lands on, and says so.
      const ownerId = clicked.kind === "WORK_ORDER" ? String(clicked.id) : typeof clicked.workOrderId === "string" && clicked.workOrderId ? clicked.workOrderId : null;
      if (!ownerId) return refusal("Uppgiften saknar arbetsorder; tid rapporteras på en arbetsorder.");
      const task = ownerId === String(clicked.id) ? clicked : await checked(() => readWholeTask(ownerId));
      if (CLOSED.has(String(task.status))) return refusal("Arbetsordern är färdigställd eller har utgått; tid rättas i tidrapporten.");
      const startedAt = new Date(input.startedAt).toISOString();
      const endedAt = new Date(input.endedAt).toISOString();
      return save("TIME_ENTRY", { type: "WORKFLOW_TASK", id: String(task.id) }, { taskId: String(task.id), title: String(task.title ?? ""), startedAt, endedAt, ...(input.note ? { note: input.note } : {}) });
    }

    if (tool === "propose_planning") {
      const input = chatProposalInput.propose_planning.parse(raw);
      if (!known(input.projectId)) return refusal("Projektet måste vara ett som du har hämtat med get_project.");
      requireWorkflowPermission(ctx, "projects", "create");
      const project = await checked(() => runTool("get_project", { projectId: input.projectId })) as Row;
      const planned = await checked(() => runTool("list_planned_activities", { projectId: input.projectId })) as { activities?: Row[] };
      const tasks = unplannedTasks(project, planned.activities ?? []);
      if (!tasks.length) return refusal("Projektets öppna uppgifter är redan planerade.");
      const keyOf = new Map(tasks.map((task, index) => [task.id, `t${index + 1}`]));
      const lastDay = planningLastDay(project, options.now);
      const activities = planningPayload(String(project.id), tasks, {
        activities: input.activities.flatMap((item) => keyOf.has(item.taskId) ? [{ key: keyOf.get(item.taskId)!, day: item.day, startHour: item.startHour, hours: item.hours }] : []),
        note: input.note,
      }, lastDay, options.now);
      if (!activities.length) return refusal(`Inget av förslagen höll sig inom reglerna: oplanerade uppgifter i projektet, vardagar från i morgon till ${lastDay}, kl. 07–17.`);
      return save("PROJECT_PLANNING", { type: "PROJECT", id: String(project.id) }, { activities, note: input.note });
    }

    if (tool === "propose_quote") {
      const input = chatProposalInput.propose_quote.parse(raw);
      if (!known(input.projectId)) return refusal("Projektet måste vara ett som du har hämtat med get_project.");
      requireWorkflowPermission(ctx, "quotes", "edit");
      // The project's summed material, read with the route's own price right (prices only for those who may see them).
      const project = await checked(async () => ((await callRoute(projectsRoute.GET, "GET", `/api/projects?id=${encodeURIComponent(input.projectId)}`)).projects as Row[] | undefined)?.[0]);
      if (!project) return refusal("Projektet hittades inte.");
      const made = quoteFromProjectMaterials(project, input);
      if (!made.quote.lines.length) return refusal("Projektet har inget material med antal att göra en offert av. Fyll i material på arbetsordrarna först, eller skapa offerten i Offerter.");
      return save("QUOTE", { type: "PROJECT", id: String(project.id) }, made);
    }

    if (tool === "propose_place_nameplate") {
      // Märkskylt (2026-11-21): the place is the work order's own, read by the server – never an id the model gave.
      const input = chatProposalInput.propose_place_nameplate.parse(raw);
      if (!known(input.taskId)) return refusal("Arbetsordern måste vara den öppna eller en som du har hämtat med get_task.");
      const task = await checked(() => readWholeTask(input.taskId));
      const placeId = typeof task.facilityId === "string" ? task.facilityId : "";
      if (!placeId) return refusal("Arbetsordern har ingen plats. Välj plats på arbetsordern först, eller lägg uppgifterna i utfört arbete.");
      requireWorkflowPermission(ctx, "customers", "edit");
      const place = await checked(async () => (await callRoute(placesRoute.GET, "GET", `/api/places?id=${encodeURIComponent(placeId)}`)).place as Row | undefined);
      if (!place?.id) return refusal("Platsen hittades inte.");
      return save("PLACE_NAMEPLATE", { type: "PLACE", id: String(place.id) }, { placeId: String(place.id), placeName: String(place.name ?? ""), taskId: String(task.id),
        manufacturer: input.manufacturer, model: input.model, serialNumber: input.serialNumber, ratings: input.ratings });
    }

    if (tool === "propose_post_draft") {
      // Inlägg are the company's admin's, in a company with Webb och inlägg on (as /api/meta/posts); a draft only, never published here.
      if (!ctx.admin) return refusal("Inlägg görs av en administratör. Säg det till personen.");
      requireModule(ctx, "web_posts");
      const input = chatProposalInput.propose_post_draft.parse(raw);
      return save("POST_DRAFT", { type: "CHAT", id: options.conversationId }, { heading: input.heading.slice(0, 60), body: input.body, caption: input.caption });
    }

    if (tool === "propose_agent_mission") {
      // Tolka and Kontrollera (2026-11-21): the server reads the person's words and checks the mission; what is unclear is asked.
      const input = chatProposalInput.propose_agent_mission.parse(raw);
      const { interpretForOwner } = await import("@/lib/agents/server");
      const read = await interpretForOwner(ctx, input.text);
      if (read.questions.length) return { questions: read.questions.map((item) => item.question), note: "Inget är sparat. Ställ frågorna till personen ordagrant och föreslå uppdraget igen med svaren." };
      if (!read.check.ok) return refusal(`Uppdraget kan inte skapas ännu: ${read.check.problems.map((item) => item.message).join(" ")}`);
      const autoPublish = (read.draft.target.kind === "post" || read.draft.target.kind === "news") && read.draft.target.publish === "auto";
      return save("AGENT_MISSION", { type: "CHAT", id: options.conversationId }, { draft: read.draft, scheduleText: read.check.scheduleText, nextRunAt: read.check.nextRunAt, summary: read.check.summary, cautions: read.check.cautions, autoPublish });
    }

    if (tool === "propose_action") {
      // Every catalog tool the person may use, except the deny-list (lib/agents/tool-policy.ts); the route checks the rights on Använd.
      const input = chatProposalInput.propose_action.parse(raw);
      const { agentToolAllowed, toolTitle } = await import("@/lib/agents/tool-policy");
      const { TOOL_CATALOG } = await import("@/lib/tools/catalog");
      const allowed = agentToolAllowed(input.tool);
      if (!allowed.ok) return refusal(allowed.reason);
      const definition = TOOL_CATALOG[input.tool as keyof typeof TOOL_CATALOG];
      if (definition.effect === "read") return refusal("Läsverktyg används direkt, inte som förslag.");
      let args: unknown;
      try { args = JSON.parse(input.input || "{}"); } catch { return refusal("Indata gick inte att läsa som JSON."); }
      const parsedArgs = definition.input.safeParse(args);
      if (!parsedArgs.success) return refusal(parsedArgs.error.issues[0]?.message ?? "Indata stämmer inte för verktyget.");
      const ids = Object.entries(parsedArgs.data as Row).filter(([key, value]) => /Id$/.test(key) && typeof value === "string").map(([, value]) => String(value));
      if (!ids.every((value) => known(value))) return refusal("Använd bara id som du har hämtat med ett verktyg.");
      return save("ACTION", { type: "CHAT", id: options.conversationId }, { tool: input.tool, input: parsedArgs.data as Row, title: toolTitle(input.tool) });
    }

    // propose_risk_hazards
    const input = chatProposalInput.propose_risk_hazards.parse(raw);
    if (!known(input.taskId)) return refusal("Riskbedömningen måste vara den öppna eller en som du har hämtat med get_task.");
    const task = await checked(() => readWholeTask(input.taskId));
    const details = (task.data as { kind?: string; details?: Row } | undefined)?.details ?? {};
    const key = task.kind === "FORM" && isRiskAssessmentTask({ kind: String(task.kind), formArea: task.formArea as string | null | undefined, data: task.data }) ? riskTableKey(details.document as FormDocument | undefined) : null;
    // The simplified risk step lives on the job itself: its questions are always answered by the person.
    if (!key) return refusal("Faror föreslås bara i en utökad riskbedömning (riskbedömningsformuläret). Den förenklade riskbedömningens frågor svarar personen själv på.");
    if (CLOSED.has(String(task.status))) return refusal("Riskbedömningen är färdigställd och ändras inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(String(task.kind), task.formArea as string | null | undefined), "edit");
    return save("RISK_HAZARDS", { type: "WORKFLOW_TASK", id: String(task.id) }, { taskId: String(task.id), title: String(task.title ?? ""), hazards: input.hazards });
  }

  return {
    handle: async (name: string, raw: Row, seen: ReadonlySet<string>) => {
      try { return await handle(name, raw, seen); } catch (error) {
        // A missing permission or a record the person may not read is said plainly; nothing was saved.
        if (error instanceof ApiError) return refusal(error.message);
        throw error;
      }
    },
    created,
  };
}

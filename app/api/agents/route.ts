import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, body, checkOrigin, context, failure, requireCloudWriteAccess } from "@/lib/kfid/server";
import {
  checkDraft, createMission, decideChange, deleteMission, getMission, interpretForOwner, refineForOwner, listMissions, missionFacts, factsOptions, previewMission, resendFeedback, runMissionNow, runReportPdf,
  setMissionActive, takeOverMission, updateMission,
} from "@/lib/agents/server";
import { AGENT_TEMPLATES } from "@/lib/agents/templates";
import { listSystemAgents, saveCompanyAgent, savePersonAgent } from "@/lib/agents/system-agents-server";

export const dynamic = "force-dynamic";

/**
 * Agenter (2026-11-21): the company's missions. Every signed-in member may make missions for their own work (members see
 * their own, admins every mission); what concerns the whole company needs an admin owner, which the check says next to the field.
 * Reads are open; every change checks the origin, the company's write access and the mission's own rules. The run itself acts with
 * the owner's rights (lib/agents/server.ts). Never through an API or MCP key: an agent is made by a person in the app.
 */
const id = z.string().trim().min(1).max(100);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), mission: z.unknown(), missionId: id.optional() }),
  // Tolka; with `current` the words change that draft (a follow-up in the mission's conversation).
  z.object({ action: z.literal("interpret"), text: z.string().trim().min(2).max(1_000), current: z.unknown().optional(), missionId: id.optional() }),
  z.object({ action: z.literal("preview"), mission: z.unknown(), missionId: id.optional() }),
  z.object({ action: z.literal("create"), mission: z.unknown(), active: z.boolean().default(true) }),
  z.object({ action: z.literal("update"), missionId: id, mission: z.unknown(), version: z.number().int().optional() }),
  z.object({ action: z.literal("pause"), missionId: id }),
  z.object({ action: z.literal("resume"), missionId: id }),
  z.object({ action: z.literal("take_over"), missionId: id }),
  z.object({ action: z.literal("delete"), missionId: id }),
  z.object({ action: z.literal("run_now"), missionId: id, nonce: z.string().trim().max(60).optional() }),
  z.object({ action: z.literal("resend"), missionId: id, runId: id }),
  // Godkänn eller Avvisa a change Workflow AI asked for in a run (säkerhetsgranskningen 2026-11-24, G-07).
  z.object({ action: z.literal("decide"), missionId: id, runId: id, index: z.number().int().min(0).max(50), approve: z.boolean() }),
  // De inbyggda agenterna: the admin's choice for the company, each person's own level.
  z.object({ action: z.literal("system_company"), agentId: id, on: z.boolean().optional(), focus: z.string().max(400).optional(), when: z.string().max(40).optional(), reset: z.boolean().optional() }),
  z.object({ action: z.literal("system_person"), agentId: id, level: z.enum(["often", "normal", "rarely", "off"]) }),
]);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    if (ctx.integration) throw new ApiError(403, "Agenter görs av en person i appen.");
    const params = new URL(request.url).searchParams;
    // Visa rapporten (PDF): a run's report in the company's look.
    if (params.get("run") && params.get("pdf") === "1") {
      const pdf = await runReportPdf(ctx, params.get("run")!);
      return new Response(Buffer.from(pdf.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`, "Cache-Control": "no-store" } });
    }
    const missionId = params.get("mission");
    if (missionId) return NextResponse.json(await getMission(ctx, missionId));
    // The chat's waiting proposals and tips read only the built-in agents (cheap, on every page).
    if (new URL(request.url).searchParams.get("part") === "system") return NextResponse.json({ system: await listSystemAgents(ctx) });
    const facts = await missionFacts(ctx);
    return NextResponse.json({ missions: await listMissions(ctx), templates: AGENT_TEMPLATES, options: factsOptions(facts), system: await listSystemAgents(ctx), me: ctx.user.id });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.integration) throw new ApiError(403, "Agenter görs av en person i appen.");
    const command = input.parse(await body(request));
    // Checking, reading the words and Provkör change nothing; everything else needs the company's write access.
    if (!["check", "interpret", "preview", "system_person"].includes(command.action)) await requireCloudWriteAccess(ctx);
    switch (command.action) {
      case "check": return NextResponse.json(await checkDraft(ctx, command.mission, command.missionId));
      case "interpret": return NextResponse.json(command.current ? await refineForOwner(ctx, command.current, command.text, command.missionId) : await interpretForOwner(ctx, command.text));
      case "preview": return NextResponse.json(await previewMission(ctx, command.mission, command.missionId));
      case "create": return NextResponse.json(await createMission(ctx, command.mission, { active: command.active, via: "page" }));
      case "update": return NextResponse.json(await updateMission(ctx, command.missionId, command.mission, command.version));
      case "pause": return NextResponse.json(await setMissionActive(ctx, command.missionId, false));
      case "resume": return NextResponse.json(await setMissionActive(ctx, command.missionId, true));
      case "take_over": return NextResponse.json(await takeOverMission(ctx, command.missionId));
      case "delete": return NextResponse.json(await deleteMission(ctx, command.missionId));
      case "run_now": return NextResponse.json(await runMissionNow(ctx, command.missionId, command.nonce));
      case "resend": return NextResponse.json(await resendFeedback(ctx, command.missionId, command.runId));
      case "decide": return NextResponse.json(await decideChange(ctx, command.missionId, command.runId, command.index, command.approve));
      case "system_company": return NextResponse.json({ system: await saveCompanyAgent(ctx, command.agentId, command) });
      case "system_person": return NextResponse.json({ system: await savePersonAgent(ctx, command.agentId, command.level) });
    }
  } catch (error) {
    return failure(error);
  }
}

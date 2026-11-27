import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import * as tasksRoute from "@/app/api/workflow-tasks/route";
import { runStructuredAgent } from "@/lib/ai/agent-run";
import { AliasMap } from "@/lib/ai/alias";
import { formHasResults, formReviewMaterial, PROTOCOL_REVIEW_INSTRUCTIONS, protocolReviewResultSchema, REVIEW_DISCLAIMER } from "@/lib/ai/protocol-review";
import { sharesWork } from "@/lib/ai/sharing-policy";
import { callRoute, ToolError } from "@/lib/tools/call-route";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import type { FormDocument, FormValues } from "@/lib/workflow/form-document";

export const dynamic = "force-dynamic";

const id = z.string().min(1).max(100);
const requestSchema = z.object({ taskId: id }).strict();
type Row = Record<string, unknown>;

/**
 * Granska med AI (plan 2026-10-01, fas 3): the reviewer reads the saved protocol's technical values – never names,
 * addresses or attachments – and answers with what a careful colleague would ask about. Nothing is changed. The
 * protocol is read in the person's own session, with the same permission as opening it.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Granskning med Workflow AI kräver serverlagring.");
    // Granska med AI is a built-in agent (2026-11-21): the company's admin may switch it off under Agenter.
    const { assertSystemAgentOn, withExtraInstruction } = await import("@/lib/agents/system-agents-server");
    const extra = await assertSystemAgentOn(ctx.organizationId, "review");
    const input = requestSchema.parse(await body(request));
    const alias = new AliasMap();
    let task: Row | undefined;
    try { task = ((await callRoute(tasksRoute.GET, "GET", `/api/workflow-tasks?id=${encodeURIComponent(input.taskId)}`)).tasks as Row[] | undefined)?.[0]; }
    catch (error) { if (error instanceof ToolError) throw new ApiError(error.status, error.message); throw error; }
    const data = task?.data as { kind?: string; details?: { document?: FormDocument; values?: FormValues } } | undefined;
    if (!task || data?.kind !== "FORM" || !data.details?.document || !data.details.values) throw new ApiError(404, "Protokollet hittades inte.");
    if (!formHasResults(data.details.document, data.details.values)) return NextResponse.json({ review: null, reason: "Protokollet har inga registrerade resultat ännu. Fyll i och spara det först." });
    const material = alias.deep(formReviewMaterial(data.details.document, data.details.values));
    const subject = { type: "WORKFLOW_TASK" as const, id: String(task.id) };

    const outcome = await runStructuredAgent({
      organizationId: ctx.organizationId, actorId: ctx.user.id, agentId: "kfid-control-review", taskKind: "KFID_CONTROL_REVIEW", surface: "review",
      subject, requestKey: `review:${randomUUID()}`, instructions: withExtraInstruction(PROTOCOL_REVIEW_INSTRUCTIONS, extra), input: JSON.stringify(material),
      schema: protocolReviewResultSchema, schemaName: "hintek_protocol_review", shared: sharesWork,
    });
    if (!outcome.used) return NextResponse.json({ review: null, reason: outcome.reason });
    const review = {
      summary: alias.restore(outcome.output.summary),
      findings: outcome.output.findings.map((finding) => ({ ...finding, where: alias.restore(finding.where), title: alias.restore(finding.title), explanation: alias.restore(finding.explanation), recommendation: alias.restore(finding.recommendation) })),
      limitations: outcome.output.limitations.map((item) => alias.restore(item)),
      disclaimer: REVIEW_DISCLAIMER,
    };
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "ai_protocol_review", detail: `AI-granskning av ett protokoll: ${review.findings.length} ${review.findings.length === 1 ? "synpunkt" : "synpunkter"}.` } });
    return NextResponse.json({ review, chargedCredits: outcome.chargedCredits });
  } catch (error) {
    return failure(error);
  }
}

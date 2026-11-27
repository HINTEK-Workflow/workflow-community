import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { MACHINE_INTAKE_OFF_CODE, MACHINE_INTAKE_OFF_TEXT } from "@/lib/workflow/modules";

/** The administration history gets at most one line per source and this long; the server log gets every refusal. */
const LOG_INTERVAL_MS = 60 * 60 * 1000;
const ACTION = "machine_intake_refused";

/**
 * Företagets moduler (0.39.0): machine intake while Underhåll is off. An alarm must never be lost in silence, so the sender is told
 * plainly with 409 and a fixed code and nothing is counted as delivered: the edge device keeps its queue (scripts/pi/hintek-edge.mjs)
 * and sends again when the module is on. Each refusal goes in the server log with ids only; the company's history tells its admin.
 */
export async function refuseMachineIntake(principal: { sourceId: string; organizationId: string; name: string }, headers: Record<string, string>, now = new Date()) {
  console.warn("machine intake refused: module off", JSON.stringify({ sourceId: principal.sourceId, organizationId: principal.organizationId }));
  try {
    const detail = `Maskinkällan ${principal.name} skickade händelser medan Underhåll är avstängt. De togs inte emot.`;
    const told = await prisma.administrationEvent.count({ where: { organizationId: principal.organizationId, action: ACTION, detail, createdAt: { gte: new Date(now.getTime() - LOG_INTERVAL_MS) } } });
    if (!told) await prisma.administrationEvent.create({ data: { actorId: `system:machine-source:${principal.sourceId}`, organizationId: principal.organizationId, action: ACTION, detail } });
  } catch (error) {
    // The answer to the sender never depends on the history line.
    console.error("machine intake refusal not logged", error instanceof Error ? error.name : "Unknown");
  }
  return NextResponse.json({ error: MACHINE_INTAKE_OFF_TEXT, code: MACHINE_INTAKE_OFF_CODE }, { status: 409, headers });
}

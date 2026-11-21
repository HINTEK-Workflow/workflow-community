import { NextResponse } from "next/server";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { levelsView } from "@/lib/self-inspection/levels";
import { loadLevelDirectory, loadRiskClassMap } from "@/lib/self-inspection/levels-server";
import { SelfInspectionError } from "@/lib/self-inspection/model";
import { companyPeople } from "@/lib/self-inspection/server";

export const dynamic = "force-dynamic";

/**
 * Roller med nivå och riskklasser (2026-10-07), the short answer the screen needs outside Egenkontroll: whether the
 * company uses levels at all, the reader's own level, everyone's level and the company's risk class per task type (the
 * cards under Ny uppgift mark each with it). Levels and classes are not secret from the people they apply to – the programme's
 * roles and their people are read by every member – so every active member reads it; changing them is done under
 * Egenkontroll by an admin (POST /api/self-inspection).
 */
export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const people = await companyPeople(ctx.organizationId);
    const names = new Map(people.all.map((person) => [person.id, person.name]));
    const [directory, riskClasses] = await Promise.all([loadLevelDirectory(ctx.organizationId, undefined, names), loadRiskClassMap(ctx.organizationId)]);
    // Företagets moduler (0.39.0): the same as the routes' gate, so a page does not stop what the server would let through.
    const inForce = organizationModuleOn(ctx.organization, "self_inspection") ? directory : { enforced: false, people: [] };
    return NextResponse.json(levelsView(inForce, ctx.user.id, riskClasses), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SelfInspectionError) return NextResponse.json({ error: error.message }, { status: error.status });
    return failure(error);
  }
}

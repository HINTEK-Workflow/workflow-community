import { context, failure } from "@/lib/kfid/server";
import { requireFormAdmin } from "@/lib/kfid/form-server";
import { FORM_AI_SKILL_VERSION, formAiSkillZip, formAiSkillZipName } from "@/lib/kfid/form-ai-skill";

export const dynamic = "force-dynamic";

/**
 * "Skapa formulär med extern AI" (2026-11-24): the skill package Workflow Form Builder as a zip, for those who
 * build forms. It holds only the instructions, the schema, the template and the examples – nothing of the company.
 */
export async function GET() {
  try {
    const ctx = await context();
    requireFormAdmin(ctx);
    const zip = await formAiSkillZip();
    return new Response(Buffer.from(zip), { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${formAiSkillZipName()}"`,
      "Cache-Control": "private, no-store",
      "X-Skill-Version": FORM_AI_SKILL_VERSION,
    } });
  } catch (error) {
    return failure(error);
  }
}

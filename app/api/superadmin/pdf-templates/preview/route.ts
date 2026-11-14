import { NextResponse } from "next/server";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { pdfTemplatePreviewSchema } from "@/lib/pdf-templates/input";
import { pdfDocumentDef, type PdfDocumentType } from "@/lib/pdf-templates/catalog";
import { validateOverride, type PdfTemplateOverride } from "@/lib/pdf-templates/model";
import { pdfExampleCoverage, renderTracedExample } from "@/lib/pdf-templates/examples";
import { pdfText } from "@/lib/import/pdf-text";
import { workflowReportFont } from "@/lib/workflow/report-server";

export const dynamic = "force-dynamic";

/**
 * PDF-mallar's live preview (2026-11-03; clickable 2026-11-04): the document drawn by its real generator with invented example
 * data and the editor's unsaved overrides. Answers the PDF (base64), its text, the pages' sizes and where each template text
 * landed, so the page shows the very PDF and a click finds the block. Nothing is stored and no company's data is read.
 * Workflow's superadmin only; a POST because it carries the draft. A block whose draft breaks its rules is left at its default
 * here; saving says why. GET ?type= answers which of the document's examples print which block.
 */
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
  return ctx;
}

export async function GET(request: Request) {
  try {
    await superadmin();
    const def = pdfDocumentDef(new URL(request.url).searchParams.get("type") ?? "");
    if (!def) throw new ApiError(404, "Dokumenttypen finns inte.");
    return NextResponse.json({ coverage: await pdfExampleCoverage(def.type as PdfDocumentType, await workflowReportFont()) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    if (!(await hitRateLimit(RATE_RULES.pdfTemplatePreview, ctx.user.id)).allowed) throw new ApiError(429, "Många förhandsvisningar den senaste timmen. Vänta en stund.");
    const input = pdfTemplatePreviewSchema.parse(await body(request));
    const def = pdfDocumentDef(input.documentType)!;
    const overrides: PdfTemplateOverride[] = input.blocks.flatMap((item) => {
      const owner = pdfDocumentDef(item.documentType ?? def.type)!;
      const block = owner.blocks.find((candidate) => candidate.id === item.blockId);
      if (!block) return [];
      const groupSize = block.group ? owner.blocks.filter((other) => other.group === block.group).length : 0;
      if (validateOverride(block, item, groupSize)) return [];
      return [{ documentType: owner.type, blockId: item.blockId, text: item.text, visible: item.visible, orderIndex: item.orderIndex, basedOnVersion: item.basedOnVersion }];
    });
    const render = await renderTracedExample(def.type as PdfDocumentType, input.variant ?? null, overrides, await workflowReportFont());
    const buffer = Buffer.from(render.pdf);
    return NextResponse.json({ pdf: buffer.toString("base64"), text: pdfText(buffer) ?? "", targets: render.targets, pages: render.pages }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

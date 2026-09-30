import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  context,
  checkOrigin,
  body,
  failure,
  ApiError,
  ownedControl,
  requireCloudStorage,
  requireWorkflowPermission,
} from "@/lib/kfid/server";
import { normalizeControl } from "@/lib/kfid/model";
import { createPortableControlExport } from "@/lib/kfid/portable";
import { pdfReport, excelReport } from "@/lib/kfid/reports";
import { store, remove } from "@/lib/kfid/storage";
export async function POST(request: Request) {
  let resultId: string | undefined;
  let storagePath: string | undefined;
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    requireWorkflowPermission(ctx, "kfid", "report");
    const input = z
      .object({
        id: z.string().max(100),
        kind: z.enum(["pdf", "xlsx", "pdf_template", "xlsx_template", "json"]),
        requestKey: z.uuid(),
      })
      .parse(await body(request));
    const requestKey = `${ctx.organizationId}:${input.requestKey}`;
    const existing = await prisma.generatedResult.findUnique({
      where: { requestKey },
    });
    if (existing) {
      if (existing.controlId !== input.id || existing.kind !== input.kind)
        throw new ApiError(409, "Begäran används redan.");
      if (existing.status === "COMPLETE")
        return NextResponse.json({ url: `/api/reports/${existing.id}` });
      throw new ApiError(
        409,
        "Rapporten bearbetas eller misslyckades. Försök igen med en ny begäran.",
      );
    }
    const control = await ownedControl(ctx, input.id);
    const data = normalizeControl(control.data);
    const generated = await prisma.generatedResult.create({
      data: {
        organizationId: ctx.organizationId,
        controlId: control.id,
        requestKey,
        kind: input.kind,
      },
    });
    resultId = generated.id;
    const files = await prisma.attachment.findMany({
      where: { controlId: control.id, organizationId: ctx.organizationId },
    });
    const settings = await prisma.workspaceSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    const isPdf = input.kind.startsWith("pdf"),
      isJson = input.kind === "json",
      template = input.kind.endsWith("template");
    const bytes = isPdf
      ? await pdfReport(
          data,
          {
            company: settings?.companyName || ctx.organization.name,
            branding: {
              primary: settings?.reportPrimary,
              accent: settings?.reportAccent,
              soft: settings?.reportSoft,
            },
            logoPath: settings?.logoPath,
          },
          files,
          template,
        )
      : isJson
        ? Buffer.from(
            JSON.stringify(createPortableControlExport(data), null, 2),
          )
        : await excelReport(
            data,
            {
              company: settings?.companyName || ctx.organization.name,
              branding: {
                primary: settings?.reportPrimary,
                accent: settings?.reportAccent,
                soft: settings?.reportSoft,
              },
            },
            template,
            files.length,
          );
    storagePath = await store(bytes, isPdf ? "pdf" : isJson ? "json" : "xlsx");
    await prisma.generatedResult.update({
      where: { id: resultId },
      data: {
        status: "COMPLETE",
        storagePath,
        mimeType: isPdf
          ? "application/pdf"
          : isJson
            ? "application/json"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
    return NextResponse.json({ url: `/api/reports/${resultId}` });
  } catch (e) {
    if (storagePath) await remove(storagePath);
    if (resultId) {
      const id = resultId;
      await prisma
        .$transaction(async (tx) => {
          const result = await tx.generatedResult.findUnique({ where: { id } });
          if (!result || result.status !== "PENDING") return;
          await tx.generatedResult.update({
            where: { id },
            data: { status: "FAILED" },
          });
        })
        .catch(() => {});
    }
    return failure(e);
  }
}

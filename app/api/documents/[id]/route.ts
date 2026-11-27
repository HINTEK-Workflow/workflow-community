import { NextResponse } from "next/server";
import { body, checkOrigin, context, failure, requireModule } from "@/lib/kfid/server";
import { documentChangeSchema } from "@/lib/documents/model";
import { changeDocument, documentFile, removeDocument } from "@/lib/documents/server";

export const dynamic = "force-dynamic";

/** The name in Content-Disposition: plain ASCII for old clients, the real name in UTF-8 beside it. */
const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * One document (Dokument, 0.87.0): GET downloads it – always as an attachment, never shown inline, and only once the virus scan says
 * clean; PATCH renames, restores from the papperskorg or files it at another place of the customer; DELETE moves it to the
 * papperskorg (`?permanent=1` from there removes it for good). lib/documents/server.ts holds every check.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context();
    const { id } = await params;
    const file = await documentFile(ctx, id);
    return new Response(file.bytes, { headers: {
      "Content-Type": file.mimeType, "Content-Disposition": disposition(file.name),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
    } });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireModule(ctx, "customers");
    const { id } = await params;
    return NextResponse.json({ document: await changeDocument(ctx, id, documentChangeSchema.parse(await body(request))) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireModule(ctx, "customers");
    const { id } = await params;
    return NextResponse.json(await removeDocument(ctx, id, new URL(request.url).searchParams.get("permanent") === "1"));
  } catch (error) {
    return failure(error);
  }
}

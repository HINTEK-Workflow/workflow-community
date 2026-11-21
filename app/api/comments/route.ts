import { NextResponse } from "next/server";
import { body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";
import { commentActionSchema, commentParentQuery } from "@/lib/comments/model";
import { applyCommentAction, loadThread } from "@/lib/comments/server";

export const dynamic = "force-dynamic";

/**
 * Kommentarer (beslut 14, 2026-11-01): one thread per work order, project and deviation. The session, the membership and
 * the company come from context(); lib/comments/server.ts checks the right to read the parent on every read and write. Cloud
 * only: a Local file has one user, and its thread is hidden.
 */
const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const params = new URL(request.url).searchParams;
    const query = commentParentQuery.parse({ parentType: params.get("parentType"), parentId: params.get("parentId") });
    return NextResponse.json(await loadThread(ctx, { type: query.parentType, id: query.parentId }), noStore);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    const input = commentActionSchema.parse(await body(request));
    // Following and "seen" are the person's own marks; what others read needs the company's right to write.
    if (input.action === "add" || input.action === "set_customer" || input.action === "remove") await requireCloudWriteAccess(ctx);
    return NextResponse.json(await applyCommentAction(ctx, input), noStore);
  } catch (error) {
    return failure(error);
  }
}

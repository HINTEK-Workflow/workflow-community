import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { articleRefInputSchema } from "@/lib/catalogue/lists";
import {
  addArticleListLines, addFavorite, articleListRows, createArticleList, deleteArticleList, getArticleList, listArticleLists, listFavorites, removeFavorite, requireArticleLists, updateArticleList,
  type ArticleListCaller,
} from "@/lib/catalogue/lists-server";

export const dynamic = "force-dynamic";

/**
 * Favoriter och artikellistor (2026-10-16, docs/artikellistor.md).
 * GET ?part=favorites – the caller's favourites with today's hits; GET ?part=lists – the company's lists (summaries);
 * GET ?id= – one list with its lines resolved; GET ?id=&rows=1 – the list as document rows (for other modules).
 * POST actions: favorite / unfavorite; create, update (name, description, lines with revision), add_lines, delete.
 * Session, company, the right to pick articles (catalogue "pick"), Cloud and – on a change – Cloud write access and Origin
 * are checked on every call; a list is changed only by the one who made it or an admin; prices only for those who see them.
 */
const caller = (ctx: Context): ArticleListCaller => ({ organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode });
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(100);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const who = caller(ctx);
    requireArticleLists(who);
    const url = new URL(request.url);
    const one = url.searchParams.get("id");
    if (one !== null) {
      if (url.searchParams.get("rows") === "1") return NextResponse.json({ rows: await articleListRows(who, id.parse(one)) }, { headers: noStore });
      return NextResponse.json({ list: await getArticleList(who, id.parse(one)) }, { headers: noStore });
    }
    if (url.searchParams.get("part") === "favorites") return NextResponse.json({ favorites: await listFavorites(who) }, { headers: noStore });
    return NextResponse.json({ lists: await listArticleLists(who) }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const lines = z.array(z.unknown()).max(200);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("favorite"), ref: articleRefInputSchema, snapshot: z.unknown().optional() }),
  z.object({ action: z.literal("unfavorite"), id }),
  z.object({ action: z.literal("create"), list: z.unknown(), lines: lines.optional() }),
  z.object({ action: z.literal("update"), id, revision: z.number().int().min(1), name: z.unknown().optional(), description: z.unknown().optional(), lines: z.unknown().optional() }),
  z.object({ action: z.literal("add_lines"), id, lines: lines.min(1) }),
  z.object({ action: z.literal("delete"), id }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const who = caller(ctx);
    requireArticleLists(who);
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "purchasing");
    const input = requestSchema.parse(await body(request));
    switch (input.action) {
      case "favorite": return NextResponse.json({ favorite: await addFavorite(who, { ref: input.ref, snapshot: input.snapshot }) });
      case "unfavorite": await removeFavorite(who, input.id); return NextResponse.json({ ok: true });
      case "create": return NextResponse.json({ list: await createArticleList(who, input.list, input.lines ?? []) });
      case "update": return NextResponse.json({ list: await updateArticleList(who, input.id, input.revision, { name: input.name, description: input.description, lines: input.lines }) });
      case "add_lines": return NextResponse.json({ list: await addArticleListLines(who, input.id, input.lines) });
      case "delete": await deleteArticleList(who, input.id); return NextResponse.json({ ok: true });
    }
  } catch (error) {
    return failure(error);
  }
}

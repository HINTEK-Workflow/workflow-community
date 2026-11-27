import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { parseNewsFilter } from "@/lib/news/model";
import { createCompanyNews, deleteCompanyNews, getCompanyNews, listCompanyNews, pinCompanyNews, updateCompanyNews } from "@/lib/news/server";

export const dynamic = "force-dynamic";

/**
 * Nyheter (2026-11-21): the company's internal news. GET ?filter=published|draft&q=&cursor= (one page; drafts only for the admin),
 * GET ?id= (one post; opening it reads its notice). POST changes, only for the company's admin: create, save, pin, delete. Every
 * call checks the session (or the API/MCP key), the company, the membership and the test-account limits in context(); a change also
 * Origin, server storage, Cloud write access and the module, and lib/news/server.ts checks the role again, so a call from other
 * code (an agent mission) meets the same rules.
 */
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(60);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const url = new URL(request.url);
    const one = url.searchParams.get("id");
    if (one) return NextResponse.json(await getCompanyNews(ctx, id.parse(one)), { headers: noStore });
    const cursor = url.searchParams.get("cursor");
    return NextResponse.json(await listCompanyNews(ctx, {
      filter: parseNewsFilter(url.searchParams.get("filter")), query: url.searchParams.get("q"), cursor: cursor ? id.parse(cursor) : null,
    }), { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), post: z.unknown() }),
  z.object({ action: z.literal("save"), id, post: z.unknown() }),
  z.object({ action: z.literal("pin"), id, pinned: z.boolean() }),
  z.object({ action: z.literal("delete"), id }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "news");
    const input = requestSchema.parse(await body(request));
    switch (input.action) {
      case "create": return NextResponse.json(await createCompanyNews(ctx, input.post));
      case "save": return NextResponse.json(await updateCompanyNews(ctx, input.id, input.post));
      case "pin": return NextResponse.json(await pinCompanyNews(ctx, input.id, input.pinned));
      case "delete": return NextResponse.json(await deleteCompanyNews(ctx, input.id));
    }
  } catch (error) {
    return failure(error);
  }
}

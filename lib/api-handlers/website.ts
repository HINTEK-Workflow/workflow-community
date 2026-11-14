import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { BLOCK_NAME } from "@/lib/website/frame";
import { draftFromWebsite } from "@/lib/meta/server";
import {
  checkWebsite, connectionView, discardWebsiteDraft, listWebsitePages, openWebsitePage, publishWebsitePage, removeConnection, renderWebsiteBlock, restoreWebsiteBackup, saveConnection,
  saveWebsiteDraft, websiteExtras, websitePageModified, websiteThemeStyles, connectionConfig, importWebsiteImage, websiteMedia,
} from "@/lib/website/server";
import { refreshSiteLook, siteLookView } from "@/lib/website/look-server";

/** After a check that worked: the site's look is read again (best effort; the editor falls back to a system font). */
async function readLook(organizationId: string) {
  const config = await connectionConfig(organizationId).catch(() => null);
  if (config) await refreshSiteLook(organizationId, config).catch(() => false);
}

/**
 * Min webbsida (2026-11-10): Inställningar → Min webbsida, the company's own WordPress. Like the company's other settings:
 * the signed-in person (or an API key's member, with the same checks), an active membership in the active company, ADMIN or
 * OWNER there, Cloud storage, and on every change the app's Origin, the company's write access and the rate; a change of the
 * connection (where Workflow writes, and with whose password) also a fresh sign-in. Everything read or written is the active
 * company's own – a superadmin gets no other company's site. The application password is never returned, and the audit
 * never holds a page's text.
 */
export async function websiteAdmin() {
  const ctx = await context();
  requireAdmin(ctx);
  requireCloudStorage(ctx);
  return ctx;
}
export type WebsiteContext = Awaited<ReturnType<typeof websiteAdmin>>;

/** The company's ceilings: changes and reads each, an hour (every call may reach the company's WordPress). */
export async function websiteRate(ctx: WebsiteContext, kind: "change" | "read") {
  const hit = await hitRateLimit(kind === "change" ? RATE_RULES.websiteChange : RATE_RULES.websiteRead, `website-${kind}:${ctx.organizationId}`);
  if (!hit.allowed) throw new ApiError(429, kind === "change" ? "Många ändringar av webbplatsen den senaste timmen. Vänta en stund." : "Många anrop till webbplatsen den senaste timmen. Vänta en stund.");
}

const noStore = { "Cache-Control": "private, no-store" };
const actorOf = (ctx: WebsiteContext) => ({ userId: ctx.user.id, organizationId: ctx.organizationId });
const idOf = (value: string) => z.coerce.number().int().positive().max(1_000_000_000).parse(value);

export async function GET(request: Request) {
  try {
    const ctx = await websiteAdmin();
    const { organizationId } = ctx;
    const url = new URL(request.url);
    const page = url.searchParams.get("page");
    const modified = url.searchParams.get("modified");
    const styles = url.searchParams.get("styles");
    // Kopplingar's card and status line (2026-11-10): the connection only, without asking WordPress.
    if (url.searchParams.get("part") === "connection") return NextResponse.json({ connection: await connectionView(organizationId) }, { headers: noStore });
    // Sajtens utseende (2026-11-10): the typography and the copied fonts; read once when a connected site has none yet.
    if (url.searchParams.get("look")) {
      let view = await siteLookView(organizationId);
      if (!view.look && (await connectionView(organizationId)).configured) { await websiteRate(ctx, "read"); await readLook(organizationId); view = await siteLookView(organizationId); }
      return NextResponse.json(view, { headers: noStore });
    }
    // Sökmotorer och delning: the share picture is chosen from the media library (shown through the app's own server).
    if (url.searchParams.get("media")) { await websiteRate(ctx, "read"); return NextResponse.json({ media: await websiteMedia(organizationId) }, { headers: noStore }); }
    if (page || modified || styles) await websiteRate(ctx, "read");
    if (page) return NextResponse.json(await openWebsitePage(organizationId, idOf(page)), { headers: noStore });
    if (modified) return NextResponse.json(await websitePageModified(organizationId, idOf(modified)), { headers: noStore });
    if (styles) return NextResponse.json(await websiteThemeStyles(organizationId, idOf(styles)), { headers: noStore });
    const extras = await websiteExtras(organizationId);
    const connection = await connectionView(organizationId, extras);
    let pages: Awaited<ReturnType<typeof listWebsitePages>> = [];
    let pagesError: string | null = null;
    if (connection.configured) {
      await websiteRate(ctx, "read");
      try { pages = await listWebsitePages(organizationId, extras); } catch (error) { pagesError = error instanceof ApiError ? error.message : "Sidorna kunde inte hämtas."; }
    }
    return NextResponse.json({ connection, pages, pagesError, auto: extras ? { sources: extras.sources } : null }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const pageId = z.number().int().positive().max(1_000_000_000);
const content = z.string().max(1_600_000);
const modified = z.string().min(1).max(40);
// Sökmotorer och delning: generous here, the exact limits (70 and 200 characters as WordPress counts them) in lib/website/seo.ts.
const seo = z.object({ title: z.string().max(400), description: z.string().max(1000), noindex: z.boolean(), image: z.number().int().min(0).max(1_000_000_000) });
const seoFields = { seo: seo.nullable().optional(), seoBase: seo.nullable().optional() };
const attributes = z.record(z.string().max(100), z.unknown()).refine((value) => JSON.stringify(value).length <= 20_000, "Blockets inställningar är för stora.");
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("connection"), siteUrl: z.string().trim().max(300).optional(), baseUrl: z.string().trim().max(300).nullable().optional(),
    username: z.string().trim().max(200).nullable().optional(), password: z.string().max(200).nullable().optional(),
  }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("check") }),
  z.object({ action: z.literal("save"), pageId, content, baseModified: modified, revision: z.number().int().min(0), ...seoFields }),
  z.object({ action: z.literal("discard"), pageId }),
  z.object({ action: z.literal("publish"), pageId, content, baseModified: modified, ...seoFields, share: z.union([z.boolean(), z.object({
    heading: z.string().max(200), body: z.string().max(400), caption: z.string().max(2400), background: z.string().trim().max(2000).nullable().optional(),
  })]).optional() }),
  z.object({ action: z.literal("restore"), backupId: z.string().min(1).max(40), baseModified: modified }),
  z.object({ action: z.literal("auto") }),
  z.object({ action: z.literal("import-image"), url: z.string().trim().min(8).max(2000) }),
  z.object({ action: z.literal("render"), pageId, name: z.string().max(120).regex(BLOCK_NAME), attributes }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await websiteAdmin();
    const input = requestSchema.parse(await body(request));
    const { organizationId } = ctx;
    // Drawing a block and checking the connection only read: the read ceiling, so a page with many blocks never uses up the changes.
    const reads = input.action === "render" || input.action === "check";
    await websiteRate(ctx, reads ? "read" : "change");
    if (!reads) await requireCloudWriteAccess(ctx);
    const actor = actorOf(ctx);
    switch (input.action) {
      case "connection": {
        // The address and the sign-in decide where Workflow writes, and as whom: a fresh sign-in.
        await requireFreshAuth(ctx.user.id, ctx.auth);
        const view = await saveConnection(actor, input);
        const check = view.configured ? await checkWebsite(organizationId) : null;
        if (check?.ok) await readLook(organizationId);
        return NextResponse.json({ connection: view, check }, { headers: noStore });
      }
      case "disconnect": {
        await requireFreshAuth(ctx.user.id, ctx.auth);
        return NextResponse.json({ connection: await removeConnection(actor), check: null }, { headers: noStore });
      }
      case "check": {
        const check = await checkWebsite(organizationId);
        if (check.ok) await readLook(organizationId);
        return NextResponse.json({ check }, { headers: noStore });
      }
      case "import-image": return NextResponse.json(await importWebsiteImage(actor, input.url), { headers: noStore });
      case "save": return NextResponse.json(await saveWebsiteDraft(actor, input.pageId, input), { headers: noStore });
      case "discard": return NextResponse.json(await discardWebsiteDraft(actor, input.pageId), { headers: noStore });
      case "publish": {
        const published = await publishWebsitePage(actor, input.pageId, input);
        // Dela även på Facebook och Instagram (2026-11-10): a draft under Inlägg – never posted from here.
        const post = input.share && !published.unchanged
          ? await draftFromWebsite(actor, { id: input.pageId, title: published.page.title, modified: published.page.modified, link: published.page.link || null, markup: input.content },
            typeof input.share === "object" ? input.share : undefined).catch(() => null)
          : null;
        return NextResponse.json({ ...published, post: post ? { id: post.id } : null }, { headers: noStore });
      }
      case "restore": return NextResponse.json(await restoreWebsiteBackup(actor, input.backupId, input), { headers: noStore });
      case "auto": {
        const extras = await websiteExtras(organizationId);
        if (!extras) throw new ApiError(404, "Webbplatsen har inga automatiska block.");
        return NextResponse.json(await extras.run(), { headers: noStore });
      }
      case "render": return NextResponse.json(await renderWebsiteBlock(organizationId, input.pageId, input.name, input.attributes), { headers: noStore });
    }
  } catch (error) {
    return failure(error);
  }
}

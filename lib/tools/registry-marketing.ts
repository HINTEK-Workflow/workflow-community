import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { context, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { actorOf, metaAdmin, metaRate } from "@/lib/api-handlers/meta";
import { createPost, getPost, listPosts, type PostInput } from "@/lib/meta/server";
import { listScheduled } from "@/lib/schedule/server";
import { RELEASE_NOTES, currentAppVersion } from "@/lib/release-notes";
import { addReportDays, buildComparedReport, MAX_REPORT_DAYS, periodTotals, previousPeriod } from "@/lib/analytics/report";
import { readCounters } from "@/lib/analytics/store";
import { isHintekOrganization } from "@/lib/branding";
import { swedishDayKey } from "@/lib/swedish-time";
import { ToolError } from "@/lib/tools/call-route";
import { API_POST_SOURCE, filterPosts, postToolView, releaseNotesView, siteAnalyticsView } from "@/lib/tools/marketing-view";
import type { MARKETING_TOOL_CATALOG } from "@/lib/tools/catalog-marketing";
import type { AssignmentInstruction } from "@/lib/content-assignments/model";

/**
 * The runners of lib/tools/catalog-marketing.ts (2026-11-25), spread into the registry's runners. The posts tools take the same
 * checks as the page Inlägg (lib/api-handlers/meta-posts.ts): the key's member must be the company's admin, Cloud, the rate of
 * Inlägg, and for a draft write access and the module Webb och inlägg. A draft is all a tool makes: Publicera, Schemalägg and the
 * approval stay in Workflow. The statistics are the installation's own anonymous counters, only for its own company's admin who
 * is the installation's administrator, as on Beteendeanalys.
 */
type Input = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" ? value : undefined);

async function schedulesOf(organizationId: string) {
  const items = await listScheduled(organizationId, { kind: "post" });
  // The newest item per post (the list is by time, oldest first).
  return new Map(items.map((item) => [item.targetId, item] as const));
}

async function draftByReference(organizationId: string, externalRef: string) {
  const found = await prisma.socialPost.findFirst({ where: { organizationId, source: API_POST_SOURCE, sourceRef: externalRef }, select: { id: true } });
  return found ? getPost(organizationId, found.id) : null;
}

export const marketingRunners: Record<keyof typeof MARKETING_TOOL_CATALOG, (input: Input) => Promise<unknown>> = {
  list_release_notes: async ({ since, limit }) => {
    // Public texts (the page /nytt), but still only for a key of a company the key may act in.
    await context();
    return releaseNotesView(RELEASE_NOTES, currentAppVersion(), { since: str(since), limit: num(limit) });
  },

  list_social_posts: async ({ status, since, externalRef, limit }) => {
    const ctx = await metaAdmin();
    await metaRate(ctx, "read");
    const [posts, schedules] = await Promise.all([listPosts(ctx.organizationId), schedulesOf(ctx.organizationId)]);
    const shown = filterPosts(posts, { status: str(status), since: str(since), externalRef: str(externalRef), limit: num(limit) });
    return { total: shown.length, posts: shown.map((post) => postToolView(post, schedules.get(post.id) ?? null)), url: "/?view=web_posts" };
  },

  get_social_post: async ({ postId }) => {
    const ctx = await metaAdmin();
    await metaRate(ctx, "read");
    const [post, schedules] = await Promise.all([getPost(ctx.organizationId, String(postId)), schedulesOf(ctx.organizationId)]);
    return { post: postToolView(post, schedules.get(post.id) ?? null) };
  },

  create_social_post_draft: async (input) => {
    const ctx = await metaAdmin();
    await metaRate(ctx, "change");
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "web_posts");
    const { externalRef, ...fields } = input as Input & { externalRef?: string };
    if (externalRef) {
      const existing = await draftByReference(ctx.organizationId, externalRef);
      if (existing) return { existing: true, post: postToolView(existing) };
    }
    if (!fields.heading && !fields.caption && !fields.body) throw new ToolError(400, "Ange minst en rubrik, en text i bilden eller inläggets text.");
    try {
      const post = await createPost(actorOf(ctx), fields as PostInput, externalRef ? { source: API_POST_SOURCE, sourceRef: externalRef } : undefined);
      return { existing: false, post: postToolView(post) };
    } catch (error) {
      // Two calls with the same reference at once: the second gets the first one's draft.
      if (externalRef && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await draftByReference(ctx.organizationId, externalRef);
        if (existing) return { existing: true, post: postToolView(existing) };
      }
      throw error;
    }
  },

  create_content_brief: async (input) => {
    const ctx = await metaAdmin();
    await metaRate(ctx, "change");
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "web_posts");
    const { externalRef, autoPublish, ...instruction } = input as Input & { externalRef?: string; autoPublish?: boolean };
    const { createContentAssignment } = await import("@/lib/content-assignments/server");
    const result = await createContentAssignment(actorOf(ctx), instruction as AssignmentInstruction, externalRef, { autoPublish: autoPublish === true });
    const schedules = await schedulesOf(ctx.organizationId);
    return { existing: result.existing, post: postToolView(result.post, schedules.get(result.post.id) ?? null) };
  },

  list_films: async () => {
    // Public texts (the film page), but only for a key of a company the key may act in.
    await context();
    const { filmList } = await import("@/lib/content-assignments/server");
    return { films: await filmList(), url: "/filmer" };
  },

  get_site_analytics: async ({ from, to }) => {
    const ctx = await context();
    if (!ctx.admin || ctx.user.role !== "SUPERADMIN" || !isHintekOrganization(ctx.organization))
      throw new ToolError(403, "Besöksstatistiken finns bara för installationens eget företag, med installationens administratör som nyckelns användare.");
    const today = swedishDayKey(new Date());
    const end = str(to) && String(to) <= today ? String(to) : today;
    let start = str(from) && String(from) <= end ? String(from) : addReportDays(end, -29);
    if (start < addReportDays(end, -(MAX_REPORT_DAYS - 1))) start = addReportDays(end, -(MAX_REPORT_DAYS - 1));
    const report = buildComparedReport(await readCounters(previousPeriod(start, end).from, end), start, end);
    return siteAnalyticsView(report, periodTotals(report));
  },
};

import { prisma } from "@/lib/db";
import { isErasedCompany } from "@/lib/kfid/paused-company";
import { normalizeWorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { boardFeed, type BoardFeed } from "./feed-server";
import type { MetricCaller } from "./metrics-server";
import { readLayout, type BoardLayout } from "./model";
import { visibilitySchema } from "./privacy";
import { readPlaylistItems } from "./screens";

/**
 * Visning utan inloggning (Tavlor etapp 2, 2026-11-18; plan 4.7): what a connected screen or a shared link is shown. Only the
 * published versions of the boards it points at, with their figures counted as the person who published each version – with that
 * person's rights today, so a publisher who lost a right or left the company makes the card say "Inte tillgängligt längre" instead
 * of letting the data through. Personal data follows the publisher's choice per card, and `namesAllowed` false hides it anyway.
 * Nothing here returns ids of customers or people, and nothing can be changed through it.
 */
export type ViewerOrganization = { id: string; slug: string; isActive: boolean; disabledModules: string[]; weeklyWorkMinutes: number };
export type PlayerBoardOut = { id: string; name: string; layout: BoardLayout; cards: BoardFeed; seconds: number };
export type TargetFeed = { boards: PlayerBoardOut[]; seconds: number; at: string };

/** Whether the company may show anything at all: not erased, the module on. A paused company keeps reading (plan 4.7.4). */
export const organizationShows = (organization: ViewerOrganization | null) => Boolean(organization && !isErasedCompany(organization) && organizationModuleOn(organization, "boards"));

/** The publisher as a viewer: an active member of an active account in the company, with the rights the person has now. */
export async function publisherViewer(organization: ViewerOrganization, userId: string): Promise<MetricCaller | null> {
  const member = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: organization.id, userId } }, select: { isActive: true, role: true, workflowPermissions: true, user: { select: { isActive: true } } } });
  if (!member?.isActive || !member.user.isActive) return null;
  return {
    organizationId: organization.id, userId, admin: member.role === "OWNER" || member.role === "ADMIN",
    workflowPermissions: normalizeWorkflowPermissionProfile(member.workflowPermissions),
    organization: { disabledModules: organization.disabledModules, weeklyWorkMinutes: organization.weeklyWorkMinutes },
  };
}

/** The boards a target shows, in order, with seconds each (one board: no rotation). */
async function targetBoards(organizationId: string, target: { boardId: string | null; playlistId: string | null }) {
  if (target.boardId) return { items: [{ boardId: target.boardId, seconds: 0 }], name: null as string | null };
  if (!target.playlistId) return { items: [], name: null };
  const playlist = await prisma.boardPlaylist.findFirst({ where: { id: target.playlistId, organizationId, deletedAt: null }, select: { name: true, items: true } });
  return { items: playlist ? readPlaylistItems(playlist.items) : [], name: playlist?.name ?? null };
}

/** The published layouts a target shows (for its pictures), without counting anything. */
export async function targetLayouts(organizationId: string, target: { boardId: string | null; playlistId: string | null }): Promise<BoardLayout[]> {
  const { items } = await targetBoards(organizationId, target);
  const boards = await prisma.board.findMany({ where: { organizationId, id: { in: items.map((item) => item.boardId) }, deletedAt: null, publishedVersionId: { not: null } }, select: { publishedVersionId: true } });
  const versions = await prisma.boardVersion.findMany({ where: { organizationId, id: { in: boards.map((board) => board.publishedVersionId!) } }, select: { layout: true } });
  return versions.map((version) => readLayout(version.layout));
}

export async function targetFeed(organization: ViewerOrganization, target: { boardId: string | null; playlistId: string | null }, options: { namesAllowed: boolean; tag: string; now?: Date }): Promise<TargetFeed> {
  const now = options.now ?? new Date();
  const { items } = await targetBoards(organization.id, target);
  const boards = await prisma.board.findMany({ where: { organizationId: organization.id, id: { in: items.map((item) => item.boardId) }, deletedAt: null, publishedVersionId: { not: null } }, select: { id: true, name: true, publishedVersionId: true } });
  const versions = await prisma.boardVersion.findMany({ where: { organizationId: organization.id, id: { in: boards.map((board) => board.publishedVersionId!) } } });
  const viewers = new Map<string, Promise<MetricCaller | null>>();
  const out: PlayerBoardOut[] = [];
  for (const item of items) {
    const board = boards.find((row) => row.id === item.boardId);
    const version = board && versions.find((row) => row.id === board.publishedVersionId);
    if (!board || !version) continue;
    const layout = readLayout(version.layout);
    if (!viewers.has(version.publishedById)) viewers.set(version.publishedById, publisherViewer(organization, version.publishedById));
    const viewer = await viewers.get(version.publishedById)!;
    const cards: BoardFeed = viewer
      ? await boardFeed(viewer, layout, { outside: true, visibility: visibilitySchema.parse(version.visibility ?? {}), namesAllowed: options.namesAllowed }, { cacheKey: `${version.id}:${options.tag}:${options.namesAllowed ? "names" : "none"}`, boardId: board.id, now })
      : Object.fromEntries(layout.cards.filter((card) => card.data).map((card) => [card.id, { ok: false as const, at: now.toISOString(), reason: "not_available" as const }]));
    out.push({ id: board.id, name: board.name, layout, cards, seconds: item.seconds });
  }
  const seconds = items.length > 1 ? Math.round(items.reduce((sum, item) => sum + item.seconds, 0) / items.length) : 0;
  return { boards: out, seconds, at: now.toISOString() };
}

/** The company's row as the viewer routes need it. */
export const viewerOrganization = (organizationId: string) => prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, slug: true, isActive: true, disabledModules: true, weeklyWorkMinutes: true } });

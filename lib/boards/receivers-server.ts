import { prisma } from "@/lib/db";
import { readPlaylistItems } from "./screens";

/**
 * Mottagarna av en tavla (Tavlor etapp 2, 2026-11-18): the connected screens and the shared links that show a board – directly or
 * through a playlist – named in "Det här syns" before it is published. Blocked screens and ended links are left out.
 */
export async function receiversOfBoard(organizationId: string, boardId: string): Promise<{ screens: string[]; links: string[] }> {
  const playlists = await prisma.boardPlaylist.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, items: true } });
  const holding = playlists.filter((playlist) => readPlaylistItems(playlist.items).some((item) => item.boardId === boardId)).map((playlist) => playlist.id);
  const rows = await prisma.boardAccess.findMany({
    where: { organizationId, revokedAt: null, OR: [{ boardId }, ...(holding.length ? [{ playlistId: { in: holding } }] : [])], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] },
    select: { kind: true, name: true, screen: { select: { status: true } } }, take: 200,
  });
  return {
    screens: rows.filter((row) => row.kind === "screen" && row.screen?.status === "active").map((row) => row.name),
    links: rows.filter((row) => row.kind === "link").map((row) => row.name),
  };
}

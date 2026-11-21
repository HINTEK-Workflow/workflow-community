import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { boardsAccess } from "./access";
import { forgetBoardFeeds } from "./feed-server";
import type { BoardsCaller } from "./server";
import { playlistItemsSchema, readPlaylistItems } from "./screens";

/**
 * Spellistor (Tavlor och skärmar etapp 2, 2026-11-18): boards shown in turn on a screen or behind a link, each for its own number of
 * seconds. Made and changed with the right to publish, since a playlist decides what a screen shows; seen with the right Skärmar too.
 */
const audit = (caller: BoardsCaller, action: string, detail: string) =>
  prisma.administrationEvent.create({ data: { organizationId: caller.organizationId, actorId: caller.userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
const requirePublish = (caller: BoardsCaller) => { if (!boardsAccess(caller).publish) throw new ApiError(403, "Du saknar behörighet att ändra spellistor."); };

export async function listPlaylists(caller: BoardsCaller) {
  const rights = boardsAccess(caller);
  if (!rights.publish && !rights.screens) throw new ApiError(403, "Du saknar behörighet att se spellistor.");
  const rows = await prisma.boardPlaylist.findMany({ where: { organizationId: caller.organizationId, deletedAt: null }, orderBy: { name: "asc" }, take: 200 });
  return { items: rows.map((row) => ({ id: row.id, name: row.name, items: readPlaylistItems(row.items), updatedAt: row.updatedAt.toISOString() })), canEdit: rights.publish };
}

const saveSchema = z.object({ name: z.string().trim().min(1, "Ge spellistan ett namn.").max(60), items: playlistItemsSchema });

async function checkBoards(caller: BoardsCaller, ids: string[]) {
  const found = await prisma.board.count({ where: { organizationId: caller.organizationId, id: { in: [...new Set(ids)] }, deletedAt: null } });
  if (found !== new Set(ids).size) throw new ApiError(404, "En av tavlorna finns inte.");
}

export async function createPlaylist(caller: BoardsCaller, input: unknown) {
  requirePublish(caller);
  const data = saveSchema.parse(input);
  await checkBoards(caller, data.items.map((item) => item.boardId));
  const row = await prisma.boardPlaylist.create({ data: { organizationId: caller.organizationId, name: data.name, items: data.items, createdById: caller.userId, updatedById: caller.userId }, select: { id: true } });
  await audit(caller, "board_playlist_created", `Spellistan ${data.name} skapades.`);
  return { id: row.id };
}

export async function savePlaylist(caller: BoardsCaller, id: string, input: unknown) {
  requirePublish(caller);
  const data = saveSchema.parse(input);
  await checkBoards(caller, data.items.map((item) => item.boardId));
  const updated = await prisma.boardPlaylist.updateMany({ where: { id, organizationId: caller.organizationId, deletedAt: null }, data: { name: data.name, items: data.items, updatedById: caller.userId } });
  if (!updated.count) throw new ApiError(404, "Spellistan finns inte.");
  for (const item of data.items) forgetBoardFeeds({ boardId: item.boardId });
  return { ok: true };
}

export async function deletePlaylist(caller: BoardsCaller, id: string) {
  requirePublish(caller);
  const row = await prisma.boardPlaylist.findFirst({ where: { id, organizationId: caller.organizationId, deletedAt: null } });
  if (!row) throw new ApiError(404, "Spellistan finns inte.");
  await prisma.boardPlaylist.update({ where: { id }, data: { deletedAt: new Date(), updatedById: caller.userId } });
  await audit(caller, "board_playlist_deleted", `Spellistan ${row.name} togs bort.`);
  return { ok: true };
}

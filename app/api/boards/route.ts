import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import {
  boardFeedInApp, boardsCallerOf, boardSources, createBoard, createTable, deleteBoard, deleteTable, getBoard, getTable, listBoards, listTables, publishBoard, publishPreview, saveBoard, saveTable,
} from "@/lib/boards/server";
import { boardsAccess } from "@/lib/boards/access";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { approvePairing, commandScreen, deleteScreen, listScreens, pairingInfo, revokeScreen, updateScreen } from "@/lib/boards/screens-server";
import { createLink, defaultLinkUntil, deleteLink, listLinks, renewLink, revokeLink, setLinkCode } from "@/lib/boards/links-server";
import { createPlaylist, deletePlaylist, listPlaylists, savePlaylist } from "@/lib/boards/playlists-server";
import { linkAddress } from "@/lib/boards/screens";
import { appOrigin, qrSvg } from "@/lib/boards/viewer-http";

export const dynamic = "force-dynamic";

/**
 * Tavlor (Tavlor och skärmar etapp 1, 2026-11-18): the company's boards and their own tables, for the signed-in person. GET
 * ?part=list, ?part=board&id=, ?part=feed&id=&draft=1 (the figures, counted as the person), ?part=publish&id= ("Det här syns"),
 * ?part=tables, ?part=table&id=; etapp 2: ?part=screens, ?part=pairing&code= (what a code on a screen is), ?part=links, ?part=playlists.
 * POST changes; approving a screen and making or renewing a link need a recent sign-in. every call checks the session, the company, the rights (lib/boards/server.ts), Cloud
 * write access, the module and Origin. A company that keeps its data in its own file (.hwf) has no boards: they need the server.
 * Screens and links never reach this route (lib/boards/guard.ts); they have their own read-only routes under /skarm and /visa.
 */
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(60);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const caller = boardsCallerOf(ctx);
    const url = new URL(request.url);
    const param = (key: string) => id.parse(url.searchParams.get(key) ?? "");
    const json = (value: unknown) => NextResponse.json(value, { headers: noStore });
    switch (url.searchParams.get("part")) {
      // The app's own public address goes with the rights, so Skärmar and Länkar write every address out in full (2026-11-19).
      case "access": return json({ ...boardsAccess(caller), origin: appOrigin() });
      case "list": return json(await listBoards(caller));
      case "board": return json(await getBoard(caller, param("id")));
      case "feed": return json(await boardFeedInApp(caller, param("id"), url.searchParams.get("draft") === "1" ? "draft" : "published"));
      case "publish": return json(await publishPreview(caller, param("id")));
      case "tables": return json(await listTables(caller));
      case "table": return json(await getTable(caller, param("id")));
      case "screens": return json(await listScreens(caller));
      case "pairing": return json(await pairingInfo(caller, (url.searchParams.get("code") ?? "").slice(0, 20), request.headers));
      case "links": return json({ ...(await listLinks(caller)), defaultUntil: defaultLinkUntil() });
      case "playlists": return json(await listPlaylists(caller));
      case "sources": return json(await boardSources(caller, url.searchParams.get("kind"), url.searchParams.get("id")));
      default: return NextResponse.json({ error: "Okänd begäran." }, { status: 400 });
    }
  } catch (error) {
    return failure(error);
  }
}

const revision = z.number().int().min(1);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_board"), board: z.unknown() }),
  z.object({ action: z.literal("save_board"), id, revision, board: z.unknown() }),
  z.object({ action: z.literal("delete_board"), id }),
  z.object({ action: z.literal("publish_board"), id, revision, publish: z.unknown() }),
  z.object({ action: z.literal("create_table"), table: z.unknown() }),
  z.object({ action: z.literal("save_table"), id, revision, table: z.unknown() }),
  z.object({ action: z.literal("delete_table"), id }),
  z.object({ action: z.literal("approve_screen"), screen: z.unknown() }),
  z.object({ action: z.literal("update_screen"), id, screen: z.unknown() }),
  z.object({ action: z.literal("screen_command"), id, command: z.string().max(20) }),
  z.object({ action: z.literal("revoke_screen"), id }),
  z.object({ action: z.literal("delete_screen"), id }),
  z.object({ action: z.literal("create_link"), link: z.unknown() }),
  z.object({ action: z.literal("renew_link"), id }),
  z.object({ action: z.literal("revoke_link"), id }),
  z.object({ action: z.literal("link_code"), id, code: z.string().max(20).nullable() }),
  z.object({ action: z.literal("delete_link"), id }),
  z.object({ action: z.literal("create_playlist"), playlist: z.unknown() }),
  z.object({ action: z.literal("save_playlist"), id, playlist: z.unknown() }),
  z.object({ action: z.literal("delete_playlist"), id }),
]);

/** A link's address with its secret in the #-part and the QR code of it – shown once, never stored. */
const linkAnswer = async (made: { id: string; secret: string }) => {
  const address = linkAddress(appOrigin(), made.secret);
  return { id: made.id, address, qr: await qrSvg(address) };
};

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "boards");
    const caller = boardsCallerOf(ctx);
    const input = requestSchema.parse(await body(request));
    const json = (value: unknown) => NextResponse.json(value);
    switch (input.action) {
      case "create_board": return json(await createBoard(caller, input.board));
      case "save_board": return json(await saveBoard(caller, input.id, input.revision, input.board));
      case "delete_board": return json(await deleteBoard(caller, input.id));
      case "publish_board": return json(await publishBoard(caller, input.id, input.revision, input.publish));
      case "create_table": return json(await createTable(caller, input.table));
      case "save_table": return json(await saveTable(caller, input.id, input.revision, input.table));
      case "delete_table": return json(await deleteTable(caller, input.id));
      case "approve_screen": await requireFreshAuth(ctx.user.id, ctx.auth); return json(await approvePairing(caller, input.screen));
      case "update_screen": return json(await updateScreen(caller, input.id, input.screen));
      case "screen_command": return json(await commandScreen(caller, input.id, input.command));
      case "revoke_screen": return json(await revokeScreen(caller, input.id));
      case "delete_screen": return json(await deleteScreen(caller, input.id));
      case "create_link": await requireFreshAuth(ctx.user.id, ctx.auth); return json(await linkAnswer(await createLink(caller, input.link)));
      case "renew_link": await requireFreshAuth(ctx.user.id, ctx.auth); return json(await linkAnswer(await renewLink(caller, input.id)));
      case "revoke_link": return json(await revokeLink(caller, input.id));
      case "link_code": return json(await setLinkCode(caller, input.id, input.code));
      case "delete_link": return json(await deleteLink(caller, input.id));
      case "create_playlist": return json(await createPlaylist(caller, input.playlist));
      case "save_playlist": return json(await savePlaylist(caller, input.id, input.playlist));
      case "delete_playlist": return json(await deletePlaylist(caller, input.id));
    }
  } catch (error) {
    return failure(error);
  }
}

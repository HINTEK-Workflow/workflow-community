import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { failure } from "@/lib/kfid/server";
import { SCREEN_COOKIE } from "@/lib/boards/guard";
import { screenFeed } from "@/lib/boards/screens-server";
import { noStore } from "@/lib/boards/viewer-http";

export const dynamic = "force-dynamic";

/**
 * What a connected screen shows (Tavlor etapp 2): the published boards it was given, counted as their publisher, and a one-time order
 * from Skärmar. Read only; the screen key is checked on every fetch, so a block takes effect at the next one.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const info = { width: Number(url.searchParams.get("w")) || undefined, height: Number(url.searchParams.get("h")) || undefined, version: url.searchParams.get("v")?.slice(0, 30) || undefined };
    return NextResponse.json(await screenFeed((await cookies()).get(SCREEN_COOKIE)?.value, info, request.headers), { headers: noStore });
  } catch (error) { return failure(error); }
}

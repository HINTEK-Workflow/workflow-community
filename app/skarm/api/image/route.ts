import { cookies } from "next/headers";
import { failure } from "@/lib/kfid/server";
import { SCREEN_COOKIE } from "@/lib/boards/guard";
import { screenImageLayouts } from "@/lib/boards/screens-server";
import { imageAnswer } from "@/lib/boards/viewer-http";

export const dynamic = "force-dynamic";

/** A picture on a board the screen shows: only a picture on the published version it was given. */
export async function GET(request: Request) {
  try {
    const { organizationId, layouts } = await screenImageLayouts((await cookies()).get(SCREEN_COOKIE)?.value);
    return await imageAnswer(organizationId, layouts, new URL(request.url).searchParams.get("id"));
  } catch (error) { return failure(error); }
}

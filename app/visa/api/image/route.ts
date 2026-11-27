import { cookies } from "next/headers";
import { failure } from "@/lib/kfid/server";
import { LINK_COOKIE } from "@/lib/boards/guard";
import { linkImageLayouts } from "@/lib/boards/links-server";
import { imageAnswer } from "@/lib/boards/viewer-http";

export const dynamic = "force-dynamic";

/** A picture on a board the link shows: only a picture on the published version it points at. */
export async function GET(request: Request) {
  try {
    const { organizationId, layouts } = await linkImageLayouts((await cookies()).get(LINK_COOKIE)?.value);
    return await imageAnswer(organizationId, layouts, new URL(request.url).searchParams.get("id"));
  } catch (error) { return failure(error); }
}

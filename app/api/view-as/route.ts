import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { env } from "@/lib/env";
import { VIEW_AS_COOKIE, VIEW_AS_MODES } from "@/lib/workflow/view-as";

// "Visa som" (2026-10-03): only the superadmin, and only a preview cookie – never a change of rights.
const input = z.object({ mode: z.enum(VIEW_AS_MODES).nullable() });

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Visa som finns bara för superadmin.");
    const { mode } = input.parse(await body(request));
    const response = NextResponse.json({ mode });
    if (mode) response.cookies.set(VIEW_AS_COOKIE, mode, { httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https:"), path: "/", maxAge: 8 * 3600 });
    else response.cookies.delete(VIEW_AS_COOKIE);
    return response;
  } catch (error) {
    return failure(error);
  }
}

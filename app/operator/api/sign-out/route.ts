import { NextResponse } from "next/server";
import { checkOrigin, failure } from "@/lib/kfid/server";
import { endOperatorSession } from "@/lib/operator/session";

export const dynamic = "force-dynamic";

/** Logga ut på operatörssidan: the session ends on the server and the cookie goes. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    await endOperatorSession(response);
    return response;
  } catch (error) {
    return failure(error);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, failure } from "@/lib/kfid/server";
import { signInWithPassword } from "@/lib/operator/sign-in";
import { deviceId, setOperatorCookies, startOperatorSession } from "@/lib/operator/session";
import { operatorPagePath } from "@/lib/operator/rules";

export const dynamic = "force-dynamic";

/** Operatörens inloggning med användarnamn och lösenord (lib/operator/sign-in.ts). The session is bound to this device. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = z.object({ page: z.string().min(1).max(60), username: z.string().max(200), password: z.string().max(400) }).strict().parse(await body(request));
    const signedIn = await signInWithPassword({ pageKey: input.page, username: input.username, password: input.password, headers: request.headers });
    const device = await deviceId();
    const token = await startOperatorSession({ accountId: signedIn.accountId, organizationId: signedIn.organizationId, device: device.id, method: "password", headers: request.headers });
    const response = NextResponse.json({ ok: true, path: operatorPagePath(signedIn.pageKey) }, { headers: { "Cache-Control": "no-store" } });
    setOperatorCookies(response, { token, device });
    return response;
  } catch (error) {
    return failure(error);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptInvitationWithToken } from "@/lib/auth/invitations";
import { body, checkOrigin, failure } from "@/lib/kfid/server";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = z
      .object({
        token: z.string().min(32).max(256),
        password: z.string().min(12).max(200),
      })
      .parse(await body(request));
    const result = await acceptInvitationWithToken(
      input.token,
      input.password,
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return failure(error);
  }
}

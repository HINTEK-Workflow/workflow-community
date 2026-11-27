import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptInvitationWithToken } from "@/lib/auth/invitations";
import { COMMON_PASSWORD_REFUSAL, isCommonPassword } from "@/lib/auth/common-password";
import { ApiError, body, checkOrigin, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (!(await hitRateLimit(RATE_RULES.invitation, clientIp(request.headers))).allowed) throw new ApiError(429, "För många försök. Vänta en stund och försök igen.");
    const input = z
      .object({
        token: z.string().min(32).max(256),
        password: z.string().min(12).max(200).refine((value) => !isCommonPassword(value), COMMON_PASSWORD_REFUSAL),
        newsletter: z.boolean().optional(),
      })
      .parse(await body(request));
    const result = await acceptInvitationWithToken(
      input.token,
      input.password,
      { newsletter: input.newsletter },
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return failure(error);
  }
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { env } from "@/lib/env";
import { getCurrentAuth } from "@/lib/auth/session";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { cleanPasskeyName, defaultPasskeyName, PASSKEY_CHALLENGE_SECONDS, PASSKEY_COOKIE, PASSKEY_NAME_MAX } from "@/lib/auth/passkey-core";
import {
  finishPasskeyRegistration,
  listPasskeys,
  passkeyAuthenticationOptions,
  passkeyRegistrationOptions,
  PasskeyError,
  removePasskey,
  renamePasskey,
} from "@/lib/auth/passkeys";
import { parsePasskeyResponse } from "@/lib/auth/passkey-core";
import { ApiError, body, checkOrigin, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { clientIp, UNKNOWN_CLIENT_IP } from "@/lib/security/client-ip";
import { recordSecurityEvent } from "@/lib/security/security-log";

export const dynamic = "force-dynamic";

/**
 * Passkeys (2026-10-11). Signed out: `login_options` starts a sign-in (the browser shows its own passkey choice; the
 * answer goes to NextAuth's "passkey" provider). Signed in, only for the person's own account and outside context()
 * like /api/security: list, add (after a fresh confirmation), rename and remove (never the last way to sign in), and
 * `reauth_options` for confirming it is you with a passkey.
 */
const noStore = { "Cache-Control": "private, no-store" };

async function signedIn() {
  const auth = await getCurrentAuth();
  if (!auth) throw new ApiError(401, "Logga in för att fortsätta.");
  return auth;
}

function withChallenge(payload: unknown, challengeId: string) {
  const response = NextResponse.json(payload, { headers: noStore });
  response.cookies.set(PASSKEY_COOKIE, challengeId, { httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https://"), path: "/", maxAge: PASSKEY_CHALLENGE_SECONDS });
  return response;
}

/** A ceremony's start stores a challenge; capped per IP address so the table cannot be flooded. */
async function startAllowed(request: Request) {
  const ip = clientIp(request.headers);
  if (ip !== UNKNOWN_CLIENT_IP && !(await hitRateLimit(RATE_RULES.passkeyStart, ip)).allowed) throw new ApiError(429, "För många försök. Vänta en kvart och försök igen.");
}

export async function GET() {
  try {
    const auth = await signedIn();
    return NextResponse.json({ passkeys: await listPasskeys(auth.user.id) }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const id = z.string().min(1).max(60);
const name = z.string().max(PASSKEY_NAME_MAX * 2);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login_options") }),
  z.object({ action: z.literal("register_options") }),
  z.object({ action: z.literal("register"), response: z.string().max(40_000), name }),
  z.object({ action: z.literal("rename"), id, name }),
  z.object({ action: z.literal("remove"), id }),
  z.object({ action: z.literal("reauth_options") }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const command = input.parse(await body(request));

    if (command.action === "login_options") {
      await startAllowed(request);
      const { options, challengeId } = await passkeyAuthenticationOptions("login");
      return withChallenge({ options }, challengeId);
    }

    const auth = await signedIn();
    const { user } = auth;
    if (command.action === "register_options") {
      // A new way to sign in needs a fresh confirmation, like linking Google (2026-10-10).
      await requireFreshAuth(user.id, auth);
      await startAllowed(request);
      const { options, challengeId } = await passkeyRegistrationOptions(user);
      return withChallenge({ options }, challengeId);
    }
    if (command.action === "register") {
      await requireFreshAuth(user.id, auth);
      const response = parsePasskeyResponse<RegistrationResponseJSON>(command.response);
      if (!response) throw new ApiError(400, "Passkeyn kunde inte läsas. Försök igen.");
      const jar = await cookies();
      const challengeId = jar.get(PASSKEY_COOKIE)?.value;
      jar.delete(PASSKEY_COOKIE);
      await finishPasskeyRegistration(user.id, challengeId, response, cleanPasskeyName(command.name) || defaultPasskeyName(request.headers.get("user-agent")));
      await recordSecurityEvent({ type: "passkey_added", userId: user.id, actorId: user.id, headers: request.headers });
      return NextResponse.json({ passkeys: await listPasskeys(user.id) }, { headers: noStore });
    }
    if (command.action === "rename") {
      await renamePasskey(user.id, command.id, command.name);
      return NextResponse.json({ passkeys: await listPasskeys(user.id) }, { headers: noStore });
    }
    if (command.action === "remove") {
      await requireFreshAuth(user.id, auth);
      await removePasskey(user.id, command.id);
      await recordSecurityEvent({ type: "passkey_removed", userId: user.id, actorId: user.id, headers: request.headers });
      return NextResponse.json({ passkeys: await listPasskeys(user.id) }, { headers: noStore });
    }
    await startAllowed(request);
    const { options, challengeId } = await passkeyAuthenticationOptions("reauth", user.id);
    return withChallenge({ options }, challengeId);
  } catch (error) {
    if (error instanceof PasskeyError) return failure(new ApiError(409, error.message));
    return failure(error);
  }
}

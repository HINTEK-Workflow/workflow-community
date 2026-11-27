import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { PASSKEY_COOKIE } from "@/lib/auth/passkey-core";
import { verifyPasskeyAssertion } from "@/lib/auth/passkeys";
import { parsePasskeyResponse } from "@/lib/auth/passkey-core";
import { prisma } from "@/lib/db";
import { getCurrentAuth } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { freshlyAuthenticated } from "@/lib/auth/session-rules";
import { listSessions, markReauthenticated, revokeAllSessions, revokeSession, sessionReauthAt } from "@/lib/auth/sessions";
import { confirmTotpSetup, disableTotp, renewBackupCodes, startTotpSetup, twoFactorRequired, twoFactorStatus, verifySecondFactor } from "@/lib/auth/two-factor";
import { ApiError, body, checkOrigin, failure } from "@/lib/kfid/server";
import { assertMayTryApi } from "@/lib/auth/sign-in-limit";
import { clearRateLimit, hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { personalSecurityLog, recordSecurityEvent } from "@/lib/security/security-log";

export const dynamic = "force-dynamic";

/**
 * Mina inställningar → Säkerhet (2026-10-10): the person's own two-factor sign-in, active sessions and security log.
 * Only ever the signed-in person's own account; deliberately outside context(), so a company's two-factor requirement
 * can be met here.
 */
async function signedIn() {
  const auth = await getCurrentAuth();
  if (!auth) throw new ApiError(401, "Logga in för att fortsätta.");
  return auth;
}

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: Request) {
  try {
    const auth = await signedIn();
    const cursor = new URL(request.url).searchParams.get("before");
    if (cursor) return NextResponse.json({ log: await personalSecurityLog(auth.user.id, cursor) }, noStore);
    const [twoFactor, required, sessions, log, reauthAt, google] = await Promise.all([
      twoFactorStatus(auth.user.id),
      twoFactorRequired(auth.user),
      listSessions(auth.user.id, auth.sessionId),
      personalSecurityLog(auth.user.id),
      sessionReauthAt(auth.sessionId, auth.user.id),
      prisma.authAccount.count({ where: { userId: auth.user.id, provider: "google" } }),
    ]);
    return NextResponse.json({
      twoFactor, required, method: auth.method, sessions, log, google: google > 0,
      fresh: freshlyAuthenticated(auth.authAt, reauthAt), sessionTracked: Boolean(auth.sessionId),
    }, noStore);
  } catch (error) {
    return failure(error);
  }
}

const code = z.string().trim().min(6, "Skriv koden.").max(20);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reauth"), password: z.string().max(200).optional(), code: z.string().trim().max(20).optional(), passkey: z.string().max(40_000).optional() }),
  z.object({ action: z.literal("totp_start") }),
  z.object({ action: z.literal("totp_confirm"), code }),
  z.object({ action: z.literal("backup_renew") }),
  z.object({ action: z.literal("totp_disable"), password: z.string().max(200).optional(), code }),
  z.object({ action: z.literal("session_revoke"), id: z.string().min(1).max(60) }),
  z.object({ action: z.literal("sessions_revoke_all") }),
]);

/** A wrong code counts in the two-factor window; a right one clears it. */
async function checkCode<T>(userId: string, check: () => Promise<T | null>) {
  await assertMayTryApi(RATE_RULES.twoFactor, userId, "För många felaktiga koder. Vänta en kvart och försök igen.");
  const result = await check();
  if (!result) {
    await hitRateLimit(RATE_RULES.twoFactor, userId);
    throw new ApiError(400, "Koden stämmer inte. Kontrollera att klockan i telefonen går rätt och skriv den senaste koden.");
  }
  await clearRateLimit(RATE_RULES.twoFactor, userId);
  return result;
}

async function checkPassword(user: { id: string; email: string }, password: string | undefined) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row.passwordHash) return false;
  await assertMayTryApi(RATE_RULES.loginAccount, user.email);
  if (!password || !(await verifyPassword(password, row.passwordHash))) {
    await hitRateLimit(RATE_RULES.loginAccount, user.email);
    throw new ApiError(400, "Lösenordet stämmer inte.");
  }
  return true;
}

/** Bekräfta med passkey (2026-10-11): one of the person's own passkeys, on the challenge from reauth_options. */
async function checkPasskey(user: { id: string; email: string }, raw: string, headers: Headers) {
  await assertMayTryApi(RATE_RULES.loginAccount, user.email);
  const response = parsePasskeyResponse<AuthenticationResponseJSON>(raw);
  const jar = await cookies();
  const challengeId = jar.get(PASSKEY_COOKIE)?.value;
  jar.delete(PASSKEY_COOKIE);
  const result = response ? await verifyPasskeyAssertion(challengeId, "reauth", response, user.id) : null;
  if (result?.ok) return;
  if (result?.reason === "challenge") throw new ApiError(400, "Det tog för lång tid. Försök igen.");
  await hitRateLimit(RATE_RULES.loginAccount, user.email);
  if (result?.reason === "invalid") await recordSecurityEvent({ type: "login_failed", userId: user.id, detail: "Passkey", headers });
  throw new ApiError(400, "Passkeyn kunde inte bekräfta att det är du. Välj en av dina egna passkeys.");
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const auth = await signedIn();
    const { user } = auth;
    const command = input.parse(await body(request));
    const headers = request.headers;

    if (command.action === "reauth") {
      // Bekräfta att det är du: the password, or a code from the app (or a backup code), within this session.
      const status = await twoFactorStatus(user.id);
      if (command.passkey) await checkPasskey(user, command.passkey, headers);
      else if (command.password) await checkPassword(user, command.password);
      else if (command.code && status.enabled) await checkCode(user.id, () => verifySecondFactor(user.id, command.code!));
      else if (!status.hasPassword && !status.enabled) throw new ApiError(409, "Logga in igen med Google eller Microsoft, eller använd en passkey, för att bekräfta att det är du.");
      else throw new ApiError(400, status.enabled ? "Skriv ditt lösenord eller en kod." : "Skriv ditt lösenord.");
      if (!(await markReauthenticated(auth.sessionId, user.id))) throw new ApiError(409, "Logga ut och in igen för att bekräfta att det är du.");
      return NextResponse.json({ ok: true });
    }

    if (command.action === "totp_start") {
      await requireFreshAuth(user.id, auth);
      return NextResponse.json(await startTotpSetup(user.id, user.email), { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "totp_confirm") {
      await requireFreshAuth(user.id, auth);
      const codes = await checkCode(user.id, () => confirmTotpSetup(user.id, command.code));
      await recordSecurityEvent({ type: "two_factor_on", userId: user.id, actorId: user.id, headers });
      return NextResponse.json({ codes }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "backup_renew") {
      await requireFreshAuth(user.id, auth);
      if (!(await twoFactorStatus(user.id)).enabled) throw new ApiError(409, "Slå på tvåstegsverifiering först.");
      const codes = await renewBackupCodes(user.id);
      await recordSecurityEvent({ type: "backup_codes_renewed", userId: user.id, actorId: user.id, headers });
      return NextResponse.json({ codes }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "totp_disable") {
      // Stäng av: the password (when the account has one) and a code, both now – never on an old confirmation alone.
      const status = await twoFactorStatus(user.id);
      if (!status.enabled) return NextResponse.json({ ok: true });
      if (await twoFactorRequired(user)) throw new ApiError(409, "Tvåstegsverifiering krävs för ditt konto och kan inte stängas av. Byter du telefon väljer du Byt app i stället.");
      if (status.hasPassword) await checkPassword(user, command.password);
      await checkCode(user.id, () => verifySecondFactor(user.id, command.code));
      await disableTotp(user.id);
      await recordSecurityEvent({ type: "two_factor_off", userId: user.id, actorId: user.id, headers });
      return NextResponse.json({ ok: true });
    }
    if (command.action === "session_revoke") {
      if (!(await revokeSession(user.id, command.id, headers))) throw new ApiError(404, "Inloggningen finns inte eller är redan avslutad.");
      return NextResponse.json({ ok: true, current: command.id === auth.sessionId });
    }
    await revokeAllSessions(user.id, { actorId: user.id, headers });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

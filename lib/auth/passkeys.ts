import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { publicInstance } from "@/lib/instance";
import {
  challengeUsable,
  cleanPasskeyName,
  LAST_SIGN_IN_WAY,
  MAX_PASSKEYS_PER_PERSON,
  PASSKEY_ALGORITHMS,
  mayRemoveSignInWay,
  PASSKEY_CHALLENGE_SECONDS,
  relyingParty,
  type PasskeyPurpose,
} from "@/lib/auth/passkey-core";

export { PASSKEY_COOKIE, PASSKEY_CHALLENGE_SECONDS } from "@/lib/auth/passkey-core";

/**
 * Passkeys (2026-10-09, built 2026-10-11): sign in with Face ID, fingerprint, Windows Hello or a security key
 * instead of a password, through WebAuthn (@simplewebauthn/server, MIT). A signed-in person adds them under Mina
 * inställningar → Säkerhet after a fresh confirmation; the login page offers "Logga in med passkey" and the browser's
 * autofill. Only the public key is stored. Every ceremony has its own random challenge in WebAuthnChallenge, used at
 * most once and within five minutes; the browser that started it carries its id in an httpOnly cookie.
 *
 * User verification (fingerprint, face or PIN) is required both when a passkey is made and every time it is used, so a
 * passkey sign-in is two steps by itself: something the person has and something they are or know.
 */
const rp = () => relyingParty(env.APP_URL, process.env.NEXTAUTH_URL);

export class PasskeyError extends Error {}

/** A new single-use challenge; expired rows are swept at the same time so the table stays small. */
async function issueChallenge(purpose: PasskeyPurpose, userId: string | null, challenge: string, now = new Date()) {
  const id = randomBytes(24).toString("base64url");
  await prisma.$transaction([
    prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.webAuthnChallenge.create({ data: { id, purpose, userId, challenge, expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_SECONDS * 1000) } }),
  ]);
  return id;
}

/**
 * Takes the challenge out: returned once for the right purpose and person, then gone. A row for another purpose or
 * person is also removed, so a challenge never gets a second try.
 */
export async function consumeChallenge(id: string | undefined | null, purpose: PasskeyPurpose, userId: string | null, now = Date.now()) {
  if (!id || id.length > 100) return null;
  const row = await prisma.webAuthnChallenge.findUnique({ where: { id } });
  if (!row) return null;
  const { count } = await prisma.webAuthnChallenge.deleteMany({ where: { id } });
  if (!count || !challengeUsable(row, purpose, userId, now)) return null;
  return row.challenge;
}

// The user handle the authenticator stores with the passkey: random per person is not needed, but it must not be the
// e-mail address. The account id is opaque and stable, so the same device replaces rather than duplicates a passkey.
const userHandle = (userId: string) => new TextEncoder().encode(userId);

/** Options for navigator.credentials.create(): a discoverable credential with user verification, never a duplicate. */
export async function passkeyRegistrationOptions(user: { id: string; email: string; name: string | null }) {
  const existing = await prisma.userPasskey.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } });
  if (existing.length >= MAX_PASSKEYS_PER_PERSON) throw new PasskeyError(`Du har redan ${MAX_PASSKEYS_PER_PERSON} passkeys. Ta bort en du inte använder först.`);
  const { rpID } = rp();
  const options = await generateRegistrationOptions({
    rpName: publicInstance().name,
    rpID,
    userName: user.email,
    userID: userHandle(user.id),
    userDisplayName: user.name || user.email,
    attestationType: "none",
    supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
    excludeCredentials: existing.map((item) => ({ id: item.credentialId, transports: item.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    timeout: 120_000,
  });
  const challengeId = await issueChallenge("register", user.id, options.challenge);
  return { options, challengeId };
}

/** Checks the browser's answer and stores the new passkey under the person. */
export async function finishPasskeyRegistration(userId: string, challengeId: string | undefined, response: RegistrationResponseJSON, name: string) {
  const challenge = await consumeChallenge(challengeId, "register", userId);
  if (!challenge) throw new PasskeyError("Det tog för lång tid eller startades i en annan flik. Försök igen.");
  const { rpID, origins } = rp();
  let result;
  try {
    result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: PASSKEY_ALGORITHMS });
  } catch {
    throw new PasskeyError("Passkeyn kunde inte kontrolleras. Försök igen.");
  }
  if (!result.verified) throw new PasskeyError("Passkeyn kunde inte kontrolleras. Försök igen.");
  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  if (await prisma.userPasskey.findUnique({ where: { credentialId: credential.id }, select: { id: true } }))
    throw new PasskeyError("Den här passkeyn är redan tillagd.");
  if ((await prisma.userPasskey.count({ where: { userId } })) >= MAX_PASSKEYS_PER_PERSON)
    throw new PasskeyError(`Du har redan ${MAX_PASSKEYS_PER_PERSON} passkeys. Ta bort en du inte använder först.`);
  const row = await prisma.userPasskey.create({
    data: {
      userId, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: BigInt(credential.counter),
      transports: (credential.transports ?? []).slice(0, 8).map(String), deviceType: credentialDeviceType, backedUp: credentialBackedUp,
      name: cleanPasskeyName(name) || "Passkey",
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Options for navigator.credentials.get(). At login the browser offers every passkey it has for this site (nothing is
 * told about which accounts exist); to confirm it is you, only the person's own passkeys are allowed.
 */
export async function passkeyAuthenticationOptions(purpose: "login" | "reauth", userId: string | null = null) {
  let allowCredentials: { id: string; transports?: string[] }[] | undefined;
  if (purpose === "reauth") {
    if (!userId) throw new PasskeyError("Logga in för att fortsätta.");
    const own = await prisma.userPasskey.findMany({ where: { userId }, select: { credentialId: true, transports: true } });
    if (!own.length) throw new PasskeyError("Du har ingen passkey. Bekräfta med lösenord eller kod.");
    allowCredentials = own.map((item) => ({ id: item.credentialId, transports: item.transports }));
  }
  const options = await generateAuthenticationOptions({ rpID: rp().rpID, userVerification: "required", allowCredentials, timeout: 120_000 });
  const challengeId = await issueChallenge(purpose, purpose === "reauth" ? userId : null, options.challenge);
  return { options, challengeId };
}

export type PasskeyAssertion =
  | { ok: true; userId: string; email: string; passkeyId: string }
  | { ok: false; reason: "challenge" | "unknown" | "invalid"; userId?: string; email?: string };

/**
 * Checks a signed answer: the challenge (once), the passkey by its id, the signature with user verification, and the
 * counter (it may not go backwards; it is claimed atomically, so two sign-ins with one answer cannot both pass).
 * For reauth the passkey must be the person's own.
 */
export async function verifyPasskeyAssertion(challengeId: string | undefined, purpose: "login" | "reauth", response: AuthenticationResponseJSON, userId: string | null = null): Promise<PasskeyAssertion> {
  const challenge = await consumeChallenge(challengeId, purpose, purpose === "reauth" ? userId : null);
  if (!challenge) return { ok: false, reason: "challenge" };
  const credentialId = typeof response?.id === "string" ? response.id.slice(0, 1400) : "";
  const passkey = credentialId ? await prisma.userPasskey.findUnique({ where: { credentialId }, select: { id: true, userId: true, publicKey: true, counter: true, transports: true, user: { select: { email: true } } } }) : null;
  if (!passkey || (purpose === "reauth" && passkey.userId !== userId)) return { ok: false, reason: "unknown" };
  const { rpID, origins } = rp();
  const who = { userId: passkey.userId, email: passkey.user.email };
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: Number(passkey.counter), transports: passkey.transports },
    });
  } catch {
    return { ok: false, reason: "invalid", ...who };
  }
  if (!result.verified || !result.authenticationInfo.userVerified) return { ok: false, reason: "invalid", ...who };
  const { count } = await prisma.userPasskey.updateMany({
    where: { id: passkey.id, counter: passkey.counter },
    data: { counter: BigInt(result.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });
  if (!count) return { ok: false, reason: "invalid", ...who };
  return { ok: true, passkeyId: passkey.id, ...who };
}

/** Mina inställningar → Säkerhet: the person's passkeys, newest first. Never the key material. */
export async function listPasskeys(userId: string) {
  const rows = await prisma.userPasskey.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_PASSKEYS_PER_PERSON, select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true } });
  return rows.map((row) => ({ id: row.id, name: row.name, synced: row.deviceType === "multiDevice" || row.backedUp, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null }));
}

export async function renamePasskey(userId: string, id: string, name: string) {
  const clean = cleanPasskeyName(name);
  if (!clean) throw new PasskeyError("Skriv ett namn.");
  const { count } = await prisma.userPasskey.updateMany({ where: { id, userId }, data: { name: clean } });
  if (!count) throw new PasskeyError("Passkeyn finns inte.");
}

/** The person's ways to sign in, for "the last way can never be removed". */
export async function signInWays(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, _count: { select: { authAccounts: true, passkeys: true } } } });
  return { hasPassword: Boolean(user.passwordHash), linkedAccounts: user._count.authAccounts, passkeys: user._count.passkeys };
}

/** Removes one of the person's own passkeys – never the last way to sign in. */
export async function removePasskey(userId: string, id: string) {
  const owned = await prisma.userPasskey.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new PasskeyError("Passkeyn finns inte.");
  if (!mayRemoveSignInWay(await signInWays(userId))) throw new PasskeyError(LAST_SIGN_IN_WAY);
  await prisma.userPasskey.deleteMany({ where: { id, userId } });
}

import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { publicInstance } from "@/lib/instance";
import { keyRing, openValue, ringHashSecrets, sealValue } from "@/lib/security/key-ring";
import { groupedSecret, looksLikeTotp, newTotpSecret, totpUri, verifyTotp } from "@/lib/security/totp";
import { BACKUP_CODE_COUNT, hashBackupCode, looksLikeBackupCode, newBackupCodes } from "@/lib/security/backup-codes";

/**
 * Tvåstegsverifiering (2026-10-10): TOTP as an optional second step after the password, per person. The secret is
 * sealed at rest with the installation's key (AES-256-GCM, the same sealing as the keys under Servernycklar); the
 * ten backup codes are kept only as keyed hashes. Since the security review 2026-11-24 (G-09) a Google or Microsoft
 * sign-in asks for the code too when it is on (lib/auth/oauth-code-step.ts).
 */
// Since 2026-10-25 sealed with the key ring (lib/security/sealing.ts), bound to the person; the older sealing still opens.
const seal = (userId: string, value: string) => sealValue("totp", value, userId);
const open = (userId: string, sealed: string | null | undefined) => openValue("totp", sealed, userId, "totp");
/** A backup code's hash under every secret in the ring (the newest first): codes made before a rotation still work. */
const backupHashes = (userId: string, code: string) => ringHashSecrets().map((secret) => hashBackupCode(userId, code, secret));

/** The server-side error a sign-in gets while a code is needed, and when the code was wrong. */
export const TOTP_REQUIRED = "TOTP_REQUIRED";
export const TOTP_INVALID = "TOTP_INVALID";

export async function twoFactorStatus(userId: string) {
  const [user, left] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true, totpSecret: true, passwordHash: true } }),
    prisma.userBackupCode.count({ where: { userId, usedAt: null } }),
  ]);
  return { enabled: Boolean(user.totpSecret && user.totpEnabledAt), enabledAt: user.totpEnabledAt?.toISOString() ?? null, backupCodesLeft: left, hasPassword: Boolean(user.passwordHash) };
}

export const twoFactorEnabled = (user: { totpSecret: string | null; totpEnabledAt: Date | null }) => Boolean(user.totpSecret && user.totpEnabledAt);

/** Step 1: a new secret, kept aside (sealed) until a code from the app confirms it. */
export async function startTotpSetup(userId: string, account: string) {
  const value = newTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: seal(userId, value) } });
  const uri = totpUri(value, account, publicInstance().name);
  // Drawn at 240 px in the setup box (2026-11-25); made larger, so it stays sharp on a high-resolution screen. Black on white with
  // its own light margin (2026-11-26), whatever the theme: the box's white padding (.qr-surface) adds to it, so the quiet zone is
  // about four modules and the code scans in Dark too.
  return { secret: groupedSecret(value), qr: await QRCode.toDataURL(uri, { margin: 2, width: 480, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }) };
}

async function replaceBackupCodes(userId: string) {
  const codes = newBackupCodes();
  await prisma.$transaction([
    prisma.userBackupCode.deleteMany({ where: { userId } }),
    prisma.userBackupCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashBackupCode(userId, code, keyRing().current) })) }),
  ]);
  return codes;
}

/** Step 2: the code from the app turns two-factor on; the ten backup codes are returned once. */
export async function confirmTotpSetup(userId: string, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpPendingSecret: true } });
  const pending = open(userId, user.totpPendingSecret);
  if (!pending) return null;
  const step = verifyTotp(pending, code);
  if (step === null) return null;
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: seal(userId, pending), totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step } });
  return replaceBackupCodes(userId);
}

export async function renewBackupCodes(userId: string) {
  return replaceBackupCodes(userId);
}

export async function disableTotp(userId: string) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null } }),
    prisma.userBackupCode.deleteMany({ where: { userId } }),
  ]);
}

/**
 * Checks a second factor: a TOTP code (never the same step twice – the step is claimed atomically) or an unused backup
 * code (marked used atomically). Returns how it was proven, or null.
 */
export async function verifySecondFactor(userId: string, code: string): Promise<"totp" | "backup" | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true } });
  if (!user || !twoFactorEnabled(user)) return null;
  if (looksLikeTotp(code)) {
    const value = open(userId, user.totpSecret);
    const step = value ? verifyTotp(value, code, { lastStep: user.totpLastStep }) : null;
    if (step === null) return null;
    const { count } = await prisma.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return count ? "totp" : null;
  }
  if (looksLikeBackupCode(code)) {
    const { count } = await prisma.userBackupCode.updateMany({ where: { userId, codeHash: { in: backupHashes(userId, code) }, usedAt: null }, data: { usedAt: new Date() } });
    return count ? "backup" : null;
  }
  return null;
}

export const backupCodesLeft = (userId: string) => prisma.userBackupCode.count({ where: { userId, usedAt: null } });
export { BACKUP_CODE_COUNT };

/**
 * Whether the person must use two-factor (TOTP or a passkey): always a superadmin (security review 2026-11-24, G-10 – no
 * longer a setting that starts off), and a member of any company (active membership) whose admin requires it.
 */
export async function twoFactorRequired(user: { id: string; role: string }) {
  if (user.role === "SUPERADMIN") return true;
  const memberships = await prisma.organizationMember.findMany({ where: { userId: user.id, isActive: true }, select: { organizationId: true } });
  const companies = memberships.length ? await prisma.workspaceSettings.count({ where: { requireTwoFactor: true, organizationId: { in: memberships.map((item) => item.organizationId) } } }) : 0;
  return companies > 0;
}

// Asked on every work request for people without TOTP, so the answer is kept 15 seconds per person in this process
// (the same delay as the other sign-in switches); turning a requirement on or off clears it here at once.
const requiredCache = new Map<string, { at: number; value: boolean }>();
export async function twoFactorRequiredCached(user: { id: string; role: string }, now = Date.now()) {
  const hit = requiredCache.get(user.id);
  if (hit && now - hit.at < 15_000) return hit.value;
  const value = await twoFactorRequired(user);
  if (requiredCache.size > 5000) requiredCache.clear();
  requiredCache.set(user.id, { at: now, value });
  return value;
}
export const clearTwoFactorRequiredCache = () => requiredCache.clear();

export { TWO_FACTOR_SETUP_REQUIRED } from "@/lib/auth/session-rules";

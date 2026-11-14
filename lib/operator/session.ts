import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/kfid/errors";
import { requestFingerprint } from "@/lib/security/security-log";
import { OPERATOR_BASE_PATH, OPERATOR_DEVICE_COOKIE, OPERATOR_SESSION_COOKIE, OPERATOR_SESSION_MAX_HOURS, operatorSessionNeedsTouch, operatorSessionValid } from "@/lib/operator/rules";
import { settingsView } from "@/lib/operator/settings-server";

/**
 * Operatörens inloggning (2026-10-30): its own cookie and its own session rows, apart from a person's NextAuth
 * session. The cookie holds a random token; the database only its hash. Each device has a cookie of its own (a random id,
 * also only hashed in the database) and a session is valid only on the device it started on. Ends after the company's
 * inactivity time, after OPERATOR_SESSION_MAX_HOURS, on Logga ut, and when the admin blocks the account or changes its
 * password. Only the operator routes read this; no other route ever accepts it (and proxy.ts refuses them early).
 */
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secure = () => new URL(env.APP_URL).protocol === "https:";
const DEVICE_DAYS = 400;

export type OperatorContext = {
  sessionId: string;
  organizationId: string;
  organization: { name: string; workdayStartMinutes: number; workdayEndMinutes: number; disabledModules?: readonly string[] };
  account: { id: string; username: string; displayName: string; kind: "password" | "microsoft"; shared: boolean };
  settings: ReturnType<typeof settingsView>;
};

/** The signed-in operator of this request, or null. Touches lastSeenAt now and then (the inactivity clock). */
export async function currentOperator(options: { touch?: boolean; now?: number } = {}): Promise<OperatorContext | null> {
  const now = options.now ?? Date.now();
  const jar = await cookies();
  const token = jar.get(OPERATOR_SESSION_COOKIE)?.value;
  const device = jar.get(OPERATOR_DEVICE_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const row = await prisma.operatorSession.findUnique({
    where: { tokenHash: hash(token) },
    include: {
      account: {
        select: { id: true, username: true, displayName: true, kind: true, shared: true, active: true, sessionsRevokedAt: true,
          organization: { select: { id: true, name: true, isActive: true, storageMode: true, workdayStartMinutes: true, workdayEndMinutes: true, disabledModules: true, operatorSettings: true } } },
      },
    },
  });
  const organization = row?.account.organization;
  const settings = organization?.operatorSettings;
  if (!row || !organization || !settings || !organization.isActive || organization.storageMode !== "HINTEK_CLOUD") return null;
  const valid = operatorSessionValid({ row, deviceHash: device ? hash(device) : null, inactivityMinutes: settings.inactivityMinutes, account: row.account, now });
  if (!valid) return null;
  // A poll for the on-call state (`touch: false`) is not activity: the inactivity clock runs on.
  if (options.touch !== false && operatorSessionNeedsTouch(row.lastSeenAt, now))
    await prisma.operatorSession.updateMany({ where: { id: row.id, revokedAt: null }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  return {
    sessionId: row.id, organizationId: organization.id,
    organization: { name: organization.name, workdayStartMinutes: organization.workdayStartMinutes, workdayEndMinutes: organization.workdayEndMinutes, disabledModules: organization.disabledModules },
    account: { id: row.account.id, username: row.account.username, displayName: row.account.displayName, kind: row.account.kind === "microsoft" ? "microsoft" : "password", shared: row.account.shared },
    settings: settingsView(settings),
  };
}

/** For the operator routes: the operator, or 401. */
export async function requireOperator(options: { touch?: boolean } = {}) {
  const operator = await currentOperator(options);
  if (!operator) throw new ApiError(401, "Logga in igen.");
  return operator;
}

/** The device's id: the one this browser has, or a new one (the caller sets the cookie). */
export async function deviceId() {
  const existing = (await cookies()).get(OPERATOR_DEVICE_COOKIE)?.value;
  return existing && /^[a-f0-9]{64}$/.test(existing) ? { id: existing, fresh: false } : { id: randomBytes(32).toString("hex"), fresh: true };
}

/** A new session row for the account on this device; returns the raw token for the cookie. */
export async function startOperatorSession(input: { accountId: string; organizationId: string; device: string; method: "password" | "microsoft"; headers?: Headers | null }) {
  const token = randomBytes(32).toString("hex");
  const fingerprint = requestFingerprint(input.headers ?? null);
  await prisma.operatorSession.create({ data: { tokenHash: hash(token), accountId: input.accountId, organizationId: input.organizationId, deviceHash: hash(input.device), method: input.method, client: fingerprint.client } });
  await prisma.operatorAccount.updateMany({ where: { id: input.accountId, organizationId: input.organizationId }, data: { lastLoginAt: new Date() } });
  return token;
}

/** The two cookies on the answer: the session (ends with the browser's max age) and, when new, the device's id. */
export function setOperatorCookies(response: NextResponse, input: { token: string; device: { id: string; fresh: boolean } }) {
  // Path /operator: the browser sends them only to the operator page and its endpoints, never to /api (lib/operator/guard.ts).
  const common = { httpOnly: true, secure: secure(), sameSite: "lax" as const, path: OPERATOR_BASE_PATH };
  response.cookies.set(OPERATOR_SESSION_COOKIE, input.token, { ...common, maxAge: OPERATOR_SESSION_MAX_HOURS * 3600 });
  if (input.device.fresh) response.cookies.set(OPERATOR_DEVICE_COOKIE, input.device.id, { ...common, maxAge: DEVICE_DAYS * 24 * 3600 });
}

/** Logga ut: the row ends and the cookie goes (the device's id stays, it is not a sign-in). */
export async function endOperatorSession(response: NextResponse) {
  const token = (await cookies()).get(OPERATOR_SESSION_COOKIE)?.value;
  if (token) await prisma.operatorSession.updateMany({ where: { tokenHash: hash(token), revokedAt: null }, data: { revokedAt: new Date() } });
  response.cookies.set(OPERATOR_SESSION_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "lax", path: OPERATOR_BASE_PATH, maxAge: 0 });
}

/** Every session of an account ends (Spärra, a new password, Ta bort). */
export async function revokeOperatorSessions(organizationId: string, accountId: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.operatorSession.updateMany({ where: { accountId, organizationId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.operatorAccount.updateMany({ where: { id: accountId, organizationId }, data: { sessionsRevokedAt: now } }),
  ]);
}

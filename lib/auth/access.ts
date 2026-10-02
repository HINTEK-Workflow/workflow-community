import { instanceAdminEmail } from "@/lib/instance-server";

// Temporary private test: only the installation's owner account (INSTANCE_ADMIN_EMAIL) may sign in.
// Change deliberately when opening registration.
export const QA_ROLE_EMAILS = {
  owner: "qa-owner@role-test.invalid",
  worker: "qa-worker@role-test.invalid",
  // Approved by 2026-09-26 (form editor, decision 7): a synthetic superadmin for automatic tests of the
  // superadmin views, with exactly the same loopback, kfid_v3_test and isolated-storage limits as the other two.
  superadmin: "qa-superadmin@role-test.invalid",
} as const;
export type QaRole = keyof typeof QA_ROLE_EMAILS;
/**
 * The full-day simulation (approved by 2026-10-02: "Fler testidentiteter, kör detta lokalt – JA"): a synthetic
 * company with a boss and five employees, used by scripts/qa/day-simulation. Exactly the same limits as the other
 * synthetic identities: loopback only, kfid_v3_test only, isolated test storage, no mail.
 */
export const QA_SIMULATION_EMAILS = {
  "sim-chef": "sim-chef@role-test.invalid",
  "sim-1": "sim-anstalld-1@role-test.invalid",
  "sim-2": "sim-anstalld-2@role-test.invalid",
  "sim-3": "sim-anstalld-3@role-test.invalid",
  "sim-4": "sim-anstalld-4@role-test.invalid",
  "sim-5": "sim-anstalld-5@role-test.invalid",
} as const;
export type QaSimulationIdentity = keyof typeof QA_SIMULATION_EMAILS;
export const isQaSimulationIdentity = (value: unknown): value is QaSimulationIdentity => typeof value === "string" && value in QA_SIMULATION_EMAILS;
const QA_EMAILS = new Set<string>([...Object.values(QA_ROLE_EMAILS), ...Object.values(QA_SIMULATION_EMAILS)]);
export const isQaRole = (role: string | undefined): role is QaRole => role === "owner" || role === "worker" || role === "superadmin";

// Never allow synthetic logins outside a loopback app using the dedicated QA DB.
export function localRoleQaEnabled(): boolean {
  if (process.env.KFID_LOCAL_ROLE_QA !== "true") return false;
  if (process.env.INVITATION_DELIVERY_ENABLED === "true") return false;
  try {
    const app = new URL(process.env.APP_URL ?? "");
    const database = new URL(process.env.DATABASE_URL ?? "");
    return (
      ["localhost", "127.0.0.1"].includes(app.hostname) &&
      database.pathname === "/kfid_v3_test"
    );
  } catch {
    return false;
  }
}

export function localRoleQaSessionCookie(): string | null {
  if (!localRoleQaEnabled()) return null;
  const role = process.env.KFID_LOCAL_ROLE_QA_ROLE;
  return isQaRole(role) ? `next-auth.qa-${role}.session-token` : null;
}

export function isTestEmail(email: string | null | undefined): boolean {
  const owner = instanceAdminEmail();
  return Boolean(owner) && email?.trim().toLowerCase() === owner;
}

/**
 * The pilot (prepared 2026-09-30): the addresses in PILOT_ACCESS_EMAILS may sign in too – only on the public HTTPS
 * server, never on a loopback QA instance, so no real identity is ever enabled during private testing. Empty (the
 * default) keeps the private test: only the owner account. Setting the list is the deliberate act of opening the pilot.
 */
export function pilotAccessEmails(): Set<string> {
  const raw = process.env.PILOT_ACCESS_EMAILS ?? "";
  if (!raw.trim()) return new Set();
  try {
    const app = new URL(process.env.APP_URL ?? "");
    if (app.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(app.hostname)) return new Set();
  } catch {
    return new Set();
  }
  return new Set(raw.split(",").map((item) => item.trim().toLowerCase()).filter((item) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item)));
}

export function isAllowedPrivateEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return isTestEmail(normalized) || (Boolean(normalized) && pilotAccessEmails().has(normalized!)) ||
    (localRoleQaEnabled() && QA_EMAILS.has(normalized ?? ""));
}

export function canAccessTest(user: { email: string; isActive: boolean } | null | undefined): boolean {
  return Boolean(user?.isActive && isAllowedPrivateEmail(user.email));
}

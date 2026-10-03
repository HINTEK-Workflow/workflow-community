// "Tillåt nya konton" (2026-10-03): whether the installation is open to everyone with an account, not only the
// owner and the pilot list. The value lives in the database (lib/auth/registration.ts reads it); this module only holds
// the last value read, so the synchronous access checks can use it without a database import.

let open = false;

export const registrationGateOpen = () => open;
export function setRegistrationGate(value: boolean) { open = value; }

/** On a loopback test instance only synthetic addresses may register or sign in this way; never a real identity. */
export function registrationAllowsEmail(email: string, appUrl = process.env.APP_URL ?? "") {
  let loopback = false;
  try { loopback = ["localhost", "127.0.0.1", "::1"].includes(new URL(appUrl).hostname); } catch { loopback = true; }
  return loopback ? /\.invalid$/i.test(email.trim()) : true;
}

// Server-only instance settings (Fas 1, 2026-09-30); kept apart from lib/instance.ts so the owner's address never
// travels to the browser with the public settings.
import { text, type InstanceEnv } from "./instance";
import { INSTANCE_DEFAULTS } from "./instance-defaults";

/** The installation's owner account: the only address that may sign in during the private test. Server only. */
export function instanceAdminEmail(source: InstanceEnv = process.env): string {
  // Empty (a community installation without INSTANCE_ADMIN_EMAIL): nobody may sign in.
  return (source.INSTANCE_ADMIN_EMAIL?.trim() || INSTANCE_DEFAULTS.adminEmail).toLowerCase();
}

/** The address system e-mails come from and the one shown for support. Server only. */
export function instanceSupportEmail(source: InstanceEnv = process.env): string {
  return text(source.INSTANCE_SUPPORT_EMAIL, text(source.MAIL_FROM_ADDRESS, INSTANCE_DEFAULTS.supportEmail));
}

export function instanceAppUrl(source: InstanceEnv = process.env): string {
  return text(source.APP_URL, INSTANCE_DEFAULTS.appUrl);
}

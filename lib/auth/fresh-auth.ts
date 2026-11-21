import { ReauthRequired } from "@/lib/kfid/errors";
import { freshlyAuthenticated } from "@/lib/auth/session-rules";
import { sessionReauthAt } from "@/lib/auth/sessions";

/**
 * Färsk inloggning (2026-10-10): changing two-factor, the password, linked sign-in accounts and API keys needs a sign-in
 * or a confirmation with password or code within the last ten minutes, checked on the server. `auth` null (an API/MCP
 * call) is refused: keys are never managed through a key.
 */
export async function requireFreshAuth(userId: string, auth: { sessionId?: string; authAt?: number } | null, windowSeconds?: number) {
  if (!auth) throw new ReauthRequired("Det här kan bara göras inloggad i Workflow.");
  if (freshlyAuthenticated(auth.authAt, await sessionReauthAt(auth.sessionId, userId), Date.now(), windowSeconds)) return;
  throw new ReauthRequired();
}

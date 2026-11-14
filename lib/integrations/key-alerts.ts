// Larm för nycklar som går ut (2026-10-03: "så jag vet att nycklarna är på väg att gå ut så jag kan byta").
// Pure rules: which warning a key is due for. The job (scripts/integrations/run-key-alerts.ts) sends each once.

export type KeyAlertStage = "14d" | "3d" | "expired";
const DAY = 86_400_000;

/** The warning a key is due for now: two weeks before, three days before, and once just after it has expired. */
export function keyAlertStage(expiresAt: Date | null, now = new Date()): KeyAlertStage | null {
  if (!expiresAt) return null;
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return left > -7 * DAY ? "expired" : null;
  if (left <= 3 * DAY) return "3d";
  if (left <= 14 * DAY) return "14d";
  return null;
}

export const KEY_ALERT_ACTION = "key_expiry_alert";
export const keyAlertAction = (keyId: string, stage: KeyAlertStage) => `${KEY_ALERT_ACTION}:${keyId}:${stage}`;

export function keyAlertLine(key: { name: string; kind: string; expiresAt: Date }, stage: KeyAlertStage) {
  const kind = key.kind === "API" ? "API-nyckeln" : "MCP-nyckeln";
  const day = key.expiresAt.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  return stage === "expired" ? `${kind} ”${key.name}” gick ut ${day} och fungerar inte längre.` : `${kind} ”${key.name}” går ut ${day}.`;
}

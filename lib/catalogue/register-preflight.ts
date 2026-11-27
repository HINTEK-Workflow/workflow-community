import type { ApiPreflight } from "@/lib/integrations/wholesale-api";

/**
 * The register sync's connection check with one second try (2026-11-15): Solar refuses the first token request just after
 * 00:00 UTC every night and accepts it again minutes later, which made the job fail and recover every night (an alarm mail
 * each time). Only that refusal – the sign-in with client id and secret not accepted (reason "auth") – is tried once more,
 * after a short wait, and the wait is logged. Any other answer, and a second refusal, stand as they are. Pure, so the tests
 * replace the check, the wait and the log.
 */
export const REGISTER_AUTH_RETRY_MS = 75_000;

export const authRetryLine = (ms: number) => `register:sync – Solar godkände inte inloggningen; ett nytt försök om ${Math.round(ms / 1000)} s.`;

export async function preflightWithAuthRetry(
  preflight: () => Promise<ApiPreflight>,
  pause: (ms: number) => Promise<void>,
  log: (line: string) => void = (line) => console.warn(line),
  waitMs = REGISTER_AUTH_RETRY_MS,
): Promise<ApiPreflight> {
  const first = await preflight();
  if (first.ok || first.reason !== "auth") return first;
  log(authRetryLine(waitMs));
  await pause(waitMs);
  const second = await preflight();
  log(second.ok ? "register:sync – det andra inloggningsförsöket lyckades." : "register:sync – det andra inloggningsförsöket misslyckades också.");
  return second;
}

/**
 * Whether the AI model can answer (the `available` of /api/ai/status), pure so it can be tested without a database.
 *
 * In Cloud an answer costs credits, so the model is available only with a healthy credit ledger and a balance above zero.
 * An installation without Workflow's credit system (Community, 2026-11-20) runs on its own key: there the credits say nothing,
 * and the status depends on the key and the company's setting alone – before, such an installation always read "AI är av"
 * or "0 krediter", since the wallet it never fills was still required.
 */
export type AiAvailabilityConditions = {
  provider: { ready: boolean };
  sharingPolicy: { ready: boolean };
  creditLedger: { healthy: boolean };
  availableCredits: { available: boolean };
};

export function aiAvailable(conditions: AiAvailabilityConditions, creditsCharged: boolean): boolean {
  if (!conditions.provider.ready || !conditions.sharingPolicy.ready) return false;
  if (!creditsCharged) return true;
  return conditions.creditLedger.healthy && conditions.availableCredits.available;
}

import { RISK_QUESTIONS, type RiskCheck } from "../../lib/workflow/risk-step";

// Riskbedömning som steg (2026-10-08): a new task must have its risk step done before its time starts or it is
// completed. Tests about something else start from a confirmed simplified check (every answer Ja).
export const RISK_STEP_DONE: RiskCheck = {
  level: "simplified",
  answers: Object.fromEntries(RISK_QUESTIONS.map((question) => [question.id, "yes"])) as RiskCheck["answers"],
  confirmedBy: "QA",
  confirmedAt: "2026-10-08T06:00:00.000Z",
};
export const riskDone = <T extends object>(data: T): T => ({ ...data, riskCheck: RISK_STEP_DONE });

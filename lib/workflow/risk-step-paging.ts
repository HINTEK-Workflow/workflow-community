import { RISK_QUESTIONS, type RiskCheck } from "./risk-step";

/**
 * En fråga per skärm (UX-granskningen avsnitt 6, punkt 7): which of the simplified risk step's questions the app shows.
 * An index of RISK_QUESTIONS.length is the summary (every answer listed, with Bekräfta). Pure, so it is tested on its own.
 */
type Answers = RiskCheck["answers"];

/** The first question without an answer, or the summary when all are answered (where the screen opens). */
export function firstUnanswered(answers: Answers): number {
  const index = RISK_QUESTIONS.findIndex((question) => !answers[question.id]);
  return index < 0 ? RISK_QUESTIONS.length : index;
}

/** After an answer on question `index`: the next unanswered one after it, then any before it, else the summary. */
export function nextQuestionIndex(answers: Answers, index: number): number {
  const after = RISK_QUESTIONS.findIndex((question, at) => at > index && !answers[question.id]);
  return after >= 0 ? after : firstUnanswered(answers);
}

/**
 * Svar 1 (2026-10-24): in the app "Gör utökad riskbedömning" is offered on the summary only, never under each
 * question. The rule is unchanged – a Nej or Osäker still requires the extended assessment, which the summary shows.
 */
export function showsExtendedChoice(index: number): boolean {
  return index >= RISK_QUESTIONS.length;
}

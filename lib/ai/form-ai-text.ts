/**
 * Formulär med Workflow AI (2026-11-25): the words the chat and the server share, without anything server-side, so the
 * browser can use them too (lib/ai/form-ai.ts has the rest).
 */
export const FORM_AI_KIND = "FORM_DRAFT";
/** The box the person ticks before a photo goes to Workflow AI in form mode (short, natural Swedish). */
export const FORM_AI_OWN_PROTOCOL_LABEL = "Det här är vårt eget protokoll";
/** The server's own refusal when a photo comes without the box ticked (the chat keeps Skicka off until it is). */
export const FORM_AI_OWN_PROTOCOL_REQUIRED = "Kryssa i att det är ert eget protokoll innan bilden skickas.";

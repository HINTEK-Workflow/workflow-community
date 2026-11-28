import type { EnvelopeError, RejectReason } from "@/lib/machine/intake";

// PLC-simulatorn: every code the intake can answer, in plain Swedish. The records are typed on the server's own unions, so a new
// reason there breaks the compile here instead of showing up as a bare code on the page.

export const REJECT_REASON_TEXT: Record<RejectReason, string> = {
  not_an_object: "Händelsen är inget objekt.",
  unknown_field: "Händelsen har ett okänt fält.",
  missing_field: "Ett obligatoriskt fält saknas.",
  bad_event_id: "eventId är fel: 1–128 synliga tecken utan blanksteg.",
  bad_time: "Tiden går inte att läsa. Den behöver sekunder och tidszon.",
  time_window: "Tiden är utanför fönstret: högst en vecka gammal, högst fem minuter fram.",
  bad_type: "Typen ska vara alarm, state eller diagnosis.",
  bad_code: "Koden är fel: 1–64 synliga tecken utan blanksteg, inga svenska bokstäver.",
  bad_severity: "Nivån ska vara info, warning, fault eller critical.",
  bad_state: "Läget passar inte typen.",
  bad_text: "Texten är för lång eller har styrtecken.",
  bad_basis: "Underlag får bara finnas på en diagnos, och det är för långt eller har styrtecken.",
  bad_values: "Värdena är fel: 1–20 namn med tal, sant/falskt eller kort text.",
  machine_not_allowed: "Nyckeln får inte skriva händelser för den här maskinen.",
};

export const ENVELOPE_ERROR_TEXT: Record<EnvelopeError, string> = {
  invalid_json: "Meddelandet är inte giltig JSON.",
  not_an_object: "Meddelandet ska vara ett objekt med schemaVersion och events.",
  unknown_field: "Meddelandet har ett okänt fält.",
  unsupported_version: "schemaVersion stöds inte.",
  bad_events: "events ska vara en lista.",
  bad_batch_size: "events ska ha 1–20 händelser.",
};

export const TOO_LARGE_TEXT = "Meddelandet är för stort (högst 64 kB).";
export const MODULE_OFF_TEXT = "Underhåll är avstängt för företaget.";
export const CLOCK_HINT = "Datorns klocka kan gå fel.";
export const NETWORK_TEXT = "Inget svar: nätet eller servern.";

export const STOPPED_IN_CALL_TEXT = "Stoppad under anropet. Det kan ha kommit fram.";

export const keyRefusedText = (serverText: string) =>
  `Nyckeln nekades: ${serverText} Simulatorn försöker inte igen.`;
/** The reason itself, for the log: the page line keeps it short. */
export const KEY_NO_RETRY_TEXT = "Simulatorn försöker inte igen: nekade nycklar räknas per adress och delas med alla på samma adress.";
export const oddAnswerText = (status: number) => `Oväntat svar (${status}). Kontrollera att sidan är öppnad från Workflow.`;
export const rateLimitedText = (seconds: number) => `För många anrop. Väntar ${seconds} s, som svaret säger.`;
export const rateLimitWaitText = (seconds: number) => `Källan har nått taket. Vänta ${seconds} s.`;
export const backoffText = (seconds: number) => `Inget svar. Försöker igen om ${seconds} s.`;
export const NOT_A_KEY_TEXT = "Det ser inte ut som en källnyckel.";
export const BODY_HOLDS_KEY_TEXT = "Meddelandet innehåller en nyckel.";

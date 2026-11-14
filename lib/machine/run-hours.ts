// Drifttimmar från PLC (2026-11-02): en talsignal kan mata drifttimmarna på sin maskindel, så att planer på drifttimmar
// följer maskinen. Rena regler, samma för servern (run-hours-store.ts) och simulatorn. Inga tillverkarvärden: gränsen för ett
// hopp är klockan själv. En person kan alltid skriva in timmarna; då gäller personens värde.

export const RUN_HOURS_MAX = 10_000_000;
/** Ett maskinvärde skrivs högst en gång i minuten, om det inte stigit minst en hel timme. */
export const RUN_HOURS_WRITE_INTERVAL_MS = 60_000;
/** En räknare kan inte gå fortare än klockan: tiden sedan förra värdet, med tio procents marginal och en timme extra. */
export const RUN_HOURS_CLOCK_MARGIN = 1.1;
export const RUN_HOURS_EXTRA_HOURS = 1;

export const RUN_HOURS_HELD_REASONS = ["lower", "jump"] as const;
export type RunHoursHeldReason = (typeof RUN_HOURS_HELD_REASONS)[number];
export type RunHoursOutcome = "use" | "same" | "wait" | "old" | "bad" | RunHoursHeldReason;
export type RunHoursState = { runHours: number | null; runHoursAt: Date | null; held: number | null; heldAt: Date | null; heldReason: string | null };

/**
 * Vad ett värde från maskinen ska göra med delens timmar:
 * - `bad`: inget tal, negativt eller orimligt stort. Ingenting händer.
 * - `old`: äldre än delens senaste värde (maskinens eller en persons). Ingenting händer, som för alla signaler.
 * - `lower`: lägre än delens timmar. Sänker aldrig; värdet hålls och visas på delen.
 * - `jump`: steg mer än klockan tillåter sedan förra värdet. Används inte; värdet hålls och visas på delen.
 * - `same`: samma värde. Inget skrivs, men ett hållet värde tas bort (maskinen stämmer igen).
 * - `wait`: steg lite, och inom samma minut. Väntar till nästa värde.
 * - `use`: blir delens timmar, och ett hållet värde tas bort.
 */
export function decideRunHours(state: Pick<RunHoursState, "runHours" | "runHoursAt">, reading: { value: unknown; at: Date }): RunHoursOutcome {
  const { value, at } = reading;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > RUN_HOURS_MAX) return "bad";
  if (state.runHoursAt && at.getTime() <= state.runHoursAt.getTime()) return "old";
  if (state.runHours === null) return "use";
  if (value < state.runHours) return "lower";
  if (value === state.runHours) return "same";
  if (!state.runHoursAt) return "use";
  const elapsedMs = at.getTime() - state.runHoursAt.getTime();
  if (value - state.runHours > (elapsedMs / 3_600_000) * RUN_HOURS_CLOCK_MARGIN + RUN_HOURS_EXTRA_HOURS) return "jump";
  return value - state.runHours < 1 && elapsedMs < RUN_HOURS_WRITE_INTERVAL_MS ? "wait" : "use";
}

/** Ett anrops värden i tidsordning. `used` säger att delens timmar ändrades, `newlyHeld` att ett nytt slags värde börjat hållas. */
export function foldRunHours(start: RunHoursState, readings: readonly { value: unknown; at: Date }[]) {
  let state = start;
  let used = false;
  let write = false;
  let newlyHeld: { value: number; reason: RunHoursHeldReason } | null = null;
  for (const reading of [...readings].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const outcome = decideRunHours(state, reading);
    if (outcome === "use") {
      state = { runHours: reading.value as number, runHoursAt: reading.at, held: null, heldAt: null, heldReason: null };
      used = true; write = true; newlyHeld = null;
    } else if (outcome === "same") {
      if (state.held !== null) { state = { ...state, held: null, heldAt: null, heldReason: null }; write = true; newlyHeld = null; }
    } else if (outcome === "lower" || outcome === "jump") {
      const value = reading.value as number;
      const changed = state.held !== value || state.heldReason !== outcome;
      if (changed || !state.heldAt || reading.at.getTime() - state.heldAt.getTime() >= RUN_HOURS_WRITE_INTERVAL_MS) {
        if (state.heldReason !== outcome) newlyHeld = { value, reason: outcome };
        state = { ...state, held: value, heldAt: reading.at, heldReason: outcome };
        write = true;
      }
    }
  }
  return { state, used, write, newlyHeld };
}

/** Om signalen får mata drifttimmarna: ett tal, inte ignorerad, med en egen maskindel. Skälet i ord, eller "". */
export function runHoursFeedProblem(input: { feed: boolean; kind: string; status: string; partId: string | null }) {
  if (!input.feed) return "";
  if (input.kind !== "number") return "Bara en signal med tal kan ge drifttimmar.";
  if (input.status === "ignored") return "En ignorerad signal kan inte ge drifttimmar.";
  if (!input.partId) return "Välj vilken del signalen ger drifttimmar till.";
  return "";
}

const hours = (value: number) => `${value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;

/** Raden på delen när ett maskinvärde inte används. */
export function runHoursHeldText(input: { held: number; reason: string; current: number | null }) {
  const now = input.current === null ? "delens värde" : `delens ${hours(input.current)}`;
  return input.reason === "jump"
    ? `Maskinen skickade ${hours(input.held)}. Det är ett större hopp än tiden sedan förra värdet tillåter, så ${now} gäller.`
    : `Maskinen skickade ${hours(input.held)}. Det är lägre, så ${now} gäller.`;
}

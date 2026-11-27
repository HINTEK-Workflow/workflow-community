/**
 * Workflow's suggestions for the company's values (2026-10-06): the only numbers Workflow itself knows for a limit,
 * kept in this one place. They are never applied by themselves: under Inställningar → Värden och referenser the
 * company's administrator may press "Använd förslagen", which fills in the rows that are still empty, and should check
 * them against the standard the company works to. The form itself carries no numbers (copyright precaution).
 *
 * The keys are the limits of Kontroll före idrifttagning's RCD test: the 1× trip time for each standard the installation
 * tester offers (referred to by designation), the 5× time and the two touch-voltage choices. Since 2026-10-10
 * the row offers only EN 61008 / EN 61009; the TN/IT and TT keys remain for older protocols that hold those choices.
 */
export const RCD_LIMIT_KEYS = {
  t1: { EN: "rcd_t1_en", TNIT: "rcd_t1_tnit", TT: "rcd_t1_tt" },
  t5: "rcd_t5",
  uc25: "rcd_uc_25",
  uc50: "rcd_uc_50",
} as const;

type Suggestion = { low: number | null; high: number | null };
const highest = (value: number): Suggestion => ({ low: null, high: value });

export const HINTEK_LIMIT_SUGGESTIONS: Record<string, Suggestion> = {
  [RCD_LIMIT_KEYS.t1.EN]: highest(300),
  [RCD_LIMIT_KEYS.t5]: highest(40),
  [RCD_LIMIT_KEYS.uc25]: highest(25),
  [RCD_LIMIT_KEYS.uc50]: highest(50),
};

/**
 * Limits kept only for older protocols (2026-10-10: the RCD row offers only EN 61008 / EN 61009). Värden och
 * referenser lists them only while the company has a value for them, and Workflow suggests nothing for them.
 */
export const RETIRED_LIMIT_KEYS: readonly string[] = [RCD_LIMIT_KEYS.t1.TNIT, RCD_LIMIT_KEYS.t1.TT];

/** The words beside the button, so nobody takes a suggestion for the company's own decision. */
export const SUGGESTION_NOTE = "Förslag från Workflow – kontrollera mot er standard";

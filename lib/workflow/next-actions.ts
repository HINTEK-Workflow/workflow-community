/**
 * "Gör detta nu" on Hem (dashboard etapp 2, 2026-10-28): the person's own work ranked by one written rule, so the
 * tile always says why a row is first. Pure: the server (lib/workflow/my-day-server.ts) gathers the facts, this orders them,
 * and the tests read the same rule.
 *
 * The rule, first match wins (the reason is the chip on the row):
 *  1. a machine alarm or a work order marked Akut      – "Larm" / "Akut"
 *  2. the job whose timer runs                         – "Tiden går"
 *  3. a late job (isLateTask, the same rule as the list) – "Förfallen"
 *  4. booked or planned to start today                 – "Bokad idag"
 *  5. a round that is late, or due today              – "Förfallen rond" / "Rond idag"
 *  6. an obstacle, or a job that needs action          – "Hinder" / "Åtgärda"
 *  7. an immediate deviation (category IMMEDIATE)      – "Avvikelse"
 *  8. the rest: under way before not started           – "Pågår" / "Öppen"
 * Ties: the earliest Klart senast (none last), then the title (Swedish order), then the id – so the order never flickers.
 */
export const NEXT_REASONS = [
  "alarm", "urgent", "running", "overdue", "booked_today", "round_late", "round_today", "obstacle", "needs_action", "immediate_deviation", "in_progress", "open",
] as const;
export type NextReason = (typeof NEXT_REASONS)[number];

export const NEXT_REASON_CHIP: Record<NextReason, string> = {
  alarm: "Larm", urgent: "Akut", running: "Tiden går", overdue: "Förfallen", booked_today: "Bokad idag",
  round_late: "Förfallen rond", round_today: "Rond idag", obstacle: "Hinder", needs_action: "Åtgärda",
  immediate_deviation: "Avvikelse", in_progress: "Pågår", open: "Öppen",
};

/** The reasons that mark a row as pressing (the chip is red); the rest are calm. */
export const NEXT_REASON_PRESSING: ReadonlySet<NextReason> = new Set(["alarm", "urgent", "overdue", "round_late", "obstacle", "immediate_deviation"]);

export type NextCandidate = {
  id: string;
  title: string;
  href: string;
  /** YYYY-MM-DD or empty: the tie-breaker within the same reason. */
  dueDate?: string | null;
  signals: Partial<Record<NextReason, boolean>>;
  /** The row's second line (Översiktens lyft, 2026-10-29): what it is, for whom and where, and its day. */
  detail?: string;
  /** What the row is, for its icon: a task kind, ROUND or DEVIATION. */
  kind?: string;
  /** The job's or entry's own status and a job's completion in percent (2026-10-29: "så man ser status och progresslinje"). */
  status?: string;
  progress?: number | null;
};
export type NextAction = { id: string; title: string; href: string; reason: NextReason; chip: string; pressing: boolean; detail?: string; kind?: string; status?: string; progress?: number | null };

/** The first reason that holds for a candidate, by the rule above; null when none does. */
export function nextReasonOf(signals: NextCandidate["signals"]): NextReason | null {
  return NEXT_REASONS.find((reason) => signals[reason]) ?? null;
}

/** At most `limit` rows, ranked by the rule; the same id twice is one row with both sets of facts. */
export function rankNextActions(candidates: readonly NextCandidate[], limit = 3): NextAction[] {
  const byId = new Map<string, NextCandidate>();
  for (const candidate of candidates) {
    const seen = byId.get(candidate.id);
    byId.set(candidate.id, seen ? { ...seen, dueDate: seen.dueDate || candidate.dueDate, signals: { ...seen.signals, ...Object.fromEntries(Object.entries(candidate.signals).filter(([, on]) => on)) } } : candidate);
  }
  const ranked = [...byId.values()].flatMap((candidate) => {
    const reason = nextReasonOf(candidate.signals);
    return reason ? [{ candidate, reason, rank: NEXT_REASONS.indexOf(reason) }] : [];
  });
  ranked.sort((a, b) => a.rank - b.rank
    || (a.candidate.dueDate || "9999-99-99").localeCompare(b.candidate.dueDate || "9999-99-99")
    || a.candidate.title.localeCompare(b.candidate.title, "sv")
    || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0));
  return ranked.slice(0, Math.max(0, limit)).map(({ candidate, reason }) => ({
    id: candidate.id, title: candidate.title, href: candidate.href, reason, chip: NEXT_REASON_CHIP[reason], pressing: NEXT_REASON_PRESSING.has(reason),
    ...(candidate.detail ? { detail: candidate.detail } : {}), ...(candidate.kind ? { kind: candidate.kind } : {}),
    ...(candidate.status ? { status: candidate.status } : {}), ...(typeof candidate.progress === "number" ? { progress: candidate.progress } : {}),
  }));
}

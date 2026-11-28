/**
 * Lagringstid för loggar (K3.3, 2026-11-27): each company chooses how long its security, administration and change
 * logs are kept – 1, 2, 5 or 10 years, 2 as standard. The nightly history:retention job removes older rows and leaves a
 * checkpoint, so the chain can still be checked (lib/traceability/retention-server.ts). Security events without a company
 * (a person's sign-ins) keep the installation's 12 months (lib/security/security-log-core.ts). Pure, for the page and the tests.
 */
export const LOG_RETENTION_YEARS = [1, 2, 5, 10] as const;
export type LogRetentionYears = (typeof LOG_RETENTION_YEARS)[number];
export const DEFAULT_LOG_RETENTION_YEARS: LogRetentionYears = 2;

export const isLogRetentionYears = (value: unknown): value is LogRetentionYears => LOG_RETENTION_YEARS.includes(value as LogRetentionYears);
export const logRetentionYears = (value: unknown): LogRetentionYears => isLogRetentionYears(value) ? value : DEFAULT_LOG_RETENTION_YEARS;
export const logRetentionLabel = (years: LogRetentionYears) => years === 1 ? "1 år" : `${years} år`;

/** The moment before which a log row is removed: the same day and time, the given number of years back (29 February → 28). */
export function logRetentionCutoff(years: number, now = new Date()) {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const last = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, last));
  return cutoff;
}

/** The detail line in the administration log when the time is changed. */
export const logRetentionDetail = (years: LogRetentionYears) => `Lagringstid för loggar: ${logRetentionLabel(years)}.`;

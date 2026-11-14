/**
 * Filters in the address (dashboard etapp 3, 2026-10-28: "Varje nyckeltal ska öppna rätt lista med rätt filter.
 * Använd gemensamma filter … Återanvänd befintliga listor"). A key figure, a notice or a link opens an existing list with
 * these keys; each list checks a value against what it allows and ignores anything else, so an address never widens what a
 * person may read (the server checks scope and permission again). One set of names for every list:
 * filter (the list's own filter), scope (mine | all), status, assignee, from / to (days), type (the Jobb list's Typ),
 * workOrder and attention.
 */
export const LIST_FILTER_KEYS = ["filter", "scope", "status", "assignee", "from", "to", "type", "workOrder", "attention"] as const;
export type ListFilterKey = (typeof LIST_FILTER_KEYS)[number];
export type ListFilters = Partial<Record<ListFilterKey, string | boolean | null | undefined>>;

/** A value the list allows, else null (ignored). */
export function allowedFilter<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | null {
  return value != null && (allowed as readonly string[]).includes(value) ? value as T : null;
}

/** A calendar day (YYYY-MM-DD) that exists, else null. */
export function filterDay(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

/** The address of a list with filters, `/?view=<view>&…`: empty, false and null values are left out, true is "1". */
export function listHref(view: string, filters: ListFilters = {}) {
  const params = new URLSearchParams({ view });
  for (const key of LIST_FILTER_KEYS) {
    const value = filters[key];
    if (value === null || value === undefined || value === false || value === "") continue;
    params.set(key, value === true ? "1" : value);
  }
  return `/?${params}`;
}

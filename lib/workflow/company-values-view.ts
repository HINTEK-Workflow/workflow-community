import { companyValueFilled, type CatalogFormRef, type CompanyValue, type CompanyValueGroup, type CompanyValueRow } from "./company-values";
import { RETIRED_LIMIT_KEYS } from "./limit-suggestions";

/**
 * Filters and order for Inställningar → Värden och referenser (2026-10-07): the list is narrowed to one form
 * (also through the address ?form=<id>, which the cards under Ny uppgift link to), to the limits that still have no
 * value, or by a search over name, key, unit, forms and source; and it can be ordered by form, name, key or by what is
 * missing. Pure rules, shared by the page and its tests.
 */
export const VALUE_SORTS = [
  { value: "form", label: "Per formulär" },
  { value: "name", label: "Namn A–Ö" },
  { value: "key", label: "Nyckel A–Ö" },
  { value: "missing", label: "Saknar värde först" },
] as const;
export type ValueSort = (typeof VALUE_SORTS)[number]["value"];
export const isValueSort = (value: string | null | undefined): value is ValueSort => VALUE_SORTS.some((item) => item.value === value);

export type ValueFilter = { formId: string; query: string; missingOnly: boolean; sort: ValueSort };
export const emptyValueFilter: ValueFilter = { formId: "", query: "", missingOnly: false, sort: "form" };
/** Something narrows the list (the order alone does not). */
export const valueFilterNarrowed = (filter: ValueFilter) => Boolean(filter.formId || filter.query.trim() || filter.missingOnly);

/** The address that opens the page filtered on one form – what "Värden för den här kontrollen" on a card links to. */
export const companyValuesHref = (formId: string) => `/?view=company_values&form=${encodeURIComponent(formId)}`;

/** The heading of the flat list a sort other than "Per formulär" gives. */
export const FLAT_GROUP = "Alla värden";

const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const byText = (a: string, b: string) => a.localeCompare(b, "sv");

/** The forms the listed limits belong to, once each and by name. */
export function catalogForms(groups: CompanyValueGroup[]): CatalogFormRef[] {
  const seen = new Map<string, CatalogFormRef>();
  for (const group of groups) for (const row of group.rows) for (const form of row.forms) if (!seen.has(form.id)) seen.set(form.id, form);
  return [...seen.values()].sort((a, b) => byText(a.name, b.name));
}

/** The form an id names: the form itself, or the Workflow original that a company's own version stands for. */
export function catalogForm(groups: CompanyValueGroup[], formId: string): CatalogFormRef | null {
  if (!formId) return null;
  const forms = catalogForms(groups);
  return forms.find((form) => form.id === formId) ?? forms.find((form) => form.baseId === formId) ?? null;
}

export type ValueView = {
  groups: CompanyValueGroup[];
  /** The rows shown, and all rows of the company's forms. */
  shown: number;
  total: number;
  /** Rows without a value among those the form and the search leave, whether or not "Saknar värde" is on. */
  missing: number;
  /** The form the filter names; null for no filter, or an id that names no form with limits. */
  form: CatalogFormRef | null;
};

/**
 * A limit kept only for older protocols (the RCD row's TN/IT and TT, 2026-10-10) is listed only while the company
 * has a value for it, so the value can still be read and changed but nobody is asked to fill it in.
 */
export const companyValueListed = (row: Pick<CompanyValueRow, "key">, values: CompanyValue[]) =>
  !RETIRED_LIMIT_KEYS.includes(row.key) || companyValueFilled(values.find((value) => value.key === row.key));

export function viewCompanyValues(allGroups: CompanyValueGroup[], values: CompanyValue[], filter: ValueFilter): ValueView {
  const groups = allGroups.map((group) => ({ ...group, rows: group.rows.filter((row) => companyValueListed(row, values)) })).filter((group) => group.rows.length);
  const form = catalogForm(groups, filter.formId);
  // An id that names no form with limits (a form without any, or one that was taken away) shows nothing, never everything.
  const unknownForm = Boolean(filter.formId) && !form;
  const words = plain(filter.query).split(/\s+/).filter(Boolean);
  const valueOf = (row: CompanyValueRow) => values.find((value) => value.key === row.key);
  const missingRow = (row: CompanyValueRow) => !companyValueFilled(valueOf(row));
  const inScope = (row: CompanyValueRow) => {
    if (unknownForm || (form && !row.forms.some((item) => item.id === form.id))) return false;
    if (!words.length) return true;
    const value = valueOf(row);
    const haystack = plain([row.label, row.key, row.unit, ...row.usedIn, value?.source ?? "", value?.reference ?? ""].join(" "));
    return words.every((word) => haystack.includes(word));
  };
  const rows = groups.flatMap((group) => group.rows);
  const scoped = rows.filter(inScope);
  const wanted = (row: CompanyValueRow) => inScope(row) && (!filter.missingOnly || missingRow(row));
  let shownGroups: CompanyValueGroup[];
  if (filter.sort === "form") shownGroups = groups.map((group) => ({ ...group, rows: group.rows.filter(wanted) })).filter((group) => group.rows.length);
  else {
    const flat = rows.filter(wanted);
    const order: Record<Exclude<ValueSort, "form">, (a: CompanyValueRow, b: CompanyValueRow) => number> = {
      name: (a, b) => byText(a.label, b.label) || byText(a.key, b.key),
      key: (a, b) => byText(a.key, b.key),
      missing: (a, b) => Number(missingRow(b)) - Number(missingRow(a)) || byText(a.label, b.label) || byText(a.key, b.key),
    };
    flat.sort(order[filter.sort]);
    shownGroups = flat.length ? [{ title: FLAT_GROUP, rows: flat }] : [];
  }
  return { groups: shownGroups, shown: shownGroups.reduce((sum, group) => sum + group.rows.length, 0), total: rows.length, missing: scoped.filter(missingRow).length, form };
}

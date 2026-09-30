/** Filters for Mina uppgifter, shared by the server list, the demo backend and the client. */
export const WORK_ITEM_FILTERS = ["open", "active", "planned", "action", "done", "all"] as const;
export type WorkItemFilter = (typeof WORK_ITEM_FILTERS)[number];

const kindLabels = [
  ["COMMISSIONING_CONTROL", "kontroll före idrifttagning"],
  ["WORK_ORDER", "arbetsorder"],
  ["RISK_ASSESSMENT", "riskbedömning"],
  ["FORM", "formulär"],
] as const;

/** Task kinds whose Swedish name contains the search text, so "arbetsorder" finds all work orders. */
export function workItemKindsForQuery(query: string) {
  const needle = query.trim().toLocaleLowerCase("sv-SE");
  return needle ? kindLabels.filter(([, label]) => label.includes(needle)).map(([kind]) => kind) : [];
}

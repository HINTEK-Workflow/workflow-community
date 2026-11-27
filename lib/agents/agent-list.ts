/**
 * Agenter's start page as one list (2026-11-23, the shared list page of Tavlor and Rapportarkiv): the person's missions, the
 * examples to start from and the built-in agents in the same rows, with Mina | Alla, the kind as chips with counts, the search,
 * Status and Schema or händelse as selects, the sort and Rader | Kort. Pure, so the page and the tests read the same rules.
 */
export const AGENT_LIST_KINDS = ["all", "mission", "template", "system"] as const;
export type AgentListKind = (typeof AGENT_LIST_KINDS)[number];
export const AGENT_LIST_KIND_LABEL: Record<AgentListKind, string> = { all: "Alla", mission: "Uppdrag", template: "Exempel", system: "Inbyggda" };
export const AGENT_TYPE_LABEL: Record<Exclude<AgentListKind, "all">, string> = { mission: "Uppdrag", template: "Exempel", system: "Inbyggd agent" };
export type AgentListStatus = "active" | "paused" | "off";
export const AGENT_STATUS_LABEL: Record<AgentListStatus, string> = { active: "Aktiv", paused: "Pausad", off: "Av" };
export type AgentListTrigger = "schedule" | "event";
export const AGENT_TRIGGER_LABEL: Record<AgentListTrigger, string> = { schedule: "Schema", event: "Händelse" };

export type AgentListItem = {
  key: string; kind: Exclude<AgentListKind, "all">; name: string; description: string; href: string; mine: boolean;
  /** Missions and built-in agents; an example has none. */
  status: AgentListStatus | null;
  trigger: AgentListTrigger | null;
  /** Nästa körning or the state in words. */
  when: string;
  updatedAt: string | null;
};
export type AgentListFilter = { kind: AgentListKind; scope: "mine" | "all"; status: "" | AgentListStatus; trigger: "" | AgentListTrigger };

/** Whether an item is shown: Mina is the person's own missions; a status or a trigger leaves out what has none. */
export function agentListMatches(item: AgentListItem, filter: Omit<AgentListFilter, "kind">) {
  if (filter.scope === "mine" && !(item.kind === "mission" && item.mine)) return false;
  if (filter.status && item.status !== filter.status) return false;
  if (filter.trigger && item.trigger !== filter.trigger) return false;
  return true;
}
export const agentKindMatches = (item: AgentListItem, kind: AgentListKind) => kind === "all" || item.kind === kind;

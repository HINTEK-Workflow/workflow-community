import type { Severity } from "@/lib/operator/rules";

/**
 * Gränssnittet mot underhållsmodulen (2026-10-30). The operator page needs three things from the maintenance
 * module, and only through this port: the company's machine tree (the module's tree of parts – never the customer place
 * tree), the run state the machine connection knows, and "make a corrective maintenance item in a new work order" for a
 * fault report. The operator page owns the fault report itself (OperatorFaultReport), its photos, the on-call path and the
 * operator's view of it; the port owns the tree, the maintenance item and the work order.
 *
 * lib/operator/maintenance-adapter.ts answers (the module's tree of parts, a work order holding a corrective maintenance
 * item); `maintenancePort()` in maintenance-port.ts picks it. Nothing else in lib/operator, the routes or the page knows
 * which adapter answers. This file is pure: types and the tree rules.
 */

/** One node of the machine tree as the operator page sees it. */
export type MachineNode = {
  id: string;
  parentId: string | null;
  name: string;
  /** A short type text for the icon and the second line (Linje, Pump, Motor …); "" when none. */
  objectType: string;
  /** Whether a fault can be reported on the node itself (a site or a department may only group machines). */
  reportable: boolean;
  /** The object whose alarm contacts (ansvarig, ersättare: MachineAlarmContact) are told first; null = no own contacts. */
  alarmFacilityId: string | null;
  /** "" | IN_SERVICE | OUT_OF_SERVICE | DECOMMISSIONED (the node's own operating state, when the module keeps one). */
  operatingState: string;
};

export type FaultPhoto = { buffer: Uint8Array; filename: string; mimeType: string; extension: string };

/** What the port gets to make the corrective maintenance item and its work order. */
export type CorrectiveWorkInput = {
  organizationId: string;
  reportId: string;
  machine: MachineNode;
  /** "Linje 2 › Press 4 › Hydraulpump". */
  machinePath: string;
  cause: string;
  text: string;
  severity: Severity;
  /** The account's name, and the name the operator wrote on a shared terminal ("" when none). */
  accountName: string;
  reporterName: string;
  photos: readonly FaultPhoto[];
  now: Date;
  /** The admin who approved it from the approval list (null when it went directly). */
  decidedById: string | null;
};

export type CorrectiveWork = {
  workOrderId: string;
  /** What the operator's receipt says: "AO-1234". */
  workOrderLabel: string;
  /** The maintenance item's own id when the module keeps one apart from the work order; null otherwise. */
  maintenanceItemId: string | null;
};

/** The operator's own history on a machine and the machine's latest alarms, for the AI troubleshooting step. */
export type MachineHistory = {
  /** Earlier work on the machine: what it was and what was done (closing notes), newest first. */
  work: { label: string; at: string; cause: string; done: string }[];
  /** The machine connection's alarms in the last day, newest first. */
  alarms: { at: string; code: string; text: string }[];
};

export type MaintenancePort = {
  /** Which adapter answers ("maintenance": the module). */
  name: string;
  /** The company's whole machine tree (the admin chooses what an account sees from it). */
  tree(organizationId: string): Promise<MachineNode[]>;
  /** The run state the machine connection last told, per node that has one. */
  runStates(organizationId: string, nodeIds: readonly string[]): Promise<Map<string, "running" | "stopped">>;
  /** Makes the corrective maintenance item in a new work order. */
  createCorrectiveWork(input: CorrectiveWorkInput): Promise<CorrectiveWork>;
  /** The work orders' statuses (WorkflowTask.status), for "Mina felanmälningar". */
  workStatuses(organizationId: string, workOrderIds: readonly string[]): Promise<Map<string, string>>;
  history(organizationId: string, nodeId: string, now: Date): Promise<MachineHistory>;
};

// ---------- the tree rules ----------

/** The nodes an account sees: each chosen node and everything under it (none chosen = none). */
export function visibleNodes(tree: readonly MachineNode[], chosen: readonly string[]): MachineNode[] {
  if (!chosen.length) return [];
  const children = new Map<string, MachineNode[]>();
  for (const node of tree) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const byId = new Map(tree.map((node) => [node.id, node]));
  const keep = new Set<string>();
  const walk = (id: string) => {
    if (keep.has(id)) return;
    keep.add(id);
    for (const child of children.get(id) ?? []) walk(child.id);
  };
  for (const id of chosen) if (byId.has(id)) walk(id);
  return tree.filter((node) => keep.has(node.id));
}

/** "Linje 2 › Press 4 › Hydraulpump": the node's names from the top of the whole tree (cycles and gaps stop the walk). */
export function nodePath(tree: readonly MachineNode[], id: string): string {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(" › ");
}

/**
 * The visible part as its own tree: a node whose parent is not visible becomes a top node, so the operator never sees
 * (or can open) anything above what the admin chose. The path label still names the whole way down.
 */
export function asOwnTree(visible: readonly MachineNode[]): MachineNode[] {
  const ids = new Set(visible.map((node) => node.id));
  return visible.map((node) => node.parentId && !ids.has(node.parentId) ? { ...node, parentId: null } : node);
}

/**
 * Sämsta status uppåt (2026-10-31): each node's open reports with those under it, so a reported part makes its machine
 * Felanmäld with the count and a place shows that something there is wrong. A node keeps its own state; only the count grows.
 */
export function openReportsUpward(nodes: readonly MachineNode[], own: ReadonlyMap<string, number>): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const out = new Map<string, number>();
  for (const [id, count] of own) {
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      out.set(current.id, (out.get(current.id) ?? 0) + count);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return out;
}

/** Only real nodes of the company's tree may be chosen for an account (a removed one is dropped quietly). */
export const knownNodeIds = (tree: readonly MachineNode[], ids: readonly string[]) => {
  const known = new Set(tree.map((node) => node.id));
  return [...new Set(ids)].filter((id) => known.has(id));
};

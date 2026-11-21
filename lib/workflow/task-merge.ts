import { formLeafBlocks, type FormDocument } from "./form-document";

/**
 * Live sync for tasks (2026-10-04): two people in the same task get each other's changes within a second, and
 * changes in different fields are merged instead of the second save failing with "Uppgiften har ändrats".
 *
 * A three-way merge of plain JSON: `base` is what both started from (the version the person last read), `mine` the
 * person's own state and `theirs` the newer saved version. Objects merge key by key; lists whose items all carry an
 * `id` (table rows, materials, risks) merge item by item, so two people can add or fill in different rows. Anything
 * else changed differently on both sides is a conflict, and `mine` wins: the person saving is the latest. The server
 * still checks the version, so a save only goes through once it has been merged with what is stored.
 */
export type MergePath = string[];
export type MergeResult<T> = { value: T; conflicts: MergePath[] };

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const idOf = (value: unknown) => (isObject(value) && typeof value.id === "string" ? value.id : null);
const isIdList = (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) && value.every((item) => idOf(item) !== null);
// The segment for a list item is its id, marked so a label can tell rows from object keys.
const itemSegment = (id: string) => `#${id}`;

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!sameJson(a[key], b[key])) return false;
    return true;
  }
  // A missing key, undefined and null are the same thing once stored.
  return (a ?? null) === (b ?? null);
}

/**
 * The same JSON text for the same content, whatever order the keys come in (2026-10-09). The database stores a task's
 * data with its keys in its own order, so text made from what was typed and from the server's reply could differ for an
 * unchanged task: the page then said "Ändringar som inte har sparats går förlorade" on a finished, locked work order
 * and stopped the link that was clicked. Keys are sorted, and a missing key, undefined and null count as the same
 * (as in sameJson).
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? "null";
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonical(item) ?? null);
  if (!isObject(value)) return value ?? null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) if (value[key] !== undefined && value[key] !== null) out[key] = canonical(value[key]);
  return out;
}

export function threeWayMerge<T>(base: T, mine: T, theirs: T): MergeResult<T> {
  const conflicts: MergePath[] = [];
  const value = merge(base, mine, theirs, [], conflicts, "mine") as T;
  return { value, conflicts };
}

/** A place both changed differently, with both values: what the person had (`mine`) and what is saved (`theirs`). */
export type FieldConflict = { path: MergePath; mine: unknown; theirs: unknown };

/**
 * The merge after a refused save (409, 2026-10-28: "inte tyst skriver över andras ändringar ... tydlig information
 * om vad som faktiskt sparats"). Unlike the live merge, where the person has already been told and their change wins, a
 * save that met a newer version has told nobody: places both changed keep what is saved, and each conflict carries the
 * person's own value so the page can say so and offer it back. Places changed by only one side merge as in threeWayMerge.
 */
export function mergeKeepingSaved<T>(base: T, mine: T, theirs: T): { value: T; conflicts: FieldConflict[] } {
  const paths: MergePath[] = [];
  const value = merge(base, mine, theirs, [], paths, "theirs") as T;
  return { value, conflicts: paths.map((path) => ({ path, mine: valueAtPath(mine, path), theirs: valueAtPath(theirs, path) })) };
}

type Winner = "mine" | "theirs";

function merge(base: unknown, mine: unknown, theirs: unknown, path: MergePath, conflicts: MergePath[], winner: Winner): unknown {
  if (sameJson(mine, base)) return theirs;
  if (sameJson(theirs, base)) return mine;
  if (sameJson(mine, theirs)) return mine;
  if (isObject(mine) && isObject(theirs) && (base === undefined || isObject(base))) {
    const from = (base ?? {}) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const merged = merge(from[key], mine[key], theirs[key], [...path, key], conflicts, winner);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }
  if (isIdList(mine) && isIdList(theirs) && (base === undefined || isIdList(base))) return mergeList((base ?? []) as Record<string, unknown>[], mine, theirs, path, conflicts, winner);
  conflicts.push(path);
  return winner === "mine" ? mine : theirs;
}

function mergeList(base: Record<string, unknown>[], mine: Record<string, unknown>[], theirs: Record<string, unknown>[], path: MergePath, conflicts: MergePath[], winner: Winner) {
  const byId = (list: Record<string, unknown>[]) => new Map(list.map((item) => [idOf(item)!, item]));
  const baseItems = byId(base), mineItems = byId(mine), theirItems = byId(theirs);
  const merged = new Map<string, unknown>();
  for (const id of new Set([...mineItems.keys(), ...theirItems.keys(), ...baseItems.keys()])) {
    const inBase = baseItems.get(id), inMine = mineItems.get(id), inTheirs = theirItems.get(id);
    const at = [...path, itemSegment(id)];
    if (inBase && (!inMine || !inTheirs)) {
      // Removed on one side: gone, unless the other side changed it meanwhile (then the winning side decides).
      const kept = inMine ?? inTheirs;
      if (kept && !sameJson(kept, inBase)) {
        conflicts.push(at);
        const winning = winner === "mine" ? inMine : inTheirs;
        if (winning) merged.set(id, winning);
      }
      continue;
    }
    if (!inBase && inMine && inTheirs) { merged.set(id, merge(undefined, inMine, inTheirs, at, conflicts, winner)); continue; }
    if (!inBase) { merged.set(id, inMine ?? inTheirs); continue; }
    merged.set(id, merge(inBase, inMine, inTheirs, at, conflicts, winner));
  }
  // My order, with the rows only the other side added placed after the row they followed there.
  const order = mine.map((item) => idOf(item)!).filter((id) => merged.has(id));
  theirs.forEach((item, index) => {
    const id = idOf(item)!;
    if (order.includes(id) || !merged.has(id)) return;
    const before = theirs.slice(0, index).reverse().map((other) => idOf(other)!).find((other) => order.includes(other));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  });
  return order.map((id) => merged.get(id));
}

/** The value at a merge path (a `#id` segment picks the list item with that id); undefined when it is not there. */
export function valueAtPath(source: unknown, path: MergePath): unknown {
  let current = source;
  for (const segment of path) {
    if (Array.isArray(current) && segment.startsWith("#")) current = current.find((item) => idOf(item) === segment.slice(1));
    else if (isObject(current)) current = current[segment];
    else return undefined;
  }
  return current;
}

/**
 * A copy with `value` put at `path` ("Använd min text" after a conflict, 2026-10-28). undefined removes the key
 * or the list item; a missing list item is added at the end. Nothing else changes.
 */
export function withValueAt<T>(source: T, path: MergePath, value: unknown): T {
  if (!path.length) return value as T;
  const [segment, ...rest] = path;
  if (Array.isArray(source) && segment.startsWith("#")) {
    const id = segment.slice(1);
    const index = source.findIndex((item) => idOf(item) === id);
    if (index < 0) return (rest.length || value === undefined ? source : [...source, value]) as T;
    const next = withValueAt(source[index], rest, value);
    return (next === undefined ? source.filter((_, at) => at !== index) : source.map((item, at) => at === index ? next : item)) as T;
  }
  const from: Record<string, unknown> = isObject(source) ? source : {};
  const next = withValueAt(from[segment], rest, value);
  const result: Record<string, unknown> = { ...from };
  if (next === undefined) delete result[segment]; else result[segment] = next;
  return result as T;
}

/**
 * The server trims text when it stores it, so "Bytt kabel " came back as "Bytt kabel" and the reply took the space the
 * person had just typed – the caret jumped and the next word stuck to the last (2026-10-05: "hoppar till").
 * Where the stored text is only the sent text trimmed, the sent text is kept; everything else follows the server.
 * Returns `server` itself when nothing differs that way.
 */
export function keepSentText<T>(sent: unknown, server: T): T {
  if (typeof server === "string") return (typeof sent === "string" && sent !== server && sent.trim() === server ? sent : server) as T;
  if (Array.isArray(server)) {
    if (!Array.isArray(sent)) return server;
    const byId = new Map(sent.map((item) => [idOf(item), item]));
    let changed = false;
    const items = server.map((item, index) => {
      const id = idOf(item);
      const kept = keepSentText(id !== null ? byId.get(id) : sent[index], item);
      if (kept !== item) changed = true;
      return kept;
    });
    return (changed ? items : server) as T;
  }
  if (isObject(server)) {
    if (!isObject(sent)) return server;
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(server)) {
      result[key] = keepSentText(sent[key], value);
      if (result[key] !== value) changed = true;
    }
    return (changed ? result : server) as T;
  }
  return server;
}

/** The places where two versions differ, as deep as objects and id lists go: what a person changed, or what came in. */
export function changedPaths(before: unknown, after: unknown, path: MergePath = []): MergePath[] {
  if (sameJson(before, after)) return [];
  if (isObject(before) && isObject(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => changedPaths(before[key], after[key], [...path, key]));
  if (isIdList(before) && isIdList(after)) {
    const old = new Map(before.map((item) => [idOf(item)!, item]));
    const now = new Map(after.map((item) => [idOf(item)!, item]));
    const ids = new Set([...old.keys(), ...now.keys()]);
    const inner = [...ids].flatMap((id) => old.has(id) && now.has(id) ? changedPaths(old.get(id), now.get(id), [...path, itemSegment(id)]) : [[...path, itemSegment(id)]]);
    // A reordering alone is a change of the list itself.
    return inner.length ? inner : [path];
  }
  return [path];
}

/** Whether a path lies inside (or is) another; a row's cell belongs to the row. */
export const pathWithin = (path: MergePath, outer: MergePath) => outer.length <= path.length && outer.every((segment, index) => path[index] === segment);
export const pathKey = (path: MergePath) => path.join("/");

const TASK_FIELD_LABELS: Record<string, string> = {
  title: "Rubrik", description: "Beskrivning", status: "Status", projectId: "Projekt", customerId: "Kund", facilityId: "Plats", workOrderId: "Hör till arbetsorder",
  assignedToUserId: "Ansvarig", assignedToName: "Ansvarig", dueDate: "Klart senast",
};
const DETAIL_LABELS: Record<string, string> = {
  executionNotes: "Utfört arbete", deviations: "Avvikelser", materials: "Material", signature: "Signering", closeNotes: "Avslutande kommentar",
  risks: "Identifierade risker", generalMeasures: "Gemensamma skyddsåtgärder", approval: "Godkännande",
};
const VALUE_LABELS: Record<string, string> = { signatures: "Signering", deviationComment: "Sammanfattning / avvikelser", images: "Bilder", sections: "Avsnitt", limits: "Gränsvärden" };

type LabelTask = { data: { kind: string; details: unknown } };

/** The name a person recognises for a changed place in a task, for "Erik ändrade också …". */
export function taskPathLabel(task: LabelTask, path: MergePath): string {
  const [head, , , group, key, item] = path;
  if (head !== "data") return TASK_FIELD_LABELS[head] ?? "ett fält";
  const field = path[2];
  if (task.data.kind !== "FORM") {
    const label = DETAIL_LABELS[field] ?? "ett fält";
    if (field === "risks" && path[3]?.startsWith("#")) {
      const risk = (task.data.details as { risks?: { id: string; hazard: string }[] }).risks?.find((entry) => entry.id === path[3].slice(1));
      return risk?.hazard ? `${label}: ${risk.hazard.slice(0, 60)}` : label;
    }
    if (field === "materials" && path[3]?.startsWith("#")) {
      const material = (task.data.details as { materials?: { id: string; name: string }[] }).materials?.find((entry) => entry.id === path[3].slice(1));
      return material?.name ? `${label}: ${material.name.slice(0, 60)}` : label;
    }
    return label;
  }
  if (field !== "values") return "formuläret";
  const document = (task.data.details as { document?: FormDocument }).document;
  const blocks = document ? formLeafBlocks(document) : [];
  const block = key ? blocks.find((entry) => "key" in entry && entry.key === key) : undefined;
  const blockLabel = block && "label" in block && block.label ? String(block.label) : null;
  if (group === "fields" || group === "tables") return blockLabel ?? "ett fält";
  if (group === "checklists") {
    const point = block?.type === "checklist" && item ? block.items.find((entry) => entry.id === item) : undefined;
    return [blockLabel, point?.text?.slice(0, 60)].filter(Boolean).join(": ") || "checklistan";
  }
  return VALUE_LABELS[group] ?? "ett fält";
}

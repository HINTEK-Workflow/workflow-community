import { partDepth, partPath, subtreeIds, type PartRow } from "./model";

/**
 * De gamla maskinträden (beslut 2026-11-02): allt under Utan plats tas bort, med samma regel som Ta bort för varje rad. Utan databas:
 * vad som går och vad som blir kvar. Det djupaste först, eftersom en del med delar under sig inte kan tas bort. En del med
 * historik blir kvar, och därmed allt ovanför den; delar bredvid den går. Ingenting tvingas.
 */
export type UnplacedPart = PartRow & { placeId: string | null };
export type UnplacedPlan = {
  machines: number;
  /** I den ordning de tas bort: det djupaste först. */
  remove: { id: string; name: string; way: string }[];
  keep: { id: string; name: string; way: string; reason: string }[];
};

export const KEPT_ABOVE = "Något under den finns kvar.";

export function planUnplaced(parts: readonly UnplacedPart[], historyRefusal: ReadonlyMap<string, string>): UnplacedPlan {
  const roots = parts.filter((part) => !part.parentId && !part.placeId);
  const inScope = roots.flatMap((root) => subtreeIds(parts, root.id));
  const byId = new Map(parts.map((part) => [part.id, part]));
  const way = (id: string) => [...partPath(parts, id), byId.get(id)?.name ?? ""].join(" › ");
  const kept = new Set<string>();
  const plan: UnplacedPlan = { machines: roots.length, remove: [], keep: [] };
  for (const id of [...inScope].sort((a, b) => partDepth(parts, b) - partDepth(parts, a) || a.localeCompare(b))) {
    const part = byId.get(id)!;
    const own = historyRefusal.get(id);
    const below = parts.some((row) => row.parentId === id && kept.has(row.id));
    if (!own && !below) { plan.remove.push({ id, name: part.name, way: way(id) }); continue; }
    kept.add(id);
    plan.keep.push({ id, name: part.name, way: way(id), reason: own ?? KEPT_ABOVE });
  }
  return plan;
}

/** `--company <id>` (required), and `--delete` alone says that it should really happen. Anything else is refused: this deletes data. */
export function parseRemovalArgs(argv: readonly string[]): { ok: true; companyId: string; execute: boolean } | { ok: false; error: string } {
  let companyId = "";
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--delete") execute = true;
    else if (arg === "--company") companyId = argv[++index] ?? "";
    else return { ok: false, error: `Okänt argument: ${arg}` };
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(companyId)) return { ok: false, error: "Ange företagets id med --company <id>." };
  return { ok: true, companyId, execute };
}

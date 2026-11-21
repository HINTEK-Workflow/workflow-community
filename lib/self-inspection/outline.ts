import { activityLabel, ANCHORS, peopleOverview, ROLE_CAPABILITIES, type CheckKind, type PersonOverview, type ProgramContent, type RoleCapability } from "./model";

/**
 * The programme as one document (2026-10-06): the numbered sections in their order, the linked data placed in
 * the section it belongs to, and two appendices. The screen (read and edit mode, the contents list) and the PDF follow
 * the same outline, so they never drift apart.
 *
 * Linked data goes into the section with the template's key; when a company has removed that section the data still
 * appears – the facts first, the organisation chart and the competence table in the appendices.
 */
export type DataBlock = "facts" | "ere" | "orgchart" | "competence";
export type OutlineEntry = {
  anchor: string;
  /** "1", "2" … for sections, "A", "B" for appendices, "" for the facts when they stand alone. */
  number: string;
  title: string;
  kind: "facts" | "section" | "appendix";
  sectionIndex?: number;
  blocks: DataBlock[];
};

const BLOCK_SECTION: Record<DataBlock, string> = { facts: "business", ere: "ere", orgchart: "organization", competence: "competence" };

export function programOutline(sections: readonly { key: string; title: string }[]): OutlineEntry[] {
  const keys = new Set(sections.map((section) => section.key).filter(Boolean));
  const entries: OutlineEntry[] = [];
  // The facts name the ERE as well, so they stand on their own when the section is gone.
  if (!keys.has(BLOCK_SECTION.facts)) entries.push({ anchor: ANCHORS.facts, number: "", title: "Programmets uppgifter", kind: "facts", blocks: ["facts"] });
  const placed = new Set<string>();
  sections.forEach((section, index) => {
    const blocks = (Object.keys(BLOCK_SECTION) as DataBlock[]).filter((block) => BLOCK_SECTION[block] === section.key && section.key && !placed.has(block));
    for (const block of blocks) placed.add(block);
    entries.push({ anchor: ANCHORS.section(index), number: String(index + 1), title: section.title || "Avsnitt utan rubrik", kind: "section", sectionIndex: index, blocks });
  });
  entries.push({ anchor: ANCHORS.roles, number: "A", title: "Roller och ansvar", kind: "appendix", blocks: placed.has("orgchart") ? [] : ["orgchart"] });
  entries.push({ anchor: ANCHORS.people, number: "B", title: "Personer och kompetens", kind: "appendix", blocks: placed.has("competence") ? [] : ["competence"] });
  return entries;
}

/**
 * What the field check found per part of the document (2026-10-18): a part that is folded on a phone or a tablet shows it in its row,
 * so nothing that needs attention hides behind a closed part. A check belongs to the part whose anchor it names; the facts
 * (`si-facts`) belong to the section that holds them.
 */
export type PartFlags = { missing: number; template: number; reminder: number };
export function partFlags(outline: readonly OutlineEntry[], checks: readonly { kind: CheckKind; anchor?: string }[]): Map<string, PartFlags> {
  const flags = new Map<string, PartFlags>();
  for (const check of checks) {
    if (!check.anchor) continue;
    const part = outline.find((entry) => entry.anchor === check.anchor) ?? (check.anchor === ANCHORS.facts ? outline.find((entry) => entry.blocks.includes("facts")) : undefined);
    if (!part) continue;
    const found = flags.get(part.anchor) ?? { missing: 0, template: 0, reminder: 0 };
    if (check.kind === "MISSING") found.missing += 1;
    else if (check.kind === "TEMPLATE") found.template += 1;
    else found.reminder += 1;
    flags.set(part.anchor, found);
  }
  return flags;
}

/**
 * Which parts of the editor are open (by anchor) follows the sections when one is added, moved or removed: the anchor of a section is
 * its place, so the open ones are renumbered with it and the part the person is working in stays open where it ends up.
 */
export type PartChange = { kind: "move"; from: number; to: number } | { kind: "insert"; at: number } | { kind: "remove"; at: number };
export function shiftOpenParts(open: ReadonlySet<string>, change: PartChange): Set<string> {
  const next = new Set<string>();
  for (const anchor of open) {
    const found = /^si-section-(\d+)$/.exec(anchor);
    if (!found) { next.add(anchor); continue; }
    const index = Number(found[1]);
    if (change.kind === "move") next.add(ANCHORS.section(index === change.from ? change.to : index === change.to ? change.from : index));
    else if (change.kind === "insert") next.add(ANCHORS.section(index >= change.at ? index + 1 : index));
    else if (index !== change.at) next.add(ANCHORS.section(index > change.at ? index - 1 : index));
  }
  if (change.kind === "insert") next.add(ANCHORS.section(change.at));
  return next;
}

/**
 * Where each saved section is now: an unsaved move, insert or remove changes the order but not the section (its id). Open parts, and the field
 * check kept per saved place, follow the section to the place it has now; a section that is gone (or not saved yet) has none.
 */
export function remapSectionAnchors<T extends { anchor?: string }>(items: readonly T[], from: readonly { id?: string }[], to: readonly { id?: string }[]): T[] {
  return items.flatMap((item) => {
    const found = item.anchor ? /^si-section-(\d+)$/.exec(item.anchor) : null;
    if (!found) return [item];
    const id = from[Number(found[1])]?.id;
    const at = id ? to.findIndex((section) => section.id === id) : -1;
    return at < 0 ? [] : [{ ...item, anchor: ANCHORS.section(at) }];
  });
}

export const capabilityLabel = (key: RoleCapability) => ROLE_CAPABILITIES.find((item) => item.key === key)?.label ?? key;

/** What a person may do, in words: the work stated in the competence data, else what the person's roles do. */
export function mayDo(person: PersonOverview): string {
  const work = person.competence ? [person.competence.scope.trim(), person.competence.workTypes.map(activityLabel).join(", ")].filter(Boolean) : [];
  const roles = person.capabilities.filter((key) => key === "perform" || key === "inspect" || key === "plan").map(capabilityLabel);
  return [...work, ...(work.length ? [] : roles)].join(" · ") || "Inget angivet";
}
/** What a reader who may not see the person's competence reads instead (2026-10-09). */
export const COMPETENCE_HIDDEN_TEXT = "Visas bara för personen och administratören";
export function limitationsOf(person: PersonOverview): string {
  if (person.competenceHidden) return COMPETENCE_HIDDEN_TEXT;
  if (!person.competence) return person.capabilities.some((key) => key === "perform" || key === "inspect") ? "Kompetensen är inte dokumenterad" : "–";
  return [person.competence.supervised ? "Arbetar under handledning" : "", person.competence.limitations.trim()].filter(Boolean).join(". ") || "Inga";
}

/** The organisation chart's rows, from the roles alone: who leads, who supports, who plans, who does the work. */
export const ORG_LEVELS = ["Ledning", "Stöd för regelefterlevnad och programmet", "Planering", "Utförande och kontroll"] as const;
export function orgLevel(role: Pick<ProgramContent["roles"][number], "key" | "isEre" | "capabilities">): number {
  if (role.key === "manager") return 0;
  if (role.isEre || role.key === "program_admin") return 1;
  if (role.capabilities.includes("approve") && !role.capabilities.some((key) => key === "plan" || key === "perform" || key === "inspect")) return role.capabilities.includes("deviations") ? 1 : 0;
  if (role.capabilities.includes("plan")) return 2;
  return 3;
}
export function orgChart<T extends Pick<ProgramContent["roles"][number], "key" | "isEre" | "capabilities">>(roles: readonly T[]) {
  return ORG_LEVELS.map((label, level) => ({ label, roles: roles.filter((role) => orgLevel(role) === level) })).filter((row) => row.roles.length);
}

export { peopleOverview };

/**
 * Egenkontroll, ny struktur (2026-11-24): the pure rules behind Rollbeskrivningar, Kompetenskort, Organisation och
 * ansvar and Inhyrd personal, shared by Cloud, Local, the demo and the screen. No database code and no import from ./model,
 * so the model can use these rules.
 *
 * - A person's level is counted from their years of experience with the company's limits (default 2 and 5): under the first
 *   is level 1, up to and including the second level 2, above it level 3. An admin may adjust it either way with a reason,
 *   and a new counted level waits until an admin confirms it.
 * - A role's level is the role's level requirement: a person below it is a warning, never a stop.
 * - The roles form one tree; a role stands in one place. Without a tree of the company's own, the automatic chart is a proposal.
 * - The programme's text can hold markers on a line of their own that Workflow fills in ({{roller}} and the others).
 */

export type Level = 1 | 2 | 3;
export const DEFAULT_LEVEL_YEARS: readonly [number, number] = [2, 5];
const asLevel = (value: unknown): Level | null => value === 1 || value === 2 || value === 3 ? value : null;

/** The company's limits as stored; anything that does not read as two rising whole years is the default. */
export function levelYearsOf(value: readonly number[] | null | undefined): [number, number] {
  const [first, second] = value ?? [];
  return Number.isInteger(first) && Number.isInteger(second) && first! >= 1 && second! > first! && second! <= 60 ? [first!, second!] : [...DEFAULT_LEVEL_YEARS] as [number, number];
}
/** "Under 2 år ger nivå 1, 2 till och med 5 år ger nivå 2 och över 5 år ger nivå 3." */
export const levelRuleText = (years: readonly number[] | null | undefined) => {
  const [first, second] = levelYearsOf(years);
  return `Under ${first} år ger nivå 1, ${first} till och med ${second} år ger nivå 2 och över ${second} år ger nivå 3.`;
};

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Years between two days, as a decimal number (never below zero). */
export function yearsBetween(from: string, to: string) {
  if (!DAY.test(from) || !DAY.test(to)) return 0;
  return Math.max(0, (dayNumber(to) - dayNumber(from)) / 365.25);
}

export type ExperienceFacts = { experienceSince?: string | null; experienceYears?: number | null; experienceYearsAt?: string | null };
/** The person's years of experience today: since a day, or a number of years on a day and the time after it. */
export function experienceYearsOn(card: ExperienceFacts, today: string): number | null {
  if (card.experienceSince && DAY.test(card.experienceSince)) return yearsBetween(card.experienceSince, today);
  if (typeof card.experienceYears === "number" && card.experienceYears >= 0) return card.experienceYears + (card.experienceYearsAt ? yearsBetween(card.experienceYearsAt, today) : 0);
  return null;
}
export function levelFromYears(years: number, limits: readonly number[] | null | undefined): Level {
  const [first, second] = levelYearsOf(limits);
  return years < first ? 1 : years <= second ? 2 : 3;
}

export type PersonLevelFacts = ExperienceFacts & { level?: number | null; levelOverride?: number | null; levelReason?: string | null };
export type PersonLevel = {
  /** Years of experience today, or null when the card says none. */
  years: number | null;
  /** The level the years give today. */
  counted: Level | null;
  /** The level that applies: the admin's adjustment, else the confirmed level (else the counted one). */
  level: Level | null;
  adjusted: boolean;
  reason: string;
  /** A higher counted level that waits for the admin's confirmation. */
  pending: Level | null;
};
export function personLevel(card: PersonLevelFacts | null | undefined, limits: readonly number[] | null | undefined, today: string): PersonLevel {
  const years = card ? experienceYearsOn(card, today) : null;
  const counted = years === null ? null : levelFromYears(years, limits);
  const confirmed = asLevel(card?.level) ?? counted;
  const override = asLevel(card?.levelOverride);
  return { years, counted, level: override ?? confirmed, adjusted: override !== null, reason: override !== null ? card?.levelReason?.trim() ?? "" : "",
    pending: override === null && counted !== null && confirmed !== null && counted > confirmed ? counted : null };
}
/** "Nivå 2", "Nivå 3 · Justerad (räknad: 2)". */
export function personLevelText(level: PersonLevel) {
  if (!level.level) return "Ingen nivå";
  return level.adjusted ? `Nivå ${level.level} · Justerad (räknad: ${level.counted ?? "–"})` : `Nivå ${level.level}`;
}
/** "3,5 år" – the years one decimal, Swedish style. */
export const yearsText = (years: number | null) => years === null ? "" : `${(Math.floor(years * 10) / 10).toLocaleString("sv-SE")} år`;

// ---------- the card's words ----------

export const CREDENTIAL_KINDS = { TRAINING: "Utbildning", AUTHORIZATION: "Behörighet", CERTIFICATE: "Intyg" } as const;
export type CredentialKind = keyof typeof CREDENTIAL_KINDS;
export const credentialKind = (value: unknown): CredentialKind => value === "AUTHORIZATION" || value === "CERTIFICATE" ? value : "TRAINING";
/** Suggestions only; the company writes its own form when none fits. */
export const EMPLOYMENT_FORMS = ["Tillsvidareanställning", "Visstidsanställning", "Provanställning", "Timanställning", "Lärlingsanställning"] as const;

/**
 * The start lists (2026-11-24): short, neutral and in Workflow's own words, so a company has something to tick from the
 * start. Each company changes its own list; nothing here is taken from a standard or another company's material.
 */
export const STARTER_EXPERIENCE_AREAS = [
  "Bostäder", "Kontor och butiker", "Industri", "Service och felsökning", "Belysning", "Laddplatser för elfordon",
  "Solceller", "Styr och regler", "Data och tele", "Larm och passage",
] as const;
export const STARTER_COMPETENCE_GROUPS = [
  { name: "Installation", description: "Nya installationer och ombyggnad." },
  { name: "Service", description: "Felsökning, reparation och mindre ändringar." },
  { name: "Planering", description: "Planering och kravbestämning inför arbete." },
  { name: "Kontroll", description: "Kontroll och mätning av utfört arbete." },
] as const;

// ---------- inhyrd personal ----------

export type ExternalFacts = { included: boolean; periodFrom?: string | null; periodTo?: string | null };
/** The period has ended: the switch is turned off. */
export const externalPeriodEnded = (person: ExternalFacts, today: string) => Boolean(person.periodTo && person.periodTo < today);
/** In the programme now: the switch is on and today is within the period. */
export const externalInProgramme = (person: ExternalFacts, today: string) =>
  person.included && !externalPeriodEnded(person, today) && !(person.periodFrom && person.periodFrom > today);

// ---------- the tree ----------

export type TreeRole = { id: string; name: string; key?: string; isEre?: boolean; capabilities?: readonly string[]; parentId?: string | null; treeOrder?: number | null; sortOrder?: number };
export type TreeNode = { roleId: string; parentId: string | null; order: number };

/** Which of the four rows of the automatic chart a role belongs to (as the chart always drew it). */
function chartRow(role: TreeRole) {
  const capabilities = role.capabilities ?? [];
  if (role.key === "manager") return 0;
  if (role.isEre || role.key === "program_admin") return 1;
  if (capabilities.includes("approve") && !capabilities.some((key) => key === "plan" || key === "perform" || key === "inspect")) return capabilities.includes("deviations") ? 1 : 0;
  if (capabilities.includes("plan")) return 2;
  return 3;
}
/**
 * The automatic chart as a proposal for a tree: the management at the top, the support beside each other under it, and the
 * planning and the work under the first role for compliance (or under the top when there is none).
 */
export function proposedTree(roles: readonly TreeRole[]): TreeNode[] {
  const ordered = [...roles].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const rows = [0, 1, 2, 3].map((row) => ordered.filter((role) => chartRow(role) === row));
  const top = rows[0][0] ?? null;
  const support = rows[1].find((role) => role.isEre) ?? null;
  const nodes: TreeNode[] = [];
  const put = (role: TreeRole, parentId: string | null) => nodes.push({ roleId: role.id, parentId, order: nodes.filter((node) => node.parentId === parentId).length });
  for (const role of rows[0]) put(role, role === top ? null : top?.id ?? null);
  for (const role of rows[1]) put(role, top?.id ?? null);
  for (const role of [...rows[2], ...rows[3]]) put(role, support?.id ?? top?.id ?? null);
  return nodes;
}
/** The company's own tree, or the proposal when it has none. A parent that is gone reads as the top. */
export function roleTree(roles: readonly TreeRole[], saved: boolean): TreeNode[] {
  if (!saved) return proposedTree(roles);
  const ids = new Set(roles.map((role) => role.id));
  return roles.map((role) => ({ roleId: role.id, parentId: role.parentId && ids.has(role.parentId) && role.parentId !== role.id ? role.parentId : null, order: role.treeOrder ?? 0 }));
}
/** Why a tree cannot be saved, or null: every role once, parents among the roles, no role under itself. */
export function treeRefusal(nodes: readonly { roleId: string; parentId: string | null }[], roleIds: readonly string[]): string | null {
  const known = new Set(roleIds);
  const seen = new Set<string>();
  for (const node of nodes) {
    if (!known.has(node.roleId)) return "En roll i trädet finns inte längre. Ladda om sidan.";
    if (seen.has(node.roleId)) return "En roll kan bara stå på ett ställe i trädet.";
    seen.add(node.roleId);
    if (node.parentId && !known.has(node.parentId)) return "En roll i trädet finns inte längre. Ladda om sidan.";
    if (node.parentId === node.roleId) return "En roll kan inte stå under sig själv.";
  }
  const parent = new Map(nodes.map((node) => [node.roleId, node.parentId]));
  for (const node of nodes) {
    const chain = new Set<string>();
    for (let at: string | null | undefined = node.roleId; at; at = parent.get(at)) {
      if (chain.has(at)) return "En roll kan inte stå under en roll som står under den själv.";
      chain.add(at);
    }
  }
  return null;
}
/** Whether `roleId` may be put under `parentId` (never under itself or one of its own). */
export function mayPlaceUnder(nodes: readonly TreeNode[], roleId: string, parentId: string | null) {
  if (!parentId) return true;
  const parent = new Map(nodes.map((node) => [node.roleId, node.parentId]));
  for (let at: string | null | undefined = parentId; at; at = parent.get(at)) if (at === roleId) return false;
  return true;
}
// ---------- the chart (Organisation och ansvar, 2026-11-24: built in the chart itself, as a hierarchy in Word) ----------

/** A role taken out of the chart keeps its row with the order -1 (no new column): it is not drawn, the role itself stays. */
export const OUT_OF_CHART = -1;
export const inChart = (node: Pick<TreeNode, "order">) => node.order >= 0;
export type ChartNode = { roleId: string; children: ChartNode[] };
/** The chart as nested boxes: the tops side by side, each box's children under it in their order. */
export function chartForest(nodes: readonly TreeNode[]): ChartNode[] {
  const shown = nodes.filter(inChart);
  const ids = new Set(shown.map((node) => node.roleId));
  const children = new Map<string | null, TreeNode[]>();
  for (const node of shown) { const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null; children.set(parent, [...(children.get(parent) ?? []), node]); }
  const seen = new Set<string>();
  const build = (parentId: string | null, depth: number): ChartNode[] => [...(children.get(parentId) ?? [])].sort((a, b) => a.order - b.order)
    .filter((node) => !seen.has(node.roleId) && depth < 12 && (seen.add(node.roleId), true))
    .map((node) => ({ roleId: node.roleId, children: build(node.roleId, depth + 1) }));
  return build(null, 0);
}
/** The siblings under `parentId` in the chart, in their order. */
export const chartSiblings = (nodes: readonly TreeNode[], parentId: string | null) =>
  nodes.filter((node) => inChart(node) && (node.parentId ?? null) === parentId).sort((a, b) => a.order - b.order);
/** Every sibling group numbered 0, 1, 2 … in its present order; the roles out of the chart keep -1. */
export function renumberChart(nodes: readonly TreeNode[]): TreeNode[] {
  const order = new Map<string, number>();
  const groups = new Map<string | null, TreeNode[]>();
  for (const node of nodes.filter(inChart)) groups.set(node.parentId ?? null, [...(groups.get(node.parentId ?? null) ?? []), node]);
  for (const group of groups.values()) group.sort((a, b) => a.order - b.order).forEach((node, index) => order.set(node.roleId, index));
  return nodes.map((node) => inChart(node) ? { ...node, order: order.get(node.roleId)! } : { ...node, parentId: null, order: OUT_OF_CHART });
}
/**
 * Puts `roleId` under `parentId` at `index` among its new siblings (last when left out); its own children follow it. Refused
 * (null) under itself or one of its own. A role out of the chart comes into it this way too ("Lägg till").
 */
export function placeInChart(nodes: readonly TreeNode[], roleId: string, parentId: string | null, index?: number): TreeNode[] | null {
  if (parentId === roleId || !mayPlaceUnder(nodes, roleId, parentId)) return null;
  const siblings = chartSiblings(nodes, parentId).filter((node) => node.roleId !== roleId);
  const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  const placed = new Map<string, number>(siblings.map((node, position) => [node.roleId, position < at ? position : position + 1]));
  return renumberChart(nodes.map((node) => node.roleId === roleId ? { ...node, parentId, order: at } : placed.has(node.roleId) ? { ...node, order: placed.get(node.roleId)! } : node));
}
/** Ta bort ur schemat: the box goes, the role stays; its children move up one step into its place. */
export function removeFromChart(nodes: readonly TreeNode[], roleId: string): TreeNode[] {
  const removed = nodes.find((node) => node.roleId === roleId);
  if (!removed || !inChart(removed)) return [...nodes];
  const parentId = removed.parentId ?? null;
  const kids = chartSiblings(nodes, roleId).map((node) => node.roleId);
  const siblings = chartSiblings(nodes, parentId).map((node) => node.roleId);
  const ordered = siblings.flatMap((id) => id === roleId ? kids : [id]);
  return renumberChart(nodes.map((node) => node.roleId === roleId ? { ...node, parentId: null, order: OUT_OF_CHART }
    : ordered.includes(node.roleId) ? { ...node, parentId, order: ordered.indexOf(node.roleId) } : node));
}
/** Flytta upp / ned among its siblings. */
export function moveInChart(nodes: readonly TreeNode[], roleId: string, step: -1 | 1): TreeNode[] {
  const node = nodes.find((item) => item.roleId === roleId);
  if (!node || !inChart(node)) return [...nodes];
  const index = chartSiblings(nodes, node.parentId ?? null).findIndex((item) => item.roleId === roleId);
  return placeInChart(nodes, roleId, node.parentId ?? null, index + step) ?? [...nodes];
}

// ---------- the free chart (2026-11-24: cards placed freely, lines drawn by hand) ----------

/** The chart's grid: a fixed number of columns across the page's width, rows of a fixed height; a card is CARD_COLUMNS wide. */
export const GRID_COLUMNS = 24;
export const CARD_COLUMNS = 4;
export const ROW_PX = 24;
export type CardPlace = { roleId: string; x: number | null; y: number | null; parentId: string | null };
export const onChart = (card: Pick<CardPlace, "x" | "y">) => card.x !== null && card.y !== null;
export const clampColumn = (x: number) => Math.max(0, Math.min(GRID_COLUMNS - CARD_COLUMNS, Math.round(x)));
export const clampRow = (y: number) => Math.max(0, Math.min(2000, Math.round(y)));
/**
 * The tree the programme and the PDF read from the free chart: a card's line upwards is its parent, and siblings stand in the
 * order of their places (left to right, then top to bottom). A role not on the chart gets the order -1 and no parent.
 */
export function chartOrder(cards: readonly CardPlace[]): Map<string, { parentId: string | null; order: number }> {
  const placed = cards.filter(onChart);
  const ids = new Set(placed.map((card) => card.roleId));
  const result = new Map<string, { parentId: string | null; order: number }>();
  const groups = new Map<string | null, CardPlace[]>();
  for (const card of placed) { const parent = card.parentId && ids.has(card.parentId) ? card.parentId : null; groups.set(parent, [...(groups.get(parent) ?? []), card]); }
  for (const [parentId, group] of groups) group.sort((a, b) => a.x! - b.x! || a.y! - b.y!).forEach((card, order) => result.set(card.roleId, { parentId, order }));
  for (const card of cards) if (!onChart(card)) result.set(card.roleId, { parentId: null, order: OUT_OF_CHART });
  return result;
}
/** Whether a line from `childId` up to `parentId` would make a ring (the parent already stands under the child). */
export function wouldRing(cards: readonly Pick<CardPlace, "roleId" | "parentId">[], childId: string, parentId: string) {
  const parent = new Map(cards.map((card) => [card.roleId, card.parentId]));
  for (let at: string | null | undefined = parentId; at; at = parent.get(at)) if (at === childId) return true;
  return false;
}
/**
 * Ordna korten (2026-11-24: "skall göra organisationsträdet symmetriskt"): a card's height in rows when it is not
 * measured, the rows between two levels, the gap between siblings, and the gap between the two columns of hanging children
 * (even, so the parent's line stands exactly in the middle).
 */
export const CARD_ROWS = 5;
export const LEVEL_GAP_ROWS = 3;
const SIBLING_GAP = 1;
const HANG_GAP = 2;
/** A card in a block: its column, its level below the block's top and its row within a hanging pair of columns. */
type Rect = { id: string; x: number; d: number; s: number };
type Layout = { node: ChartNode; rects: Rect[]; width: number; spreads: boolean };
const rightOf = (rects: readonly Rect[]) => Math.max(...rects.map((rect) => rect.x + CARD_COLUMNS));
const shifted = (rects: readonly Rect[], dx: number, dd = 0) => rects.map((rect) => ({ ...rect, x: rect.x + dx, d: rect.d + dd }));
const toLeft = (rects: readonly Rect[]) => shifted(rects, -Math.min(...rects.map((rect) => rect.x)));
/** The least distance between two blocks' top cards so that no card of the second meets one of the first on the same level. */
function topDistance(first: readonly Rect[], second: readonly Rect[], gap: number) {
  let need = CARD_COLUMNS + gap;
  for (const a of first) for (const b of second) if (a.d === b.d) need = Math.max(need, (a.x - first[0]!.x) + CARD_COLUMNS + gap - (b.x - second[0]!.x));
  return need;
}
/**
 * Blocks side by side in their order with the same distance between every pair of neighbouring tops (so the gaps are equal and
 * the row is symmetric), as close as the levels below allow. Returns the blocks placed and the parent's column, exactly in the
 * middle of the first and last top when the width allows it.
 */
function evenRow(blocks: readonly Rect[][], gap: number, columns: number): { rects: Rect[]; middle: number } {
  let step = CARD_COLUMNS + gap;
  for (let i = 0; i < blocks.length; i += 1) for (let j = i + 1; j < blocks.length; j += 1) step = Math.max(step, Math.ceil(topDistance(blocks[i]!, blocks[j]!, gap) / (j - i)));
  const place = (distance: number) => {
    const rects = blocks.flatMap((block, index) => shifted(block, index * distance - block[0]!.x));
    return { rects, middle: Math.floor((blocks.length - 1) * distance / 2) };
  };
  // An odd total would put the parent half a column off: one column more when it still fits.
  if (((blocks.length - 1) * step) % 2) { const wider = place(step + 1); if (rightOf(toLeft(wider.rects)) <= columns) return wider; }
  return place(step);
}
/**
 * A tidy, symmetric chart for a forest (Reingold–Tilford with contours): each top card at the top, every parent exactly over the
 * middle of its children, siblings in their order with equal gaps, every level on one row across the whole chart (the same y),
 * and the whole chart centred. Nothing overlaps and everything stands on the grid. Wide and low before narrow and high: when a
 * level does not fit across the width the gaps close first, then the widest child that spreads its own children hangs them, and
 * only then do this card's children hang – symmetrically, in two columns on either side of the parent's line. Top cards without
 * any line stand in rows at the bottom after a clear gap. `rowsOf` gives a card's measured height in rows, so a level is as high
 * as its tallest card. Used by Ordna korten, Börja från förslag and the demo; the grid is relative, so it fits at every width.
 */
export function arrangeForest(forest: readonly ChartNode[], options: { columns?: number; rowsOf?: (roleId: string) => number } = {}): Map<string, { x: number; y: number }> {
  const columns = options.columns ?? GRID_COLUMNS;
  const rowsOf = options.rowsOf ?? (() => CARD_ROWS);
  const layout = (node: ChartNode, hang = false): Layout => {
    if (!node.children.length) return { node, rects: [{ id: node.roleId, x: 0, d: 0, s: 0 }], width: CARD_COLUMNS, spreads: false };
    const kids = node.children.map((child) => layout(child));
    const spread = (gap: number) => {
      const row = evenRow(kids.map((kid) => shifted(kid.rects, 0, 1)), gap, columns);
      return toLeft([{ id: node.roleId, x: row.middle, d: 0, s: 0 }, ...row.rects]);
    };
    if (!hang) for (;;) {
      for (const gap of [SIBLING_GAP, 0]) {
        const rects = spread(gap);
        if (rightOf(rects) <= columns) return { node, rects, width: rightOf(rects), spreads: true };
      }
      const widest = kids.filter((kid) => kid.spreads).sort((a, b) => b.width - a.width)[0];
      if (!widest) break;
      kids[kids.indexOf(widest)] = layout(widest.node, true);
    }
    if (kids.every((kid) => !kid.node.children.length)) {
      // Hanging, symmetric: two columns on either side of the parent's line, in reading order; an odd last one in the middle.
      const right = CARD_COLUMNS + HANG_GAP, middle = (CARD_COLUMNS + HANG_GAP) / 2;
      const rects: Rect[] = [{ id: node.roleId, x: middle, d: 0, s: 0 }, ...kids.map((kid, index) => ({ id: kid.node.roleId,
        x: index === kids.length - 1 && index % 2 === 0 ? middle : index % 2 ? right : 0, d: 1, s: Math.floor(index / 2) }))];
      return { node, rects, width: rightOf(rects), spreads: false };
    }
    // The last way out (children with their own children that do not fit even hanging): each child's branch under the one before.
    const indent = Math.max(...kids.map((kid) => kid.width)) + 1 <= columns ? 1 : 0;
    const rects: Rect[] = [{ id: node.roleId, x: 0, d: 0, s: 0 }];
    let depth = 1;
    for (const kid of kids) { rects.push(...shifted(kid.rects, indent, depth)); depth = Math.max(...rects.map((rect) => rect.d)) + 1; }
    return { node, rects, width: rightOf(rects), spreads: false };
  };
  const trees = forest.filter((node) => node.children.length).map((node) => layout(node));
  const loose = forest.filter((node) => !node.children.length);
  // The trees side by side when they fit (evenly, closing the gaps first), otherwise one under the other; centred.
  let chart: Rect[] = [];
  const side = trees.length ? [SIBLING_GAP, 0].map((gap) => toLeft(evenRow(trees.map((tree) => tree.rects), gap, columns).rects)).find((rects) => rightOf(rects) <= columns) : [];
  if (side) chart = shifted(side, Math.floor((columns - (side.length ? rightOf(side) : 0)) / 2));
  else {
    let depth = 0;
    for (const tree of trees) { chart.push(...shifted(tree.rects, Math.floor((columns - tree.width) / 2), depth)); depth = Math.max(...chart.map((rect) => rect.d)) + 1; }
  }
  // Every level on one row: as high as its tallest card (a hanging pair of columns as high as its rows).
  const levels = chart.length ? Math.max(...chart.map((rect) => rect.d)) + 1 : 0;
  const tallest = Array.from({ length: levels }, (_, d) => Math.max(CARD_ROWS, ...chart.filter((rect) => rect.d === d).map((rect) => rowsOf(rect.id))));
  const subRows = Array.from({ length: levels }, (_, d) => Math.max(0, ...chart.filter((rect) => rect.d === d).map((rect) => rect.s)) + 1);
  const top: number[] = [];
  for (let d = 0, y = 0; d < levels; d += 1) { top[d] = y; y += subRows[d]! * (tallest[d]! + 1) - 1 + LEVEL_GAP_ROWS; }
  const places = new Map<string, { x: number; y: number }>();
  for (const rect of chart) places.set(rect.id, { x: rect.x, y: top[rect.d]! + rect.s * (tallest[rect.d]! + 1) });
  // The cards without lines in rows at the bottom, after a clear gap.
  if (loose.length) {
    const perLine = Math.max(1, Math.floor((columns + SIBLING_GAP) / (CARD_COLUMNS + SIBLING_GAP)));
    const height = Math.max(CARD_ROWS, ...loose.map((node) => rowsOf(node.roleId)));
    let y = levels ? top[levels - 1]! + subRows[levels - 1]! * (tallest[levels - 1]! + 1) - 1 + LEVEL_GAP_ROWS + 2 : 0;
    for (let start = 0; start < loose.length; start += perLine) {
      const line = loose.slice(start, start + perLine);
      let x = Math.floor((columns - (line.length * (CARD_COLUMNS + SIBLING_GAP) - SIBLING_GAP)) / 2);
      for (const node of line) { places.set(node.roleId, { x, y }); x += CARD_COLUMNS + SIBLING_GAP; }
      y += height + 1;
    }
  }
  return places;
}
/**
 * Ordna korten: the cards on the chart arranged from their lines, siblings kept in their order (left to right, then top to
 * bottom); `rowsOf` gives the cards' measured heights in rows.
 */
export function arrangeCards<T extends CardPlace>(cards: readonly T[], rowsOf?: (roleId: string) => number): T[] {
  const placed = cards.filter(onChart);
  const order = chartOrder(placed);
  const places = arrangeForest(chartForest(placed.map((card) => ({ roleId: card.roleId, parentId: order.get(card.roleId)!.parentId, order: order.get(card.roleId)!.order }))), { rowsOf });
  return cards.map((card) => places.has(card.roleId) ? { ...card, ...places.get(card.roleId)! } : card);
}
/** Places for a tree without any (Börja från förslag, or a chart saved before cards had places): the same tidy layout. */
export function treePlaces(forest: readonly ChartNode[]): Map<string, { x: number; y: number }> {
  return arrangeForest(forest);
}

/** The tree in reading order with each role's depth (for the document and the PDF); roles out of the chart are left out. */
export function treeRows(nodes: readonly TreeNode[]): { roleId: string; depth: number }[] {
  const children = new Map<string | null, TreeNode[]>();
  for (const node of nodes.filter(inChart)) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const rows: { roleId: string; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const node of [...(children.get(parentId) ?? [])].sort((a, b) => a.order - b.order)) {
      if (seen.has(node.roleId) || depth > 12) continue;
      seen.add(node.roleId);
      rows.push({ roleId: node.roleId, depth });
      walk(node.roleId, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

// ---------- markers in the programme's text ----------

/** What Workflow fills in where a line holds only the marker. */
export const PROGRAM_MARKERS = {
  roller: "Rollerna med uppgifter",
  organisation: "Organisationsträdet",
  ere: "Elinstallatör för regelefterlevnad med auktorisation",
  personal: "Personer med roll och nivå",
  nivaregel: "Nivåregeln med företagets gränser",
  inhyrda: "Inhyrd personal som ingår i programmet",
} as const;
export type ProgramMarker = keyof typeof PROGRAM_MARKERS;
const MARKER_LINE = /^\s*\{\{\s*([a-zåäö]+)\s*\}\}\s*$/i;
export const markerText = (key: ProgramMarker) => `{{${key}}}`;
export type MarkedPart = { kind: "text"; text: string } | { kind: "marker"; marker: ProgramMarker };
/** The text split at its marker lines; an unknown marker stays text. */
export function splitMarkers(body: string): MarkedPart[] {
  const parts: MarkedPart[] = [];
  let text: string[] = [];
  const flush = () => { if (text.join("\n").trim()) parts.push({ kind: "text", text: text.join("\n") }); text = []; };
  for (const line of body.split("\n")) {
    const found = MARKER_LINE.exec(line);
    const key = found?.[1]?.toLocaleLowerCase("sv") as ProgramMarker | undefined;
    if (key && key in PROGRAM_MARKERS) { flush(); parts.push({ kind: "marker", marker: key }); } else text.push(line);
  }
  flush();
  return parts;
}
export const markersIn = (body: string) => splitMarkers(body).flatMap((part) => part.kind === "marker" ? [part.marker] : []);

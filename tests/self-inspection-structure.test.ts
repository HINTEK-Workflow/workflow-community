import assert from "node:assert/strict";
import test from "node:test";
import { applySelfInspectionAction, type DocumentActor } from "../lib/self-inspection/document";
import { documentLevels, emptySelfInspectionDocument, programContent, programExtras, selfInspectionView, SelfInspectionError, type SelfInspectionAction, type SelfInspectionDocument } from "../lib/self-inspection/model";
import { arrangeCards, CARD_COLUMNS, CARD_ROWS, chartForest, chartOrder, externalInProgramme, GRID_COLUMNS, treePlaces, wouldRing, levelFromYears, levelRuleText, markersIn, moveInChart, OUT_OF_CHART, personLevel, placeInChart, proposedTree, removeFromChart, roleTree, splitMarkers, treeRefusal, treeRows, type TreeNode } from "../lib/self-inspection/structure";
import { TEMPLATE_ROLES } from "../lib/self-inspection/template";

// Egenkontroll, ny struktur (2026-11-24): the level from the years, adjustment and confirmation, the tree, hired staff and the
// markers – the pure rules and the Local document (Cloud applies the same rules in lib/self-inspection/server.ts).
const admin: DocumentActor = { id: "u-admin", name: "Ada Admin", admin: true };
const member: DocumentActor = { id: "u-member", name: "Mats Montör", admin: false };
const people = [admin, member].map(({ id, name }) => ({ id, name }));
let sequence = 0;
const newId = () => `id-${++sequence}`;
const now = new Date("2026-11-24T10:00:00Z");
const act = (doc: SelfInspectionDocument, action: SelfInspectionAction, actor = admin) => applySelfInspectionAction(doc, action, actor, { now, newId, people });

test("the level from the years: under 2 is 1, 2 up to and including 5 is 2, above 5 is 3; the company's limits apply", () => {
  assert.deepEqual([levelFromYears(1.9, null), levelFromYears(2, null), levelFromYears(5, null), levelFromYears(5.1, null)], [1, 2, 2, 3]);
  assert.equal(levelFromYears(3, [3, 8]), 2);
  assert.equal(levelRuleText([2, 5]), "Under 2 år ger nivå 1, 2 till och med 5 år ger nivå 2 och över 5 år ger nivå 3.");
  assert.equal(personLevel({ experienceYears: 4, experienceYearsAt: "2024-11-24" }, null, "2026-11-24").counted, 3, "years on a day count on");
});

test("a new level waits for the admin; an adjustment needs a reason and shows the counted level", async () => {
  let doc = emptySelfInspectionDocument();
  doc = await act(doc, { action: "save_competence_card", card: { personId: member.id, experienceSince: "2025-06-01" } });
  assert.equal(doc.competenceCards[0].level, 1, "the counted level is confirmed when the experience is saved");
  const later = personLevel(doc.competenceCards[0], null, "2027-08-01");
  assert.deepEqual([later.level, later.pending], [1, 2], "two years later level 2 waits");
  await assert.rejects(act(doc, { action: "confirm_competence_level", personId: member.id }), (error: unknown) => error instanceof SelfInspectionError && error.status === 409);
  await assert.rejects(act(doc, { action: "set_competence_level", personId: member.id, level: 3, reason: "" }));
  doc = await act(doc, { action: "set_competence_level", personId: member.id, level: 3, reason: "Lång erfarenhet hos tidigare arbetsgivare." });
  const info = personLevel(doc.competenceCards[0], null, "2026-11-24");
  assert.deepEqual([info.level, info.adjusted, info.counted], [3, true, 1]);
  assert.match([...doc.cardVersions].sort((a, b) => b.number - a.number)[0]!.change,/^Nivå justerad till 3 \(räknad: 1\)/);
  await assert.rejects(act(doc, { action: "set_competence_level", personId: member.id, level: 2, reason: "x" }, member), (error: unknown) => error instanceof SelfInspectionError && error.status === 403);
});

test("Krävd nivå follows the person's own level; the role's level is only a requirement", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const ere = doc.program!.roles.find((role) => role.key === "ere")!;
  doc = await act(doc, { action: "set_person_roles", revision: doc.program!.revision, personId: member.id, roleIds: [ere.id] });
  assert.equal(documentLevels(doc).people.find((person) => person.personId === member.id)?.level, 3, "without a card the role's level counts, as before");
  doc = await act(doc, { action: "save_competence_card", card: { personId: member.id, experienceSince: "2025-06-01" } });
  assert.equal(documentLevels(doc, new Map(), undefined, "2026-11-24").people.find((person) => person.personId === member.id)?.level, 1);
});

test("the tree: the automatic chart is the proposal; a role stands in one place and never under itself", async () => {
  const roles = TEMPLATE_ROLES.map((role, sortOrder) => ({ ...role, id: role.key, sortOrder }));
  const proposal = proposedTree(roles);
  assert.equal(proposal.find((node) => node.roleId === "manager")?.parentId, null);
  assert.equal(proposal.find((node) => node.roleId === "installer")?.parentId, "ere");
  assert.equal(treeRows(roleTree(roles, false))[0]?.roleId, "manager");
  assert.equal(treeRefusal([{ roleId: "a", parentId: "b" }, { roleId: "b", parentId: "a" }], ["a", "b"]), "En roll kan inte stå under en roll som står under den själv.");
  assert.equal(treeRefusal([{ roleId: "a", parentId: null }, { roleId: "a", parentId: null }], ["a"]), "En roll kan bara stå på ett ställe i trädet.");
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const ids = doc.program!.roles.map((role) => role.id);
  const before = programContent(doc.program!);
  assert.equal("orgTree" in before, false, "a programme without a tree keeps its content as before");
  doc = await act(doc, { action: "save_org_tree", revision: doc.program!.revision, nodes: ids.map((roleId, order) => ({ roleId, parentId: order ? ids[0]! : null, order, responsibility: order ? "" : "Leder" })) });
  const content = programContent(doc.program!);
  assert.equal(content.orgTree, true);
  assert.equal(content.roles.find((role) => role.id === ids[0])?.responsibility, "Leder");
  await assert.rejects(act(doc, { action: "save_org_tree", revision: doc.program!.revision, nodes: [{ roleId: ids[0]!, parentId: null, order: 0, responsibility: "" }] }));
});

test("hired staff: off from the start, in the programme only during the period, and only name, company, role and level", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const role = doc.program!.roles.find((item) => item.key === "hired")!;
  doc = await act(doc, { action: "save_external_person", person: { name: "Fredrik Holm", companyName: "Exempel AB", companyOrgNumber: "000000-1111", roleId: role.id, level: 2, periodFrom: "2026-11-01", periodTo: "2026-12-31" } });
  assert.equal(doc.externalPeople![0].included, false);
  assert.equal(programExtras(doc, new Map(), "2026-11-24").external.length, 0);
  doc = await act(doc, { action: "save_external_person", person: { ...doc.externalPeople![0], included: true } });
  const extras = programExtras(doc, new Map(), "2026-11-24");
  assert.deepEqual(Object.keys(extras.external[0]).sort(), ["company", "id", "level", "name", "role", "roleId"]);
  assert.equal(externalInProgramme(doc.externalPeople![0], "2027-01-02"), false, "the period has ended");
  const view = await selfInspectionView(doc, { me: { id: member.id, name: member.name }, admin: false, company: "Bolaget", people });
  assert.deepEqual(view.externalPeople, [], "a member never reads the hired staff");
});

test("the chart: a box moves with its children, never under its own; out of the chart the children move up a step", () => {
  // VD › (ERE › (Montör, Lärling), Admin)
  const nodes: TreeNode[] = [{ roleId: "vd", parentId: null, order: 0 }, { roleId: "ere", parentId: "vd", order: 0 }, { roleId: "admin", parentId: "vd", order: 1 },
    { roleId: "montor", parentId: "ere", order: 0 }, { roleId: "larling", parentId: "ere", order: 1 }];
  const moved = placeInChart(nodes, "ere", "admin")!;
  assert.deepEqual(treeRows(moved).map((row) => `${row.roleId}:${row.depth}`), ["vd:0", "admin:1", "ere:2", "montor:3", "larling:3"], "the children follow");
  assert.equal(placeInChart(nodes, "ere", "montor"), null, "never under one of its own");
  assert.equal(placeInChart(nodes, "vd", "vd"), null);
  const reordered = placeInChart(nodes, "larling", "ere", 0)!;
  assert.deepEqual(chartForest(reordered)[0]!.children[0]!.children.map((node) => node.roleId), ["larling", "montor"], "between siblings");
  assert.deepEqual(chartForest(moveInChart(nodes, "admin", -1))[0]!.children.map((node) => node.roleId), ["admin", "ere"]);
  const top = placeInChart(nodes, "admin", null)!;
  assert.deepEqual(chartForest(top).map((node) => node.roleId), ["vd", "admin"], "a top box of its own");
  const removed = removeFromChart(nodes, "ere");
  assert.equal(removed.find((node) => node.roleId === "ere")!.order, OUT_OF_CHART);
  assert.deepEqual(chartForest(removed)[0]!.children.map((node) => node.roleId), ["montor", "larling", "admin"], "the children take its place");
  assert.ok(!treeRows(removed).some((row) => row.roleId === "ere"), "a role out of the chart is not drawn");
});

test("the chart saved at once: new roles, a role removed, names, levels and people in one change", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const roles = doc.program!.roles;
  const top = roles.find((role) => role.key === "manager")!;
  const gone = roles.find((role) => role.key === "trainee")!;
  const nodes = roles.filter((role) => role.id !== gone.id).map((role, order) => ({ roleId: role.id, parentId: role.id === top.id ? null : top.id, order: role.id === top.id ? 0 : order, responsibility: "",
    ...(role.id === top.id ? { name: "Vd", level: 3, memberIds: [admin.id] } : {}) }));
  doc = await act(doc, { action: "save_org_tree", revision: doc.program!.revision, removeRoleIds: [gone.id],
    nodes: [...nodes, { roleId: "new:1", parentId: top.id, order: 40, responsibility: "Ny i schemat", name: "Schemaroll", level: 2, memberIds: [member.id] }] });
  const saved = doc.program!.roles;
  assert.ok(!saved.some((role) => role.id === gone.id), "the role removed entirely");
  const made = saved.find((role) => role.name === "Schemaroll")!;
  assert.deepEqual([made.parentId, made.level, made.members.map((item) => item.personId)], [top.id, 2, [member.id]]);
  const renamed = saved.find((role) => role.id === top.id)!;
  assert.deepEqual([renamed.name, renamed.level, renamed.members.map((item) => item.personId)], ["Vd", 3, [admin.id]]);
  await assert.rejects(act(doc, { action: "save_org_tree", revision: doc.program!.revision, nodes: saved.map((role, order) => ({ roleId: role.id, parentId: null, order, responsibility: "", name: "Samma" })) }),
    (error: unknown) => error instanceof SelfInspectionError && error.status === 409, "two roles cannot have the same name");
  await assert.rejects(act(doc, { action: "save_org_tree", revision: doc.program!.revision, nodes: [] }, member), (error: unknown) => error instanceof SelfInspectionError && error.status === 403, "only the one who edits");
});

test("the free chart: lines make the tree, siblings ordered by place, a ring is found, a tree gets places", () => {
  const cards = [{ roleId: "a", x: 10, y: 0, parentId: null }, { roleId: "c", x: 14, y: 8, parentId: "a" }, { roleId: "b", x: 4, y: 8, parentId: "a" }, { roleId: "d", x: null, y: null, parentId: "a" }];
  const order = chartOrder(cards);
  assert.deepEqual([order.get("a"), order.get("b"), order.get("c"), order.get("d")], [{ parentId: null, order: 0 }, { parentId: "a", order: 0 }, { parentId: "a", order: 1 }, { parentId: null, order: OUT_OF_CHART }]);
  assert.equal(wouldRing(cards, "a", "b"), true, "a cannot report to its own");
  assert.equal(wouldRing(cards, "b", "c"), false);
  const places = treePlaces(chartForest([{ roleId: "a", parentId: null, order: 0 }, { roleId: "b", parentId: "a", order: 0 }, { roleId: "c", parentId: "a", order: 1 }]));
  assert.equal(places.get("a")!.y, 0);
  assert.ok(places.get("b")!.y > 0 && places.get("b")!.y === places.get("c")!.y && places.get("b")!.x < places.get("c")!.x, "the children on one row, in order");
  for (const place of places.values()) assert.ok(place.x >= 0 && place.x + CARD_COLUMNS <= GRID_COLUMNS, "inside the grid");
});

const overlaps = (cards: readonly { x: number | null; y: number | null }[]) => cards.some((a, i) => cards.some((b, j) => i < j
  && a.x! < b.x! + CARD_COLUMNS && b.x! < a.x! + CARD_COLUMNS && a.y! < b.y! + CARD_ROWS && b.y! < a.y! + CARD_ROWS));
test("Ordna korten: no overlap, children centred under the parent, siblings in their order, loose cards at the bottom, inside the grid", () => {
  // Thrown about: siblings left to right are Projektör, Montör, Kontroll, Inhyrd (by their x), whatever their rows.
  const messy = [{ roleId: "vd", x: 3, y: 40, parentId: null }, { roleId: "ere", x: 18, y: 2, parentId: "vd" }, { roleId: "admin", x: 20, y: 30, parentId: "vd" },
    { roleId: "proj", x: 0, y: 9, parentId: "ere" }, { roleId: "mont", x: 4, y: 50, parentId: "ere" }, { roleId: "kontr", x: 9, y: 0, parentId: "ere" }, { roleId: "inhyrd", x: 15, y: 22, parentId: "ere" },
    { roleId: "loose", x: 12, y: 12, parentId: null }];
  assert.ok(overlaps([messy[0]!, { x: 3, y: 41 }]), "the helper sees an overlap");
  const tidy = arrangeCards(messy);
  const at = new Map(tidy.map((card) => [card.roleId, card]));
  const kids = ["proj", "mont", "kontr", "inhyrd"];
  assert.equal(overlaps(tidy), false, "nothing overlaps");
  assert.deepEqual(kids.map((id) => at.get(id)!.x), kids.map((id) => at.get(id)!.x).sort((a, b) => a! - b!), "the siblings keep their order");
  assert.equal(new Set(kids.map((id) => at.get(id)!.y)).size, 1, "siblings on one row");
  assert.equal(new Set(kids.slice(1).map((id, index) => at.get(id)!.x! - at.get(kids[index]!)!.x!)).size, 1, "the same gap between siblings");
  assert.equal(at.get("ere")!.x, Math.floor((at.get("proj")!.x! + at.get("inhyrd")!.x!) / 2), "the parent stands over the middle of its children");
  assert.ok(at.get("vd")!.y! < at.get("ere")!.y! && at.get("ere")!.y! < at.get("proj")!.y!, "levels downwards");
  const inTrees = tidy.filter((card) => card.roleId !== "loose");
  assert.equal(Math.min(...inTrees.map((card) => card.y!)), 0, "the top card at the top");
  assert.ok(at.get("loose")!.y! > Math.max(...inTrees.map((card) => card.y!)) + CARD_ROWS, "a card without lines at the bottom, after a gap");
  // The grid is relative, so inside 24 columns is inside the width at 1440, 1024 and 768 px alike.
  for (const card of tidy) assert.ok(card.x! >= 0 && card.x! + CARD_COLUMNS <= GRID_COLUMNS, `${card.roleId} inside the width`);
  assert.deepEqual(tidy.map((card) => card.parentId), messy.map((card) => card.parentId), "the lines stay");
});

test("Ordna korten: wide and low – VD, two under it and five under one of them stand in a row, nothing hangs", () => {
  // The grid is relative: 24 columns are the surface's width, about 1100 px at 1440 (a card about 176 px, a gap about 46 px).
  const cards = [{ roleId: "vd", x: 0, y: 0, parentId: null }, { roleId: "ere", x: 0, y: 8, parentId: "vd" }, { roleId: "admin", x: 10, y: 8, parentId: "vd" },
    ...Array.from({ length: 5 }, (_, index) => ({ roleId: `k${index}`, x: index * 3, y: 16, parentId: "ere" }))];
  const tidy = arrangeCards(cards);
  const at = new Map(tidy.map((card) => [card.roleId, card]));
  const kids = tidy.filter((card) => card.roleId.startsWith("k"));
  assert.equal(new Set(kids.map((card) => card.y)).size, 1, "the five in one row");
  assert.equal(at.get("ere")!.y, at.get("admin")!.y, "ERE and Administratör on one row");
  assert.equal(overlaps(tidy), false);
  for (const card of tidy) assert.ok(card.x! >= 0 && card.x! + CARD_COLUMNS <= GRID_COLUMNS, `${card.roleId} inside the width`);
  assert.ok(Math.max(...tidy.map((card) => card.y!)) <= 16, "low: three levels");
});

test("Ordna korten: a parent with 8 children hangs them symmetrically in two columns; cards off the chart stay off", () => {
  // 8 cards of 4 columns never fit in 24, whatever the width (768 px included).
  const cards = [{ roleId: "top", x: 0, y: 0, parentId: null }, ...Array.from({ length: 8 }, (_, index) => ({ roleId: `c${index}`, x: index * 2, y: 10, parentId: "top" })),
    { roleId: "off", x: null, y: null, parentId: null }];
  const tidy = arrangeCards(cards);
  const top = tidy[0]!;
  const children = tidy.filter((card) => card.roleId.startsWith("c"));
  const columnsOf = [...new Set(children.map((card) => card.x!))].sort((a, b) => a - b);
  assert.equal(columnsOf.length, 2, "two columns");
  assert.equal(top.x! + CARD_COLUMNS / 2, (columnsOf[0]! + columnsOf[1]! + CARD_COLUMNS) / 2, "on either side of the parent's line");
  assert.deepEqual(children.map((card) => card.roleId), [...children].sort((a, b) => a.y! - b.y! || a.x! - b.x!).map((card) => card.roleId), "in reading order");
  assert.equal(overlaps(tidy.filter((card) => card.x !== null)), false);
  for (const card of children) assert.ok(card.x! + CARD_COLUMNS <= GRID_COLUMNS);
  assert.deepEqual([tidy.at(-1)!.x, tidy.at(-1)!.y], [null, null]);
});

test("Ordna korten is symmetric: parents over their children's middle, equal gaps, one row per level, the chart centred", () => {
  // VD with three branches of different sizes; the cards of level 2 are of different heights.
  const cards = [{ roleId: "vd", x: 0, y: 0, parentId: null },
    ...["a", "b", "c"].map((id, index) => ({ roleId: id, x: index * 6, y: 8, parentId: "vd" })),
    { roleId: "a1", x: 0, y: 16, parentId: "a" }, { roleId: "a2", x: 3, y: 16, parentId: "a" }, { roleId: "c1", x: 12, y: 16, parentId: "c" }];
  const rows: Record<string, number> = { a1: 7, a2: 5, c1: 5 };
  const tidy = arrangeCards(cards, (id) => rows[id] ?? CARD_ROWS);
  const at = new Map(tidy.map((card) => [card.roleId, card]));
  const centre = (id: string) => at.get(id)!.x! + CARD_COLUMNS / 2;
  for (const [parent, kids] of [["vd", ["a", "b", "c"]], ["a", ["a1", "a2"]], ["c", ["c1"]]] as const)
    assert.ok(Math.abs(centre(parent) - (centre(kids[0]) + centre(kids[kids.length - 1]!)) / 2) <= 1, `${parent} over the middle of its children`);
  assert.equal(at.get("b")!.x! - at.get("a")!.x!, at.get("c")!.x! - at.get("b")!.x!, "equal gaps between siblings");
  assert.equal(new Set(["a", "b", "c"].map((id) => at.get(id)!.y)).size, 1, "level 1 on one row");
  assert.equal(new Set(["a1", "a2", "c1"].map((id) => at.get(id)!.y)).size, 1, "level 2 on one row across the branches");
  const left = Math.min(...tidy.map((card) => card.x!)), right = Math.max(...tidy.map((card) => card.x! + CARD_COLUMNS));
  assert.ok(Math.abs((left + right) / 2 - GRID_COLUMNS / 2) <= 1, "the chart centred on the surface");
  assert.ok(at.get("a1")!.y! >= at.get("a")!.y! + CARD_ROWS + 1, "a level below the tallest card above");
  assert.equal(overlaps(tidy), false);
});

test("the free chart saved: places kept, a card off the surface leaves the tree", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const roles = doc.program!.roles;
  const [top, child, off] = roles;
  doc = await act(doc, { action: "save_org_tree", revision: doc.program!.revision, nodes: roles.map((role, order) => ({ roleId: role.id, order, responsibility: role.id === child!.id ? "Ansvar här" : "",
    parentId: role.id === child!.id || role.id === off!.id ? top!.id : null, x: role.id === top!.id ? 10 : role.id === child!.id ? 4 : null, y: role.id === top!.id ? 0 : role.id === child!.id ? 8 : null })) });
  const saved = new Map(doc.program!.roles.map((role) => [role.id, role]));
  assert.deepEqual([saved.get(top!.id)!.chartX, saved.get(top!.id)!.chartY, saved.get(child!.id)!.parentId, saved.get(child!.id)!.responsibility], [10, 0, top!.id, "Ansvar här"]);
  assert.deepEqual([saved.get(off!.id)!.chartX ?? null, saved.get(off!.id)!.parentId, saved.get(off!.id)!.treeOrder], [null, null, OUT_OF_CHART], "off the surface, out of the tree");
});

test("markers: on a line of their own; an unknown one stays text", () => {
  assert.deepEqual(splitMarkers("Inledning\n{{organisation}}\n{{okänd}}").map((part) => part.kind === "marker" ? part.marker : part.text), ["Inledning", "organisation", "{{okänd}}"]);
  assert.deepEqual(markersIn("text {{roller}} i en mening\n  {{ERE}} "), ["ere"]);
});

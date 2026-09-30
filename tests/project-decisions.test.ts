import assert from "node:assert/strict";
import { test } from "node:test";
import { addLocalProjectDecision, createLocalWorkspace, parseLocalWorkspace, saveLocalProjectRecord, setLocalProjectArchived } from "../features/kfid/local-workspace-store";

test("the Local decision log is append-only, validated and survives a save and reload of the file", () => {
  const created = saveLocalProjectRecord(createLocalWorkspace({ id: "decisions-local", name: "Beslut AB" }), {
    name: "Beslutsprojekt", description: "", startDate: "2026-09-01", dueDate: "2026-12-31", customerId: null,
  }, "Lokal ägare");
  const projectId = created.project.id;
  const first = addLocalProjectDecision(created.workspace, projectId, { decidedOn: "2026-09-26", text: "Kabelstege byts till trådstege.", decidedBy: "Beställaren" }, "Lokal ägare");
  const second = addLocalProjectDecision(first, projectId, { decidedOn: "2026-09-27", text: "Slutdatum flyttas en vecka.", decidedBy: "Projektledare" }, "Lokal ägare");
  const decisions = second.projects.find((project) => project.id === projectId)!.decisions;
  assert.deepEqual(decisions.map((decision) => decision.text), ["Kabelstege byts till trådstege.", "Slutdatum flyttas en vecka."]);
  assert.equal(decisions[0].actorName, "Lokal ägare");
  // The first decision is untouched when the second is added.
  assert.deepEqual(first.projects.find((project) => project.id === projectId)!.decisions, [decisions[0]]);

  assert.throws(() => addLocalProjectDecision(second, projectId, { decidedOn: "2026-09-27", text: " ", decidedBy: "X" }), /Beskriv beslutet/);
  assert.throws(() => addLocalProjectDecision(second, projectId, { decidedOn: "2026-09-27", text: "Något", decidedBy: "" }), /Ange vem som beslutade/);
  assert.throws(() => addLocalProjectDecision(second, "missing", { decidedOn: "2026-09-27", text: "Något", decidedBy: "X" }), /hittades inte/);
  const archived = setLocalProjectArchived(second, projectId, true);
  assert.throws(() => addLocalProjectDecision(archived, projectId, { decidedOn: "2026-09-27", text: "Något", decidedBy: "X" }), /Återställ projektet/);

  const reloaded = parseLocalWorkspace(JSON.parse(JSON.stringify(second)), "decisions-local");
  assert.equal(reloaded.projects.find((project) => project.id === projectId)!.decisions.length, 2);
  // Older files without a decision log read as projects with an empty log.
  const older = JSON.parse(JSON.stringify(created.workspace));
  delete older.projects[0].decisions;
  assert.deepEqual(parseLocalWorkspace(older, "decisions-local").projects[0].decisions, []);
});

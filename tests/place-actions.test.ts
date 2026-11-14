import assert from "node:assert/strict";
import test from "node:test";
import { NEW_CHILD_LABELS, placeActions, placeLevelName } from "../lib/workflow/place-actions";

// Hantera anläggningar (2026-10-24): one compact action card above the tree whose actions follow the chosen level –
// Adress → Objekt → Underobjekt; Ny adress always; Redigera and Ta bort act on the chosen level; a button that does not fit
// is inactive with its reason, never removed, so the card keeps its shape.
const place = (depth: number, extra: Partial<NonNullable<Parameters<typeof placeActions>[0]["selected"]>> = {}) =>
  ({ depth, name: depth === 0 ? "Strömgatan 18" : depth === 1 ? "HC1" : "E12", isActive: true, hasChildren: false, inUse: false, ...extra });
const base = { canEdit: true, canManage: true, maxDepth: 4 };

test("the levels: Adress, Objekt, Underobjekt", () => {
  assert.deepEqual([0, 1, 2, 3].map(placeLevelName), ["Adress", "Objekt", "Underobjekt", "Underobjekt"]);
});

test("nothing chosen: Ny adress works, the rest is inactive with a reason, and nothing is left out", () => {
  const actions = placeActions({ ...base, selected: null });
  assert.equal(actions.level, null);
  assert.match(actions.line, /Välj en adress i trädet/);
  assert.deepEqual(actions.newAddress, { enabled: true });
  assert.equal(actions.newChild?.label, "Nytt objekt");
  for (const action of [actions.newChild, actions.edit, actions.pause, actions.remove]) {
    assert.equal(action?.enabled, false);
    assert.match(action?.reason ?? "", /Välj en adress/);
  }
});

test("an address adds an object, an object a sub-object; Redigera on the chosen level", () => {
  const address = placeActions({ ...base, selected: place(0) });
  assert.equal(address.level, "Adress");
  assert.equal(address.line, "Vald nivå: Adress · Strömgatan 18");
  assert.deepEqual({ label: address.newChild?.label, enabled: address.newChild?.enabled }, { label: "Nytt objekt", enabled: true });
  assert.equal(address.edit?.enabled, true);
  const object = placeActions({ ...base, selected: place(1) });
  assert.equal(object.level, "Objekt");
  assert.equal(object.newChild?.label, "Nytt underobjekt");
  const sub = placeActions({ ...base, selected: place(2) });
  assert.equal(sub.level, "Underobjekt");
  assert.equal(sub.newChild?.label, "Nytt underobjekt");
  assert.equal(sub.newChild?.enabled, true);
  // The deepest level adds nothing under it, and says why.
  const deepest = placeActions({ ...base, selected: place(3) });
  assert.equal(deepest.newChild?.enabled, false);
  assert.match(deepest.newChild?.reason ?? "", /Högst 4 nivåer/);
  // The card reserves the longer of the two labels.
  assert.deepEqual([...NEW_CHILD_LABELS], ["Nytt objekt", "Nytt underobjekt"]);
});

test("Ta bort only for a place nothing points to; while that is read it waits", () => {
  assert.equal(placeActions({ ...base, selected: place(1) }).remove?.enabled, true);
  assert.match(placeActions({ ...base, selected: place(1, { hasChildren: true }) }).remove?.reason ?? "", /under/);
  assert.match(placeActions({ ...base, selected: place(1, { inUse: true }) }).remove?.reason ?? "", /Pausa den i stället/);
  assert.match(placeActions({ ...base, selected: place(1, { inUse: null }) }).remove?.reason ?? "", /Kontrollerar/);
});

test("a paused place: Aktivera instead of Pausa, and nothing new under it", () => {
  const paused = placeActions({ ...base, selected: place(0, { isActive: false }) });
  assert.equal(paused.pause?.label, "Aktivera");
  assert.equal(paused.newChild?.enabled, false);
  assert.match(paused.newChild?.reason ?? "", /pausad/);
  assert.equal(placeActions({ ...base, selected: place(0) }).pause?.label, "Pausa");
});

test("rights: read only shows no changing buttons; Pausa only for an admin", () => {
  const reader = placeActions({ ...base, canEdit: false, canManage: false, selected: place(0) });
  assert.deepEqual([reader.newAddress, reader.newChild, reader.edit, reader.pause, reader.remove], [null, null, null, null, null]);
  assert.equal(reader.line, "Vald nivå: Adress · Strömgatan 18", "the chosen level is still shown");
  assert.equal(placeActions({ ...base, canManage: false, selected: place(0) }).pause, null);
});

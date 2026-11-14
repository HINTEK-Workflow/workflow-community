import assert from "node:assert/strict";
import test from "node:test";
import { arrivalEvent, canStepBack, canStepForward, emptyHistory, recordNavigation, rememberScroll, sameAddress, stepsBack, stepsForward, type HistoryState } from "../lib/workflow/history-stack";
import { floatingNavLabel, floatingNavModel, usefulFallback, type FloatingNavInput } from "../lib/workflow/floating-nav";

// Flytande navigering (2026-10-27, beslut 5–7): a complement to the page's own buttons, adapted to the display level.
const page: FloatingNavInput = {
  native: false, level: 3, wide: true, covered: false, canBack: true, canForward: false, fallback: null,
  ownBack: false, cancel: false, save: false, headerInView: true,
};

test("floating nav: visning 1 has its own top bar and edge swipe – nothing floats there", () => {
  assert.deepEqual(floatingNavModel({ ...page, native: true, level: 1, cancel: true, save: true, headerInView: false }).buttons, []);
});

test("floating nav: Workflow AI's button (2026-11-02) wherever the group is drawn, whatever the arrows do", () => {
  assert.equal(floatingNavModel(page).assistant, false, "only for whoever is given it");
  const withAi = { ...page, assistant: true };
  assert.equal(floatingNavModel(withAi).assistant, true);
  assert.equal(floatingNavModel({ ...withAi, canBack: false }).assistant, true, "a page where both arrows are idle");
  assert.deepEqual(floatingNavModel({ ...withAi, canBack: false }).idle, ["back", "forward"]);
  assert.equal(floatingNavModel({ ...withAi, cancel: true, headerInView: false }).assistant, true, "while editing");
  assert.equal(floatingNavModel({ ...withAi, wide: false, level: 2 }).assistant, true, "a tablet");
  assert.equal(floatingNavModel({ ...withAi, native: true }).assistant, false, "visning 1 has Hem and Mer");
  assert.equal(floatingNavModel({ ...withAi, covered: true }).assistant, false, "the keyboard, the menu, a chat that fills the screen");
});

test("floating nav: Tillbaka when there is a way back, Framåt only with a visit forward", () => {
  assert.deepEqual(floatingNavModel(page).buttons, ["back"]);
  assert.deepEqual(floatingNavModel({ ...page, canForward: true }).buttons, ["back", "forward"]);
  assert.deepEqual(floatingNavModel({ ...page, canBack: false }).buttons, [], "opened directly on a root page: nowhere to go back");
  assert.deepEqual(floatingNavModel({ ...page, canBack: false, fallback: "/?view=customers" }).buttons, ["back"], "opened directly: the page above");
  assert.deepEqual(floatingNavModel({ ...page, canBack: false, ownBack: true }).buttons, ["back"], "the page's own Tillbaka till …");
});

test("floating nav: Tillbaka on every page with an earlier page, also a list or tab from the menu (replaces N13, 2026-11-02)", () => {
  // The model no longer knows what kind of page it is: whether there is somewhere to go decides, nothing else.
  assert.deepEqual(floatingNavModel(page).buttons, ["back"]);
  assert.deepEqual(floatingNavModel(page).idle, ["forward"]);
  assert.deepEqual(floatingNavModel({ ...page, canBack: false }).idle, ["back", "forward"], "nearly transparent only when there really is nothing to go to");
  assert.deepEqual(floatingNavModel({ ...page, canBack: false, canForward: true }).buttons, ["forward"], "the first page after going back");
  assert.deepEqual(floatingNavModel({ ...page, canBack: false, ownBack: true }).buttons, ["back"], "the page's own Tillbaka till …");
  assert.deepEqual(floatingNavModel({ ...page, canBack: false, fallback: "/?view=tools" }).buttons, ["back"], "opened directly: the page above");
});

test("floating nav: the page above is no way back when the person already stands on it", () => {
  assert.equal(usefulFallback("/?view=tools", "/?view=instruments"), "/?view=tools");
  assert.equal(usefulFallback("/?view=tools", "/?view=tools"), null);
  assert.equal(usefulFallback("/?a=1&view=tools", "/?view=tools&a=1"), null, "the order of the values does not matter");
  assert.equal(usefulFallback(null, "/?view=tools"), null);
});

test("floating nav: while editing Tillbaka is the page's Avbryt, and the floating Avbryt and Spara come only when the header's are out of sight", () => {
  const editing = { ...page, cancel: true, save: true, canBack: false };
  assert.deepEqual(floatingNavModel(editing).buttons, ["back"], "opened directly too: Avbryt leads somewhere; the header's Avbryt and Spara are in sight, so no copies");
  assert.deepEqual(floatingNavModel({ ...editing, canForward: true }).buttons, ["back", "forward"]);
  assert.deepEqual(floatingNavModel({ ...editing, headerInView: false }).buttons, ["back", "cancel", "save"]);
  assert.deepEqual(floatingNavModel({ ...page, save: true, headerInView: false }).buttons, ["back", "save"], "a saved job: Tillbaka and Spara");
});

test("floating nav: under 1024 px the bottom bar has Spara – never two; the group stands left above the bar", () => {
  const tablet = floatingNavModel({ ...page, wide: false, level: 2, cancel: true, save: true, headerInView: false });
  assert.deepEqual(tablet.buttons, ["back", "cancel"]);
  assert.equal(tablet.placement, "left");
  assert.equal(tablet.compact, true);
});

test("floating nav: a computer stands bottom right, visning 3 with words and visning 2 compact", () => {
  assert.equal(floatingNavModel(page).placement, "right");
  assert.equal(floatingNavModel(page).compact, false);
  assert.equal(floatingNavModel({ ...page, level: 2 }).compact, true);
});

test("floating nav: steps aside for the keyboard, the menu and Workflow AI", () => {
  assert.deepEqual(floatingNavModel({ ...page, covered: true }).buttons, []);
});

test("floating nav: every button has a label for screen readers", () => {
  assert.deepEqual(floatingNavLabel("back", "Jobbet"), { label: "Tillbaka", aria: "Tillbaka till Jobbet" });
  assert.equal(floatingNavLabel("back").aria, "Tillbaka");
  assert.equal(floatingNavLabel("forward").aria, "Framåt");
  assert.equal(floatingNavLabel("cancel").aria, "Avbryt redigeringen");
  assert.equal(floatingNavLabel("save").aria, "Spara ändringarna");
});

const steps = (...urls: string[]): HistoryState => ({ index: 0, entries: urls.map((url, index) => ({ id: String(index), url })) }) as HistoryState;
const at = (state: HistoryState, index: number): HistoryState => ({ ...state, index });

test("Framåt: the step to a closed form page is no way forward; a list's next page and another page are", () => {
  assert.equal(canStepForward(steps("/?view=administration&person=a", "/?view=administration&person=a&page=anvandare")), false);
  assert.equal(canStepForward(steps("/?view=administration&person=a", "/?view=administration&person=b")), true);
  assert.equal(canStepForward(steps("/?view=tasks", "/?view=tasks&page=2")), true);
  assert.equal(canStepForward(steps("/?view=tasks")), false);
});

test("Framåt: a closed form page never hides the real page after it (2026-11-02)", () => {
  const state = steps("/?view=tasks", "/?view=tasks&page=ny", "/?view=customers");
  assert.equal(stepsForward(state), 2, "past the form page, to the page that was left from it");
  assert.equal(canStepForward(state), true);
});

test("the arrows pass an entry with the same address: a press always changes the page (2026-11-02)", () => {
  // The back guard's extra entry of an unsaved view stays behind when the person leaves or saves.
  const left = at(steps("/?view=tasks", "/?view=quote&quoteId=q", "/?view=quote&quoteId=q", "/?view=customers"), 3);
  assert.equal(stepsBack(left), 1);
  const onCopy = at(left, 2);
  assert.equal(stepsBack(onCopy), 2, "Tillbaka does not stop on the same page");
  assert.equal(stepsForward(onCopy), 1);
  assert.equal(stepsForward(at(left, 1)), 2, "Framåt passes it too");
  const saved = at(steps("/?view=tasks", "/?view=quote&quoteId=q", "/?view=quote&quoteId=q"), 1);
  assert.equal(canStepForward(saved), false, "after a save the guard's entry ahead is no way forward");
  assert.equal(canStepBack(at(steps("/?view=tasks", "/?view=tasks"), 1)), false, "the same page twice: nothing to go back to");
  assert.equal(stepsBack(at(steps("/?a=1&view=x", "/?view=x&a=1", "/?view=y"), 1)), 0, "the order of the values does not matter");
  assert.equal(stepsBack(emptyHistory()), 0);
  assert.equal(stepsForward(emptyHistory()), 0);
  assert.equal(sameAddress("/", "/?"), true);
});

test("Tillbaka: a closed form page behind the page is passed, an open form closes with one step (2026-11-02)", () => {
  assert.equal(stepsBack(at(steps("/?view=customers", "/?view=tasks", "/?view=tasks&page=ny", "/?view=tasks"), 3)), 3, "past the closed form and the same list, to the page before");
  assert.equal(stepsBack(at(steps("/?view=tasks", "/?view=tasks&page=ny"), 1)), 1, "the form is open: back to the page under it");
});

test("Tillbaka: a tab or a page that took its own step has a way back, one that replaced has not", () => {
  let state = recordNavigation(emptyHistory(), { kind: "visit", id: "a", url: "/?view=stats" });
  state = recordNavigation(state, { kind: "push", id: "b", url: "/?view=self_inspection" });
  state = recordNavigation(state, { kind: "push", id: "c", url: "/?view=self_inspection&tab=review" });
  assert.equal(stepsBack(state), 1);
  assert.equal(state.entries[state.index - stepsBack(state)]!.url, "/?view=self_inspection", "just that page");
  state = recordNavigation(state, { kind: "replace", id: "c", url: "/?view=self_inspection&tab=review&filter=x" });
  assert.equal(state.entries.length, 3, "a filter that replaces adds no step and loses none");
});

test("history: a replace of the same entry keeps its scroll position, also Next's own after a step back", () => {
  let state = recordNavigation(emptyHistory(), { kind: "visit", id: "a", url: "/?view=tasks" });
  state = rememberScroll(state, "a", 400);
  state = recordNavigation(state, { kind: "replace", id: "a", url: "/?view=tasks" });
  assert.equal(state.entries[0]!.scrollY, 400);
  state = recordNavigation(state, { kind: "replace", id: "other", url: "/?view=tasks" });
  assert.equal(state.entries[0]!.scrollY, undefined, "another entry has its own");
});

test("history: a full load from inside Workflow is a step, not a new start (2026-11-02)", () => {
  const before = steps("/?view=stats", "/?view=project&projectId=p");
  const state = at(before, 1);
  const load = { id: "new", url: "/?view=place&placeId=x", loadedBy: "navigate", referrer: "/?view=project&projectId=p", historyLength: 3 };
  assert.deepEqual(arrivalEvent(state, load), { kind: "push", id: "new", url: load.url }, "a pin on the map: Tillbaka leads to the page it was pressed on");
  assert.equal(stepsBack(recordNavigation(state, arrivalEvent(state, load))), 1);
  assert.equal(arrivalEvent(state, { ...load, url: "/?view=project&projectId=p" }).kind, "replace", "the same address takes the place of its entry");
  assert.equal(arrivalEvent(state, { ...load, referrer: "/login" }).kind, "visit", "the first page after signing in: a new start");
  assert.equal(arrivalEvent(state, { ...load, referrer: null }).kind, "visit", "a link from elsewhere, a bookmark");
  assert.equal(arrivalEvent(state, { ...load, historyLength: 1 }).kind, "visit", "a new tab with a copy of the list has no history of its own");
  assert.equal(arrivalEvent(state, { ...load, loadedBy: "reload" }).kind, "visit");
  assert.equal(arrivalEvent(emptyHistory(), load).kind, "visit");
  const started = recordNavigation(state, arrivalEvent(state, { ...load, referrer: "/login" }));
  assert.equal(canStepBack(started), false, "a new start has no way back");
});

test("floating nav: the arrows without a function keep their places, nearly transparent; visning 1 has none", () => {
  assert.deepEqual(floatingNavModel(page).idle, ["forward"]);
  assert.deepEqual(floatingNavModel({ ...page, canBack: false }).idle, ["back", "forward"]);
  assert.deepEqual(floatingNavModel({ ...page, cancel: true }).idle, ["forward"], "editing: Tillbaka is the page's Avbryt");
  assert.deepEqual(floatingNavModel({ ...page, canForward: true }).idle, []);
  assert.deepEqual(floatingNavModel({ ...page, native: true, level: 1 }).idle, []);
});

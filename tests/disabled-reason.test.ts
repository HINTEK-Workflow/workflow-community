import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../components/ui/button";
import { DisabledReason, disabledReasonProps } from "../components/ui/disabled-reason";

// Spärrade kontroller (2026-10-08): a blocked control says why in visible text and, when pressed, as a toast.
const fakeEvent = () => {
  const calls: string[] = [];
  return { calls, event: { preventDefault: () => calls.push("prevent"), stopPropagation: () => calls.push("stop") } as never };
};

test("without a reason the control is untouched and its own click runs", () => {
  let clicked = 0;
  const props = disabledReasonProps({ reason: "  ", describedBy: "x", title: "Titel", className: "a", onClick: () => { clicked++; } });
  assert.equal(props["aria-disabled"], undefined);
  assert.equal(props["data-disabled-reason"], undefined);
  assert.equal(props.title, "Titel");
  assert.equal(props.className, "a");
  props.onClick?.(fakeEvent().event);
  assert.equal(clicked, 1);
});

test("with a reason the control is aria-disabled, described by the visible line and tells the reason instead of acting", () => {
  let clicked = 0;
  const told: string[] = [];
  const props = disabledReasonProps({ reason: " Ange en rubrik först. ", describedBy: "why", onClick: () => { clicked++; }, notify: (text) => told.push(text) });
  assert.equal(props["aria-disabled"], true);
  assert.equal(props["aria-describedby"], "why");
  assert.equal(props["data-disabled-reason"], "Ange en rubrik först.");
  assert.equal(props.title, "Ange en rubrik först.");
  assert.match(props.className ?? "", /opacity-50/);
  const { calls, event } = fakeEvent();
  props.onClick?.(event);
  assert.equal(clicked, 0);
  assert.deepEqual(told, ["Ange en rubrik först."]);
  assert.deepEqual(calls, ["prevent", "stop"]);
});

test("an own title is kept as the tooltip", () => {
  assert.equal(disabledReasonProps({ reason: "Spara först.", title: "Historik", notify: () => undefined }).title, "Historik");
});

test("DisabledReason draws the reason as a muted line with its id, and nothing without one", () => {
  assert.equal(renderToStaticMarkup(h(DisabledReason, { id: "r", reason: "" })), "");
  assert.equal(renderToStaticMarkup(h(DisabledReason, { id: "r", reason: null })), "");
  const html = renderToStaticMarkup(h(DisabledReason, { id: "task-send-reason", reason: "Ange en rubrik först." }));
  assert.match(html, /^<p id="task-send-reason"[^>]*>Ange en rubrik först\.<\/p>$/);
  assert.match(html, /text-muted-foreground/);
});

test("Button with disabledReason stays enabled for focus and tap but says it is unavailable", () => {
  const html = renderToStaticMarkup(h(Button, { disabledReason: "Välj en uppgift först.", "aria-describedby": "time-save-reason" }, "Spara tid"));
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /aria-describedby="time-save-reason"/);
  assert.match(html, /data-disabled-reason="Välj en uppgift först\."/);
  assert.doesNotMatch(html, / disabled=""/);
});

test("a real disabled (busy) wins over the reason, and no reason leaves the button as before", () => {
  const busy = renderToStaticMarkup(h(Button, { disabled: true, disabledReason: "Spara först." }, "Historik"));
  assert.match(busy, / disabled=""/);
  assert.doesNotMatch(busy, /aria-disabled/);
  const plain = renderToStaticMarkup(h(Button, { disabledReason: "" }, "Spara"));
  assert.doesNotMatch(plain, /aria-disabled|data-disabled-reason/);
});

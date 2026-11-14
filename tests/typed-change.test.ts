import assert from "node:assert/strict";
import { test } from "node:test";
import { listenForTypedChange } from "../lib/workflow/typed-change";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("a typed change is reported after the input event, never inside it (the first keystroke stays)", async () => {
  const element = new EventTarget();
  const calls: string[] = [];
  listenForTypedChange(element, () => calls.push("changed"));
  // A listener after it (React's own at the root) still runs before the report: nothing renders in between.
  element.addEventListener("input", () => calls.push("react"));
  element.dispatchEvent(new Event("input"));
  assert.deepEqual(calls, ["react"]);
  await tick();
  assert.deepEqual(calls, ["react", "changed"]);
});

test("several events before the report give one report, and a stopped listener hears nothing new", async () => {
  const element = new EventTarget();
  let count = 0;
  const stop = listenForTypedChange(element, () => { count += 1; });
  element.dispatchEvent(new Event("input"));
  element.dispatchEvent(new Event("change"));
  await tick();
  assert.equal(count, 1);
  element.dispatchEvent(new Event("change"));
  await tick();
  assert.equal(count, 2);
  stop();
  element.dispatchEvent(new Event("input"));
  await tick();
  assert.equal(count, 2);
});

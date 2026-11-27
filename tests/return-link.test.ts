import assert from "node:assert/strict";
import test from "node:test";
import { passReturn, pickParam, returnLabel, returnOf, returnTargetWord, returnWithPick, sameReturnChain, withoutPicks, withReturn } from "../lib/workflow/return-link";
import { draftAddress } from "../lib/workflow/return-draft";
import { placeNeedsCustomerHint } from "../lib/workflow/customer-place";

const order = "/?view=workflow_task&taskId=wo1&taskType=WORK_ORDER";

// Samband (2026-10-26): a sub-page carries the way back to the page it was opened from.
test("return link: a sub-page's address carries the page it was opened from, without one-time markers", () => {
  const href = withReturn("/?view=new_task&workOrderId=wo1", `${order}&pickTask=t9`);
  assert.equal(returnOf(href), order, "the marker of an earlier return is not carried");
  assert.equal(withReturn("/?view=new_task", null), "/?view=new_task", "no way back: the link is unchanged");
  assert.equal(withReturn("/?view=new_task", "https://evil.example/"), "/?view=new_task", "only addresses inside Workflow");
  assert.equal(returnOf("/?view=new_task&returnTo=%2F%2Fevil.example"), null);
});

test("return link: the way back follows the chain onward and comes back with the new thing marked", () => {
  const picker = withReturn("/?view=new_task&workOrderId=wo1", order);
  const protocol = passReturn("/?view=workflow_task&taskType=FORM&formId=f1", picker);
  assert.equal(returnOf(protocol), order);
  assert.ok(sameReturnChain(picker, order) && sameReturnChain(protocol, order));
  assert.ok(!sameReturnChain("/?view=tasks", order));
  const back = returnWithPick(order, "Task", "t1");
  assert.equal(new URLSearchParams(back.split("?")[1]).get(pickParam("Task")), "t1");
  assert.equal(withoutPicks(back), order);
  assert.equal(draftAddress(`${order}&pickCustomer=c1`), order, "a draft is found again whatever was picked");
});

test("return link: the button says where it leads", () => {
  assert.equal(returnLabel(order), "Tillbaka till arbetsordern");
  assert.equal(returnTargetWord("/?view=workflow_task&taskId=t1&taskType=FORM"), "uppgiften");
  assert.equal(returnTargetWord("/?view=project&projectId=p1"), "projektet");
  assert.equal(returnTargetWord("/?view=customers&customerId=c1"), "kunden");
  assert.equal(returnTargetWord("/?view=planning"), "kalendern");
  assert.equal(returnTargetWord(null), "föregående sida");
});

// Logisk ordning (2026-10-26, punkt 4): the customer first, then only that customer's places.
test("customer and place: the place waits for the customer", () => {
  assert.equal(placeNeedsCustomerHint(null, null), "Välj kund först.");
  assert.equal(placeNeedsCustomerHint("c1", null), "");
  assert.equal(placeNeedsCustomerHint(null, "p1"), "", "an older job with a place but no customer can still clear it");
});

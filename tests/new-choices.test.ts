import assert from "node:assert/strict";
import { test } from "node:test";
import { headerWorkOrderShown, linkedTaskNotice, mobileNewChoices, projectJobChoices } from "../lib/workflow/new-choices";
import { newLinkedTaskHref } from "../lib/workflow/work-order-link";

test("the mobile Ny always offers the same choices, only those the person may create", () => {
  assert.deepEqual(mobileNewChoices({ workOrder: true, task: true, project: true }).map((choice) => choice.label), ["Arbetsorder", "Uppgift", "Projekt"]);
  assert.deepEqual(mobileNewChoices({ workOrder: false, task: true, project: false }).map((choice) => [choice.label, choice.href]), [["Uppgift", "/?view=new_task"]]);
  assert.equal(mobileNewChoices({ workOrder: true, task: false, project: false })[0].href, "/?view=workflow_task&taskType=WORK_ORDER");
  assert.deepEqual(mobileNewChoices({ workOrder: false, task: false, project: false }), []);
});

test("Ny offers Kund and Offert beside the jobs, by the person's rights (plan 1A, 2026-10-11)", () => {
  const all = mobileNewChoices({ workOrder: true, task: true, project: true, customer: true, quote: true });
  assert.deepEqual(all.map((choice) => choice.label), ["Arbetsorder", "Uppgift", "Projekt", "Kund", "Offert"]);
  assert.equal(all.find((choice) => choice.key === "customer")?.href, "/?view=customers&new=1");
  assert.equal(all.find((choice) => choice.key === "quote")?.href, "/?view=quote");
  // Without the right Offerter – or in Local, where the caller passes quote: false – there is no Offert.
  assert.deepEqual(mobileNewChoices({ workOrder: false, task: false, project: false, customer: true, quote: false }).map((choice) => choice.label), ["Kund"]);
});

test("Nytt jobb on a project: work order and task carry the project, customer and place; no Koppla befintlig uppgift (2026-10-26)", () => {
  const choices = projectJobChoices({ id: "p 1", customerId: "c-1", facilityId: null }, { workOrder: true, task: true, link: true });
  assert.deepEqual(choices.map((choice) => choice.label), ["Ny arbetsorder", "Ny uppgift", "Flytta arbetsorder hit"]);
  assert.ok(!choices.some((choice) => /Koppla befintlig uppgift/.test(choice.label)), "a task follows its work order; only a work order moves");
  assert.deepEqual(projectJobChoices({ id: "p" }, { workOrder: false, task: true, link: true }).map((choice) => choice.label), ["Ny uppgift"], "moving needs the work order right too");
  assert.equal(choices[0].href, "/?view=workflow_task&taskType=WORK_ORDER&projectId=p+1&customerId=c-1");
  assert.equal(choices[1].href, "/?view=new_task&projectId=p+1&customerId=c-1");
  assert.equal(choices[2].href, undefined);
  assert.equal(projectJobChoices({ id: "p", facilityId: "f" }, { workOrder: true, task: false, link: false })[0].href, "/?view=workflow_task&taskType=WORK_ORDER&projectId=p&facilityId=f");
  assert.deepEqual(projectJobChoices({ id: "p" }, { workOrder: false, task: false, link: false }), []);
});

test("Skapa arbetsorder in a protocol's header only follows up a deviation", () => {
  const risk = (residual: number) => ({ id: "t-1", kind: "RISK_ASSESSMENT", data: { kind: "RISK_ASSESSMENT", details: { risks: [{ hazard: "Fall", residualLikelihood: residual, residualConsequence: 5 }] } } });
  assert.equal(headerWorkOrderShown(risk(3)), true, "a high remaining risk is something to act on");
  assert.equal(headerWorkOrderShown(risk(1)), false, "nothing to act on: start the work order from the menu or the project");
  assert.equal(headerWorkOrderShown({ ...risk(3), id: "" }), false, "an unsaved task cannot be linked back to");
  assert.equal(headerWorkOrderShown({ id: "w", kind: "WORK_ORDER", data: { kind: "WORK_ORDER", details: { deviations: "Trasig dvärgbrytare" } } }), false, "a work order never offers another from its header");
});

test("Ny uppgift from a work order says where the task goes", () => {
  assert.equal(linkedTaskNotice("Byte av central"), "Uppgiften läggs i arbetsorder Byte av central.");
  assert.equal(linkedTaskNotice("  "), "Uppgiften läggs i arbetsordern.");
  assert.equal(linkedTaskNotice(null), "Uppgiften läggs i arbetsordern.");
  const href = newLinkedTaskHref({ id: "wo-1", projectId: null, customerId: null, title: " Byte av central " });
  assert.equal(new URL(href, "http://x").searchParams.get("workOrderTitle"), "Byte av central");
});

test("Ny uppgift is offered by task rights only, never by the work order right (simulation 0.6.4, sim-5)", async () => {
  const { NEW_TASK_SUBJECTS } = await import("../lib/workflow/new-choices");
  const { hasWorkflowPermission, normalizeWorkflowPermissionProfile } = await import("../lib/workflow/permissions");
  assert.deepEqual([...NEW_TASK_SUBJECTS], ["kfid", "risk-assessment", "forms"]);
  const onlyWorkOrders = normalizeWorkflowPermissionProfile({ grants: ["work-order:create", "work-order:read"] } as never);
  assert.equal(NEW_TASK_SUBJECTS.some((subject) => hasWorkflowPermission(onlyWorkOrders, subject, "create")), false);
});

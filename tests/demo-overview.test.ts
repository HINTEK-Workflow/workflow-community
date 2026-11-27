import assert from "node:assert/strict";
import test from "node:test";

/** Översikten i demon (2026-10-29): the demo answers /api/overview like Cloud – the same tabs, rights and shapes. */
test("the demo answers every Översikt tab with the permission matrix of Cloud", async () => {
  const { handleDemoRequest, setDemoUser } = await import("../features/demo/demo-backend");
  const read = async (path: string) => {
    const response = await handleDemoRequest("GET", new URL(path, "http://localhost"), null);
    return { status: response.status, body: await response.json() };
  };

  setDemoUser("demo-elna");
  const me = await read("/api/overview?tab=me");
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.tabs, { me: true, team: true, economy: true, customers: true });
  assert.ok(me.body.data.week.days.length === 7);
  assert.ok(Array.isArray(me.body.data.plan.items));
  assert.ok(me.body.data.next && Array.isArray(me.body.data.next.rows));

  const plan = await read("/api/overview?tab=me&part=plan&month=2026-01");
  assert.equal(plan.status, 200);
  assert.equal(plan.body.data.plan.month, "2026-01");

  const team = await read("/api/overview?tab=team");
  assert.equal(team.status, 200);
  assert.equal(team.body.data.load.people.length, 4);
  assert.equal(team.body.data.deviations.scope, "company");
  assert.ok(team.body.data.deviations.counts.open >= 1);
  // The demo's accepted garage quote has its work order, so none waits.
  assert.ok(team.body.data.acceptedQuotes);

  const economy = await read("/api/overview?tab=economy");
  assert.equal(economy.status, 200);
  assert.equal(economy.body.data.cloud, true);
  assert.equal(economy.body.data.invoiced.months.length, 6);
  assert.ok(economy.body.data.quotes.awaiting.count >= 1);
  assert.equal(economy.body.data.credits, null);

  const customers = await read("/api/overview?tab=customers");
  assert.equal(customers.status, 200);
  assert.ok(customers.body.data.rows.length >= 1);

  assert.equal((await read("/api/overview?tab=nope")).status, 400);

  // A field worker sees Jag only; the other tabs are refused, as in Cloud.
  setDemoUser("demo-elis");
  const field = await read("/api/overview?tab=me");
  assert.equal(field.status, 200);
  assert.equal(field.body.tabs.me, true);
  for (const tab of ["team", "economy", "customers"] as const) {
    if (field.body.tabs[tab]) continue;
    assert.equal((await read(`/api/overview?tab=${tab}`)).status, 403, tab);
  }
  setDemoUser("demo-elna");
});

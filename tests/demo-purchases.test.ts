import assert from "node:assert/strict";
import test from "node:test";

/**
 * Inköp i demon (2026-11-18): the demo answers /api/purchases in the browser like Cloud does for a work order's articles –
 * the question's drafts, a new purchase from the first article (linked to the work order with its project and customer),
 * later articles in the same purchase, the purchase following the rows after a save, Beställt and the delivery ticks.
 */
test("the demo makes a work order's purchase like Cloud: add_lines, drafts, sync, order and delivery", async () => {
  const { handleDemoRequest, setDemoUser } = await import("../features/demo/demo-backend");
  const { purchaseLineFromRow } = await import("../lib/purchases/model");
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await handleDemoRequest(method, new URL(path, "http://localhost"), body === undefined ? null : JSON.stringify(body));
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  setDemoUser("demo-elna");
  const order = "demo-task-stallverk-brytare", project = "demo-project-stallverk";
  const source = { kind: "work_order", id: order };

  const drafts = await call("GET", `/api/purchases?part=drafts&projectId=${project}&workOrderId=${order}`);
  assert.equal(drafts.status, 200, JSON.stringify(drafts.json));
  assert.ok(Array.isArray(drafts.json.drafts), "the question lists the open drafts");

  // Nytt inköp: the first article makes the purchase "Material – <the work order's title>".
  const first = await call("POST", "/api/purchases", { action: "add_lines", id: null, lines: [purchaseLineFromRow({ name: "Effektbrytare 3-pol", quantity: "1", unit: "st" })],
    create: { title: "Material – Byte av brytare fack 3", projectId: project, workOrderId: order }, source });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const id = first.json.id as string;
  assert.match(first.json.label as string, /^I-\d{4}$/);
  assert.equal((first.json.lineIds as string[]).length, 1);

  // A later article goes to the same purchase.
  const second = await call("POST", "/api/purchases", { action: "add_lines", id, lines: [purchaseLineFromRow({ name: "Kabelsko 50 mm²", quantity: "6", unit: "st" })], source });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.id, id);

  type View = { title: string; status: string; project: { id: string } | null; customer: { id: string } | null; workOrder: { id: string; title: string } | null; lines: { id: string; name: string; quantity: string; deliveredAt: string | null }[]; actions: string[] };
  const read = async () => (await call("GET", `/api/purchases?id=${id}`)).json.purchase as View;
  let purchase = await read();
  assert.equal(purchase.title, "Material – Byte av brytare fack 3");
  assert.equal(purchase.status, "DRAFT");
  assert.equal(purchase.workOrder?.id, order, "linked to the work order");
  assert.equal(purchase.project?.id, project, "with the work order's project");
  assert.ok(purchase.customer, "and the project's customer, as the server derives it");
  assert.equal(purchase.lines.length, 2);

  // The purchase is offered as a draft the next time, first for this work order.
  const again = await call("GET", `/api/purchases?part=drafts&workOrderId=${order}`);
  assert.equal((again.json.drafts as { id: string }[])[0].id, id);

  // After the work order is saved the purchase follows its rows: a changed antal, and a row let go of is forgotten.
  const [keep, drop] = purchase.lines;
  const synced = await call("POST", "/api/purchases", { action: "sync", id, source, lines: [{ lineId: keep.id, name: keep.name, quantity: "2", unit: "st" }], forget: [drop.id] });
  assert.equal(synced.status, 200, JSON.stringify(synced.json));
  assert.equal(synced.json.changed, true);
  purchase = await read();
  assert.deepEqual(purchase.lines.map((line) => [line.name, line.quantity]), [["Effektbrytare 3-pol", "2"]]);

  // Markera som beställt, then tick the line as it arrives.
  assert.ok(purchase.actions.includes("order"));
  assert.equal((await call("POST", "/api/purchases", { action: "status", id, to: "order" })).json.status, "ORDERED");
  const delivered = await call("POST", "/api/purchases", { action: "deliver", id, lineId: keep.id, delivered: true });
  assert.equal(delivered.json.status, "DELIVERED");
  assert.equal((await read()).lines[0].deliveredAt !== null, true);

  // A purchase that is ordered takes no more lines.
  const locked = await call("POST", "/api/purchases", { action: "add_lines", id, lines: [purchaseLineFromRow({ name: "Extra", quantity: "1", unit: "st" })], source });
  assert.equal(locked.status, 409);

  // The demo's own purchase I-0001 has the customer of its work order's project too.
  const seeded = (await call("GET", "/api/purchases?id=demo-purchase-1")).json.purchase as View;
  assert.ok(seeded.customer);
});

/**
 * Skapa inköp på arbetsordern i demon (2026-11-18): the button's calls – the order's open draft (filter=draft and
 * workOrderId), rows added to it instead of a second purchase, and the order's purchases for its links (filter=all).
 */
test("the demo answers Skapa inköp: an order's open draft takes the rows, and the order's purchases are listed for its links", async () => {
  const { handleDemoRequest, setDemoUser } = await import("../features/demo/demo-backend");
  const { purchaseLineFromRow, workOrderPurchaseRows, workOrderPurchaseTitle } = await import("../lib/purchases/model");
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await handleDemoRequest(method, new URL(path, "http://localhost"), body === undefined ? null : JSON.stringify(body));
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  setDemoUser("demo-elna");
  type Item = { id: string; label: string; status: string; workOrder: { id: string } | null };
  // The service order for the charger already has draft I-0004: Skapa inköp adds to it.
  const order = "demo-task-service-relabacken-laddbox";
  const drafts = (await call("GET", `/api/purchases?workOrderId=${order}&filter=draft`)).json.items as Item[];
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].label, "I-0004");
  assert.equal(drafts[0].workOrder?.id, order);
  const pick = workOrderPurchaseRows([{ name: "Jordfelsbrytare typ B", quantity: "1", unit: "st" }, { name: "Ur förrådet", quantity: "1", unit: "st", storeRef: { transactionId: "t", locationName: "" } } as never]);
  assert.equal(pick.rows.length, 1);
  const added = await call("POST", "/api/purchases", { action: "add_lines", id: drafts[0].id, lines: pick.rows.map((row) => purchaseLineFromRow(row)),
    create: { title: workOrderPurchaseTitle("Installation av laddbox"), projectId: null, workOrderId: order }, source: { kind: "work_order", id: order } });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  assert.equal(added.json.id, drafts[0].id, "no second purchase");
  const purchase = (await call("GET", `/api/purchases?id=${drafts[0].id}`)).json.purchase as { lines: { name: string }[]; customer: { id: string } | null };
  assert.equal(purchase.lines.at(-1)?.name, "Jordfelsbrytare typ B");
  assert.equal(purchase.customer?.id, "demo-customer-relabacken");

  // The garage order's links: its ordered purchase I-0001.
  const linked = (await call("GET", "/api/purchases?workOrderId=demo-task-garage-laddboxar&filter=all")).json.items as Item[];
  assert.deepEqual(linked.map((item) => [item.label, item.status]), [["I-0001", "ORDERED"]]);
});

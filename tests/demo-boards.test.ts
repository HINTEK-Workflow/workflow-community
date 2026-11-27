import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tavlor i demon (2026-11-19, issue #4): /api/boards answered in the browser. The example boards are there and published,
 * every card of them gets figures counted from the demo's invented data, Ny tavla makes a board from any of the ten templates, the
 * editor saves and publishes, and own tables, screens and links are refused plainly.
 */
test("the demo has Tavlor: ready boards with figures counted in the browser, Ny tavla from a template, save and publish", async () => {
  const { handleDemoRequest, setDemoUser } = await import("../features/demo/demo-backend");
  const { BOARD_TEMPLATE_KEYS } = await import("../lib/boards/templates");
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await handleDemoRequest(method, new URL(path, "http://localhost"), body === undefined ? null : JSON.stringify(body));
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  setDemoUser("demo-elna");
  const access = await call("GET", "/api/boards?part=access");
  assert.equal(access.status, 200);
  assert.equal(access.json.demo, true);
  assert.equal(access.json.read, true);

  const list = await call("GET", "/api/boards?part=list");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const items = list.json.items as { id: string; name: string; published: { number: number } | null }[];
  assert.ok(items.length >= 4, "the example boards are ready");
  assert.ok(items.every((item) => item.published?.number === 1), "and published");

  for (const item of items) {
    const feed = await call("GET", `/api/boards?part=feed&id=${item.id}`);
    assert.equal(feed.status, 200, JSON.stringify(feed.json));
    const cards = Object.entries(feed.json.cards as Record<string, { ok: boolean; reason?: string }>);
    assert.ok(cards.length > 0, `${item.name} has cards with data`);
    for (const [id, card] of cards) assert.equal(card.ok, true, `${item.name} ${id}: ${card.reason ?? ""}`);
  }

  // Every template can be made and its cards are counted (the admin sees every measure).
  for (const template of BOARD_TEMPLATE_KEYS) {
    const made = await call("POST", "/api/boards", { action: "create_board", board: { name: `Prov ${template}`, template } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const id = made.json.id as string;
    const board = await call("GET", `/api/boards?part=board&id=${id}`);
    assert.equal(board.status, 200);
    assert.ok((board.json.metrics as unknown[]).length > 10, "the editor gets the measures");
    const feed = await call("GET", `/api/boards?part=feed&draft=1&id=${id}`);
    for (const [card, data] of Object.entries(feed.json.cards as Record<string, { ok: boolean; reason?: string }>)) assert.equal(data.ok, true, `${template} ${card}: ${data.reason ?? ""}`);
    if (template === "week_work") {
      const draft = board.json.draft as { cards: { id: string; settings: Record<string, unknown> }[] };
      draft.cards[0]!.settings = { ...draft.cards[0]!.settings, accent: "round", emphasis: "tinted" };
      const saved = await call("POST", "/api/boards", { action: "save_board", id, revision: board.json.revision, board: { name: "Min vecka", description: "Prov", layout: draft } });
      assert.equal(saved.status, 200, JSON.stringify(saved.json));
      const published = await call("POST", "/api/boards", { action: "publish_board", id, revision: saved.json.revision, publish: { visibility: {} } });
      assert.equal(published.json.number, 1);
      const again = await call("GET", `/api/boards?part=board&id=${id}`);
      assert.equal(again.json.name, "Min vecka");
      assert.equal(((again.json.published as { layout: { cards: { settings: { accent?: string } }[] } }).layout.cards[0]!.settings.accent), "round");
    }
  }

  // What needs Workflow's server is empty to read and refused to change, in plain words.
  assert.deepEqual((await call("GET", "/api/boards?part=tables")).json, { items: [] });
  assert.deepEqual((await call("GET", "/api/boards?part=screens")).json, { items: [], canManage: false });
  const table = await call("POST", "/api/boards", { action: "create_table", table: { name: "Prov" } });
  assert.equal(table.status, 403);
  assert.match(String(table.json.error), /demon/);
  const link = await call("POST", "/api/boards", { action: "create_link", link: { name: "Prov" } });
  assert.equal(link.status, 403);
  assert.match(String(link.json.error), /demon/);
});

test("a demo person without the right to see boards gets no boards", async () => {
  const { handleDemoRequest, setDemoUser } = await import("../features/demo/demo-backend");
  setDemoUser("demo-elis");
  try {
    const response = await handleDemoRequest("GET", new URL("/api/boards?part=access", "http://localhost"), null);
    const access = await response.json() as { read: boolean };
    const list = await handleDemoRequest("GET", new URL("/api/boards?part=list", "http://localhost"), null);
    assert.equal(list.status, access.read ? 200 : 403);
  } finally { setDemoUser("demo-elna"); }
});

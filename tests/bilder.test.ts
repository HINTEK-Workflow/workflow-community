import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { solarMasterData } from "../lib/integrations/solar";
import { RowProduct } from "../features/catalogue/product-info";
import { productInfoOfApi } from "../lib/catalogue/product-info";

// Miniatyrer (2026-10-18): the picture link is read from Solar's answer, never stored as a file; a quote shows text only.
// Invented answers shaped like Solar's – nothing here calls Solar.

const base = { name: "Påhittad dvärgbrytare", electricalNo: "1000001", salesUnitofMeasure: "ST" };

test("the first https image link is the picture; http and empty links are ignored", () => {
  const many = solarMasterData({ ...base, imageLinks: [{ url: "http://example.invalid/a.jpg", linkNumber: 1 }, { url: "", linkNumber: 2 }, { url: "https://example.invalid/b.jpg", linkNumber: 3 }, { url: "https://example.invalid/c.jpg", linkNumber: 4 }] });
  assert.equal(many!.imageUrl, "https://example.invalid/b.jpg");
  assert.equal(solarMasterData({ ...base, imageLinks: [] })!.imageUrl, "");
  assert.equal(solarMasterData({ ...base })!.imageUrl, "");
  assert.equal(solarMasterData({ ...base, imageLinks: [{ url: "http://example.invalid/a.jpg" }] })!.imageUrl, "");
});

test("of several links, a picture the browser shows comes before a TIFF; only a TIFF keeps the first link", () => {
  const links = (...urls: string[]) => solarMasterData({ ...base, imageLinks: urls.map((url, index) => ({ url, linkNumber: index + 1 })) })!.imageUrl;
  assert.equal(links("https://example.invalid/a.tiff", "https://example.invalid/b.jpg"), "https://example.invalid/b.jpg");
  assert.equal(links("https://example.invalid/a.TIF", "https://example.invalid/b.PNG?v=2"), "https://example.invalid/b.PNG?v=2");
  assert.equal(links("https://example.invalid/a.tiff", "http://example.invalid/b.jpg", "https://example.invalid/c.webp", "https://example.invalid/d.gif"), "https://example.invalid/c.webp", "never an http link");
  assert.equal(links("https://example.invalid/a.png", "https://example.invalid/b.jpeg"), "https://example.invalid/a.png", "the first browser picture");
  assert.equal(links("https://example.invalid/a.tiff", "https://example.invalid/b.tif"), "https://example.invalid/a.tiff");
  assert.equal(links("https://example.invalid/jpg/a.tiff"), "https://example.invalid/jpg/a.tiff", "the ending decides, not a folder name");
});

test("Solar's capitalised field names are read the same way", () => {
  assert.equal(solarMasterData({ Name: "x", ElectricalNo: "1000001", ImageLinks: [{ Url: "https://example.invalid/d.jpg", LinkNumber: 1 }], MaterialDescription: base.name })!.imageUrl, "https://example.invalid/d.jpg");
});

test("a row product shows its picture, but not on a quote (images=false)", () => {
  const info = productInfoOfApi("solar", { eNumber: "1000001", imageUrl: "https://example.invalid/e.jpg" });
  const withPicture = renderToStaticMarkup(createElement(RowProduct, { info }));
  assert.match(withPicture, /<img[^>]+src="\/api\/product-image\?u=[^"]*example\.invalid%2Fe\.jpg/);
  const quote = renderToStaticMarkup(createElement(RowProduct, { info, images: false }));
  assert.doesNotMatch(quote, /<img|product-thumb/);
  assert.match(quote, /1000001/);
  assert.equal(renderToStaticMarkup(createElement(RowProduct, { info: productInfoOfApi("solar", { imageUrl: "https://example.invalid/e.jpg" }), images: false })), "");
});

test("thumbnail queue: off asks nothing, one question per article, 2 at a time, limit per search, a miss is quiet", async () => {
  const { ThumbQueue } = await import("../lib/catalogue/thumb-queue");
  const asked: string[] = [];
  const done: Record<string, string> = {};
  const releases: (() => void)[] = [];
  let running = 0;
  let peak = 0;
  const queue = new ThumbQueue(
    (key) => new Promise<string>((resolve, reject) => {
      asked.push(key); running += 1; peak = Math.max(peak, running);
      releases.push(() => { running -= 1; if (key === "bad") reject(new Error("fel")); else resolve(key === "none" ? "" : `https://example.invalid/${key}.jpg`); });
    }),
    (id, url) => { done[id] = url; }, 2, 4);
  assert.equal(queue.want("a", "k1"), false, "off by default");
  queue.enable(true);
  assert.equal(queue.want("a", "k1"), true);
  assert.equal(queue.want("a", "k1"), false, "one question per article");
  assert.equal(queue.want("b", "bad"), true);
  assert.equal(queue.want("c", "none"), true);
  assert.equal(queue.want("d", "k4"), true);
  assert.equal(queue.want("e", "k5"), false, "over the limit per search (4)");
  assert.deepEqual(asked, ["k1", "bad"], "only 2 at a time");
  releases.shift()!(); releases.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(asked, ["k1", "bad", "none", "k4"]);
  releases.shift()!(); releases.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(peak, 2);
  assert.deepEqual(done, { a: "https://example.invalid/k1.jpg", b: "", c: "", d: "https://example.invalid/k4.jpg" });
  queue.reset();
  assert.equal(queue.want("e", "k5"), true, "a new search starts over");
});

test("thumbnail queue: a miss or an error is asked once more, then it is quiet", async () => {
  const { ThumbQueue } = await import("../lib/catalogue/thumb-queue");
  const asked: string[] = [];
  const done: Record<string, string> = {};
  let answers = 0;
  const queue = new ThumbQueue(
    async (key) => { asked.push(key); answers += 1; if (key === "flaky" && answers > 1) return "https://example.invalid/flaky.jpg"; return ""; },
    (id, url) => { done[id] = url; }, 2, 10, 1, 5);
  (globalThis as { window?: unknown }).window = { setTimeout };
  queue.enable(true);
  queue.want("a", "flaky");
  queue.want("b", "none");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(asked.sort(), ["flaky", "flaky", "none", "none"], "each miss was asked twice, no more");
  assert.equal(done.a, "https://example.invalid/flaky.jpg", "the second try found the picture");
  assert.equal(done.b, "", "a real miss ends quiet");
});

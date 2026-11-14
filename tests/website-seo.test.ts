// Min webbsida, Sökmotorer och delning (2026-11-11): finding the optional SEO meta, checking and cleaning the values, the `meta`
// sent to WordPress (only what differs, never for a site without the keys), and the client against a local stand-in with and
// without the plugin (never a real site).
import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanSeoText, EMPTY_SEO, indexHasSeo, normalSeo, sameSeo, seoFromMeta, seoMetaPayload, seoProblem, storedSeo, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX,
} from "../lib/website/seo";
import { getMedia, getPage, uploadMedia, writePage } from "../lib/website/wp-client";
import { startFakeWordPress } from "./fake-wordpress";

process.env.WEBSITE_ALLOW_LOCAL_ADDRESSES = "true";
const full = { hintek_seo_title: "Titel", hintek_seo_description: "Text", hintek_seo_noindex: true, hintek_seo_image: 12 };

test("the SEO meta is found only when the site has the keys", () => {
  assert.equal(seoFromMeta([]), null, "plain WordPress: meta is an empty list");
  assert.equal(seoFromMeta(undefined), null);
  assert.equal(seoFromMeta({ footnotes: "" }), null, "other plugins' meta is not ours");
  assert.equal(seoFromMeta({ hintek_seo_title: "x" }), null, "the title alone is not enough");
  assert.deepEqual(seoFromMeta(full), { title: "Titel", description: "Text", noindex: true, image: 12 });
  assert.deepEqual(seoFromMeta({ hintek_seo_title: "", hintek_seo_description: "" }), EMPTY_SEO, "missing noindex and image are off and 0");
  assert.deepEqual(seoFromMeta({ ...full, hintek_seo_title: 5, hintek_seo_noindex: "1", hintek_seo_image: -3 }), { title: "", description: "Text", noindex: true, image: 0 });
  assert.equal(indexHasSeo({ namespaces: ["wp/v2", "hintek-seo/v1"] }), true);
  assert.equal(indexHasSeo({ namespaces: ["wp/v2"] }), false);
  assert.equal(indexHasSeo(null), false);
});

test("the values are checked and cleaned like the plugin's", () => {
  assert.equal(seoProblem({ ...EMPTY_SEO, title: "a".repeat(SEO_TITLE_MAX) }), null);
  assert.match(seoProblem({ ...EMPTY_SEO, title: "a".repeat(SEO_TITLE_MAX + 1) })!, /högst 70/);
  assert.match(seoProblem({ ...EMPTY_SEO, description: "å".repeat(SEO_DESCRIPTION_MAX + 1) })!, /högst 200/);
  assert.equal(seoProblem({ ...EMPTY_SEO, title: "😀".repeat(SEO_TITLE_MAX) }), null, "counted as WordPress counts: characters, not UTF-16 units");
  assert.match(seoProblem({ ...EMPTY_SEO, image: 1.5 })!, /Delningsbilden/);
  assert.match(seoProblem({ ...EMPTY_SEO, image: -1 })!, /Delningsbilden/);
  assert.equal(cleanSeoText("  Rad ett\nrad två\t\u0000 slut  "), "Rad ett rad två slut");
  assert.deepEqual(normalSeo({ title: " A \n B ", description: "C", noindex: true, image: 4 }), { title: "A B", description: "C", noindex: true, image: 4 });
  assert.equal(sameSeo(null, null), true);
  assert.equal(sameSeo(EMPTY_SEO, null), false);
  assert.equal(sameSeo(EMPTY_SEO, { ...EMPTY_SEO }), true);
  assert.deepEqual(storedSeo({ title: "t", description: "", noindex: false, image: 0 }), { title: "t", description: "", noindex: false, image: 0 });
  assert.equal(storedSeo({ title: "t" }), null);
  assert.equal(storedSeo(null), null);
});

test("the meta sent holds only the keys that differ, and nothing when nothing does", () => {
  const now = { title: "A", description: "B", noindex: false, image: 0 };
  assert.equal(seoMetaPayload(now, { ...now }), null);
  assert.deepEqual(seoMetaPayload({ ...now, title: "Ny" }, now), { hintek_seo_title: "Ny" });
  assert.deepEqual(seoMetaPayload({ title: "", description: "B", noindex: true, image: 7 }, now), { hintek_seo_title: "", hintek_seo_noindex: true, hintek_seo_image: 7 });
});

test("the client: no meta read or sent without the plugin; with it, read and written in the same page update", async () => {
  const password = "abcd efgh ijkl mnop qrst uvwx";
  const plain = await startFakeWordPress({ username: "r", password, pages: [{ id: 1, title: "Start", content: "<p>Hej</p>" }] });
  const seo = await startFakeWordPress({ username: "r", password, seo: true, pages: [{ id: 1, title: "Start", content: "<p>Hej</p>", seo: { hintek_seo_title: "Gammal" } }] });
  try {
    const plainConfig = { baseUrl: plain.base, username: "r", password };
    assert.equal((await getPage(plainConfig, 1)).seo, null, "plain WordPress has no SEO values");
    await writePage(plainConfig, 1, { content: "<p>Hej då</p>" });
    assert.deepEqual(Object.keys(plain.writes[0].body), ["content"], "only the content reaches a site without the plugin");

    const config = { baseUrl: seo.base, username: "r", password };
    const page = await getPage(config, 1);
    assert.deepEqual(page.seo, { title: "Gammal", description: "", noindex: false, image: 0 });
    const media = await uploadMedia(config, { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), name: "Dela.png", type: "image/png" });
    assert.equal((await getMedia(config, media.id))?.url, media.url);
    assert.equal(await getMedia(config, 99999), null, "a missing picture is null, not an error");
    const written = await writePage(config, 1, { content: "<p>Ny</p>", meta: { hintek_seo_title: "Ny titel", hintek_seo_image: media.id } });
    assert.deepEqual(seo.writes.at(-1)!.body, { content: "<p>Ny</p>", meta: { hintek_seo_title: "Ny titel", hintek_seo_image: media.id } }, "one update with both");
    assert.deepEqual(written.seo, { title: "Ny titel", description: "", noindex: false, image: media.id }, "WordPress's values after the write");
    assert.notEqual(written.modified, page.modified);
    const metaOnly = await writePage(config, 1, { meta: { hintek_seo_noindex: true } });
    assert.deepEqual(Object.keys(seo.writes.at(-1)!.body), ["meta"], "only the meta when the content is the same (no needless revision)");
    assert.equal(metaOnly.seo?.noindex, true);
    assert.equal(seo.pages.get(1)!.content, "<p>Ny</p>");
    // Too long for the plugin (it refuses over REST, never cuts): a clear Swedish message, nothing changed.
    await assert.rejects(writePage(config, 1, { meta: { hintek_seo_title: "x".repeat(71) } }), (error: unknown) => error instanceof Error && /för lång[\s\S]*Inget ändrades/.test(error.message) && (error as { status?: number }).status === 400);
    assert.equal(seo.pages.get(1)!.meta.hintek_seo_title, "Ny titel");
  } finally { await plain.stop(); await seo.stop(); }
});

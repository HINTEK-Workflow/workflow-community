import assert from "node:assert/strict";
import test from "node:test";
import { facebookMultiPhotoPost, type GraphRequest, type GraphTransport } from "../lib/meta/graph";
import { createImageCache, imageCacheKey } from "../lib/meta/image-cache";
import { facebookLoginInstagram } from "../lib/meta/instagram";
import { cancelSummary, cancelWaiting, finishProgress, initialProgress, progressOf, setStep, STALE_MS, STOPPED_MESSAGE } from "../lib/meta/progress";
import { campaignLink, campaignText, facebookCaption, INSTAGRAM_TEXT_MAX, instagramCaption, linkedInCommentary, postProblem } from "../lib/meta/text";
import { demoStartKey } from "../lib/analytics/catalog";
import { postContentHash } from "../lib/schedule/model";

// Inlägg 0.67.0 (2026-11-15, built 2026-11-16): Bara på Instagram, Kampanjlänkar, Karusell / flera bilder, the AI disclosure,
// the preview's cache and the publishing steps.

const HOSTS = ["app.hintekwork.com", "hintekwork.com", "www.hintekwork.com"];

test("Kampanjlänkar: the own hosts get ?via=<channel>, other addresses and an existing via stay as they are", () => {
  assert.equal(campaignLink("https://hintekwork.com/demo", "facebook", HOSTS), "https://hintekwork.com/demo?via=facebook");
  assert.equal(campaignLink("https://www.hintekwork.com/?a=1#top", "linkedin", HOSTS), "https://www.hintekwork.com/?a=1&via=linkedin#top");
  assert.equal(campaignLink("https://hintekwork.com/demo?via=button", "facebook", HOSTS), "https://hintekwork.com/demo?via=button", "an own via is kept");
  assert.equal(campaignLink("https://example.se/demo", "facebook", HOSTS), "https://example.se/demo", "another site is left alone");
  assert.equal(campaignLink("https://evil-hintekwork.com/", "facebook", HOSTS), "https://evil-hintekwork.com/");
  assert.equal(campaignLink("inte en adress", "facebook", HOSTS), "inte en adress");
  assert.equal(campaignText("Prova på https://hintekwork.com/demo. Eller (https://hintekwork.com/priser)!", "instagram", HOSTS),
    "Prova på https://hintekwork.com/demo?via=instagram. Eller (https://hintekwork.com/priser?via=instagram)!", "the full stop and bracket stay outside");
  assert.equal(campaignText("Läs mer på hintekwork.com.", "facebook", HOSTS), "Läs mer på hintekwork.com.", "a bare name without https is not a link");
  assert.equal(campaignText("https://hintekwork.com/demo", "facebook", []), "https://hintekwork.com/demo", "no hosts, no change");
  // Beteendeanalys counts the channel as its own way in to the demo.
  assert.deepEqual(["facebook", "instagram", "linkedin"].map(demoStartKey), ["start_facebook", "start_instagram", "start_linkedin"]);
});

test("each channel's text: the Instagram text only on Instagram, the links per channel only when switched on", () => {
  const post = { caption: "Hej", hashtags: "#el", link: "https://hintekwork.com/demo", instagramText: "Länk i bio 👆", campaignLinks: true };
  assert.equal(facebookCaption(post, HOSTS), "Hej\n\n#el\n\nhttps://hintekwork.com/demo?via=facebook");
  assert.equal(linkedInCommentary(post, HOSTS), "Hej\n\n#el\n\nhttps://hintekwork.com/demo?via=linkedin");
  assert.equal(instagramCaption(post, HOSTS), "Hej\n\nLänk i bio 👆\n\n#el");
  assert.equal(facebookCaption({ ...post, campaignLinks: false }, HOSTS), "Hej\n\n#el\n\nhttps://hintekwork.com/demo", "switched off per post");
  assert.equal(facebookCaption(post), "Hej\n\n#el\n\nhttps://hintekwork.com/demo", "without the hosts (an older caller) nothing changes");
  const base = { heading: "R", body: "", caption: "Text", link: null, toFacebook: true, toInstagram: true };
  assert.equal(postProblem({ ...base, instagramText: "x".repeat(INSTAGRAM_TEXT_MAX + 1) }), `Texten bara för Instagram får vara högst ${INSTAGRAM_TEXT_MAX} tecken.`);
  assert.equal(postProblem({ ...base, instagramText: "Länk i bio" }), null);
});

const recorder = (answers: (request: GraphRequest) => unknown) => {
  const calls: GraphRequest[] = [];
  const transport: GraphTransport = async (request) => { calls.push(request); return { status: 200, body: answers(request) }; };
  return { calls, transport };
};

test("Karusell: children with is_carousel_item and no caption or AI flag, the carousel with the caption and is_ai_generated", async () => {
  let n = 0;
  const { calls, transport } = recorder(() => ({ id: `c${++n}` }));
  const publisher = facebookLoginInstagram(transport);
  const account = { id: "17841", token: "t" };
  const child = await publisher.createContainer(account, { imageUrl: "https://app.example/1", caption: "ignored", carouselItem: true, aiGenerated: true });
  assert.equal(child, "c1");
  assert.deepEqual(calls[0].params, { image_url: "https://app.example/1", is_carousel_item: true, access_token: "t" }, "Meta refuses is_ai_generated on a child");
  await publisher.createCarousel(account, { children: ["c1", "c2"], caption: "Text", aiGenerated: true });
  assert.deepEqual(calls[1].params, { media_type: "CAROUSEL", children: "c1,c2", caption: "Text", is_ai_generated: true, access_token: "t" });
  await publisher.createContainer(account, { imageUrl: "https://app.example/2", caption: "En", aiGenerated: true });
  assert.equal(calls[2].params?.is_ai_generated, true, "a single picture carries the disclosure");
  await publisher.createContainer(account, { imageUrl: "https://app.example/3", caption: "", story: true, aiGenerated: false });
  assert.equal(calls[3].params?.is_ai_generated, undefined, "no flag unless ticked");
  await assert.rejects(publisher.createCarousel(account, { children: ["c1"], caption: "" }), /2–20/);
});

test("Facebook with several pictures: the unpublished photos attached to one post on the feed", async () => {
  const { calls, transport } = recorder(() => ({ id: "page_post" }));
  assert.equal(await facebookMultiPhotoPost(transport, { id: "123", token: "t" }, { photoIds: ["p1", "p2"], message: "Text" }), "page_post");
  assert.equal(calls[0].path, "123/feed");
  assert.deepEqual(calls[0].params, { message: "Text", "attached_media[0]": "{\"media_fbid\":\"p1\"}", "attached_media[1]": "{\"media_fbid\":\"p2\"}", access_token: "t" });
});

test("the publishing steps: begun, sent, cancelled, and what an Avbryt says", () => {
  const now = new Date("2026-11-16T10:00:00Z");
  let progress = initialProgress("live", ["linkedin", "facebook", "instagram"], now);
  assert.deepEqual(progress.steps.map((step) => step.key), ["image", "facebook", "instagram", "linkedin"], "always in the channels' order, the picture first");
  progress = setStep(setStep(progress, "image", "done", "Bilden är klar."), "facebook", "done", "Publicerat på Facebook.");
  progress = cancelWaiting(progress);
  assert.deepEqual(progress.steps.map((step) => step.status), ["done", "done", "cancelled", "cancelled"]);
  assert.equal(cancelSummary(progress), "Publiceringen avbröts. Redan publicerat: Facebook – det ligger kvar. Inte skickat: Instagram och LinkedIn.");
  const finished = finishProgress(progress, cancelSummary(progress), now);
  assert.equal(finished.running, false);
  assert.equal(progressOf(JSON.parse(JSON.stringify(finished)), now.getTime())?.message, finished.message, "stored and read back the same");
  const test_ = cancelWaiting(initialProgress("test", ["facebook"], now));
  assert.equal(cancelSummary(test_), "Testpubliceringen avbröts. Inte skickat: Facebook.");
  // A run left running after a restart is shown as stopped, never as running for ever.
  const stale = progressOf(initialProgress("live", ["facebook"], now), now.getTime() + STALE_MS + 1);
  assert.equal(stale?.running, false);
  assert.equal(stale?.message, STOPPED_MESSAGE);
  assert.equal(progressOf({ mode: "nope" }), null);
  assert.equal(progressOf(null), null);
});

test("the preview's cache: the same content once, any change a new key, bounded in count and bytes", () => {
  const key = (heading: string, background: Uint8Array | null = null) => imageCacheKey({ organizationId: "o", heading, body: "", template: "color", format: "feed" }, background);
  assert.equal(key("A"), key("A"));
  assert.notEqual(key("A"), key("B"));
  assert.notEqual(key("A", new Uint8Array([1])), key("A", new Uint8Array([2])), "another background is another picture");
  const cache = createImageCache(2, 10);
  cache.set("a", Buffer.from("1234"));
  cache.set("b", Buffer.from("1234"));
  assert.ok(cache.get("a"), "a is used, so b is now the oldest");
  cache.set("c", Buffer.from("1234"));
  assert.equal(cache.get("b"), null);
  assert.ok(cache.get("a") && cache.get("c"));
  cache.set("big", Buffer.alloc(11));
  assert.equal(cache.get("big"), null, "a picture larger than the whole cache is not kept");
  assert.ok(cache.size <= 2);
});

test("the approved content: the new choices count only when used, so earlier approvals stay valid", () => {
  const post = { heading: "R", body: "", caption: "T", link: null, template: "color", toFacebook: true, toInstagram: true, backgroundSource: null, background: null };
  const base = postContentHash(post);
  assert.equal(postContentHash({ ...post, instagramText: "", campaignLinks: false, aiGenerated: false, images: [] }), base);
  for (const change of [{ instagramText: "Länk i bio" }, { campaignLinks: true }, { aiGenerated: true }, { images: [{ bytes: new Uint8Array([1]) }] }])
    assert.notEqual(postContentHash({ ...post, ...change }), base, JSON.stringify(Object.keys(change)));
  assert.notEqual(postContentHash({ ...post, images: [{ bytes: new Uint8Array([1]) }] }), postContentHash({ ...post, images: [{ bytes: new Uint8Array([2]) }] }), "another picture asks again");
});

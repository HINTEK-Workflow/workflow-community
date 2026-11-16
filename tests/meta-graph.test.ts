import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import {
  debugToken, exchangeUserToken, facebookPhoto, fetchTransport, graph, graphBase, graphIsLocal, listPages, MetaError, metaErrorOf, missingScopes, REQUIRED_SCOPES, type GraphTransport,
} from "../lib/meta/graph";
import { facebookLoginInstagram, waitForContainer, type InstagramPublisher } from "../lib/meta/instagram";
import { blockEdges, contrast, GRID_CROP, IMAGE_HEIGHT, IMAGE_WIDTH, planPost, readable, renderPostImage, SAFE_SIDE, surfaceOf, textOn } from "../lib/meta/image";
import { captionWithHashtags, checklistItems, draftFromRelease, draftFromWebsitePage, facebookCaption, firstParagraph, HASHTAG_FIELD_MAX, hashtagList, instagramCaption, linkedInCommentary, normalizeHashtags, plainText, POST_TEMPLATES, postProblem, shorten, wrapText } from "../lib/meta/text";
import { ALL_SCOPES, startFakeMeta } from "./fake-meta";

// Facebook och Instagram (2026-11-10): the calls to Meta, the error mapping, the texts and the picture – against a stand-in for
// Meta on 127.0.0.1 (tests/fake-meta.ts), never Meta itself.

test("the base is Meta's fixed host unless a loopback stand-in is named", () => {
  assert.equal(graphBase({}), "https://graph.facebook.com");
  assert.equal(graphBase({ META_GRAPH_BASE_URL: "http://127.0.0.1:3097" }), "http://127.0.0.1:3097");
  assert.equal(graphBase({ META_GRAPH_BASE_URL: "http://localhost:3097/x" }), "http://localhost:3097");
  for (const other of ["https://evil.example", "http://10.0.0.1:80", "https://127.0.0.1:3097", "http://user:pw@127.0.0.1:1", "nonsense"])
    assert.equal(graphBase({ META_GRAPH_BASE_URL: other }), "https://graph.facebook.com", other);
  assert.equal(graphIsLocal({}), false);
  assert.equal(graphIsLocal({ META_GRAPH_BASE_URL: "http://127.0.0.1:1" }), true);
});

test("Meta's errors become a kind and a plain Swedish text", () => {
  for (const subcode of [460, 463, 467, undefined]) {
    const error = metaErrorOf(400, { code: 190, error_subcode: subcode, type: "OAuthException" });
    assert.equal(error.kind, "token", String(subcode));
    assert.match(error.message, /Graph API Explorer/);
  }
  assert.match(metaErrorOf(400, { code: 190, error_subcode: 463 }).message, /gått ut/);
  assert.match(metaErrorOf(400, { code: 190, error_subcode: 460 }).message, /lösenordet/);
  for (const code of [10, 200, 230, 299]) assert.equal(metaErrorOf(403, { code }).kind, "permission", String(code));
  for (const code of [4, 17, 32, 613]) { const error = metaErrorOf(400, { code }); assert.equal(error.kind, "rate", String(code)); assert.equal(error.status, 429); }
  assert.equal(metaErrorOf(500, { code: 1 }).kind, "other");
  assert.notEqual(metaErrorOf(400, { code: 190 }).status, 401, "never 401 (that signs the person out)");
});

test("missing permissions are named; all six are required", () => {
  assert.deepEqual(missingScopes([...ALL_SCOPES]), []);
  assert.deepEqual(missingScopes(["pages_show_list", "pages_manage_posts"]), ["pages_read_engagement", "instagram_basic", "instagram_content_publish", "business_management"]);
  assert.equal(REQUIRED_SCOPES.length, 6);
});

test("token exchange, debug_token and the pages through the real transport against the stand-in", async (t) => {
  const fake = await startFakeMeta({ pages: [
    { id: "111", name: "Sida Ett", instagram: { id: "17841", username: "ett" } },
    { id: "222", name: "Sida Två", instagram: null },
  ] });
  const previous = process.env.META_GRAPH_BASE_URL;
  process.env.META_GRAPH_BASE_URL = fake.url;
  t.after(async () => { if (previous === undefined) delete process.env.META_GRAPH_BASE_URL; else process.env.META_GRAPH_BASE_URL = previous; await fake.stop(); });
  const app = { appId: fake.appId, appSecret: fake.appSecret };

  await assert.rejects(exchangeUserToken(fetchTransport, { ...app, appSecret: "wrongwrongwrongwrong" }, fake.shortToken), (error: unknown) => error instanceof MetaError);
  await assert.rejects(exchangeUserToken(fetchTransport, app, "EAAnotTheRightTokenAtAll000000"), (error: unknown) => error instanceof MetaError && error.kind === "token");
  const long = await exchangeUserToken(fetchTransport, app, fake.shortToken);
  assert.match(long.token, /^EAALong/);
  assert.ok(long.expiresAt && long.expiresAt.getTime() > Date.now() + 50 * 86_400_000, "about 60 days");

  const info = await debugToken(fetchTransport, app, long.token);
  assert.equal(info.valid, true);
  assert.equal(info.appId, fake.appId);
  assert.deepEqual(info.scopes, ALL_SCOPES);
  assert.ok(info.dataAccessExpiresAt);

  const pages = await listPages(fetchTransport, long.token);
  assert.deepEqual(pages.map((page) => [page.id, page.name, page.instagram?.username ?? null]), [["111", "Sida Ett", "ett"], ["222", "Sida Två", null]]);
  const pageInfo = await debugToken(fetchTransport, app, pages[0].token);
  assert.equal(pageInfo.expiresAt, null, "a page token from a long-lived user token never expires by itself");

  // A Facebook picture as bytes (published=false: a test nobody sees).
  const photo = await facebookPhoto(fetchTransport, { id: "111", token: pages[0].token }, { bytes: new Uint8Array(2000), caption: "Hej", published: false });
  assert.ok(photo.photoId);
  assert.equal(photo.postId, null);
  assert.equal(fake.posts.at(-1)?.published, false);

  // Revoked: code 190, subcode 460.
  fake.revokeAll();
  await assert.rejects(listPages(fetchTransport, long.token), (error: unknown) => error instanceof MetaError && error.kind === "token" && error.subcode === 460);
  // Never a token in the stand-in's request log (it holds paths only).
  for (const request of fake.requests) assert.equal(fake.issued().some((token) => request.path.includes(token)), false);
});

test("graph() turns a non-JSON or error answer into MetaError", async () => {
  const transport: GraphTransport = async () => ({ status: 200, body: null });
  await assert.rejects(graph(transport, { method: "GET", path: "me" }), MetaError);
  const limited: GraphTransport = async () => ({ status: 400, body: { error: { code: 613, message: "Calls limited" } } });
  await assert.rejects(graph(limited, { method: "GET", path: "me" }), (error: unknown) => error instanceof MetaError && error.kind === "rate");
});

test("Instagram: the container is waited for, an error status stops, the quota is read", async () => {
  const states = ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"];
  const publisher: InstagramPublisher = {
    remainingToday: async () => 3, createContainer: async () => "c1", createCarousel: async () => "k1", publish: async () => "m1",
    containerStatus: async () => (states.shift() ?? "FINISHED") as never,
  };
  await waitForContainer(publisher, { id: "1", token: "t" }, "c1", { delayMs: 1 });
  const broken: InstagramPublisher = { ...publisher, containerStatus: async () => "ERROR" };
  await assert.rejects(waitForContainer(broken, { id: "1", token: "t" }, "c1", { delayMs: 1 }), /kunde inte hämta/);
  const slow: InstagramPublisher = { ...publisher, containerStatus: async () => "IN_PROGRESS" };
  await assert.rejects(waitForContainer(slow, { id: "1", token: "t" }, "c1", { delayMs: 1, attempts: 3 }), /inte klar/);

  const quota: GraphTransport = async () => ({ status: 200, body: { data: [{ quota_usage: 48, config: { quota_total: 50 } }] } });
  assert.equal(await facebookLoginInstagram(quota).remainingToday({ id: "1", token: "t" }), 2);
  const unreadable: GraphTransport = async () => ({ status: 200, body: { data: [] } });
  assert.equal(await facebookLoginInstagram(unreadable).remainingToday({ id: "1", token: "t" }), null);
});

test("the post's texts: limits, drafts from a page and a version, captions", () => {
  const ok = { heading: "Rubrik", body: "Text", caption: "Inlägg", link: null, toFacebook: true, toInstagram: true };
  assert.equal(postProblem(ok), null);
  assert.match(postProblem({ ...ok, toFacebook: false, toInstagram: false })!, /Välj/);
  assert.match(postProblem({ ...ok, heading: " " })!, /rubrik/);
  assert.match(postProblem({ ...ok, caption: "x".repeat(2201) })!, /2200/);
  assert.match(postProblem({ ...ok, caption: Array.from({ length: 31 }, (_, index) => `#tag${index}`).join(" ") })!, /hashtaggar/);
  assert.match(postProblem({ ...ok, link: "javascript:alert(1)" })!, /https/);

  const page = draftFromWebsitePage({ title: "Solceller &amp; laddboxar", markup: "<!-- wp:paragraph --><p>Vi installerar <strong>solceller</strong> i hela länet.</p><!-- /wp:paragraph --><p>Andra stycket.</p>", link: "https://example.se/sol/" });
  assert.equal(page.heading, "Solceller & laddboxar");
  assert.equal(page.body, "Vi installerar solceller i hela länet.");
  assert.equal(page.link, "https://example.se/sol/");
  assert.equal(draftFromWebsitePage({ title: "X", markup: "", link: "javascript:x" }).link, null);
  const release = draftFromRelease({ version: "0.56.0", summary: "Inlägg till Facebook och Instagram.", items: ["Ett", "Två"] });
  assert.equal(release.heading, "Nytt i version 0.56.0");
  assert.match(release.caption, /• Ett\n• Två/);

  assert.equal(facebookCaption({ caption: "Hej ", link: "https://example.se" }), "Hej\n\nhttps://example.se");
  assert.equal(instagramCaption({ caption: " Hej " }), "Hej");
  assert.equal(plainText("<p>a&nbsp;b &#8211; c</p>"), "a b – c");
  assert.equal(firstParagraph("<p> </p><p>Andra</p>"), "Andra");
  assert.equal(shorten("ett två tre fyra", 10), "ett två…");
  assert.deepEqual(wrapText("ett två tre", 7, (text) => text.length), ["ett två", "tre"]);
});

test("the picture: 1080 × 1350 JPEG in every template, with and without a logo", async () => {
  const font = (name: string) => new Uint8Array(readFileSync(`public/fonts/${name}`));
  const fonts = { regular: font("Manrope-Regular.ttf"), bold: font("Manrope-Bold.ttf"), fallback: font("DejaVuSans.ttf") };
  const logo = new Uint8Array(readFileSync("public/icons/workflow-512.png"));
  for (const template of ["color", "light", "frame", "split", "unknown"]) {
    const bytes = await renderPostImage({ heading: "Nu installerar vi solceller i hela länet", body: "Ring oss för en offert – åäö ÅÄÖ.", template }, { primary: "#174C72", companyName: "Elfirma AB", logo: template === "light" ? null : logo }, fonts);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "jpeg", template);
    assert.equal(meta.width, IMAGE_WIDTH);
    assert.equal(meta.height, IMAGE_HEIGHT);
  }
  // A broken logo is left out; the picture is still made.
  const bytes = await renderPostImage({ heading: "Rubrik", body: "", template: "color" }, { primary: "not a colour", companyName: "", logo: new Uint8Array([1, 2, 3]) }, fonts);
  assert.equal((await sharp(bytes).metadata()).format, "jpeg");
  assert.equal(textOn("#FFFFFF"), "#0F172A");
  assert.equal(textOn("#174C72"), "#FFFFFF");
});

// Hashtaggar (2026-11-12): the field's own hashtags follow the text on every channel, never in the stored caption.
test("hashtags: normalised, after the text on each channel, counted in Instagram's limits", () => {
  assert.equal(normalizeHashtags("elinstallation, #Egenkontroll ##sol-el  EGENKONTROLL å_ä #"), "#elinstallation #Egenkontroll #solel #å_ä");
  assert.equal(normalizeHashtags(""), "");
  assert.equal(hashtagList(normalizeHashtags(Array.from({ length: 40 }, (_, index) => `t${index}`).join(" "))).length, HASHTAG_FIELD_MAX);
  const post = { caption: "Hej", link: "https://example.se", hashtags: "#el #sol" };
  assert.equal(captionWithHashtags(post, "facebook"), "Hej\n\n#el #sol\n\nhttps://example.se");
  assert.equal(facebookCaption(post), "Hej\n\n#el #sol\n\nhttps://example.se");
  assert.equal(linkedInCommentary(post), "Hej\n\n#el #sol\n\nhttps://example.se");
  assert.equal(instagramCaption(post), "Hej\n\n#el #sol");
  assert.equal(facebookCaption({ caption: "Hej", link: null }), "Hej");
  const base = { heading: "R", body: "", caption: "Text #ett", link: null, toFacebook: false, toInstagram: true };
  assert.equal(postProblem({ ...base, hashtags: "#två" }), null);
  assert.match(postProblem({ ...base, hashtags: Array.from({ length: 30 }, (_, index) => `#t${index}`).join(" ") }) ?? "", /högst 30 hashtaggar/);
  assert.equal(postProblem({ ...base, toInstagram: false, toFacebook: true, hashtags: Array.from({ length: 30 }, (_, index) => `#t${index}`).join(" ") }), null);
  assert.match(postProblem({ ...base, caption: "x".repeat(2195), hashtags: "#langtord" }) ?? "", /Instagrams gräns/);
});

// Fler mallar (2026-11-12): every template, short/long/empty text, with and without a logo and a photo; the text stays inside the
// safe area, above the logo, and reads at 4.5:1 against what lies behind it, for light, dark and mid company colours.
test("the templates: every one renders 1080 × 1350 (4:5), keeps its text inside and readable", async () => {
  const font = (name: string) => new Uint8Array(readFileSync(`public/fonts/${name}`));
  const fonts = { regular: font("Manrope-Regular.ttf"), bold: font("Manrope-Bold.ttf"), fallback: font("DejaVuSans.ttf") };
  const logo = new Uint8Array(readFileSync("public/icons/workflow-512.png"));
  const photo = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#7A9E5B" } }).jpeg().toBuffer();
  assert.ok(POST_TEMPLATES.length >= 12);
  assert.equal(new Set(POST_TEMPLATES.map((template) => template.key)).size, POST_TEMPLATES.length);
  const texts = [
    { heading: "Egenkontroll på 5 minuter", body: "Fyll i protokollet på plats och få en PDF direkt." },
    { heading: "Så gör du egenkontrollen snabbt och rätt varje gång, även när kunden står bredvid och väntar".slice(0, 90), body: "Fyll i protokollet direkt på plats i mobilen. Mätvärden, foton och underskrift hamnar på rätt ställe, och kunden får en färdig PDF i sin e-post innan du har packat ihop verktygen. Inget efterarbete alls.".slice(0, 220) },
    { heading: "Rubrik", body: "" },
    { heading: "Ettväldigtlångtordutanmellanrumsomintekanbrytasnågonstans", body: "Ettlikadantordutanmellanrumsomintegårattbrytaheller\nRad två\nRad tre\nRad fyra\nRad fem" },
  ];
  for (const template of POST_TEMPLATES) {
    for (const [index, text] of texts.entries()) {
      for (const primary of ["#174C72", "#F5B800", "#E11D48", "#FFFFFF", "#000000", "#3B82F6"]) {
        for (const withName of [false, true]) {
          const plan = planPost({ ...text, template: template.key }, { primary, companyName: "Elfirma Exempel AB" }, fonts, { withName });
          const logoTop = plan.logo.area.y;
          for (const block of plan.texts) {
            const where = `${template.key} text ${index} ${primary} ${block.role}`;
            const { left, right } = blockEdges(block);
            assert.ok(left >= SAFE_SIDE - 0.5 && right <= IMAGE_WIDTH - SAFE_SIDE + 0.5, `${where}: ${left}–${right}`);
            assert.ok(block.top >= 60, where);
            // Inside Instagram's 3:4 grid tile with room to spare, and above the logo with its 130 px below.
            assert.ok(left >= GRID_CROP.x + 90 && right <= GRID_CROP.x + GRID_CROP.width - 90, `${where}: outside the grid tile`);
            assert.ok(plan.logo.area.y + plan.logo.area.height <= IMAGE_HEIGHT - 100, where);
            if (block.role !== "name") assert.ok(block.bottom <= logoTop - 10, `${where}: bottom ${block.bottom} over the logo at ${logoTop}`);
            assert.ok(contrast(block.fill, block.behind) >= 4.5, `${where}: contrast ${contrast(block.fill, block.behind).toFixed(2)}`);
          }
        }
      }
      // Drawn: the short text with a logo, without one (the name) and on a photo; the other texts with a logo.
      const variants = ([["logo", logo, null], ["name", null, null], ["photo", logo, photo]] as const).filter(([variant]) => index === 0 || (index < 3 && variant === "logo"));
      await Promise.all(variants.map(async ([variant, brandLogo, background]) => {
        const bytes = await renderPostImage({ ...text, template: template.key }, { primary: "#174C72", companyName: "Elfirma AB", logo: brandLogo }, fonts, background);
        const meta = await sharp(bytes).metadata();
        assert.equal(meta.format, "jpeg", `${template.key} ${variant}`);
        assert.equal(meta.width, IMAGE_WIDTH);
        assert.equal(meta.height, IMAGE_HEIGHT);
      }));
    }
  }
  // The colour helpers.
  assert.ok(contrast(readable("#F5B800", "#FFFFFF"), "#FFFFFF") >= 4.5);
  assert.ok(contrast(readable("#174C72", "#0F172A", 3), "#0F172A") >= 3);
  for (const colour of ["#3B82F6", "#808080", "#F5B800", "#00FF00"]) assert.ok(contrast(textOn(surfaceOf(colour)), surfaceOf(colour)) >= 4.5, colour);
  assert.equal(textOn("#3B82F6"), "#0F172A");
  // The checklist rows: lines, else sentences; list marks off; at most four.
  assert.deepEqual(checklistItems("- Ett\n• Två\n\n✓ Tre"), ["Ett", "Två", "Tre"]);
  assert.deepEqual(checklistItems("Fyll i. Få en PDF! Klart?"), ["Fyll i.", "Få en PDF!", "Klart?"]);
  assert.deepEqual(checklistItems("1\n2\n3\n4\n5"), ["1", "2", "3", "4"]);
  assert.deepEqual(checklistItems(""), []);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { facebookPhotoStory, type GraphRequest, type GraphTransport } from "../lib/meta/graph";
import { facebookLoginInstagram } from "../lib/meta/instagram";
import { blockEdges, contrast, formatSize, IMAGE_HEIGHT, IMAGE_WIDTH, planPost, renderPostImage, SAFE_SIDE, STORY_HEIGHT, STORY_OFFSET, STORY_SAFE } from "../lib/meta/image";
import { POST_TEMPLATES } from "../lib/meta/text";
import { POST_PUBLISHERS } from "../lib/schedule/channels";
import { CHANNEL_LABEL, channelText, postContentHash } from "../lib/schedule/model";

// Även som story (2026-11-13, docs/beslut/reels-och-stories-plan.md part A): the post's picture also as a 9:16 story on the
// chosen Facebook page and/or Instagram account – drawn from the same templates, its text and logo inside the story's safe zone –
// with no new permission, no caption and no link; the tick is part of the scheduled post's approved content only when ticked.

const font = (name: string) => new Uint8Array(readFileSync(`public/fonts/${name}`));
const fonts = { regular: font("Manrope-Regular.ttf"), bold: font("Manrope-Bold.ttf"), fallback: font("DejaVuSans.ttf") };

test("the story picture: 1080 × 1920 JPEG in every template, with a logo, without one and on a photo", async () => {
  assert.deepEqual(formatSize("story"), { width: IMAGE_WIDTH, height: STORY_HEIGHT });
  assert.deepEqual(formatSize(), { width: IMAGE_WIDTH, height: IMAGE_HEIGHT });
  const logo = new Uint8Array(readFileSync("public/icons/workflow-512.png"));
  const photo = await sharp({ create: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, channels: 3, background: "#7A9E5B" } }).jpeg().toBuffer();
  await Promise.all(POST_TEMPLATES.flatMap((template) => ([["logo", logo, null], ["name", null, null], ["photo", logo, photo]] as const).map(async ([variant, brandLogo, background]) => {
    const bytes = await renderPostImage({ heading: "Egenkontroll på 5 minuter", body: "Fyll i protokollet på plats och få en PDF direkt.", template: template.key }, { primary: "#174C72", companyName: "Elfirma AB", logo: brandLogo }, fonts, background, "story");
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "jpeg", `${template.key} ${variant}`);
    assert.deepEqual([meta.width, meta.height], [IMAGE_WIDTH, STORY_HEIGHT], `${template.key} ${variant}`);
  })));
  // The post's own picture is unchanged by the story format.
  const feed = await sharp(await renderPostImage({ heading: "Rubrik", body: "", template: "color" }, { primary: "#174C72", companyName: "", logo: null }, fonts)).metadata();
  assert.deepEqual([feed.width, feed.height], [IMAGE_WIDTH, IMAGE_HEIGHT]);
});

test("the story's text and logo stay inside the safe zone, as readable as the post's, and the layout matches the post's moved down", () => {
  const texts = [
    { heading: "Egenkontroll på 5 minuter", body: "Fyll i protokollet på plats och få en PDF direkt." },
    { heading: "Så gör du egenkontrollen snabbt och rätt varje gång, även när kunden står bredvid", body: "Mätvärden, foton och underskrift hamnar på rätt ställe, och kunden får en färdig PDF i sin e-post innan du har packat ihop verktygen." },
    { heading: "Rubrik", body: "" },
  ];
  assert.ok(STORY_OFFSET >= STORY_SAFE, "the 4:5 content lies wholly between the covered bands");
  for (const template of POST_TEMPLATES) {
    for (const [index, text] of texts.entries()) {
      for (const primary of ["#174C72", "#F5B800", "#FFFFFF", "#000000"]) {
        for (const withName of [false, true]) {
          const where = `${template.key} text ${index} ${primary}${withName ? " name" : ""}`;
          const story = planPost({ ...text, template: template.key }, { primary, companyName: "Elfirma Exempel AB" }, fonts, { withName, format: "story" });
          const feed = planPost({ ...text, template: template.key }, { primary, companyName: "Elfirma Exempel AB" }, fonts, { withName });
          assert.equal(story.texts.length, feed.texts.length, where);
          assert.ok(story.logo.area.y >= STORY_SAFE && story.logo.area.y + story.logo.area.height <= STORY_HEIGHT - STORY_SAFE, `${where}: logo`);
          assert.equal(story.logo.area.y, feed.logo.area.y + STORY_OFFSET, where);
          for (const [at, block] of story.texts.entries()) {
            const { left, right } = blockEdges(block);
            assert.ok(left >= SAFE_SIDE - 0.5 && right <= IMAGE_WIDTH - SAFE_SIDE + 0.5, `${where} ${block.role}: ${left}–${right}`);
            assert.ok(block.top >= STORY_SAFE && block.bottom <= STORY_HEIGHT - STORY_SAFE, `${where} ${block.role}: ${block.top}–${block.bottom}`);
            assert.ok(contrast(block.fill, block.behind) >= 4.5, `${where} ${block.role}: contrast`);
            assert.equal(block.top, feed.texts[at].top + STORY_OFFSET, where);
            assert.deepEqual(block.lines, feed.texts[at].lines, where);
          }
          // The backgrounds fill the taller canvas; the decor is moved with the content.
          assert.match(story.background, new RegExp(`height="${STORY_HEIGHT}"|height="${STORY_HEIGHT - 112}"|y="${STORY_HEIGHT - 28}"|height="${STORY_HEIGHT - 720 - STORY_OFFSET}"`), `${where}: background`);
          if (story.decor) assert.ok(story.decor.startsWith(`<g transform="translate(0 ${STORY_OFFSET})">`), where);
        }
      }
    }
  }
});

test("Instagram's story container: media_type STORIES and no caption; Facebook's page story from an unpublished photo", async () => {
  const requests: GraphRequest[] = [];
  const transport: GraphTransport = async (request) => { requests.push(request); return { status: 200, body: request.path.endsWith("photo_stories") ? { success: true, post_id: "555_777" } : { id: "c9" } }; };
  const instagram = facebookLoginInstagram(transport);
  assert.equal(await instagram.createContainer({ id: "178", token: "t" }, { imageUrl: "https://app.example/api/meta/image/k", caption: "Text", story: true }), "c9");
  assert.deepEqual(requests[0].params, { image_url: "https://app.example/api/meta/image/k", media_type: "STORIES", access_token: "t" });
  await instagram.createContainer({ id: "178", token: "t" }, { imageUrl: "https://app.example/x", caption: "Text" });
  assert.deepEqual(requests[1].params, { image_url: "https://app.example/x", caption: "Text", access_token: "t" }, "a post is as before");

  assert.equal(await facebookPhotoStory(transport, { id: "555", token: "p" }, "777"), "555_777");
  assert.deepEqual([requests[2].method, requests[2].path, requests[2].params], ["POST", "555/photo_stories", { photo_id: "777", access_token: "p" }]);
  const refused: GraphTransport = async () => ({ status: 400, body: { error: { code: 100, message: "Invalid photo" } } });
  await assert.rejects(facebookPhotoStory(refused, { id: "555", token: "p" }, "777"), /godtog inte/);
  const empty: GraphTransport = async () => ({ status: 200, body: {} });
  await assert.rejects(facebookPhotoStory(empty, { id: "555", token: "p" }, "777"), /inget id/);
});

test("the schedule: the story is part of the approved content only when ticked, and its channels are named", () => {
  const post = { heading: "H", body: "B", caption: "C", link: null, template: "color", toFacebook: true, toInstagram: true, backgroundSource: null, background: null };
  const before = postContentHash(post);
  assert.equal(postContentHash({ ...post, toStory: false }), before, "posts scheduled before the tick keep their approval");
  assert.notEqual(postContentHash({ ...post, toStory: true }), before, "ticking it asks for a new approval");
  const meta = POST_PUBLISHERS.find((publisher) => publisher.key === "meta")!;
  assert.deepEqual(meta.channels({ ...post, toStory: false }), ["facebook", "instagram"]);
  assert.deepEqual(meta.channels({ ...post, toStory: true }), ["facebook", "instagram", "facebook_story", "instagram_story"]);
  assert.deepEqual(meta.channels({ ...post, toInstagram: false, toStory: true }), ["facebook", "facebook_story"]);
  assert.deepEqual(meta.channels({ ...post, toFacebook: false, toInstagram: false, toStory: true }), [], "no story without its channel");
  assert.equal(channelText(["facebook", "instagram_story"]), "Facebook, Story på Instagram");
  assert.equal(CHANNEL_LABEL.facebook_story, "Story på Facebook");
});

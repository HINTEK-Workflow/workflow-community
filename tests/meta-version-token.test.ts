import assert from "node:assert/strict";
import test from "node:test";
import { facebookCaption, instagramCaption, linkedInCommentary, postWithVersion, VERSION_TOKEN, withVersion } from "../lib/meta/text";
import { currentAppVersion } from "../lib/release-notes";

test("{version} is the given version, every time it stands, and a text without it is left as it is", () => {
  assert.equal(VERSION_TOKEN, "{version}");
  assert.equal(withVersion("Nytt i {version}: allt. Läs mer om {version}.", "1.2.3"), "Nytt i 1.2.3: allt. Läs mer om 1.2.3.");
  assert.equal(withVersion("Ingen version här", "1.2.3"), "Ingen version här");
  assert.equal(withVersion("{Version} och {versions}", "1.2.3"), "{Version} och {versions}", "only the exact token");
  assert.equal(withVersion("Version {version}"), `Version ${currentAppVersion()}`, "the running version by default");
});

test("the post's texts get the version; the other fields and a missing field stay", () => {
  const post = { id: "p1", heading: "Workflow {version}", body: "Text {version}", caption: "Nu {version}", instagramText: null, link: "https://example.invalid/{version}" };
  const out = postWithVersion(post, "0.68.0");
  assert.deepEqual(out, { id: "p1", heading: "Workflow 0.68.0", body: "Text 0.68.0", caption: "Nu 0.68.0", instagramText: null, link: "https://example.invalid/{version}" });
  assert.equal(post.caption, "Nu {version}", "the stored text keeps the token");
  assert.deepEqual(postWithVersion({ caption: "{version}" }, "1.0.0"), { caption: "1.0.0" });
});

test("every channel's text is current: Facebook, Instagram (with its own text) and LinkedIn", () => {
  const version = currentAppVersion();
  const post = { caption: "Version {version} är här.", link: "https://example.invalid/", hashtags: "#workflow", instagramText: "Bara här: {version}" };
  assert.equal(facebookCaption(post), `Version ${version} är här.\n\n#workflow\n\nhttps://example.invalid/`);
  assert.equal(instagramCaption(post), `Version ${version} är här.\n\nBara här: ${version}\n\n#workflow`);
  assert.ok(linkedInCommentary(post).startsWith(`Version ${version} är här.`));
  assert.ok(!facebookCaption(post).includes(VERSION_TOKEN));
});

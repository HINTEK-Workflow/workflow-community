import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MetaConnectSteps, META_DEVELOPERS_URL, SCOPE_LIST } from "../features/meta/meta-card";
import { REQUIRED_SCOPES } from "../lib/meta/graph";

// Så skapar du en egen Meta-app (2026-11-12): the guide in the Meta card's Mer. Meta has no field for the app's mode
// (neither the app's node nor debug_token), so the guide says it in words instead of an automatic check.

test("the guide names exactly the permissions Workflow asks Meta for", () => {
  assert.deepEqual(SCOPE_LIST.split(", "), [...REQUIRED_SCOPES]);
  const html = renderToStaticMarkup(h(MetaConnectSteps));
  for (const scope of REQUIRED_SCOPES) assert.ok(html.includes(scope), scope);
});

test("the guide goes all the way: Business app, basic settings, Live, token, Kontrollera and Testpublicering", () => {
  const html = renderToStaticMarkup(h(MetaConnectSteps));
  assert.match(html, /Så skapar du en egen Meta-app/);
  assert.equal(html.match(/<li>/g)?.length, 8);
  assert.match(html, /Företag \(Business\)[\s\S]*integritetspolicy[\s\S]*Live[\s\S]*utvecklingsläge syns inläggen bara för appens egna användare[\s\S]*Graph API Explorer[\s\S]*appens id[\s\S]*Kontrollera[\s\S]*Testpublicering/);
});

test("the only link is a plain one to Meta's developer site, in a new tab, and nothing of Meta's is loaded", () => {
  const html = renderToStaticMarkup(h(MetaConnectSteps));
  assert.equal(META_DEVELOPERS_URL, "https://developers.facebook.com/");
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(links, [META_DEVELOPERS_URL]);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<(img|script|iframe|link)\b/);
});

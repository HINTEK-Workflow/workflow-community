import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { EE_PRESENT } from "@ee/present";
import { publicInstance } from "../lib/instance";
import { INSTANCE_DEFAULTS } from "../lib/instance-defaults";
import { ICON_SIZES, IconError, builtInIconUrls, iconOfSize, normalizeIcon, ownIconUrls } from "../lib/instance-icon";

// Appikonen (2026-11-10, val D): Community has a neutral icon and its superadmin may upload the installation's own;
// Workflow's installation keeps Workflow's icons.

test("the built-in icons are the installation's defaults, and every one of them is a file", () => {
  const icons = builtInIconUrls();
  assert.deepEqual(Object.keys(icons).sort(), [...ICON_SIZES].sort());
  for (const url of Object.values(icons)) assert.ok(existsSync(`public${url.replace(/\?.*$/, "")}`), url);
  if (existsSync("community/instance-defaults.ts")) {
    assert.match(INSTANCE_DEFAULTS.icons["192"], /hintek-workflow-192\.png/, "Workflow's installation keeps Workflow's icon");
    const community = readFileSync("community/instance-defaults.ts", "utf8");
    assert.doesNotMatch(community, /hintek-workflow-/, "Community's defaults name no Workflow icon");
    for (const size of ["32", "192", "512", "maskable-512"]) assert.ok(existsSync(`public/icons/workflow-${size}.png`), size);
  }
});

test("only Community may have its own icon, unless Workflow's installation asks for it", () => {
  assert.equal(publicInstance({}).features.ownIcon, !EE_PRESENT);
  assert.equal(publicInstance({ INSTANCE_OWN_ICON: "true" }).features.ownIcon, true);
});

test("the page links the own icon by its version, so a new one is fetched at once", () => {
  const urls = ownIconUrls("abc123def456");
  assert.equal(urls["32"], "/api/instance-icon?size=32&v=abc123def456");
  assert.equal(urls.maskable, "/api/instance-icon?size=maskable&v=abc123def456");
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /instanceIconUrls\(features\.ownIcon\)/);
  assert.doesNotMatch(layout, /hintek-workflow-/, "no fixed Workflow icon in the layout");
  assert.doesNotMatch(readFileSync("app/manifest.webmanifest/route.ts", "utf8"), /hintek-workflow-/);
});

test("an upload is drawn again as a square PNG; every size is made from it; a broken or tiny picture is refused", async () => {
  const wide = await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } }).webp().toBuffer();
  const stored = await normalizeIcon(wide);
  const meta = await sharp(stored).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ["png", 512, 512, false]);
  for (const [size, pixels] of [["32", 32], ["192", 192], ["512", 512], ["maskable", 512]] as const) {
    const made = await sharp(await iconOfSize(stored, size)).metadata();
    assert.deepEqual([made.width, made.height], [pixels, pixels], size);
  }
  await assert.rejects(normalizeIcon(new TextEncoder().encode("<svg onload=alert(1)>")), IconError);
  await assert.rejects(normalizeIcon(await sharp({ create: { width: 20, height: 20, channels: 3, background: "#000" } }).png().toBuffer()), /för liten/);
});

test("the route: public sizes, the superadmin's upload and removal with Origin, only where it may", () => {
  const route = readFileSync("app/api/instance-icon/route.ts", "utf8");
  assert.match(route, /role !== "SUPERADMIN"/);
  assert.match(route, /features\.ownIcon/);
  for (const method of ["POST", "DELETE"]) assert.match(route.slice(route.indexOf(`export async function ${method}`)), /checkOrigin\(request\)/, method);
  assert.match(route, /ICON_MAX_BYTES/);
  assert.match(route, /ICON_TYPES/);
});

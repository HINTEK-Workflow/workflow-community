/* eslint-disable @typescript-eslint/no-require-imports -- QA helper (CommonJS): the click robot's shared settings. */
/*
 * Klickroboten (2026-10-24: "är testet gjort i webbplatskartan?"): the settings crawl.cjs, roles.cjs, back.cjs and
 * recheck.cjs share. The robot only READS: it opens pages, follows links, switches tabs and opens popups that only show;
 * it never presses anything that saves, deletes, sends, pays, signs out or switches company. It runs only against the QA
 * instances on loopback (synthetic QA identities, CLAUDE.md), never against production.
 *
 *   SITEMAP_CRAWL_OUT=<dir>   where the raw output goes (default .next/sitemap-crawl – never committed)
 *   QA_SUPERADMIN_URL, QA_ADMIN_URL, QA_MEMBER_URL   the three QA roles (default localhost:3004, 3001, 3002)
 */
"use strict";
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..", "..");
const OUT = path.resolve(process.env.SITEMAP_CRAWL_OUT || path.join(REPO, ".next", "sitemap-crawl"));
const SHOTS = path.join(OUT, "bilder");
const BASES = {
  superadmin: process.env.QA_SUPERADMIN_URL || "http://localhost:3004",
  admin: process.env.QA_ADMIN_URL || "http://localhost:3001",
  member: process.env.QA_MEMBER_URL || "http://localhost:3002",
};
for (const base of Object.values(BASES)) if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error(`Roboten körs bara mot QA på loopback, inte ${base}`);
const RUNS = ["superadmin-desktop", "superadmin-phone", "admin-desktop", "admin-phone", "member-desktop", "member-phone"];
const DEVICES = { desktop: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };

const { chromium } = require("playwright");
const axeSource = () => fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** Signs in as the QA role (the /qa page's test workspace) and declines the optional cookies. */
async function signIn(page, base) {
  await page.goto(`${base}/qa`);
  await page.waitForTimeout(800);
  const cookies = page.getByRole("button", { name: "Bara nödvändiga" });
  if (await cookies.count()) await cookies.first().click().catch(() => {});
  await page.getByRole("button", { name: /Öppna testarbetsytan/ }).click();
  await page.waitForURL(/\?view=/, { timeout: 30000 });
}

fs.mkdirSync(OUT, { recursive: true });
module.exports = { REPO, OUT, SHOTS, BASES, RUNS, DEVICES, chromium, axeSource, signIn };

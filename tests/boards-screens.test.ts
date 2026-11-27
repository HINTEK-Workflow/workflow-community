import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { boardViewerRequestRefused, LINK_COOKIE, SCREEN_COOKIE, SCREEN_PAIR_COOKIE } from "../lib/boards/guard";
import { hashLinkCode, linkCodeMatches, readLinkSession, signLinkSession } from "../lib/boards/link-session";
import { nextNightlyReload, nextRetryDelay, RETRY_MAX_MS } from "../lib/boards/player";
import {
  formatPairCode, linkAddress, linkRefusal, linkShowsNames, linkState, normalizePairCode, pairCodeFrom, PAIR_ALPHABET, PAIR_CODE_LENGTH, playlistItemsSchema, readScreenSettings, screenOnline, screenTooQuiet, secretFromHash, targetSchema,
} from "../lib/boards/screens";
import { BOARDS_TAB_LABEL, boardsTabsFor, LINKS_SENTENCE, SCREENS_SENTENCE } from "../lib/boards/tabs";
import { appReturnAddress } from "../lib/auth/session-return";

// ---------- the pairing code (RFC 8628's form) ----------

test("a pairing code is eight consonants, read leniently and shown in two groups", () => {
  assert.equal(PAIR_ALPHABET.length, 20);
  assert.doesNotMatch(PAIR_ALPHABET, /[AEIOUY0-9]/, "no vowels, so no words; no digits");
  const code = pairCodeFrom(Uint8Array.from([0, 1, 2, 19, 20, 39, 250, 239, 100]));
  assert.equal(code.length, PAIR_CODE_LENGTH);
  assert.equal(code, "BCDZBZZB", "bytes from 240 are skipped, so every letter is as likely");
  assert.equal(normalizePairCode(" bcdf-ghjk "), "BCDFGHJK");
  assert.equal(normalizePairCode("BCDF-GHJA"), null, "a vowel is no code");
  assert.equal(normalizePairCode("BCD"), null);
  assert.equal(formatPairCode("BCDFGHJK"), "BCDF-GHJK");
});

// ---------- the guard ----------

test("a screen's or a link's cookie alone never reaches /api", () => {
  for (const cookie of [SCREEN_COOKIE, SCREEN_PAIR_COOKIE, LINK_COOKIE, `__Secure-${SCREEN_COOKIE}`]) {
    assert.equal(boardViewerRequestRefused("/api/boards", [cookie]), true, cookie);
    assert.equal(boardViewerRequestRefused("/api/workspace", [cookie, "other"]), true, cookie);
  }
  assert.equal(boardViewerRequestRefused("/api/boards", [SCREEN_COOKIE, "__Secure-next-auth.session-token"]), false, "a signed-in person in the same browser");
  assert.equal(boardViewerRequestRefused("/skarm/api/feed", [SCREEN_COOKIE]), false, "its own routes");
  assert.equal(boardViewerRequestRefused("/api/boards", ["next-auth.session-token"]), false);
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /boardViewerRequestRefused\(request\.nextUrl\.pathname/);
});

test("the viewer routes read only their own cookies, set them with their own paths, and change nothing", () => {
  const routes = ["app/skarm/api/feed/route.ts", "app/skarm/api/image/route.ts", "app/skarm/api/poll/route.ts", "app/skarm/api/start/route.ts", "app/visa/api/feed/route.ts", "app/visa/api/image/route.ts", "app/visa/api/open/route.ts"];
  for (const file of routes) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /context\(\)|getCurrentAuth|next-auth/, `${file} never reads a person's session`);
    assert.doesNotMatch(source, /prisma\./, `${file} goes through lib/boards`);
    if (/export async function POST/.test(source)) assert.match(source, /checkOrigin\(request\)/, `${file} checks Origin`);
  }
  const http = readFileSync("lib/boards/viewer-http.ts", "utf8");
  assert.match(http, /httpOnly: true/);
  assert.match(http, /sameSite: "strict"/);
  for (const file of ["app/skarm/api/poll/route.ts", "app/skarm/api/start/route.ts"]) assert.match(readFileSync(file, "utf8"), /viewerCookie\(SCREEN_BASE_PATH/);
  for (const file of ["app/visa/api/open/route.ts", "app/visa/api/feed/route.ts"]) assert.match(readFileSync(file, "utf8"), /viewerCookie\(LINK_BASE_PATH/);
  // The screen's feed and the link's feed count as the publisher, never as anyone signed in.
  const viewer = readFileSync("lib/boards/viewer-server.ts", "utf8");
  assert.match(viewer, /publisherViewer\(organization, version\.publishedById\)/);
  assert.match(viewer, /outside: true/);
});

// ---------- links ----------

test("a link needs an end date when the board shows names, and shows names only with a code and an end date", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  assert.equal(linkRefusal({ expiresAt: null, personal: false, now }), null, "until further notice without names");
  assert.match(linkRefusal({ expiresAt: null, personal: true, now })!, /slutdatum/);
  assert.match(linkRefusal({ expiresAt: new Date("2026-11-01"), personal: false, now })!, /passerat/);
  assert.match(linkRefusal({ expiresAt: new Date("2028-01-01"), personal: false, now })!, /ett år/);
  assert.equal(linkShowsNames({ codeHash: "x", expiresAt: new Date() }), true);
  assert.equal(linkShowsNames({ codeHash: null, expiresAt: new Date() }), false);
  assert.equal(linkShowsNames({ codeHash: "x", expiresAt: null }), false);
  assert.equal(linkState({ revokedAt: null, expiresAt: null, lockedUntil: new Date(now.getTime() + 60_000) }, now), "locked");
  assert.equal(linkState({ revokedAt: now, expiresAt: null, lockedUntil: null }, now), "revoked");
  assert.equal(linkState({ revokedAt: null, expiresAt: new Date(now.getTime() - 1), lockedUntil: null }, now), "expired");
});

test("the secret travels only in the #-part, and is read back from it", () => {
  const secret = "a".repeat(43);
  const address = linkAddress("https://app.example.se/", secret);
  assert.equal(address, `https://app.example.se/visa#k=${secret}`);
  assert.equal(new URL(address).search, "", "nothing in the query a server would log");
  assert.equal(secretFromHash(new URL(address).hash), secret);
  assert.equal(secretFromHash("#k=short"), null);
  assert.equal(secretFromHash(""), null);
});

test("the link's session is signed, bound to its current secret and ends; the code is a salted hash", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const cookie = signLinkSession("installation-secret", "link-1", "hash-a", now + 3600_000);
  const read = readLinkSession(cookie, ["installation-secret"], now);
  assert.ok(read);
  assert.equal(read.accessId, "link-1");
  assert.equal(read.macOf("hash-a"), true);
  assert.equal(read.macOf("hash-b"), false, "a renewed link ends the old session");
  assert.equal(readLinkSession(cookie, ["another-secret"], now)?.macOf("hash-a"), false);
  assert.equal(readLinkSession(cookie, ["new-secret", "installation-secret"], now)?.macOf("hash-a"), true, "a rotated key still opens until the old one is gone");
  assert.equal(readLinkSession(cookie, ["installation-secret"], now + 2 * 3600_000), null, "ended");
  assert.equal(readLinkSession(cookie.replace("link-1", "link-2"), ["installation-secret"], now)?.macOf("hash-a"), false, "another link's id");
  assert.equal(readLinkSession("garbage", ["installation-secret"], now), null);
  const stored = hashLinkCode("123456");
  assert.doesNotMatch(stored, /123456/);
  assert.equal(linkCodeMatches("123456", stored), true);
  assert.equal(linkCodeMatches("123457", stored), false);
  assert.notEqual(hashLinkCode("123456"), stored, "salted");
});

// ---------- screens ----------

test("a screen's settings: dark by default, disconnected after 30 days without contact, online for three minutes", () => {
  assert.deepEqual(readScreenSettings({}), { theme: "dark", reloadHour: 3, burnIn: false, distance: null, inches: null }, "Avstånd follows the board and Skärmstorlek the distance by default");
  assert.equal(readScreenSettings({ distance: "far" }).distance, "far", "a fixed screen may choose its own Avstånd");
  assert.equal(readScreenSettings({ inches: 86 }).inches, 86, "and its own size");
  assert.deepEqual(readScreenSettings({ theme: "pink" }), { theme: "dark", reloadHour: 3, burnIn: false, distance: null, inches: null }, "an unreadable row is the default");
  const now = new Date("2026-11-18T12:00:00Z");
  assert.equal(screenTooQuiet(new Date("2026-10-18T11:00:00Z"), new Date("2026-01-01"), now), true);
  assert.equal(screenTooQuiet(new Date("2026-11-01T11:00:00Z"), new Date("2026-01-01"), now), false);
  assert.equal(screenTooQuiet(null, new Date("2026-11-17"), now), false, "a new screen counts from its approval");
  assert.equal(screenOnline(new Date(now.getTime() - 60_000), now.getTime()), true);
  assert.equal(screenOnline(new Date(now.getTime() - 10 * 60_000), now.getTime()), false);
  assert.equal(screenOnline(null, now.getTime()), false);
});

test("a screen or a link shows one board or one playlist, and a playlist has 1–10 boards of 5 s to an hour", () => {
  assert.ok(targetSchema.safeParse({ boardId: "b" }).success);
  assert.ok(targetSchema.safeParse({ playlistId: "p" }).success);
  assert.equal(targetSchema.safeParse({}).success, false);
  assert.ok(playlistItemsSchema.safeParse([{ boardId: "b", seconds: 30 }]).success);
  assert.equal(playlistItemsSchema.safeParse([]).success, false);
  assert.equal(playlistItemsSchema.safeParse([{ boardId: "b", seconds: 2 }]).success, false);
  assert.equal(playlistItemsSchema.safeParse(Array.from({ length: 11 }, () => ({ boardId: "b", seconds: 30 }))).success, false);
});

test("the player tries again 2, 4, 8 … seconds, at most a minute, and reloads once a night", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map(nextRetryDelay), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.equal(nextRetryDelay(0), 2000);
  assert.ok(nextRetryDelay(100) <= RETRY_MAX_MS);
  const evening = new Date(2026, 10, 18, 22, 0, 0);
  assert.equal(new Date(nextNightlyReload(evening, 3)).getDate(), 19);
  assert.equal(new Date(nextNightlyReload(evening, 3)).getHours(), 3);
  assert.equal(new Date(nextNightlyReload(new Date(2026, 10, 18, 1, 0, 0), 3)).getDate(), 18);
});

test("the tabs follow the rights: Skärmar with the right Skärmar, Länkar with the right to publish", () => {
  assert.deepEqual(boardsTabsFor({ read: true, screens: false, publish: false }), ["boards", "tables"]);
  assert.deepEqual(boardsTabsFor({ read: true, screens: true, publish: true }), ["boards", "tables", "screens", "links"]);
  assert.deepEqual(boardsTabsFor({ read: false, screens: true, publish: false }), ["screens"]);
});

test("Fasta skärmar and Delade länkar are named so, each with its own sentence (2026-11-19)", () => {
  assert.equal(BOARDS_TAB_LABEL.screens, "Fasta skärmar");
  assert.equal(BOARDS_TAB_LABEL.links, "Delade länkar");
  assert.match(SCREENS_SENTENCE, /era egna skärmar, godkända en i taget med en kod/);
  assert.match(LINKS_SENTENCE, /personer som ska kunna titta; alla som har länken ser tavlan/);
});

test("a screen's QR address survives the sign-in with its whole query (2026-11-20)", () => {
  assert.equal(appReturnAddress("boards", { view: "boards", tab: "screens", koppla: "BDFG-HJKL" }), "/?view=boards&tab=screens&koppla=BDFG-HJKL");
  assert.equal(appReturnAddress("stats", { view: "okänd", tab: ["screens", "links"], empty: undefined }), "/?view=stats&tab=screens", "the resolved view, the first of a repeated key, nothing empty");
  assert.equal(appReturnAddress("boards", { koppla: "A&B=C" }), "/?view=boards&koppla=A%26B%3DC", "values are encoded");
});

import assert from "node:assert/strict";
import test from "node:test";
import { defaultDetailLevels, deviceClass, displayLevelsFor, type DetailLevel, type DetailLevels, type DeviceClass } from "../lib/workflow/detail-level";
import { appColumnFor, nativeModeFor } from "../lib/workflow/native-mode";
import { firstFrameAttributes, firstFrameFor, guessDevice, inAppFrame, NO_FIRST_FRAME, shellRouteOf } from "../lib/workflow/first-frame";

// Telefonens första bild (stabil sidladdning steg 4, 2026-10-22): the server writes the shell's layout attributes on
// <html>, so a phone never shows the computer's frame first. The server's answer must be the shell's own (apply()).
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPAD_CHROME = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

test("a phone is known from the User-Agent or the mobile hint, standing or on its side", () => {
  assert.deepEqual(guessDevice({ userAgent: IPHONE }), { device: "phone", sure: true });
  assert.deepEqual(guessDevice({ userAgent: ANDROID_PHONE }), { device: "phone", sure: true });
  assert.deepEqual(guessDevice({ userAgent: WINDOWS, mobile: "?1" }), { device: "phone", sure: true });
  // On its side the width alone would say tablet; only with the height is the class computed as on the client.
  assert.deepEqual(guessDevice({ userAgent: ANDROID_PHONE, mobile: "?1", viewportWidth: "915" }), { device: "phone", sure: true });
  assert.deepEqual(guessDevice({ userAgent: ANDROID_PHONE, mobile: "?1", viewportWidth: "915", viewportHeight: "412" }), { device: "phone", sure: true });
});

test("with the viewport's size the class is the client's deviceClass", () => {
  for (const [ua, width, height, touch] of [[WINDOWS, 1440, 900, false], [WINDOWS, 700, 900, false], [ANDROID_TABLET, 800, 1280, true], [ANDROID_TABLET, 1280, 800, true], [ANDROID_TABLET, 1600, 1000, true]] as const) {
    assert.deepEqual(guessDevice({ userAgent: ua, mobile: "?0", viewportWidth: String(width), viewportHeight: String(height) }), { device: deviceClass(width, touch, height), sure: true }, `${ua} ${width}×${height}`);
  }
  // A computer's User-Agent with a window under 600 px high may be a phone on its side asking for the desktop site: unsure,
  // as is a wide window without its height.
  assert.deepEqual(guessDevice({ userAgent: WINDOWS, mobile: "?0", viewportWidth: "900", viewportHeight: "500" }), { device: "desktop", sure: false });
  assert.deepEqual(guessDevice({ userAgent: WINDOWS, mobile: "?0", viewportWidth: "1440" }), { device: "desktop", sure: false });
  assert.deepEqual(guessDevice({ userAgent: WINDOWS, mobile: "?0", viewportWidth: "700" }), { device: "phone", sure: true });
  // A size that is not a number is not used.
  assert.deepEqual(guessDevice({ userAgent: WINDOWS, viewportWidth: "abc" }), { device: "desktop", sure: false });
});

test("without the size a computer or a tablet is only a guess (narrow window, iPad's Safari says Macintosh)", () => {
  assert.deepEqual(guessDevice({ userAgent: WINDOWS, mobile: "?0" }), { device: "desktop", sure: false });
  assert.deepEqual(guessDevice({ userAgent: MAC }), { device: "desktop", sure: false });
  assert.deepEqual(guessDevice({ userAgent: ANDROID_TABLET, mobile: "?0" }), { device: "tablet", sure: false });
  assert.deepEqual(guessDevice({ userAgent: IPAD_CHROME }), { device: "tablet", sure: false });
  assert.deepEqual(guessDevice({}), { device: "desktop", sure: false });
});

const SAMPLES: Record<DeviceClass, { width: number; height: number; touch: boolean; hints: { userAgent: string; mobile: string; viewportWidth: string; viewportHeight: string } }> = {
  phone: { width: 390, height: 844, touch: true, hints: { userAgent: IPHONE, mobile: "?1", viewportWidth: "390", viewportHeight: "844" } },
  tablet: { width: 820, height: 1180, touch: true, hints: { userAgent: ANDROID_TABLET, mobile: "?0", viewportWidth: "820", viewportHeight: "1180" } },
  desktop: { width: 1440, height: 900, touch: false, hints: { userAgent: WINDOWS, mobile: "?0", viewportWidth: "1440", viewportHeight: "900" } },
};

test("a known device gets exactly what the shell's apply() decides (displayLevelsFor, nativeModeFor, appColumnFor)", () => {
  const levels: DetailLevel[] = [1, 2, 3];
  for (const device of ["phone", "tablet", "desktop"] as const) {
    const { width, height, touch, hints } = SAMPLES[device];
    for (const phone of levels) for (const tablet of levels) for (const desktop of levels) {
      const saved: DetailLevels = { phone, tablet, desktop };
      const isPhone = deviceClass(width, touch, height) === "phone";
      const { layout, content } = displayLevelsFor(saved, width, touch, height, { signedIn: true, showMore: false });
      const frame = firstFrameFor({ hints, levels: saved, signedIn: true });
      assert.deepEqual(frame, {
        device, windowDevice: device, detail: content, auto: false,
        native: nativeModeFor(layout, width, isPhone),
        column: appColumnFor(layout, width, isPhone),
      }, `${device} ${JSON.stringify(saved)}`);
    }
  }
});

test("a signed-in phone is always the app; Visa allt only raises the content", () => {
  assert.deepEqual(firstFrameAttributes(firstFrameFor({ hints: { userAgent: IPHONE }, levels: defaultDetailLevels, signedIn: true })), { "data-device": "phone", "data-detail": "1", "data-native": "1" });
  assert.deepEqual(firstFrameAttributes(firstFrameFor({ hints: { userAgent: IPHONE }, levels: { ...defaultDetailLevels, phone: 3 }, signedIn: true })), { "data-device": "phone", "data-detail": "3", "data-native": "1" });
  // A saved Lagom from before A2 reads as Visa allt, as on the client.
  assert.equal(firstFrameFor({ hints: { userAgent: ANDROID_PHONE }, levels: { phone: 2 }, signedIn: true }).detail, 3);
  // Nothing saved: the defaults.
  assert.equal(firstFrameFor({ hints: { userAgent: IPHONE }, levels: null, signedIn: true }).native, true);
});

test("level 1 on a known tablet or computer is the app column; the ordinary pages otherwise", () => {
  assert.deepEqual(firstFrameAttributes(firstFrameFor({ hints: SAMPLES.desktop.hints, levels: { ...defaultDetailLevels, desktop: 1 }, signedIn: true })), { "data-device": "desktop", "data-detail": "1", "data-column": "1" });
  assert.deepEqual(firstFrameAttributes(firstFrameFor({ hints: SAMPLES.tablet.hints, levels: defaultDetailLevels, signedIn: true })), { "data-device": "tablet", "data-detail": "2" });
  assert.deepEqual(firstFrameAttributes(firstFrameFor({ hints: SAMPLES.desktop.hints, levels: defaultDetailLevels, signedIn: true })), { "data-device": "desktop", "data-detail": "3" });
});

test("inside the app column's frame always the app, as apply() forces there", () => {
  const hints = { ...SAMPLES.desktop.hints, fetchDest: "iframe", fetchSite: "same-origin" };
  assert.equal(inAppFrame(hints), true);
  assert.deepEqual(firstFrameFor({ hints, levels: { ...defaultDetailLevels, desktop: 1 }, signedIn: true }), { device: "desktop", windowDevice: "phone", native: true, detail: 1, column: false, auto: false });
  // Another site's frame, or a page that is not a frame, is not the column.
  assert.equal(inAppFrame({ fetchDest: "iframe", fetchSite: "cross-site" }), false);
  assert.equal(inAppFrame({ fetchDest: "document", fetchSite: "same-origin" }), false);
});

test("an unsure device leaves the attributes to the shell and lets the style sheet hide the computer's frame", () => {
  assert.deepEqual(firstFrameAttributes(firstFrameFor({ hints: { userAgent: MAC }, levels: defaultDetailLevels, signedIn: true })), { "data-shell": "auto" });
  assert.deepEqual(firstFrameAttributes(firstFrameFor({ hints: { userAgent: WINDOWS, mobile: "?0" }, levels: defaultDetailLevels, signedIn: true })), { "data-shell": "auto" });
});

test("signed out (login, landing page) nothing is set, so those pages are drawn as before", () => {
  assert.deepEqual(firstFrameFor({ hints: { userAgent: IPHONE }, levels: defaultDetailLevels, signedIn: false }), NO_FIRST_FRAME);
  assert.deepEqual(firstFrameAttributes(NO_FIRST_FRAME), {});
  // The shell's own rule for a signed-out phone stays content level 2 (it is the shell, not the server, that sets it).
  assert.deepEqual(displayLevelsFor(defaultDetailLevels, 390, true, 844, { signedIn: false }), { layout: 2, content: 2 });
});

test("only the app's page and the demo get a first frame", () => {
  assert.equal(shellRouteOf("/", false), "app");
  assert.equal(shellRouteOf("/?view=stats", false), "app");
  assert.equal(shellRouteOf("/?view=tasks&taskId=1", true), "demo");
  // The landing page (a signed-in preview, or a visitor without a view) and every other route: nothing.
  assert.equal(shellRouteOf("/?landing=1", false), null);
  assert.equal(shellRouteOf("/?view=stats&landing=1", false), "app");
  for (const address of ["/login", "/login?returnTo=%2F", "/legal/privacy", "/m/abc", "/form-preview", "/api/workspace", "", null, undefined, "//evil.example/", "https://evil.example/"]) {
    assert.equal(shellRouteOf(address, false), null, String(address));
  }
});

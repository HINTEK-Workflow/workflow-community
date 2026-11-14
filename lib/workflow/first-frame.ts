import { defaultDetailLevels, deviceClass, displayLevelsFor, type DetailLevel, type DetailLevels, type DeviceClass } from "./detail-level";
import { appColumnFor, nativeModeFor } from "./native-mode";

/**
 * Telefonens första bild (stabil sidladdning steg 4, 2026-10-22): the right layout – the app on a phone, the app
 * column, the ordinary pages – already in the server's HTML, so a phone never shows the computer's top bar and bottom
 * row before the app's tab bar. The server guesses the device from what the request says (the browser's client hints,
 * the User-Agent as fallback) and sets the same `<html>` attributes the shell sets (data-device, data-detail,
 * data-native, data-column); the shell's apply() only corrects a wrong guess. Where the server cannot know (a desktop
 * browser without hints may be a narrow window, Safari on an iPad says Macintosh), it sets `data-shell="auto"` and the
 * style sheet hides the computer's frame on a window the shell would make a phone (app/globals.css), until apply() has
 * decided. No script runs before the page: nothing here needs a CSP exception. Display only, never a permission.
 * Pure, so the layout, the shell's hooks and the tests read the same.
 */

/** What a request says about the device (request headers, all optional). */
export type DeviceHints = {
  userAgent?: string | null;
  /** Sec-CH-UA-Mobile: "?1" on a phone in a Chromium browser, "?0" elsewhere. */
  mobile?: string | null;
  /** Sec-CH-Viewport-Width / -Height (sent once the app has asked for them with Accept-CH). */
  viewportWidth?: string | null;
  viewportHeight?: string | null;
  /** Sec-Fetch-Dest and Sec-Fetch-Site: an iframe of the app itself is the app column's frame. */
  fetchDest?: string | null;
  fetchSite?: string | null;
};

/** The server's guess: the device class, and whether it is sure (else the style sheet decides the frame). */
export type DeviceGuess = { device: DeviceClass; sure: boolean };

const size = (value: string | null | undefined) => {
  const number = Number(value?.trim());
  return Number.isFinite(number) && number > 0 && number < 100_000 ? Math.round(number) : null;
};

/**
 * The device class the shell's deviceClass would give, from the request. A phone is sure from the hint or the UA (an
 * iPhone, an Android phone); with the viewport's size the class is computed as on the client. Without it a computer or a
 * tablet is only a guess: its window may be narrow, and an iPad's Safari says Macintosh.
 */
export function guessDevice(hints: DeviceHints): DeviceGuess {
  const ua = hints.userAgent ?? "";
  const iphone = /\b(iPhone|iPod)\b/.test(ua);
  const android = /\bAndroid\b/.test(ua);
  const ipad = /\biPad\b/.test(ua);
  const mobile = hints.mobile?.trim() === "?1" || iphone || (android && /\bMobile\b/.test(ua));
  const touch = mobile || android || ipad;
  const width = size(hints.viewportWidth);
  const height = size(hints.viewportHeight);
  // A phone on its side is wider than 768 px; without its height only the hint says it is still a phone.
  if (mobile) return { device: width && height ? deviceClass(width, true, height) : "phone", sure: true };
  if (width && touch) return { device: deviceClass(width, true, height ?? width), sure: true };
  // A computer's User-Agent says nothing about touch, and a touch screen under 600 px high is a phone (a phone on its side
  // asking for the desktop site): sure only where touch would not make it one.
  if (width) return { device: deviceClass(width, false, height ?? width), sure: width < 768 || (height !== null && height >= 600) };
  return { device: touch ? "tablet" : "desktop", sure: false };
}

/** Whether the request is a page of the app drawn in a frame of the app itself: the app column (components/native/app-column.tsx). */
export const inAppFrame = (hints: DeviceHints) => hints.fetchDest?.trim() === "iframe" && hints.fetchSite?.trim() === "same-origin";

/** What the first frame is drawn as; the same values the shell's hooks start from (features/workflow/use-detail-level.ts). */
export type FirstFrame = {
  /** data-device: the device the person sits at (null: not known, not set). */
  device: DeviceClass | null;
  /** The class of this window itself (the app column's frame is phone-wide); null when not known. */
  windowDevice: DeviceClass | null;
  /** data-native: the app look. */
  native: boolean;
  /** data-detail: the content level (null: not set, which reads as 3). */
  detail: DetailLevel | null;
  /** data-column: the app column instead of the page (a tablet or a computer at level 1). */
  column: boolean;
  /** data-shell="auto": not sure; the style sheet hides the computer's frame where the shell would draw the app. */
  auto: boolean;
};

/** Nothing known (signed out, another page than the app): no attribute, as before. */
export const NO_FIRST_FRAME: FirstFrame = { device: null, windowDevice: null, native: false, detail: null, column: false, auto: false };

/** A window of each class, for the shared rules that read a width (deviceClass gives back the same class). */
const SAMPLE: Record<DeviceClass, { width: number; height: number; touch: boolean }> = {
  phone: { width: 390, height: 844, touch: true },
  tablet: { width: 820, height: 1180, touch: true },
  desktop: { width: 1440, height: 900, touch: false },
};

/**
 * The first frame of the signed-in app: the same rules as the shell's apply() (displayLevelsFor, nativeModeFor,
 * appColumnFor) for the device guessed. In the app column's frame always the app, as apply() forces there. Visa mer
 * (remembered on the device) is not known to the server: the page starts without it and apply() raises the content.
 */
export function firstFrameFor({ hints, levels, signedIn }: { hints: DeviceHints; levels: Partial<DetailLevels> | null | undefined; signedIn: boolean }): FirstFrame {
  if (!signedIn) return NO_FIRST_FRAME;
  const guess = guessDevice(hints);
  // The frame stands for a tablet or a computer; data-device only matters as "phone", which the frame never is.
  if (inAppFrame(hints)) return { device: guess.device === "phone" ? "tablet" : guess.device, windowDevice: "phone", native: true, detail: 1, column: false, auto: false };
  if (!guess.sure) return { ...NO_FIRST_FRAME, auto: true };
  const { width, height, touch } = SAMPLE[guess.device];
  const phone = guess.device === "phone";
  const { layout, content } = displayLevelsFor(levels ?? defaultDetailLevels, width, touch, height, { signedIn: true });
  return {
    device: guess.device,
    windowDevice: guess.device,
    native: nativeModeFor(layout, width, phone),
    detail: content,
    column: appColumnFor(layout, width, phone),
    auto: false,
  };
}

/** The `<html>` attributes of a first frame, as the shell writes them (absent = not set). */
export function firstFrameAttributes(frame: FirstFrame): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (frame.device) attributes["data-device"] = frame.device;
  if (frame.detail) attributes["data-detail"] = String(frame.detail);
  if (frame.native) attributes["data-native"] = "1";
  if (frame.column) attributes["data-column"] = "1";
  if (frame.auto) attributes["data-shell"] = "auto";
  return attributes;
}

/**
 * Which pages draw the app shell, from the address (the root layout does not know its route; proxy.ts passes it on):
 * `/` with a view (or none) – not the public landing page (`?landing=1` without a view) – and the demo (its cookie and a
 * view; a made-up person with the default levels). Everything else (login, legal pages, mailings) gets no attribute.
 */
export function shellRouteOf(address: string | null | undefined, demoCookie: boolean): "app" | "demo" | null {
  if (!address || !address.startsWith("/") || address.startsWith("//")) return null;
  let url: URL;
  try { url = new URL(address, "http://local"); } catch { return null; }
  if (url.pathname !== "/") return null;
  const view = url.searchParams.get("view");
  if (view && demoCookie) return "demo";
  if (!view && url.searchParams.get("landing") === "1") return null;
  return "app";
}

/** The request header proxy.ts sets with the address (path and query), always overwriting what the browser sent. */
export const ADDRESS_HEADER = "x-hintek-address";

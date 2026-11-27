import assert from "node:assert/strict";
import test from "node:test";
import { ASTRA_LIKE_CSS } from "./fake-wordpress";
import { cleanFamily, facesToCopy, fontFaceCss, isWebFont, parseCss, readSiteLook, siteLookCss, withFallback } from "../lib/website/site-look";
import { previewDocument } from "../lib/website/frame";
import { isExternalImage } from "../features/website/website-canvas";

// Sajtens utseende (2026-11-10): the editor shows the page in the site's own type – read from the theme's css (Astra's inline
// css, a block theme's global styles) – and the frames use the copied fonts instead of a fixed Arial.

const FONT_CSS = "@font-face{font-family:'Karla';font-weight:400;src:url(/f/karla-latin.woff2) format('woff2');unicode-range:U+0000-00FF}"
  + "@font-face{font-family:'Karla';font-weight:400;src:url(/f/karla-vi.woff2) format('woff2');unicode-range:U+0102-0103,U+1EA0-1EF9}"
  + "@font-face{font-family:'Rubik';font-weight:600;src:url(https://fonts.gstatic.com/s/rubik/v1/r.woff2) format('woff2'),url(/r.woff) format('woff')}"
  + "@font-face{font-family:'Unused';src:url(/u.woff2) format('woff2')}";

test("Astra's css: Karla for the text, Rubik 600 for the headings with their sizes, smaller under 921 px", () => {
  const { styles, faces } = readSiteLook([{ css: FONT_CSS, url: "https://example.se/fonts.css" }, { css: ASTRA_LIKE_CSS, url: "https://example.se/" }]);
  assert.equal(styles.body.family, "\"Karla\", sans-serif");
  assert.equal(styles.body.weight, "400");
  assert.equal(styles.body.size, "1.0625rem", "the later declaration wins, as in the browser");
  assert.equal(styles.body.color, "#3a3a3a");
  assert.deepEqual([styles.headings[1]?.family, styles.headings[1]?.weight, styles.headings[1]?.size], ["\"Rubik\", sans-serif", "600", "48px"]);
  assert.deepEqual([2, 3, 4, 5, 6].map((level) => styles.headings[level as 2]?.size), ["38px", "30px", "24px", "21px", "17px"]);
  assert.deepEqual(styles.small.headings, { 1: "40px", 2: "32px", 3: "26px", 4: "20px" });
  assert.equal(styles.link.color, "#0274be");
  assert.equal(styles.button.background, "#113351");
  const copied = facesToCopy(faces, styles);
  assert.deepEqual(copied.map((face) => [face.family, face.weight, face.url]), [
    ["Karla", "400", "https://example.se/f/karla-latin.woff2"],
    ["Rubik", "600", "https://fonts.gstatic.com/s/rubik/v1/r.woff2"],
  ], "only the families in use, latin only, woff2 first, resolved against the stylesheet");
});

test("a block theme's global styles: the presets as custom properties", () => {
  const css = ":root{--wp--preset--font-family--body:\"Inter\", sans-serif;--wp--preset--font-family--heading:Lora, serif;--wp--preset--font-size--x-large:clamp(1.75rem, 1.75rem + ((1vw - 0.2rem) * 0.682), 2.25rem)}"
    + "body{font-family:var(--wp--preset--font-family--body);line-height:1.6}h1,h2,h3,h4,h5,h6{font-family:var(--wp--preset--font-family--heading)}h1{font-size:var(--wp--preset--font-size--x-large)}";
  const { styles } = readSiteLook([{ css, url: "https://example.se/" }]);
  assert.equal(styles.body.family, "\"Inter\", sans-serif");
  assert.equal(styles.body.lineHeight, "1.6");
  assert.equal(styles.headings[2]?.family, "\"Lora\", serif");
  assert.match(styles.headings[1]?.size ?? "", /^clamp\(/);
  assert.match(withFallback(styles.headings[2]?.family), /Georgia, serif$/);
});

test("nothing but checked values is kept: no way out of the stylesheet", () => {
  const hostile = "h1{font-family:\"A\";font-size:calc(100px);color:url(javascript:alert(1));font-weight:900;line-height:1}"
    + "body{font-family:x}</style><script>alert(1)</script>;color:red;expression(1)}";
  const { styles } = readSiteLook([{ css: hostile, url: "https://example.se/" }]);
  assert.equal(styles.body.family, "\"x\"");
  assert.equal(styles.body.color, undefined);
  assert.equal(styles.headings[1]?.size, undefined);
  assert.equal(styles.headings[1]?.color, undefined);
  assert.equal(styles.headings[1]?.weight, "900");
  assert.equal(cleanFamily("a;}b"), undefined);
  assert.equal(cleanFamily("'Open Sans', Arial, sans-serif"), "\"Open Sans\", \"Arial\", sans-serif");
  assert.equal(parseCss("@media print{h1{color:red}}@import url(x.css);h2{color:blue}").length, 2);
  const css = siteLookCss(styles, "[data-site-look]");
  assert.ok(!/<|script|javascript/i.test(css));
  assert.match(css, /^\[data-site-look\]\[data-site-look\]\{font-family:"x", Arial, Helvetica, sans-serif/);
});

test("the copied fonts as @font-face with data: addresses; a font file is recognised by its first bytes", () => {
  const css = fontFaceCss([{ family: "Karla", weight: "400", style: "normal", format: "woff2", unicodeRange: "U+0000-00FF", data: "d09GMgABAAA=" }, { family: "x\"}", weight: "400", style: "normal", format: "woff2", data: "AA==" }]);
  assert.equal(css, "@font-face{font-family:\"Karla\";font-weight:400;font-style:normal;font-display:swap;src:url(data:font/woff2;base64,d09GMgABAAA=) format(\"woff2\");unicode-range:U+0000-00FF}");
  assert.equal(isWebFont(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(isWebFont(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
});

test("the frame: the site's fonts and body font first, the theme's own css after it (no fixed Arial over the theme)", () => {
  const html = previewDocument({ html: "<p>x</p>", token: "t".repeat(20), origin: "https://example.se", styles: { stylesheets: ["https://example.se/style.css"], inline: "h1{color:red}", fontCss: "@font-face{font-family:\"Karla\"}", baseFont: "\"Karla\", Arial, Helvetica, sans-serif" } });
  const base = html.indexOf("body{font-family:\"Karla\"");
  assert.ok(base > 0 && base < html.indexOf("https://example.se/style.css") && base < html.indexOf("h1{color:red}"));
  assert.ok(html.indexOf("@font-face{font-family:\"Karla\"}") < base);
  const plain = previewDocument({ html: "", token: "t".repeat(20), origin: null, styles: { stylesheets: [], inline: "", baseFont: "x;}</style><script>" } });
  assert.match(plain, /body\{font-family:Arial,Helvetica,sans-serif/, "an unsafe value falls back");
});

test("a picture on another site than the connected one", () => {
  assert.equal(isExternalImage("https://app.workflow.example/landing/a.webp", "https://www.example.se"), true);
  assert.equal(isExternalImage("https://www.example.se/wp-content/uploads/a.png", "https://www.example.se"), false);
  assert.equal(isExternalImage("http://www.example.se/a.png", "https://www.example.se"), true, "another scheme is another place");
  assert.equal(isExternalImage("", "https://www.example.se"), false);
  assert.equal(isExternalImage("https://x.se/a.png", null), false);
});

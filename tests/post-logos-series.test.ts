import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { blockEdges, contrast, IMAGE_HEIGHT, IMAGE_WIDTH, LOGO_BOX, pickLogo, planPost, renderPostImage, SAFE_SIDE, STORY_HEIGHT } from "../lib/meta/image";
import { isLogoPlate, isLogoSize, isLogoVariant, LOGO_PLATES, LOGO_SIZES, LOGO_VARIANTS, POST_TEMPLATES } from "../lib/meta/text";
import { LOGO_VARIANT_FILES, logoVariantById, logoVariantByKey } from "../lib/kfid/logo-variants";
import { postContentHash } from "../lib/schedule/model";
import { SERIES_PARTS_DEFAULT, SERIES_PARTS_MAX, SERIES_PARTS_MIN, seriesClashes, seriesCount, seriesProblem, seriesTimes, type SeriesPart } from "../lib/schedule/post-series";
import { DEFAULT_RHYTHM } from "../lib/schedule/rhythm";
import { fromSwedishDateTimeInput, swedishDayKey, toSwedishDateTimeInput } from "../lib/swedish-time";

// Fler mallar, loggans varianter och Ny serie (2026-11-13).
const font = (name: string) => new Uint8Array(readFileSync(`public/fonts/${name}`));
const fonts = { regular: font("Manrope-Regular.ttf"), bold: font("Manrope-Bold.ttf"), fallback: font("DejaVuSans.ttf") };
const text = { heading: "Egenkontroll på 5 minuter", body: "Fyll i protokollet på plats och få en PDF direkt." };

test("the new backgrounds: Vit, Blå and Svart exist, are fixed whatever the company's colour, and read at 4.5:1", () => {
  for (const key of ["white", "blue", "black"]) assert.ok(POST_TEMPLATES.some((template) => template.key === key), key);
  const behind = { white: "#FFFFFF", blue: "#1E3A8A", black: "#000000" } as const;
  for (const [key, colour] of Object.entries(behind)) {
    for (const primary of ["#174C72", "#F5B800", "#FFFFFF", "#000000", "#E11D48"]) {
      const plan = planPost({ ...text, template: key }, { primary, companyName: "Elfirma AB" }, fonts, { withName: true });
      assert.equal(plan.logo.behind, colour, `${key} ${primary}`);
      assert.ok(plan.background.includes(`fill="${colour}"`), `${key}: the background is its own colour`);
      for (const block of plan.texts) assert.ok(contrast(block.fill, block.behind) >= 4.5, `${key} ${primary} ${block.role}: ${contrast(block.fill, block.behind).toFixed(2)}`);
    }
  }
});

test("Automatiskt picks the variant made for the background, else the logo; a missing chosen variant falls back", () => {
  const all = { main: true, onDark: true, onLight: true, black: true };
  assert.deepEqual(pickLogo("#000000", all, "auto", "#FFFFFF"), { variant: "onDark", plate: null });
  assert.deepEqual(pickLogo("#1E3A8A", all, undefined, "#FFFFFF"), { variant: "onDark", plate: null });
  assert.deepEqual(pickLogo("#FFFFFF", all, "auto", null), { variant: "onLight", plate: null });
  assert.deepEqual(pickLogo("#FFFFFF", { ...all, onLight: false }, "auto", null), { variant: "black", plate: null });
  // Without variants the logo itself, on the template's own plate (white on a dark background).
  assert.deepEqual(pickLogo("#000000", { main: true, onDark: false, onLight: false, black: false }, "auto", "#FFFFFF"), { variant: "main", plate: "#FFFFFF" });
  assert.deepEqual(pickLogo("#FFFFFF", { main: true, onDark: false, onLight: false, black: false }, "auto", null), { variant: "main", plate: null });
  // Chosen by hand: kept when it exists, with a plate it reads on when it is on the other kind of background.
  assert.deepEqual(pickLogo("#FFFFFF", all, "onDark", null), { variant: "onDark", plate: "#0F172A" });
  assert.deepEqual(pickLogo("#000000", all, "black", "#FFFFFF"), { variant: "black", plate: "#FFFFFF" });
  assert.deepEqual(pickLogo("#000000", all, "main", "#FFFFFF"), { variant: "main", plate: "#FFFFFF" });
  assert.deepEqual(pickLogo("#000000", { ...all, black: false }, "black", "#FFFFFF"), { variant: "onDark", plate: null }, "missing: Automatiskt");
  assert.deepEqual(pickLogo("#000000", all, "something", "#FFFFFF"), { variant: "onDark", plate: null }, "unknown: Automatiskt");
  // Only a variant, no logo: the variant is used anyway, on a plate it reads on.
  assert.deepEqual(pickLogo("#FFFFFF", { main: false, onDark: true, onLight: false, black: false }, "auto", null), { variant: "onDark", plate: "#0F172A" });
  assert.deepEqual(pickLogo("#000000", { main: false, onDark: true, onLight: false, black: false }, "auto", null), { variant: "onDark", plate: null });
  assert.equal(pickLogo("#000000", { main: false, onDark: false, onLight: false, black: false }, "auto", null), null);
  assert.ok(LOGO_VARIANTS.every((variant) => isLogoVariant(variant.key)) && !isLogoVariant("x"));
  assert.ok(LOGO_SIZES.every((size) => isLogoSize(size.key)) && !isLogoSize("huge"));
});

test("the logo's size: small, medium and large keep its bottom-left corner, and the text stays above it in every template", () => {
  for (const template of POST_TEMPLATES) {
    const medium = planPost({ ...text, template: template.key }, { primary: "#174C72", companyName: "Elfirma AB" }, fonts);
    for (const size of ["small", "medium", "large"] as const) {
      for (const [index, sample] of [text, { heading: "Så gör du egenkontrollen snabbt och rätt varje gång, även när kunden står bredvid", body: "Mätvärden, foton och underskrift hamnar på rätt ställe, och kunden får en färdig PDF i sin e-post innan du har packat ihop verktygen." }].entries()) {
        const plan = planPost({ ...sample, template: template.key, logoSize: size }, { primary: "#174C72", companyName: "Elfirma AB" }, fonts, { withName: index === 1 });
        const where = `${template.key} ${size} ${index}`;
        assert.deepEqual([plan.logo.area.width, plan.logo.area.height], [LOGO_BOX[size].width, LOGO_BOX[size].height], where);
        assert.equal(plan.logo.area.x, medium.logo.area.x, where);
        assert.equal(plan.logo.area.y + plan.logo.area.height, medium.logo.area.y + medium.logo.area.height, where);
        assert.ok(plan.logo.area.x + plan.logo.area.width <= IMAGE_WIDTH - SAFE_SIDE, where);
        for (const block of plan.texts) {
          if (block.role === "name") continue;
          assert.ok(block.bottom <= plan.logo.area.y - 10, `${where} ${block.role}: ${block.bottom} over the logo at ${plan.logo.area.y}`);
          const { left, right } = blockEdges(block);
          assert.ok(left >= SAFE_SIDE - 0.5 && right <= IMAGE_WIDTH - SAFE_SIDE + 0.5, where);
        }
      }
    }
  }
});

test("the picture draws the variant: a white logo stands on black without a plate, and the logo itself gets the white plate", async () => {
  const white = new Uint8Array(await sharp({ create: { width: 400, height: 140, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer());
  const red = new Uint8Array(await sharp({ create: { width: 400, height: 140, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 1 } } }).png().toBuffer());
  const pixel = async (jpeg: Buffer, x: number, y: number) => { const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true }); const at = (y * info.width + x) * info.channels; return [data[at], data[at + 1], data[at + 2]]; };
  const plan = planPost({ ...text, template: "black" }, { primary: "#174C72", companyName: "" }, fonts);
  const centre = { x: plan.logo.area.x + 150, y: plan.logo.area.y + plan.logo.area.height - 40 };
  // Logga för mörk bakgrund: the white logo itself, right at the area's left edge (no plate's padding).
  const variant = await renderPostImage({ ...text, template: "black" }, { primary: "#174C72", companyName: "", logo: red, logos: { onDark: white } }, fonts);
  const [r, g, b] = await pixel(variant, plan.logo.area.x + 3, centre.y);
  assert.ok(r > 230 && g > 230 && b > 230, `white logo at the edge: ${r},${g},${b}`);
  // Chosen Logotypen: the red logo inside a white plate (white at the very edge, red inside).
  const main = await renderPostImage({ ...text, template: "black", logoVariant: "main" }, { primary: "#174C72", companyName: "", logo: red, logos: { onDark: white } }, fonts);
  const edge = await pixel(main, plan.logo.area.x + 6, centre.y);
  assert.ok(edge.every((value) => value > 230), `plate at the edge: ${edge}`);
  const inside = await pixel(main, centre.x, centre.y);
  assert.ok(inside[0] > 180 && inside[1] < 80, `red logo inside: ${inside}`);
  // A broken variant counts as missing: the logo itself is drawn instead, and the picture is made.
  const broken = await renderPostImage({ ...text, template: "black" }, { primary: "#174C72", companyName: "", logo: red, logos: { onDark: new Uint8Array([1, 2, 3]) } }, fonts);
  const meta = await sharp(broken).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", IMAGE_WIDTH, IMAGE_HEIGHT]);
  assert.ok((await pixel(broken, centre.x, centre.y))[0] > 180, "the red logo");
});

test("Bakgrund bakom logotypen: Ruta keeps today's plates, Ingen draws every variant without one", () => {
  const all = { main: true, onDark: true, onLight: true, black: true };
  assert.ok(LOGO_PLATES.every((plate) => isLogoPlate(plate.key)) && !isLogoPlate("x"));
  for (const choice of [undefined, null, "box"]) {
    assert.deepEqual(pickLogo("#000000", all, "main", "#FFFFFF", choice), { variant: "main", plate: "#FFFFFF" }, String(choice));
    assert.deepEqual(pickLogo("#FFFFFF", all, "onDark", null, choice), { variant: "onDark", plate: "#0F172A" }, String(choice));
  }
  for (const variant of ["auto", "main", "onDark", "onLight", "black"]) {
    for (const behind of ["#000000", "#FFFFFF", "#1E3A8A"]) assert.equal(pickLogo(behind, all, variant, "#FFFFFF", "none")?.plate, null, `${variant} on ${behind}`);
  }
  assert.equal(pickLogo("#000000", { main: false, onDark: false, onLight: false, black: false }, "auto", null, "none"), null);
  // The plan: the template's plate stays unless Ingen, in the feed and in the story.
  for (const template of POST_TEMPLATES) {
    for (const format of ["feed", "story"] as const) {
      const base = planPost({ ...text, template: template.key }, { primary: "#174C72", companyName: "" }, fonts, { format });
      assert.equal(planPost({ ...text, template: template.key, logoPlate: "box" }, { primary: "#174C72", companyName: "" }, fonts, { format }).logo.plate, base.logo.plate, `${template.key} ${format}`);
      const none = planPost({ ...text, template: template.key, logoPlate: "none" }, { primary: "#174C72", companyName: "" }, fonts, { format });
      assert.equal(none.logo.plate, null, `${template.key} ${format}`);
      assert.deepEqual(none.logo.area, base.logo.area, `${template.key} ${format}: the same place`);
    }
  }
});

test("the picture with Ingen: the logo itself stands on black without the white plate, in the feed and in the story", async () => {
  const red = new Uint8Array(await sharp({ create: { width: 400, height: 140, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 1 } } }).png().toBuffer());
  const pixel = async (jpeg: Buffer, x: number, y: number) => { const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true }); const at = (y * info.width + x) * info.channels; return [data[at], data[at + 1], data[at + 2]]; };
  for (const format of ["feed", "story"] as const) {
    const plan = planPost({ ...text, template: "black" }, { primary: "#174C72", companyName: "" }, fonts, { format });
    const y = plan.logo.area.y + plan.logo.area.height - 40;
    const boxed = await renderPostImage({ ...text, template: "black", logoVariant: "main" }, { primary: "#174C72", companyName: "", logo: red }, fonts, null, format);
    assert.ok((await pixel(boxed, plan.logo.area.x + 6, y)).every((value) => value > 230), `${format}: Ruta has the white plate`);
    const bare = await renderPostImage({ ...text, template: "black", logoVariant: "main", logoPlate: "none" }, { primary: "#174C72", companyName: "", logo: red }, fonts, null, format);
    assert.equal((await sharp(bare).metadata()).height, format === "story" ? STORY_HEIGHT : IMAGE_HEIGHT);
    const edge = await pixel(bare, plan.logo.area.x + 3, y);
    assert.ok(edge[0] > 180 && edge[1] < 80, `${format}: the red logo right at the edge, no plate: ${edge}`);  }
});

test("the logo's choice is part of the approved content only when it is not the default", () => {
  const post = { heading: "R", body: "", caption: "T", link: null, template: "white", toFacebook: true, toInstagram: false, backgroundSource: null };
  const base = postContentHash(post);
  assert.equal(postContentHash({ ...post, logoVariant: "auto", logoSize: "medium" }), base, "earlier approvals stay valid");
  assert.notEqual(postContentHash({ ...post, logoVariant: "onDark" }), base);
  assert.notEqual(postContentHash({ ...post, logoSize: "large" }), base);
  assert.notEqual(postContentHash({ ...post, logoSize: "large" }), postContentHash({ ...post, logoSize: "small" }));
  // Bakgrund bakom logotypen (2026-11-15): Ruta (or nothing) keeps the hash; Ingen asks for a new approval.
  assert.equal(postContentHash({ ...post, logoPlate: null }), base);
  assert.equal(postContentHash({ ...post, logoPlate: "box" }), base);
  assert.notEqual(postContentHash({ ...post, logoPlate: "none" }), base);
});

test("the logo variants' files: one id and column each, found by key and by id", () => {
  assert.deepEqual(LOGO_VARIANT_FILES.map((variant) => variant.key), ["onDark", "onLight", "black"]);
  assert.equal(logoVariantByKey("onDark")?.column, "logoOnDarkPath");
  assert.equal(logoVariantById("logo-black")?.column, "logoBlackPath");
  assert.equal(logoVariantById("logo"), null);
  assert.equal(logoVariantByKey("main"), null);
});

test("Ny serie: twelve parts on Monday, Wednesday and Friday at 08:00 from the next free time are about a month, never in a taken slot", () => {
  const now = new Date("2026-11-16T07:00:00Z"); // Monday 08:00 Swedish time
  const times = seriesTimes(12, DEFAULT_RHYTHM, { now });
  assert.equal(times.length, 12);
  assert.ok(times.every((at) => toSwedishDateTimeInput(at).endsWith("T08:00")));
  assert.deepEqual(times.slice(0, 4).map((at) => swedishDayKey(at)), ["2026-11-18", "2026-11-20", "2026-11-23", "2026-11-25"], "today's 08:00 is not five minutes ahead");
  assert.equal(swedishDayKey(times[11]), "2026-12-14");
  // A slot another post has is skipped.
  const taken = [fromSwedishDateTimeInput("2026-11-20T08:30")!];
  assert.deepEqual(seriesTimes(2, DEFAULT_RHYTHM, { now, taken }).map((at) => swedishDayKey(at)), ["2026-11-18", "2026-11-23"]);
  // From a later first day.
  assert.equal(swedishDayKey(seriesTimes(1, DEFAULT_RHYTHM, { now, fromDay: "2026-12-01" })[0]), "2026-12-02");
  assert.equal(seriesCount("12"), 12);
  assert.equal(seriesCount("100"), SERIES_PARTS_MAX);
  assert.equal(seriesCount("1"), SERIES_PARTS_MIN);
  assert.equal(seriesCount("x"), SERIES_PARTS_DEFAULT);
});

test("Ny serie: a time near another post or another part is pointed out; a passed time and a missing text are refused, by part", () => {
  const at = (value: string) => fromSwedishDateTimeInput(value)!;
  assert.deepEqual(seriesClashes([at("2026-11-18T08:00"), at("2026-11-18T08:30"), at("2026-11-20T08:00"), null], [at("2026-11-20T08:45")]), [true, true, true, false]);
  const now = new Date("2026-11-16T07:00:00Z");
  const shared = { template: "white", logoVariant: "auto", logoSize: "medium", hashtags: "#el", toFacebook: true, toInstagram: false, toLinkedIn: false };
  const part = (time: string, heading = "Rubrik"): SeriesPart => ({ heading, body: "", caption: "Text", at: time });
  assert.equal(seriesProblem(shared, [part("2026-11-18T08:00"), part("2026-11-20T08:00")], now), null);
  assert.deepEqual(seriesProblem(shared, [part("2026-11-18T08:00"), part("2026-11-10T08:00")], now), { part: 1, message: "Del 2: Tiden har redan passerat. Välj en senare tid." });
  assert.deepEqual(seriesProblem(shared, [part("2026-11-18T08:00", " "), part("2026-11-20T08:00")], now)?.part, 0);
  assert.match(seriesProblem(shared, [part("2026-11-18T08:00"), part("")], now)?.message ?? "", /^Del 2: Välj dag och klockslag/);
  assert.equal(seriesProblem(shared, [part("2026-11-18T08:00")], now)?.part, null, "one part is not a series");
  assert.equal(seriesProblem(shared, Array.from({ length: SERIES_PARTS_MAX + 1 }, () => part("2026-11-18T08:00")), now)?.part, null);
  assert.match(seriesProblem({ ...shared, toFacebook: false }, [part("2026-11-18T08:00"), part("2026-11-20T08:00")], now)?.message ?? "", /Välj Facebook/);
});

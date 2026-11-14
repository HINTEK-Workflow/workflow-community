import assert from "node:assert/strict";
import test from "node:test";
import { displayImageUrl } from "../lib/catalogue/product-info";

// Solar's pictures can be TIFF (no browser shows them) and over a megabyte: the picture service converts and shrinks them on the way out.
test("a Cloudinary picture is asked for in a browser format and a small size; any other address stays as it is", () => {
  assert.equal(
    displayImageUrl("https://res.cloudinary.com/solar-as/image/upload/v1699592473/Item/3615635.tiff", 160),
    "https://res.cloudinary.com/solar-as/image/upload/f_auto,q_auto,w_160,c_limit/v1699592473/Item/3615635.tiff",
  );
  assert.equal(displayImageUrl("https://example.invalid/bild.png", 160), "https://example.invalid/bild.png");
  assert.equal(displayImageUrl("", 160), "");
  const already = "https://res.cloudinary.com/solar-as/image/upload/f_auto,w_50/v1/Item/1.jpg";
  assert.equal(displayImageUrl(already, 160), already, "an address that already has a transformation is left alone");
});

test("a Cloudinary address without its version part is converted the same way (2026-11-03)", () => {
  assert.equal(
    displayImageUrl("https://res.cloudinary.com/solar-as/image/upload/Item/3615635.tiff", 1000),
    "https://res.cloudinary.com/solar-as/image/upload/f_auto,q_auto,w_1000,c_limit/Item/3615635.tiff",
  );
  for (const left of ["https://res.cloudinary.com/solar-as/image/upload/w_50/Item/1.jpg", "https://res.cloudinary.com/solar-as/image/upload/c_fill,w_50/Item/1.jpg", "https://res.cloudinary.com/solar-as/image/upload/1.tiff", "https://res.cloudinary.com/solar-as/video/upload/Item/1.mp4"])
    assert.equal(displayImageUrl(left, 160), left, left);
});

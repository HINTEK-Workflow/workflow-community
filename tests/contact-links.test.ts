import test from "node:test";
import assert from "node:assert/strict";
import { callHref, callTargets, destinationText, navigateHref } from "../lib/workflow/contact-links";

test("callHref keeps digits and a leading plus, and gives nothing without digits", () => {
  assert.equal(callHref("031-12 34 56"), "tel:031123456");
  assert.equal(callHref("+46 70 123 45 67"), "tel:+46701234567");
  assert.equal(callHref("  "), null);
  assert.equal(callHref(null), null);
  assert.equal(callHref("ingen"), null);
});

test("callTargets: mobile first, the same number once, name in the label, none without numbers", () => {
  assert.deepEqual(callTargets({ name: "Anna", phone: "", mobile: "" }), []);
  assert.deepEqual(callTargets({ name: "Anna", phone: "0701", mobile: "070-1" }).map((t) => t.key), ["mobile"]);
  const both = callTargets({ name: "Anna", phone: "031-1", mobile: "070-2" });
  assert.deepEqual(both.map((t) => [t.key, t.label, t.href]), [["mobile", "Ring Anna (mobil)", "tel:0702"], ["phone", "Ring Anna (telefon)", "tel:0311"]]);
  assert.equal(callTargets({ name: "Anna", phone: "031-1" })[0].label, "Ring Anna");
  assert.equal(callTargets({ phone: "031-1" })[0].label, "Ring telefon");
});

test("navigateHref uses the position, else the address, else nothing", () => {
  assert.equal(destinationText({ address: "Elvägen 4", postalCode: "123 41", city: "Elstad" }), "Elvägen 4, 123 41 Elstad");
  assert.equal(navigateHref({ address: "Elvägen 4", postalCode: "123 41", city: "Elstad" }), "https://www.google.com/maps/dir/?api=1&destination=Elv%C3%A4gen%204%2C%20123%2041%20Elstad");
  assert.equal(navigateHref({ address: "x", latitude: 57.7, longitude: 11.97 }), "https://www.google.com/maps/dir/?api=1&destination=57.7%2C11.97");
  assert.equal(navigateHref({ address: " ", city: "" }), null);
  assert.equal(navigateHref(null), null);
});

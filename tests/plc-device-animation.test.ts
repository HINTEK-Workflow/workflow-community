import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { animationCss, animationText, animationTexts, checkAnimation, evaluateAnimation, missingParts, parseAnimation, standardAnimation, stateHolds, type AnimationSpec } from "../lib/machine/simulator/surface/animation";
import { cleanImage, exportDevices, MAX_LAYERED_SVG_BYTES, MAX_SVG_BYTES, parseDeviceFile, pictureParts, standardDesign, validateDesign } from "../lib/machine/simulator/surface/device-designs";
import { DEVICE_KINDS } from "../lib/machine/simulator/surface/devices";
import { createDeviceState, type DeviceState } from "../lib/machine/simulator/surface/engine";
import { parseSafeSvg } from "../lib/machine/simulator/surface/svg-safe";

// PLC-apparater, animering (2026-11-07: "Animering skall vara i redigerbar kod. Jag skall kunna be att annat AI-system ta fram
// knappar på det sättet"): the declarative spec – read, checked, evaluated to CSS – and the allowlisted SVG it moves.

const state = (patch: Partial<DeviceState> = {}): DeviceState => ({ ...createDeviceState(), ...patch });
const spec = (rules: unknown[]) => checkAnimation({ rules });

test("a spec is read from text, and every error says where", () => {
  const good = parseAnimation(`{"rules":[{"part":"plunger","when":"pressed","move":[0,2],"ms":60}]}`);
  assert.equal(good.ok, true);
  const broken = parseAnimation(`{"rules":[{"part":"plunger","when":"pressed","move":[0,2],}]}`);
  assert.match(broken.ok ? "" : broken.errors[0]!, /inte giltig JSON/);
  const wrongState = parseAnimation(`{"rules":[{"part":"cap","when":"held","move":[0,2]}]}`);
  assert.match(wrongState.ok ? "" : wrongState.errors.join(" "), /Regel 1, when/);
  const nothing = spec([{ part: "cap", when: "pressed" }]);
  assert.match(nothing.ok ? "" : nothing.errors.join(" "), /säg vad som ska hända/);
  const spinAndMove = spec([{ part: "rotor", spin: "speed" }, { part: "rotor", when: "on", rotate: 10 }]);
  assert.match(spinAndMove.ok ? "" : spinAndMove.errors.join(" "), /snurrar/);
  assert.equal(spec([{ part: "a", rpm: 30, opacity: 1 }]).ok, false, "rpm only with spin");
});

test("nothing script-like gets through: only plain words, numbers in range, #hex colours and fixed lists", () => {
  for (const bad of [
    { part: "<script>", opacity: 1 }, { part: "a\"]{}", opacity: 1 }, { part: "cap", fill: "javascript:alert(1)" }, { part: "cap", fill: "red;}body{display:none" },
    { part: "cap", fill: "url(https://x)" }, { part: "cap", onclick: "x()" }, { part: "cap", style: "x" }, { part: "cap", move: [0, "1e9"] }, { part: "cap", rotate: 1e9 },
    { part: "cap", when: "pressed; color:red", opacity: 1 }, { part: "cap", ease: "cubic-bezier(1,1,1,1)", opacity: 1 }, { part: "cap", follow: { value: "document", rotate: [0, 1] } },
  ]) assert.equal(spec([bad]).ok, false, JSON.stringify(bad));
  assert.equal(checkAnimation({ rules: [], code: "x" }).ok, false, "no other fields");
  assert.equal(animationCss("bad scope{", standardAnimation("knapp"), state()), "", "the scope is a plain class name");
});

test("rules are evaluated per state: when, not, moves adding up, later colours winning, follow and spin", () => {
  const checked = spec([
    { part: "cap", when: "pressed", move: [0, 2], ms: 60 }, { part: "cap", when: "pressed", scale: 0.9 },
    { part: "ring", when: "energised", fill: "#22C55E" }, { part: "ring", when: "energised", fill: "#ff0000" }, { part: "ring", when: "not energised", opacity: 0.2 },
    { part: "needle", follow: { value: "drive", rotate: [-60, 60] }, origin: [42, 30] },
    { part: "rotor", spin: "speed", rpm: 120 },
  ]);
  assert.equal(checked.ok, true);
  const rules = checked.ok ? checked.spec : ({ rules: [] } as AnimationSpec);
  const rest = evaluateAnimation(rules, state());
  assert.equal(rest.get("cap")!.transform, null);
  assert.equal(rest.get("ring")!.opacity, 0.2);
  assert.equal(rest.get("needle")!.transform, "rotate(-60deg)");
  assert.equal(rest.get("rotor")!.spin, 0, "still at speed 0");
  const busy = evaluateAnimation(rules, state({ pressed: true, energised: true, drive: 0.5, speed: 1 }));
  assert.equal(busy.get("cap")!.transform, "translate(0px, 2px) scale(0.9)");
  assert.equal(busy.get("ring")!.fill, "#ff0000");
  assert.equal(busy.get("ring")!.opacity, null);
  assert.equal(busy.get("needle")!.transform, "rotate(0deg)");
  assert.equal(busy.get("rotor")!.spin, 2, "120 rpm = 2 turns a second");
  assert.equal(stateHolds("not pressed", state({ pressed: true })), false);
  assert.equal(stateHolds("running", state({ speed: 0.5 })), true);
  const css = animationCss("plc-a-1", rules, state({ pressed: true, speed: 1 }));
  assert.match(css, /\.plc-a-1 \[data-part="cap"\] \{ transform-box: fill-box; transform-origin: center; transform: translate\(0px, 2px\) scale\(0\.9\)/);
  assert.match(css, /transform-origin: 42px 30px/);
  assert.match(css, /animation: plc-part-spin 0\.5s linear infinite/);
  assert.match(css, /prefers-reduced-motion: no-preference/);
  assert.doesNotMatch(css, /url\(|javascript|<|expression/i);
});

test("every function's standard animation is valid, written in the same form, and names parts its picture has", () => {
  for (const kind of DEVICE_KINDS) {
    const standard = standardAnimation(kind);
    assert.equal(checkAnimation(standard).ok, true, kind);
    assert.deepEqual(parseAnimation(animationText(standard)), { ok: true, spec: standard }, `${kind} goes round as text`);
  }
  const drawings = readFileSync("features/plc-simulator/surface/device-drawings.tsx", "utf8") + readFileSync("features/plc-simulator/surface/pictures.tsx", "utf8");
  for (const kind of DEVICE_KINDS) for (const rule of standardAnimation(kind).rules) {
    assert.ok(drawings.includes(`name="${rule.part}"`) || drawings.includes(`part="${rule.part}"`), `${kind}: the picture has a part ${rule.part}`);
  }
  assert.equal(validateDesign("rela", { ...standardDesign("rela"), animation: { rules: [{ part: "armature", when: "energised", rotate: 12 }] } }).ok, true);
  assert.equal(validateDesign("rela", { ...standardDesign("rela"), animation: { rules: [{ part: "armature", when: "energised" }] } }).ok, false);
});

test("an uploaded SVG is read through an allowlist: drawing kept with its ids, everything else left out or refused", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>`
    + `<g id="plunger" onclick="steal()" style="fill:#16a34a;behavior:url(x)"><circle cx="36" cy="36" r="18" fill="url(#g)"/></g><text x="2" y="9">13 &amp; 14</text>`
    + `<image href="https://evil.example/x.png"/><use href="#plunger"/><a href="https://x"><rect width="9" height="9"/></a><style>*{}</style></svg>`;
  const tree = parseSafeSvg(svg);
  assert.equal(tree.ok, true);
  const text = JSON.stringify(tree.ok ? tree.root : null);
  assert.deepEqual(tree.ok ? tree.ids : [], ["g", "plunger"]);
  assert.match(text, /"fill":"url\(#g\)"/);
  assert.match(text, /"fill":"#16a34a"/, "a style's drawing properties become attributes");
  assert.match(text, /13 & 14/);
  for (const gone of ["onclick", "steal", "behavior", "evil.example", "\"use\"", "\"a\"", "\"style\"", "\"image\""]) assert.ok(!text.includes(gone), gone);
  for (const refused of [`<!DOCTYPE svg><svg/>`, `<svg><g></svg>`, `<html></html>`, `<svg><rect width=9/></svg>`]) assert.equal(parseSafeSvg(refused).ok, false, refused);
  const checked = cleanImage({ format: "svg", data: svg.replace("<image href=\"https://evil.example/x.png\"/>", "") });
  assert.equal(checked.ok, false, "on upload, handlers and outside links are refused outright, not only left out");
  assert.equal(cleanImage({ format: "svg", data: `<svg viewBox="0 0 72 72"><g id="plunger"><circle r="9"/></g></svg>` }).ok, true, "a picture with named parts is accepted");
  assert.equal(cleanImage({ format: "svg", data: `<svg viewBox="0 0 9 9"><g></svg>` }).ok, false, "broken markup is refused");
  assert.deepEqual(pictureParts("knapp", { image: { format: "svg", data: svg } }), ["g", "plunger"]);
  assert.deepEqual(missingParts({ rules: [{ part: "plunger", opacity: 1 }, { part: "lamp", opacity: 1 }, { part: "bild", opacity: 1 }] }, ["plunger"]), ["lamp"]);
});

// ---------- v4 (2026-11-09: the front-view photographs as the library, every device animated) ----------

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const WEBP = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
/** A base64 layer of about `bytes` decoded bytes that reads as a PNG. */
const pngLayer = (bytes: number) => `data:image/png;base64,iVBORw0KGgo${"A".repeat(Math.ceil((bytes * 4) / 3 / 4) * 4 - 11)}`;

test("photo layers: an <image> with an embedded PNG or WebP is kept as a part; an address, an SVG or a wrong file inside is left out", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><g id="body"><image x="0" y="0" width="72" height="72" href="${PNG}"/></g>`
    + `<g id="cap"><image x="20" y="20" width="32" height="32" xlink:href="${WEBP}"/></g>`
    + `<image href="https://evil.example/x.png"/><image href="data:image/svg+xml;base64,PHN2Zy8+"/><image href="data:image/png;base64,R0lGODlhAQABAA=="/><image x="1" y="1" width="9" height="9"/>`
    + `<text id="display" x="36" y="60">–</text></svg>`;
  const tree = parseSafeSvg(svg);
  assert.equal(tree.ok, true);
  if (!tree.ok) return;
  assert.equal(tree.layers, 2);
  assert.deepEqual(tree.ids, ["body", "cap", "display"]);
  const text = JSON.stringify(tree.root);
  assert.equal((text.match(/"tag":"image"/g) ?? []).length, 2, "only the two embedded layers are drawn");
  assert.match(text, /"href":"data:image\/webp;base64,UklGR/, "xlink:href becomes href, the data kept as it is");
  for (const gone of ["evil.example", "svg+xml", "R0lGODlh"]) assert.ok(!text.includes(gone), gone);
  assert.ok(tree.dropped.includes("image"), "what went is named");
  assert.equal(cleanImage({ format: "svg", data: svg }).ok, false, "on upload an outside address is refused outright, as before");
  const upload = svg.replace(`<image href="https://evil.example/x.png"/>`, "");
  assert.equal(cleanImage({ format: "svg", data: upload }).ok, true, "embedded layers pass the upload check");
  assert.deepEqual(pictureParts("knapp", { image: { format: "svg", data: upload } }), ["body", "cap", "display"]);
});

test("picture sizes: a drawing of its own stays within 200 kB, a picture with photo layers may reach 1 MB, a layer never more than 400 kB", () => {
  const layered = (layer: string) => `<svg viewBox="0 0 72 72"><g id="body"><image width="72" height="72" href="${layer}"/></g></svg>`;
  const vectorOnly = `<svg viewBox="0 0 72 72"><path d="${"M0 0 L1 1 ".repeat(30_000)}"/></svg>`;
  assert.ok(new TextEncoder().encode(vectorOnly).length > MAX_SVG_BYTES);
  const tooBig = cleanImage({ format: "svg", data: vectorOnly });
  assert.match(tooBig.ok ? "" : tooBig.reason, /fotolager/, "the refusal says what may be larger");
  assert.equal(cleanImage({ format: "svg", data: layered(pngLayer(300 * 1024)) }).ok, true, "300 kB of photo in one layer is fine");
  const heavyLayer = cleanImage({ format: "svg", data: layered(pngLayer(420 * 1024)) });
  assert.equal(heavyLayer.ok, false, "a layer over 400 kB goes, and a picture without layers over 200 kB is refused");
  const three = `<svg viewBox="0 0 72 72">${["a", "b", "c"].map((id) => `<g id="${id}"><image width="72" height="72" href="${pngLayer(300 * 1024)}"/></g>`).join("")}</svg>`;
  assert.ok(new TextEncoder().encode(three).length > MAX_LAYERED_SVG_BYTES);
  const over = cleanImage({ format: "svg", data: three });
  assert.match(over.ok ? "" : over.reason, /1024 kB/);
});

test("a value in the picture: \"show\" writes the device's value into a <text> part, and \"volts\" is a value to follow", () => {
  const checked = spec([{ part: "display", show: "volts" }, { part: "needle", follow: { value: "volts", rotate: [-45, 45] }, origin: [36, 60] }]);
  assert.equal(checked.ok, true, checked.ok ? "" : checked.errors.join(" "));
  const rules = checked.ok ? checked.spec : ({ rules: [] } as AnimationSpec);
  assert.deepEqual([...animationTexts(rules, state({ volts: 12.34 }), "voltmeter")], [["display", "12,3 V"]]);
  assert.equal(animationTexts(rules, state(), "voltmeter").get("display"), "0,0 V", "a meter with open leads reads 0 V (2026-11-09)");
  assert.equal(animationTexts(rules, state(), "lampa").get("display"), "–", "nothing known reads as a dash");
  assert.equal(evaluateAnimation(rules, state({ volts: 30 })).get("needle")!.transform, "rotate(45deg)");
  assert.equal(evaluateAnimation(rules, state({ volts: -15 })).get("needle")!.transform, "rotate(0deg)", "the size of the voltage, either way round");
  const reading = spec([{ part: "d", show: "reading" }]);
  assert.equal(reading.ok ? animationTexts(reading.spec, state({ outV: 5 }), "tempgivare").get("d") : null, "100,0 °C", "a sensor's reading back from its 0–10 V");
  assert.equal(reading.ok ? animationTexts(reading.spec, state({ outV: null }), "tempgivare").get("d") : null, "–");
  const percent = spec([{ part: "d", when: "running", show: "speed" }]);
  assert.equal(percent.ok ? animationTexts(percent.spec, state({ speed: 0.8 }), "motor").get("d") : null, "80 %");
  assert.equal(percent.ok ? animationTexts(percent.spec, state({ speed: 0 }), "motor").has("d") : null, false, "a rule's when holds for show too");
  assert.equal(spec([{ part: "d", show: "setpoint" }]).ok, false, "a setpoint needs the device's options, so it is not a picture value");
  assert.equal(spec([{ part: "d", show: "document.cookie" }]).ok, false);
  const blade = spec([{ part: "blade", follow: { value: "position", scaleY: [1, 0.15] }, ms: 200 }, { part: "lid", when: "open", scaleY: 0.5 }]);
  assert.equal(blade.ok, true, "height alone: a damper blade turning, seen from the front");
  const open = evaluateAnimation(blade.ok ? blade.spec : { rules: [] }, state({ position: 1 }));
  assert.equal(open.get("blade")!.transform, "scale(1, 0.15)");
  assert.equal(open.get("lid")!.transform, "scale(1, 0.5)");
  assert.ok(animationCss("plc-a-1", blade.ok ? blade.spec : { rules: [] }, state({ position: 1 })).includes(`transform: scale(1, 0.15)`));
});

test("file version 4 carries photo layers, \"volts\" and \"show\"; a version 3 file with them is refused rather than drawn half", () => {
  const meter = { name: "V", label: "Voltmeter", group: "el", function: "voltmeter", animation: { rules: [{ part: "display", show: "volts" }] } };
  const v3 = parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 3, devices: [meter] }));
  assert.match(v3.ok ? "" : v3.errors.join(" "), /först i version 4/);
  assert.equal(parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 4, devices: [meter] })).ok, true);
  const layered = { name: "K", label: "Knapp", group: "industri", function: "knapp", image: { format: "svg", svg: `<svg viewBox="0 0 72 72"><g id="cap"><image width="72" height="72" href="${PNG}"/></g></svg>` } };
  const old = parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 3, devices: [layered] }));
  assert.match(old.ok ? "" : old.errors.join(" "), /först i version 4/);
  const read = parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 4, devices: [layered] }));
  assert.equal(read.ok, true, read.ok ? "" : read.errors.join(" | "));
  assert.equal(parseDeviceFile(JSON.stringify(exportDevices(read.ok ? read.devices.map((device) => ({ key: device.key ?? "knapp", design: device.design })) : []))).ok, true, "and goes round again");
});

test("file version 3 carries the animation; version 1 and 2 files are still read but cannot carry one", () => {
  const device = { name: "Start", label: "Start", group: "industri", function: "knapp", animation: { rules: [{ part: "cap", when: "pressed", move: [0, 3] }] } };
  const v3 = parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 3, devices: [device] }));
  assert.equal(v3.ok, true);
  assert.deepEqual(v3.ok ? v3.devices[0]!.design.animation : null, device.animation);
  const v2 = parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 2, devices: [device] }));
  assert.match(v2.ok ? "" : v2.errors.join(" "), /först i version 3/);
  const { animation: _unused, ...plain } = device;
  void _unused;
  assert.equal(parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 2, devices: [plain] })).ok, true);
  const bad = parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 3, devices: [{ ...device, animation: { rules: [{ part: "cap", fill: "javascript:x" }] } }] }));
  assert.match(bad.ok ? "" : bad.errors.join(" "), /animation: Regel 1, fill/);
});

test("the value tag is part of the design and the file; an exported library carries the instruction and imports again", () => {
  const device = { key: "frysvakt", name: "Frysvakt", label: "Frysvakt", group: "fastighet", function: "frysvakt", readout: { side: "left", values: ["setpoint"] } };
  const read = parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 3, instruction: "Skapa en JSON-fil …", devices: [device] }));
  assert.equal(read.ok, true, read.ok ? "" : read.errors.join(" | "));
  assert.deepEqual(read.ok ? read.devices[0]!.design.readout : null, { side: "left", values: ["setpoint"] });
  const wrong = parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 3, devices: [{ ...device, readout: { side: "left", values: ["speed"] } }] }));
  assert.match(wrong.ok ? "" : wrong.errors.join(" "), /har inget värde "speed"/);
  const old = parseDeviceFile(JSON.stringify({ format: "hintek-plc-device", version: 2, devices: [device] }));
  assert.match(old.ok ? "" : old.errors.join(" "), /först i version 3/);
  const file = exportDevices([{ key: "frysvakt", design: standardDesign("frysvakt") }], "INSTRUKTION");
  assert.equal(file.instruction, "INSTRUKTION");
  assert.equal(Object.keys(file)[2], "instruction", "the instruction stands before the devices");
  assert.equal(parseDeviceFile(JSON.stringify(file)).ok, true);
});

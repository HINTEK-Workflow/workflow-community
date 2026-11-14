import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  cleanImage, cleanSound, designedDef, designedJoins, designedSound, designFor, DESIGN_OPTION, DEVICE_FILE_FORMAT, DEVICE_FILE_VERSION, exportDevices, functionTerminals, IMPORT_PART_BYTES, paletteEntries, parseDeviceFile, pictureOffset, plateWidth, requiredTerminals, setPublishedDesigns, splitForImport, standardDesign, terminalProblems, validateDesign,
  type DeviceDesign,
} from "../lib/machine/simulator/surface/device-designs";
import { DEVICE_DEFS, DEVICE_KINDS } from "../lib/machine/simulator/surface/devices";
import { deviceTerminalPoint } from "../lib/machine/simulator/surface/geometry";
import { DEVICE_FORMAT_GUIDE } from "../features/plc-devices/format-guide";

// PLC-apparater (2026-11-06): the product owner's device designs – validation, SVG cleaning, how the simulator reads them and
// the file format for import and export.

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">${body}</svg>`;
const knapp = (patch: Partial<DeviceDesign> = {}): DeviceDesign => ({ ...standardDesign("knapp"), ...patch });

test("every standard device is a valid design of itself, and keeps its function", () => {
  for (const kind of DEVICE_KINDS) assert.equal(validateDesign(kind, standardDesign(kind)).ok, true, kind);
  const changed = validateDesign("knapp", { ...standardDesign("lampa") });
  assert.equal(changed.ok, false);
  assert.match(changed.ok ? "" : changed.reason, /behåller sin funktion/);
});

test("the terminals must be exactly the function's, so a saved drawing never loses a wire", () => {
  const missing = validateDesign("knapp", knapp({ terminals: knapp().terminals.slice(1) }));
  assert.equal(missing.ok, false);
  const copy = validateDesign("egen-abc123", { ...knapp(), function: "rela", terminals: functionTerminals("rela") });
  assert.equal(copy.ok, true, "a copy may choose another function with that function's terminals");
  assert.equal(validateDesign("egen-abc123", { ...knapp(), function: "rela" }).ok, false, "but not with the old terminals");
  assert.equal(validateDesign("hack", knapp()).ok, false, "an unknown key is refused");
});

test("an SVG is cleaned, and anything that could run or fetch is refused", () => {
  const ok = cleanImage({ format: "svg", data: `<?xml version="1.0"?><!-- ritad -->${svg('<circle cx="36" cy="36" r="20" fill="#16a34a"/>')}` });
  assert.equal(ok.ok, true);
  assert.doesNotMatch(ok.ok ? ok.image.data : "", /<\?xml|<!--/);
  for (const bad of [
    svg("<script>alert(1)</script>"), svg('<circle onclick="x()" r="2"/>'), svg("<foreignObject><div/></foreignObject>"), svg('<image href="https://evil.example/x.png"/>'),
    svg('<a href="javascript:alert(1)"/>'), '<!DOCTYPE svg [<!ENTITY x "y">]>' + svg(""), svg('<style>@import "https://x";</style>'), "<html></html>",
  ]) assert.equal(cleanImage({ format: "svg", data: bad }).ok, false, bad);
  assert.equal(cleanImage({ format: "svg", data: svg(`<path d="${"M0 0 ".repeat(50_000)}"/>`) }).ok, false, "too large");
  assert.equal(cleanImage({ format: "png", data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" }).ok, true);
  assert.equal(cleanImage({ format: "png", data: "data:image/png;base64,R0lGODlhAQABAA==" }).ok, false, "a GIF is not a PNG");
  assert.equal(validateDesign("knapp", knapp({ image: { format: "svg", data: svg("<script/>") } })).ok, false, "a design's picture is checked too");
  assert.equal(validateDesign("knapp", knapp({ stateView: "swap", image: { format: "svg", data: svg("") } })).ok, false, "Byter bild needs the second picture");
});

test("the simulator draws a placed device with its published design, a copy by its option, and keeps behaviour", () => {
  const design = knapp({ name: "Start", label: "Startknapp", image: { format: "svg", data: svg("") }, terminals: [{ id: "1", name: "13", title: "", side: "bottom", at: 0.25, used: true, role: null, joins: null }, { id: "2", name: "14", title: "", side: "top", at: null, used: true, role: null, joins: null }] });
  const copy: DeviceDesign = { ...standardDesign("lampa"), name: "Signaltorn", label: "Signaltorn", group: "el" };
  setPublishedDesigns([{ key: "knapp", design }, { key: "egen-torn01", design: copy }, { key: "<script>", design }]);
  const placed = { id: "K1", kind: "knapp" as const, x: 100, y: 50, label: "", options: {} };
  assert.equal(designedDef(placed).label, "Startknapp");
  assert.deepEqual(designedDef(placed).elements, DEVICE_DEFS.knapp.elements, "behaviour is the kind's own");
  assert.deepEqual(deviceTerminalPoint(placed, "1"), { x: 100 + DEVICE_DEFS.knapp.width * 0.25, y: 50 + DEVICE_DEFS.knapp.height, side: "bottom" });
  const lamp = { id: "L1", kind: "lampa" as const, x: 0, y: 0, label: "", options: { [DESIGN_OPTION]: "egen-torn01" } };
  assert.equal(designedDef(lamp).name, "Signaltorn");
  assert.equal(designFor({ kind: "summer", options: { [DESIGN_OPTION]: "egen-torn01" } }), null, "a copy placed with another function keeps its own drawing");
  const palette = paletteEntries();
  assert.ok(palette.some((entry) => entry.key === "egen-torn01" && entry.kind === "lampa" && entry.def.group === "el"));
  assert.ok(!palette.some((entry) => entry.key === "<script>"), "an unknown key never reaches the palette");
  setPublishedDesigns([{ key: "summer", design: { ...standardDesign("summer"), hidden: true } }]);
  assert.ok(!paletteEntries().some((entry) => entry.key === "summer"), "a hidden device is not offered");
  setPublishedDesigns([]);
  assert.equal(designedDef(placed).label, DEVICE_DEFS.knapp.label, "without designs the simulator's own devices");
});

test("export and import go round trip, and a broken or dangerous file is refused in plain Swedish", () => {
  const design = knapp({ name: "Start", label: "Startknapp", stateView: "glow", image: { format: "svg", data: svg('<circle r="3"/>') } });
  const file = exportDevices([{ key: "knapp", design }, { key: "egen-torn01", design: { ...standardDesign("lampa"), name: "Torn", label: "Torn" } }]);
  assert.equal(file.format, DEVICE_FILE_FORMAT);
  const back = parseDeviceFile(JSON.stringify(file));
  assert.equal(back.ok, true);
  assert.deepEqual(back.ok ? back.devices.map((device) => device.key) : [], ["knapp", "egen-torn01"]);
  assert.deepEqual(back.ok ? back.devices[0]!.design : null, design);

  const refuse = (text: string, pattern: RegExp) => { const result = parseDeviceFile(text); assert.equal(result.ok, false, text.slice(0, 60)); assert.match(result.ok ? "" : result.errors.join(" | "), pattern); };
  refuse("{inte json", /inte giltig JSON/);
  refuse(JSON.stringify({ format: "annat", version: 1, devices: [] }), /hintek-plc-device/);
  refuse(JSON.stringify({ ...file, devices: [{ ...file.devices[0], extra: 1 }] }), /okänt fält/);
  refuse(JSON.stringify({ ...file, devices: [{ ...file.devices[0], function: "laser" }] }), /function/);
  refuse(JSON.stringify({ ...file, devices: [{ ...file.devices[0], image: { format: "svg", svg: svg("<script>x</script>") } }] }), /skript/);
  refuse(JSON.stringify({ ...file, devices: [{ ...file.devices[0], terminals: [{ id: "9", side: "top" }] }] }), /funktionens plintar/);
  refuse("x".repeat(20 * 1024 * 1024 + 1), /större än/);

  const minimal = parseDeviceFile(JSON.stringify({ format: DEVICE_FILE_FORMAT, version: 1, devices: [{ name: "Relä", label: "Relä", group: "industri", function: "rela" }] }));
  assert.equal(minimal.ok, true, "a device without terminals gets its function's");
  assert.equal(minimal.ok ? minimal.devices[0]!.key : "x", null, "without a key it becomes a new device");
  const otherFunction = parseDeviceFile(JSON.stringify({ format: DEVICE_FILE_FORMAT, version: 1, devices: [{ key: "knapp", name: "Relä", label: "Relä", group: "industri", function: "rela" }] }));
  assert.equal(otherFunction.ok ? otherFunction.devices[0]!.key : "x", null, "a standard device's key with another function comes in as a copy");
});

// docs/ is not in the Community export; there the editor text is still checked, the document is not.
test("the format document is the editor's text, so an AI gets the same instruction from both", { skip: !existsSync("docs/drift/PLC_APPARATFORMAT.md") && "docs/ is not part of the Community edition" }, () => {
  const doc = readFileSync("docs/drift/PLC_APPARATFORMAT.md", "utf8");
  assert.ok(doc.includes(DEVICE_FORMAT_GUIDE), "regenerate docs/drift/PLC_APPARATFORMAT.md from features/plc-devices/format-guide.ts");
  for (const kind of DEVICE_KINDS) assert.ok(DEVICE_FORMAT_GUIDE.includes(`- ${kind}: `), kind);
  const example = DEVICE_FORMAT_GUIDE.slice(DEVICE_FORMAT_GUIDE.indexOf("{", DEVICE_FORMAT_GUIDE.indexOf("Exempel ("))).trim();
  const imported = parseDeviceFile(example);
  assert.equal(imported.ok, true, imported.ok ? "" : imported.errors.join(" | "));
  assert.equal(imported.ok ? imported.devices[0]!.design.animation?.rules.length : 0, 3, "with its animation");
});

// ---------- v2 (2026-11-07): the shared base plate, chosen terminals, the picture and the sound as layers, all devices in one file ----------

const rela = (patch: Partial<DeviceDesign> = {}): DeviceDesign => ({ ...standardDesign("rela"), ...patch });
const extra = (id: string, name: string, patch: Partial<DeviceDesign["terminals"][number]> = {}): DeviceDesign["terminals"][number] => ({ id, name, title: "", side: "top", at: null, used: true, role: "wire", joins: null, ...patch });

test("the base plate grows with its terminals in a fixed step and never shrinks below the function's own", () => {
  for (const kind of DEVICE_KINDS) assert.equal(plateWidth(DEVICE_DEFS[kind].width, DEVICE_DEFS[kind].terminals), DEVICE_DEFS[kind].width, `${kind} keeps its size`);
  const side = (count: number) => Array.from({ length: count }, () => ({ side: "top" as const }));
  assert.equal(plateWidth(84, side(3)), 84);
  assert.equal(plateWidth(84, side(5)), 92, "5 × 16 + 12");
  assert.equal(plateWidth(84, side(6)), 108);
  assert.equal(plateWidth(84, side(7)) - plateWidth(84, side(6)), 16, "one more terminal, 16 px more");
  const placed = { kind: "rela" as const, options: {} };
  const wide = rela({ terminals: [...functionTerminals("rela"), extra("e1", "A2", { joins: "A2" }), extra("e2", "PE"), extra("e3", "N")] });
  assert.equal(designedDef(placed, wide).width, 5 * 16 + 12, "five on the top side");
  assert.equal(designedDef(placed, wide).height, DEVICE_DEFS.rela.height);
  assert.equal(pictureOffset(placed, wide), (92 - 84) / 2, "the standard picture stands in the middle");
  const point = deviceTerminalPoint({ id: "R1", x: 0, y: 0, label: "", ...placed }, "e3", wide);
  assert.deepEqual(point, { x: (92 * 5) / 6, y: 0, side: "top" }, "an extra terminal is spread with the others");
});

test("terminals: the function's needs stay, a contact must stay whole, extras are named and linked to what is there", () => {
  assert.deepEqual([...requiredTerminals("rela").keys()], ["A1", "A2"]);
  assert.deepEqual([...requiredTerminals("knapp").keys()], [], "a pushbutton is only a contact");
  const without = (kind: Parameters<typeof functionTerminals>[0], ...ids: string[]) => functionTerminals(kind).map((terminal) => (ids.includes(terminal.id) ? { ...terminal, used: false } : terminal));
  assert.deepEqual(terminalProblems("rela", without("rela", "12")), [], "a relay with only its NO contact");
  assert.match(terminalProblems("rela", without("rela", "A1")).join(" "), /A1 går inte att ta bort. Krävs för matningen/);
  assert.match(terminalProblems("rela", without("rela", "11")).join(" "), /Minst en kontakt behöver båda sina plintar/);
  assert.match(terminalProblems("knapp", without("knapp", "2")).join(" "), /13 och 14/);
  assert.match(terminalProblems("rela", functionTerminals("rela").slice(1)).join(" "), /funktionens plintar.*saknas: A1/);
  assert.match(terminalProblems("rela", [...functionTerminals("rela"), extra("e1", "")]).join(" "), /behöver en märkning/);
  assert.match(terminalProblems("rela", [...functionTerminals("rela"), extra("e1", "X", { joins: "e9" })]).join(" "), /kopplad till en plint som inte finns/);
  assert.match(terminalProblems("rela", [...without("rela", "12"), extra("e1", "X", { joins: "12" })]).join(" "), /kopplad till en plint som inte finns/, "not to one out of use");
  assert.match(terminalProblems("rela", [...functionTerminals("rela"), extra("x9", "X")]).join(" "), /e1–e16/);
  assert.match(terminalProblems("rela", [...functionTerminals("rela"), ...Array.from({ length: 9 }, (_, index) => extra(`e${index + 1}`, `T${index}`))]).join(" "), /Högst 10 plintar på översidan/);
  const result = validateDesign("rela", rela({ terminals: [...without("rela", "12"), extra("e1", "A2", { joins: "A2", role: null })] }));
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.design.terminals.find((terminal) => terminal.id === "e1")!.role : "", "wire", "an extra terminal always has a kind");
  assert.equal(validateDesign("rela", rela({ terminals: without("rela", "A2") })).ok, false, "saving is refused with the reason");
});

test("the simulator draws only the terminals in use, adds the extras and joins a linked extra to its terminal", () => {
  const design = rela({ terminals: [...functionTerminals("rela").map((terminal) => (terminal.id === "12" ? { ...terminal, used: false } : terminal)), extra("e1", "A2", { joins: "A2" }), extra("e2", "PE", { side: "bottom" })] });
  setPublishedDesigns([{ key: "rela", design }]);
  const placed = { id: "R1", kind: "rela" as const, x: 0, y: 0, label: "", options: {} };
  assert.deepEqual(designedDef(placed).terminals.map((terminal) => terminal.id), ["A1", "A2", "11", "14", "e1", "e2"]);
  assert.equal(designedDef(placed).terminals.find((terminal) => terminal.id === "e1")!.title, "A2, förbunden med A2");
  assert.deepEqual(designedJoins(placed), [["e1", "A2"]]);
  assert.equal(deviceTerminalPoint(placed, "12"), null, "a terminal out of use has no place");
  assert.deepEqual(designedDef(placed).elements, DEVICE_DEFS.rela.elements, "the behaviour is the function's");
  setPublishedDesigns([]);
  assert.deepEqual(designedJoins(placed), []);
});

test("the picture is a layer: replaced by an own picture, back to the standard with null, the plate and terminals kept", () => {
  const terminals = [...functionTerminals("rela"), extra("e1", "PE")];
  const own = validateDesign("rela", rela({ terminals, image: { format: "svg", data: svg('<rect width="10" height="10"/>') } }));
  assert.equal(own.ok, true);
  const back = validateDesign("rela", { ...(own.ok ? own.design : rela()), image: null });
  assert.equal(back.ok, true);
  assert.equal(back.ok ? back.design.image : "x", null, "no own picture: the function's standard picture");
  assert.deepEqual(back.ok ? back.design.terminals : [], own.ok ? own.design.terminals : [null], "the terminals stay when the picture changes");
  const placed = { kind: "rela" as const, options: {} };
  assert.equal(designedDef(placed, own.ok ? own.design : null).width, designedDef(placed, back.ok ? back.design : null).width, "and so does the plate");
});

test("a sound is a layer too: the standard by function, an own file checked, silent possible", () => {
  const wav = { format: "wav" as const, data: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" };
  const cleaned = cleanSound(wav);
  assert.equal(cleaned.ok, true);
  assert.doesNotMatch(cleaned.ok ? cleaned.sound.data : "data:", /^data:/);
  assert.equal(cleanSound({ format: "mp3", data: wav.data }).ok, false, "a WAV is not an MP3");
  assert.equal(cleanSound({ format: "ogg", data: "PHNjcmlwdD4=" }).ok, false);
  assert.equal(cleanSound({ format: "wav", data: `UklGR${"A".repeat(500_000)}` }).ok, false, "too large");
  const placed = { kind: "kontaktor" as const, options: {} };
  assert.deepEqual(designedSound(placed, null), { sound: "contactor", own: null });
  assert.deepEqual(designedSound({ kind: "lampa", options: {} }, null), { sound: null, own: null }, "a lamp is silent");
  const kontaktor = { ...standardDesign("kontaktor"), sound: cleaned.ok ? cleaned.sound : null };
  assert.equal(designedSound(placed, kontaktor).own?.format, "wav");
  assert.deepEqual(designedSound(placed, { ...kontaktor, silent: true }), { sound: null, own: null });
  assert.equal(designedSound({ kind: "lampa", options: {} }, { ...standardDesign("lampa"), sound: kontaktor.sound }).sound, "relay", "a silent function given a file clicks when energised");
  assert.equal(validateDesign("kontaktor", { ...kontaktor, sound: { format: "wav", data: "R0lGOD" } }).ok, false, "a design's sound is checked");
});

test("Exportera alla and Importera: every device with picture and sound in one versioned file, version 1 still read", () => {
  const all = DEVICE_KINDS.map((kind) => ({ key: kind as string, design: standardDesign(kind) }));
  all[0] = { key: "knapp", design: knapp({ image: { format: "svg", data: svg('<circle r="4"/>') } }) };
  all.push({ key: "egen-rela0001", design: rela({ name: "Relä 2", label: "Relä 2", terminals: [...functionTerminals("rela"), extra("e1", "A2", { joins: "A2" })], sound: { format: "wav", data: "UklGRiQAAABXQVZF" } }) });
  const file = exportDevices(all);
  assert.equal(file.version, DEVICE_FILE_VERSION);
  assert.equal(DEVICE_FILE_VERSION, 4);
  const back = parseDeviceFile(JSON.stringify(file));
  assert.equal(back.ok, true, back.ok ? "" : back.errors.join(" | "));
  assert.equal(back.ok ? back.devices.length : 0, DEVICE_KINDS.length + 1);
  assert.deepEqual(back.ok ? back.devices.map((device) => device.design) : [], all.map((device) => device.design), "round trip, pictures and sounds included");

  const v1 = { format: DEVICE_FILE_FORMAT, version: 1, devices: [{ key: "knapp", name: "Start", label: "Start", group: "industri", function: "knapp", terminals: [{ id: "1", side: "top" }, { id: "2", side: "bottom", at: 0.5 }] }] };
  const old = parseDeviceFile(JSON.stringify(v1));
  assert.equal(old.ok, true, "a version 1 file is still read");
  assert.deepEqual(old.ok ? old.devices[0]!.design.terminals.map((terminal) => [terminal.id, terminal.used, terminal.joins]) : [], [["1", true, null], ["2", true, null]]);
  const v1extra = parseDeviceFile(JSON.stringify({ ...v1, devices: [{ ...v1.devices[0], terminals: [...v1.devices[0]!.terminals, { id: "e1", name: "PE", side: "top" }] }] }));
  assert.match(v1extra.ok ? "" : v1extra.errors.join(" "), /finns först i version 2/);

  const parts = splitForImport(back.ok ? back.devices : [], 4000);
  assert.ok(parts.length > 1, "a large import goes in parts");
  assert.deepEqual(parts.flatMap((part) => part.indexes), [...Array(DEVICE_KINDS.length + 1).keys()], "every device once, in order");
  for (const part of parts) {
    const read = parseDeviceFile(part.text);
    assert.equal(read.ok, true);
    assert.deepEqual(read.ok ? read.devices.map((device) => device.key) : [], part.indexes.map((index) => all[index]!.key));
  }
  assert.ok(IMPORT_PART_BYTES < 2_000_000, "a part fits a request");
});

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// PLC-simulatorn (2026-11-02, the desktop 2026-11-04): what the page's source must never do. The simulator is an outside device
// towards the intake: no session on those calls, nothing of the key anywhere but the closure, no place in the menu. One file only may
// speak to Workflow with the signed-in session (desktop/connection-api.ts: Generera koppling automatiskt), and only to the same
// route the Maskiner page uses.

const FOLDER = "features/plc-simulator";
const walk = (folder: string, root = folder): { name: string; text: string }[] => readdirSync(folder).flatMap((entry) => {
  const path = join(folder, entry);
  return statSync(path).isDirectory() ? walk(path, root) : [{ name: path.slice(root.length + 1).split("\\").join("/"), text: readFileSync(path, "utf8") }];
});
const files = walk(FOLDER);
const SESSION_FILE = "desktop/connection-api.ts";
/** What saves in the browser: the drawing, the small preferences, the dock's layout. */
const SAVERS = ["surface/use-runtime.ts", "surface/surface-preferences.ts", "desktop/layout-store.ts"];
const page = readFileSync("app/plc-simulator/page.tsx", "utf8");

test("the intake is the page's way to the server; only the connection file uses the session, and only on the machines route", () => {
  for (const { name, text } of files) {
    if (name !== SESSION_FILE) assert.doesNotMatch(text, /features\/kfid\/api|\/api\/(?!ingest\/v1)|from "@ee|@\/ee\//, name);
    assert.doesNotMatch(text, /\bfetch\(/, `${name}: a call goes through the device's transport`);
    assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(/, `${name}: never a native dialog`);
    assert.doesNotMatch(text, /console\.(log|info|warn|error)/, `${name}: nothing to the console`);
  }
  const device = readFileSync("lib/machine/simulator/device.ts", "utf8");
  assert.match(device, /credentials: "omit"/, "no session cookie goes along to the intake");
  assert.match(device, /EVENTS_PATH = "\/api\/ingest\/v1\/events"/);
  assert.doesNotMatch(device, /api\/ingest\/v1\/raw/);
});

test("the key stays in the closure", () => {
  const store = files.find((file) => file.name === "use-simulator.ts")!.text;
  const snapshotType = store.slice(store.indexOf("export type SimSnapshot"), store.indexOf("function createSimulator"));
  assert.match(snapshotType, /hasKey: boolean/);
  assert.doesNotMatch(snapshotType, /\bkey:/, "the snapshot says only whether there is one");
  for (const { name, text } of files) {
    if (!SAVERS.includes(name)) assert.doesNotMatch(text, /localStorage|sessionStorage|document\.cookie/, `${name}: only the listed files save`);
  }
  const preferences = files.find((file) => file.name === "surface/surface-preferences.ts")!.text;
  assert.equal([...preferences.matchAll(/localStorage\.setItem/g)].length, 1, "one place saves a preference");
  assert.match(preferences, /if \(!PLAIN\.test\(value\) \|\| holdsKeyForm\(value\)\) return;\s*try \{ window\.localStorage\.setItem\(KEYS\[key\], value\)/);
  assert.match(preferences, /const PLAIN = \/\^\[A-Za-z0-9.,:-\]\{1,80\}\$\//, "a value is a word or a few numbers");
  const layoutStore = files.find((file) => file.name === "desktop/layout-store.ts")!.text;
  assert.match(layoutStore, /holdsKeyForm\(text\)\) return;\s*try \{ window\.localStorage\.setItem\(LAYOUT_STORAGE_KEY, text\)/, "the layout behind the same guard");
  const runtime = files.find((file) => file.name === "surface/use-runtime.ts")!.text;
  assert.match(runtime, /if \(holdsKeyForm\(text\)\) return;\s*try \{ window\.localStorage\.setItem\(SURFACE_STORAGE_KEY, text\)/);
  assert.equal([...runtime.matchAll(/localStorage\.setItem/g)].length, 1, "one place saves the drawing");
  assert.doesNotMatch(runtime, /pasteKey|getKey|hwf_mch/, "the runtime never touches the key; it only asks the simulator to send");
});

test("the page guards as the machine sources do, and is not in the menu", () => {
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /await context\(\)/);
  assert.match(page, /<NoPermission page \/>/);
  assert.match(page, /storageMode !== "HINTEK_CLOUD"/);
  assert.match(page, /returnTo=/);
  assert.doesNotMatch(page, /upkeepOn \?/, "module off still opens the page");
  assert.doesNotMatch(readFileSync("lib/workflow/navigation.ts", "utf8"), /plc-simulator/);
  assert.doesNotMatch(readFileSync("components/app-shell.tsx", "utf8"), /plc-simulator/);
});

test("the button opens a window that cannot touch the app, and brings nothing of the simulator along", () => {
  const button = readFileSync("features/integrations/machine-simulator-button.tsx", "utf8");
  assert.match(button, /"noopener,popup,width=1360,height=900"/);
  assert.match(button, /rel="noopener"/);
  assert.doesNotMatch(button, /plc-simulator\/|lib\/machine\/simulator/);
  assert.match(readFileSync("features/integrations/machine-sources.tsx", "utf8"), /<MachineSimulatorButton \/>/);
});

test("the Avancerat level and what only it used are gone", () => {
  for (const gone of ["features/plc-simulator/machine-panel.tsx", "features/plc-simulator/scenario-tab.tsx", "features/plc-simulator/raw-tab.tsx", "features/plc-simulator/tag-table.tsx", "lib/machine/simulator/engine.ts", "lib/machine/simulator/scenarios.ts", "lib/machine/simulator/live.ts", "lib/machine/simulator/presets.ts", "tests/plc-simulator.browser.cjs", "tests/plc-simulator.integration.ts"]) assert.ok(!existsSync(gone), gone);
  for (const { name, text } of files) assert.doesNotMatch(text, /\bAvancerat\b|plc-level|fonster=program|Grundläggande/, name);
  assert.doesNotMatch(page, /fonster|PlcProgramWindow/);
});

test("no maker's name or a family's instruction names in the simulator's source", () => {
  const ladder = walk("lib/machine/simulator/ladder");
  for (const { name, text } of [...files, ...ladder]) {
    assert.doesNotMatch(text, /\b(Siemens|Allen[- ]?Bradley|Rockwell|Studio ?5000|RSLogix|Schneider|Beckhoff|TwinCAT|Omron|Mitsubishi|Codesys|TIA Portal)\b/i, name);
    assert.doesNotMatch(text, /\b(XIC|XIO|OTE|OTL|OTU|ONS|RTO|GRT|LES|GEQ|LEQ|NEQ|EQU)\b/, name);
  }
});

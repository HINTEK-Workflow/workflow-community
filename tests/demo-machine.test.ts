import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { alarmOrderText, SYSTEM_CREATOR } from "../lib/machine/alarm-rules";
import { createEventFactory } from "../lib/machine/simulator/events";
import { parseEvent } from "../lib/machine/intake";
import { validateLayout } from "../lib/machine/simulator/surface/layout";
import { compileProgram } from "../lib/machine/simulator/st/interpreter";
import { createDemoDatabase } from "../features/demo/demo-data";
import { DEMO_ALARM_CODE, DEMO_ALARM_DEVICE, DEMO_MACHINE, demoMachineLayout, phoneAlarmEvent } from "../features/demo/machine/example";
import { alarmCode } from "../lib/machine/simulator/surface/engine";
import { considerDemoAlarm, DEMO_FAULT_CREATOR, demoMachineNotices, finishDemoOrder, makeDemoFaultOrder, skipDemoRest } from "../features/demo/machine/orders";
import { basisText, candidateSentence, createObserver, describedEnough, EMPTY_DESCRIPTION, type Finished, type MachineDescription, NO_DESCRIPTION_TEXT, observe, type Observer, OPERATOR_AI_NOTE, operatorAdvice, READY_DESCRIPTION, SETTLE_MS, type TaughtCause, teach } from "../features/demo/machine/rules";
import { faultOrderText } from "../lib/operator/rules";

// Demokopplingen (2026-11-04): the rules that simulate a future local AI, what they send, and that none of it reaches a real company.

type Run = { state: Observer; finished: Finished[]; log: string[] };
const start = (): Run => ({ state: createObserver(), finished: [], log: [] });
const read = (run: Run, description: MachineDescription, taught: readonly TaughtCause[], atMs: number, values: Record<string, boolean>) => {
  const result = observe(run.state, description, taught, { atMs, values });
  run.state = result.state;
  run.finished.push(...result.finished);
  run.log.push(...result.log.map((line) => line.text));
};
const press = (run: Run, description: MachineDescription, taught: readonly TaughtCause[], atMs: number) => {
  read(run, description, taught, atMs, { DI0: true });
  read(run, description, taught, atMs + 200, { DI0: false });
};
const pressTimes = (run: Run, description: MachineDescription, taught: readonly TaughtCause[], times: number) => {
  for (let index = 0; index < times; index += 1) press(run, description, taught, 1000 + index * 400);
  read(run, description, taught, 1000 + times * 400 + SETTLE_MS, { DI0: false });
};
const runFan = (run: Run, description: MachineDescription, taught: readonly TaughtCause[], seconds: number) => {
  read(run, description, taught, 1000, { DO0: true });
  read(run, description, taught, 1000 + seconds * 1000, { DO0: false });
};

test("one press only notes what is normal; ten presses become one alarm with the count and suggestions", () => {
  const one = start();
  pressTimes(one, READY_DESCRIPTION, [], 1);
  assert.equal(one.finished.length, 0, "one press is no alarm");
  assert.match(one.log.join("\n"), /Startknappen \(DI0\) till, 1 gång på 2 min\. Det är normalt\./);

  const ten = start();
  pressTimes(ten, READY_DESCRIPTION, [], 10);
  assert.equal(ten.finished.length, 1, "the flurry is one alarm, not one per press");
  const [alarm] = ten.finished;
  assert.match(alarm.text, /^Startknappen \(DI0\) gick till 10 gånger på \d+ s, normalt högst 5 på 2 min$/);
  assert.equal(alarm.candidates[0].origin, "described", "what the description names comes first");
  assert.equal(alarm.candidates[0].text, "Fläkten verkar inte starta, så någon försöker igen");
  assert.ok(alarm.candidates.some((item) => item.origin === "generic"), "general assumptions are there, and marked as such");
  assert.deepEqual(alarm.candidates.map((item) => item.origin), [...alarm.candidates.map((item) => item.origin)].sort((a, b) => ["taught", "described", "generic"].indexOf(a) - ["taught", "described", "generic"].indexOf(b)));
});

test("a fan that stops early gives the text from the fields; a full run gives none", () => {
  const early = start();
  runFan(early, READY_DESCRIPTION, [], 20);
  assert.equal(early.finished.length, 1);
  assert.equal(early.finished[0].text, "Fläkten stannade efter 20 s, förväntat 60 s");
  assert.deepEqual(early.finished[0].observed, ["DO0 gick 20 s."]);
  const full = start();
  runFan(full, READY_DESCRIPTION, [], 60);
  assert.equal(full.finished.length, 0);
  assert.match(full.log.join("\n"), /gick 60 s, som förväntat/);
});

test("a fault signal just before the stop is named as a suggestion and in the basis", () => {
  const run = start();
  read(run, READY_DESCRIPTION, [], 1000, { DO0: true, DI1: false });
  read(run, READY_DESCRIPTION, [], 21_000, { DO0: false, DI1: true });
  assert.equal(run.finished.length, 1, "the stop is the alarm, not the protection as well");
  assert.equal(run.finished[0].candidates[0].text, "Motorskyddet (DI1) gick till precis före stoppet");
  assert.match(run.finished[0].mapping.join(" "), /DI1 = Motorskyddet/);
});

test("no description means no alarm text and no suggestion, whatever happens", () => {
  assert.equal(describedEnough(EMPTY_DESCRIPTION), false);
  assert.equal(describedEnough({ text: "En fläkt", rows: [] }), false, "the text alone is not enough");
  assert.equal(describedEnough({ text: "", rows: READY_DESCRIPTION.rows }), false, "the table alone is not enough");
  const run = start();
  pressTimes(run, EMPTY_DESCRIPTION, [], 10);
  runFan(run, EMPTY_DESCRIPTION, [], 20);
  assert.equal(run.finished.length, 0);
  assert.match(run.log[0], /Ingen beskrivning, så inget förslag/);
});

test("changing the fields changes the text, and the free text changes nothing", () => {
  const edited: MachineDescription = { ...READY_DESCRIPTION, rows: READY_DESCRIPTION.rows.map((row) => row.signal === "DO0" ? { ...row, function: "Pumpen", expectedS: 90 } : row) };
  const run = start();
  runFan(run, edited, [], 20);
  assert.equal(run.finished[0].text, "Pumpen stannade efter 20 s, förväntat 90 s");
  const longer = start();
  runFan(longer, { ...READY_DESCRIPTION, rows: READY_DESCRIPTION.rows.map((row) => row.signal === "DO0" ? { ...row, expectedS: 30 } : row) }, [], 60);
  assert.equal(longer.finished[0].text, "Fläkten gick 60 s, förväntat 30 s");
  const free = start();
  runFan(free, { ...READY_DESCRIPTION, text: "Motorn är en pump. Allt annat står här. 999 sekunder." }, [], 20);
  assert.equal(free.finished[0].text, "Fläkten stannade efter 20 s, förväntat 60 s", "the free text is shown, never read");
});

test("a taught cause comes first next time, marked; the same words count up; removed, it is gone", () => {
  const first = start();
  pressTimes(first, READY_DESCRIPTION, [], 10);
  const { pattern, patternLabel } = first.finished[0];
  let taught = teach([], { pattern, patternLabel, cause: "Glapp i givaren", id: "a", at: 1 });
  const second = start();
  pressTimes(second, READY_DESCRIPTION, taught, 10);
  assert.deepEqual(second.finished[0].candidates[0], { text: "Glapp i givaren", origin: "taught" });
  assert.match(candidateSentence(second.finished[0].candidates), /^Kan bero på: Glapp i givaren \(från ett tidigare fel\) eller /);
  taught = teach(taught, { pattern, patternLabel, cause: "Trasig knapp", id: "b", at: 2 });
  taught = teach(taught, { pattern, patternLabel, cause: "trasig knapp", id: "c", at: 3 });
  assert.equal(taught.length, 2, "the same words are one line");
  assert.equal(taught.find((item) => item.id === "b")?.times, 2);
  const third = start();
  pressTimes(third, READY_DESCRIPTION, taught, 10);
  assert.equal(third.finished[0].candidates[0].text, "Trasig knapp", "the most taught first");
  // Another signal's fault does not borrow it.
  const other = start();
  runFan(other, READY_DESCRIPTION, taught, 20);
  assert.ok(!other.finished[0].candidates.some((item) => item.origin === "taught"));
  const after = start();
  pressTimes(after, READY_DESCRIPTION, [], 10);
  assert.ok(!after.finished[0].candidates.some((item) => item.origin === "taught"), "removed from the list, gone from the text");
});

test("what is sent passes the product's own intake check, within its limits", () => {
  const run = start();
  pressTimes(run, READY_DESCRIPTION, [], 10);
  const finished = run.finished[0];
  const factory = createEventFactory("demo-test", { textPrefix: true, maxSeverity: "critical" });
  const now = Date.now();
  const alarm = factory.make({ type: "alarm", code: finished.code, severity: "fault", state: "raised", text: finished.text }, now);
  const diagnosis = factory.make({ type: "diagnosis", code: finished.code, severity: "info", text: candidateSentence(finished.candidates), basis: basisText(finished) }, now);
  for (const wire of [alarm, diagnosis]) assert.equal(parseEvent(wire, new Date(now)).ok, true, wire.type);
  assert.ok(alarm.text?.startsWith("Simulerat: "), "marked as every simulated text is");
});

test("the ready machine is a valid drawing and program, and not in the simulator's own list", () => {
  const layout = demoMachineLayout();
  const checked = validateLayout(layout);
  assert.equal(checked.ok, true, checked.ok ? "" : checked.reason);
  assert.equal(compileProgram(layout.program).ok, true);
  assert.ok(layout.devices.some((device) => device.id === DEMO_MACHINE.start));
  assert.ok(layout.devices.some((device) => device.id === DEMO_MACHINE.protection));
  assert.doesNotMatch(readFileSync("lib/machine/simulator/surface/examples.ts", "utf8"), /demokoppling|features\/demo/i);
});

const SOURCE = { id: "demo-source-demokoppling", name: "Demokoppling", alarmMode: "direct" as const, cooldownMinutes: 1 };
const alarm = (now: Date, text = "Simulerat: Fläkten stannade efter 20 s, förväntat 60 s", severity = "fault", state: string | null = "raised") => ({ type: "alarm", code: "AI-DO0", severity, state, text, occurredAt: now });

test("an alarm becomes a marked work order by the product's rules: the same text, one open order, a rest, levels and mode", () => {
  const db = createDemoDatabase();
  const before = db.tasks.length;
  const t0 = new Date("2026-11-04T10:00:00Z");
  const diagnosis = { pattern: "stop:DO0", patternLabel: "Fläkten (DO0) stannar för tidigt", observed: ["DO0 gick 20 s."], mapping: ["DO0 = Fläkten: går 60 s"], candidates: [{ text: "Glapp", origin: "taught" as const }] };
  const made = considerDemoAlarm(db, SOURCE, alarm(t0), diagnosis, t0);
  assert.equal(made.kind, "created");
  assert.equal(db.tasks.length, before + 1);
  const task = db.tasks[0];
  const real = alarmOrderText({ sourceName: "Demokoppling", code: "AI-DO0", severity: "fault", text: alarm(t0).text, occurredAt: t0 });
  assert.equal(task.title, real.title, "the product's own title");
  assert.ok(task.description.startsWith(real.description), "the product's own description first");
  assert.match(task.description, /Simulering av framtida AI\. Underlag: DO0 gick 20 s\./);
  assert.match(task.description, /1\. Glapp \(från ett tidigare fel\)/);
  assert.match(task.description, /En människa beslutar/);
  assert.equal(task.createdBy, SYSTEM_CREATOR, "marked as made by a machine alarm");
  assert.equal(task.status, "PLANNED");
  assert.equal(task.assignedToUserId, null);
  const notices = demoMachineNotices(db, true);
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /^Larm från Demokoppling: Fläkten stannade.*Arbetsorder skapad[.]$/);
  assert.equal(notices[0].label, "Simulerat");

  const again = considerDemoAlarm(db, SOURCE, alarm(new Date(t0.getTime() + 5000)), null, new Date(t0.getTime() + 5000));
  assert.deepEqual(again.kind === "skipped" && again.reason, "open_order", "one open order per source");
  assert.equal(db.tasks.length, before + 1);
  const later = new Date(t0.getTime() + 120_000);
  assert.deepEqual(((result) => result.kind === "skipped" && result.reason)(considerDemoAlarm(db, SOURCE, alarm(later), null, later)), "open_order", "still open after the rest");

  const t1 = new Date(t0.getTime() + 121_000);
  finishDemoOrder(db, task.id, t1);
  assert.equal(demoMachineNotices(db, true).length, 0, "a finished order has no notice");
  assert.equal(considerDemoAlarm(db, SOURCE, alarm(t1), null, t1).kind, "created", "finished and rested: a new one");
  const t2 = new Date(t1.getTime() + 1000);
  finishDemoOrder(db, db.tasks[0].id, t2);
  const rest = considerDemoAlarm(db, SOURCE, alarm(t2), null, t2);
  assert.equal(rest.kind === "skipped" && rest.reason, "cooldown", "the rest counts after a finished order");
  skipDemoRest(db, t2);
  assert.equal(considerDemoAlarm(db, SOURCE, alarm(new Date(t2.getTime() + 1)), null, new Date(t2.getTime() + 1)).kind, "created", "the demo's shortcut past the rest");

  const quiet = createDemoDatabase();
  assert.equal(considerDemoAlarm(quiet, SOURCE, alarm(t0, "Bara en varning", "warning"), null, t0).kind, "none", "a warning makes no order");
  assert.equal(considerDemoAlarm(quiet, SOURCE, alarm(t0, "Släckt", "fault", "cleared"), null, t0).kind, "none", "a cleared alarm makes no order");
  const off = considerDemoAlarm(quiet, { ...SOURCE, alarmMode: "off" }, alarm(t0), null, t0);
  assert.equal(off.kind === "skipped" && off.reason, "mode_off");
});

// ---------- It can never run outside the demo ----------

const walk = (folder: string): string[] => readdirSync(folder).flatMap((entry) => {
  const path = join(folder, entry);
  return statSync(path).isDirectory() ? (entry === "node_modules" ? [] : walk(path)) : [path];
});
const imports = /features\/demo\/machine|demo\/machine\/|from "\.\/machine\//;

test("the product never reaches the simulated AI: only the demo's own files and the demo-gated simulator page import it", () => {
  const allowed = new Set(["features/demo/demo-app.tsx", "features/demo/demo-page.tsx", "features/demo/demo-backend.ts", "features/demo/demo-connections.ts", "features/plc-simulator/plc-simulator.tsx", "features/plc-simulator/desktop/connection-panel.tsx", "features/operator/demo-operator-app.tsx"]);
  for (const folder of ["app", "components", "features", "lib", "ee", "proxy.ts"]) {
    if (!existsSync(folder)) continue;
    for (const file of statSync(folder).isDirectory() ? walk(folder) : [folder]) {
      const name = file.split("\\").join("/");
      if (name.startsWith("features/demo/machine/") || !/\.(ts|tsx)$/.test(name)) continue;
      if (imports.test(readFileSync(file, "utf8"))) assert.ok(allowed.has(name), `${name} imports the demo's simulated AI`);
    }
  }
  for (const file of walk("lib/machine").concat(walk("app/api/ingest"))) assert.doesNotMatch(readFileSync(file, "utf8"), /features\/demo|setDemoSink|adoptTemporary/, `${file}: the intake and machine rules know nothing of the demo`);
});

test("the simulator's page opens the demo's link only behind the demo cookie, and real Maskinkoppling is the old panel", () => {
  const page = readFileSync("app/plc-simulator/page.tsx", "utf8");
  const demoBranch = page.slice(page.indexOf("DEMO_COOKIE)?.value === \"1\""), page.indexOf("const ctx = await context()"));
  assert.match(demoBranch, /<PlcSimulator demo demoExample=/);
  assert.equal([...page.matchAll(/demoExample/g)].length, 1, "the address is read only in the demo's branch");
  assert.match(page.slice(page.indexOf("const ctx = await context()")), /return <PlcSimulator upkeepOn=\{organizationModuleOn\(ctx\.organization, "upkeep"\)\} theme=\{preferences\.theme\} textScale=\{Number\(preferences\.textScale\)\} designs=\{await publishedDeviceDesigns\(\)\} \/>;/, "the real page passes no demo prop (the device designs are product content, the same for all)");
  const simulator = readFileSync("features/plc-simulator/plc-simulator.tsx", "utf8");
  assert.match(simulator, /\{demo \? <DemoMachineLink example=\{demoExample\} wf=\{demoWindow\} \/> : null\}/);
  const panel = readFileSync("features/plc-simulator/desktop/connection-panel.tsx", "utf8");
  assert.match(panel, /if \(demo\) return <DemoConnectionPanel \/>;\s*return <LiveConnectionPanel \/>;/);
  const sim = readFileSync("features/plc-simulator/use-simulator.ts", "utf8");
  assert.match(sim, /let demoSink[^\n]*= null;/, "without the demo's link the sink is never set");
  const setters = walk("features").concat(walk("lib"), walk("app")).filter((file) => /\.(ts|tsx)$/.test(file) && /setDemoSink\(/.test(readFileSync(file, "utf8"))).map((file) => file.split("\\").join("/")).sort();
  assert.deepEqual(setters, ["features/demo/machine/link.ts", "features/plc-simulator/use-simulator.ts"]);
  const hub = readFileSync("features/demo/machine/hub.ts", "utf8");
  assert.match(hub, /if \(!\(window as typeof window & \{ __workflowDemo\?: boolean \}\)\.__workflowDemo\) return;/, "the hub starts only where the demo's backend is installed");
  const app = readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(app, /machine\/|prova/, "the real page knows nothing of the demo's address");
});

test("the three big buttons live on the Demo page, and real companies never see them", () => {
  // 2026-11-05: on a page of their own, so Översikt looks as in a real company.
  const users = walk("app").concat(walk("features"), walk("components"), walk("lib")).filter((file) => /\.(ts|tsx)$/.test(file) && /DemoStartCard|DEMO_START_ITEMS/.test(readFileSync(file, "utf8"))).map((file) => file.split("\\").join("/")).sort();
  assert.deepEqual(users, ["features/demo/demo-page.tsx", "features/demo/machine/start-card.tsx", "lib/demo.ts"]);
  const app = readFileSync("features/demo/demo-app.tsx", "utf8");
  assert.match(app, /view === "demo" \? <><DemoBellFeed resetKey=\{userId\} \/><DemoPage /);
  assert.doesNotMatch(app, /underHeading/, "nothing of the demo above Översikt");
  assert.doesNotMatch(readFileSync("components/app-shell.tsx", "utf8"), /DemoStart|demo-start/);
  assert.doesNotMatch(readFileSync("features/kfid/workspace.tsx", "utf8"), /DemoStart|demo-start|demo\/machine/);
  // DemoApp is drawn only behind the demo cookie.
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /if \(params\.view && \(await cookies\(\)\)\.get\(DEMO_COOKIE\)\?\.value === "1"\) \{[\s\S]{0,800}return <DemoApp /);
  assert.equal([...page.matchAll(/<DemoApp /g)].length, 1);
});

test("the operator page's real path is the same: the demo's terminal only under the demo's own address, and the page itself unchanged", () => {
  const route = readFileSync("app/operator/[key]/page.tsx", "utf8");
  assert.match(route, /if \(key === OPERATOR_DEMO_KEY\) return <DemoOperatorApp machine=\{machine\} niva=\{niva\} connected=\{search\.demokoppling === "1"\} \/>;/);
  assert.equal([...route.matchAll(/demokoppling/g)].length, 2, "read only in the demo's branch, and in its type");
  assert.doesNotMatch(readFileSync("features/operator/operator-app.tsx", "utf8") + readFileSync("features/operator/report-view.tsx", "utf8"), /demokoppling|demo\/machine/i);
  assert.match(readFileSync("lib/operator/maintenance-adapter.ts", "utf8"), new RegExp(`FAULT_CREATOR = "${DEMO_FAULT_CREATOR}"`), "the demo's order has the product's mark");
});

test("the terminal's suggestion uses the machine, the signals and taught causes, never the operator's words; a report gets the product's own text", () => {
  assert.deepEqual(operatorAdvice({ description: EMPTY_DESCRIPTION, taught: [], recentAlarms: ["Larm"], cause: "Stannar" }).map((item) => item.text), [NO_DESCRIPTION_TEXT]);
  const taught = teach([], { pattern: "stop:DO0", patternLabel: "Fläkten (DO0) stannar för tidigt", cause: "Remmen slirar", id: "a", at: 2 });
  const both = teach(taught, { pattern: "press:DI0", patternLabel: "Startknappen (DI0) går till ovanligt ofta", cause: "Glapp i givaren", id: "b", at: 3 });
  const advice = operatorAdvice({ description: READY_DESCRIPTION, taught: both, recentAlarms: ["Fläkten stannade efter 20 s, förväntat 60 s"], cause: "Stannar" });
  assert.equal(advice[0].text, "Remmen slirar", "a plain word in common with the chosen cause lifts it");
  assert.match(advice[0].basis, /från ett tidigare fel/);
  assert.ok(advice.some((item) => item.text === "Senast observerat: Fläkten stannade efter 20 s, förväntat 60 s"));
  assert.ok(advice.some((item) => item.text === "Stannade fläkten innan de 60 sekunderna gått?"));
  assert.ok(advice.some((item) => item.text === "Kontrollera motorskyddet (DI1)"));
  assert.match(OPERATOR_AI_NOTE, /Simulering av framtida AI.*En människa beslutar.*visas men tolkas inte/);
  assert.doesNotMatch(operatorAdvice.toString(), /\bdraft\b|\.text\.includes/);

  const db = createDemoDatabase();
  const now = new Date("2026-11-04T10:00:00Z");
  const report = { id: "r-1", machineId: "m-flakt-f1", machineLabel: "Fläkt F1", cause: "Stannar", text: "Fläkten låter konstigt", severity: "ACUTE" as const, reporter: "", accountName: "Terminal", label: "AO-1070", onCall: true };
  const task = makeDemoFaultOrder(db, report, "Simulerat: Fläkt F1, motorskydd", null, now);
  const real = faultOrderText({ machineLabel: "Fläkt F1", cause: "Stannar", text: "Fläkten låter konstigt", severity: "ACUTE", reporter: "", accountName: "Terminal", label: "AO-1070" });
  assert.equal(task.title, real.title);
  assert.ok(task.description.startsWith(real.description));
  assert.match(task.description, /Vad hände: Fläkten låter konstigt/);
  assert.match(task.description, /senaste larm från PLC:n: Simulerat: Fläkt F1, motorskydd/);
  assert.match(task.description, /simulerat: inget meddelande lämnar webbläsaren/);
  assert.equal(task.createdBy, DEMO_FAULT_CREATOR);
  assert.match(demoMachineNotices(db, true)[0].title, /simulerad jour/);
});

test("nothing of it leaves the browser or stays in it: no call, no storage, no AI, no new counter", () => {
  for (const file of walk("features/demo/machine")) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\/api\//, `${file}: no network`);
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie/, `${file}: nothing stored`);
    assert.doesNotMatch(text, /sendDemoEvent|openai|anthropic/i, `${file}: no counter of its own, and no AI`);
  }
});

test("honest words: future tense in the docs, marked on the page, no maker's or standard's names", { skip: !existsSync("docs/drift/MASKININTAG.md") && "docs/ is not part of the Community edition" }, () => {
  const page = readFileSync("features/demo/machine/machine-page.tsx", "utf8");
  assert.match(page, /SIMULATION_MARK/);
  assert.match(page, /HUMAN_DECIDES_TEXT/);
  assert.match(page, /ALARM_SAFETY_TEXT/);
  const rules = readFileSync("features/demo/machine/rules.ts", "utf8");
  assert.match(rules, /SIMULATION_MARK = "Simulering av framtida AI"/);
  assert.doesNotMatch(rules, /finns inte i produkten i dag/, "a short mark, no long disclaimer (2026-11-05)");
  assert.doesNotMatch(rules + readFileSync("features/demo/machine/example.ts", "utf8"), /\b(Siemens|ABB|Schneider|Allen|Beckhoff|Omron|IEC|EN \d|SS \d|ISO \d)\b/);
  assert.match(readFileSync("docs/drift/MASKININTAG.md", "utf8"), /Riktning[^\n]*lokal AI|lokal AI[^\n]*Riktning/i);
  assert.match(readFileSync("docs/beslut/atkomst-och-data.md", "utf8"), /Prova maskinkopplingen/);
});

test("a phone's alarm is the simulator's own: the same code and marked text, taken by the intake, and it makes a work order", () => {
  assert.equal(alarmCode(DEMO_ALARM_DEVICE), DEMO_ALARM_CODE);
  const layout = demoMachineLayout();
  assert.ok(layout.devices.some((device) => device.id === DEMO_ALARM_DEVICE && device.label === DEMO_MACHINE.alarmText));
  const now = new Date("2026-11-16T10:00:00Z");
  const wire = phoneAlarmEvent("telefon-1", now);
  assert.match(wire.eventId, /^plcsim-telefon-1$/);
  const parsed = parseEvent(wire, now);
  assert.equal(parsed.ok, true);
  assert.ok(wire.text?.startsWith("Simulerat: "));
  const db = createDemoDatabase(now);
  const outcome = considerDemoAlarm(db, SOURCE, { type: "alarm", code: wire.code, severity: wire.severity, state: wire.state ?? null, text: wire.text ?? "", occurredAt: now }, null, now);
  assert.equal(outcome.kind, "created");
});

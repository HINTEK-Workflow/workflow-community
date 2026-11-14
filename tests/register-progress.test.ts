import assert from "node:assert/strict";
import test from "node:test";
import { cancelEffect, knownRegisterTotal, registerProgress, type RegisterProgressInput } from "../lib/catalogue/register-progress";

const base: RegisterProgressInput = { requested: false, running: null, knownTotal: null, lastRun: null };
const when = (iso: string) => `[${iso.slice(0, 10)}]`;

test("Statusraden: begärd men inte startad väntar på jobbet och kan avbrytas", () => {
  const p = registerProgress({ ...base, requested: true }, when);
  assert.equal(p.phase, "waiting");
  assert.equal(p.text, "Väntar på jobbet (startar inom tio minuter)");
  assert.equal(p.canCancel, true);
  assert.equal(p.polling, true);
});

test("Statusraden: pågående körning visar räknare och förloppsstapel mot förra totalen", () => {
  const p = registerProgress({ ...base, running: { kind: "full", pages: 82, written: 83_000, cancelling: false }, knownTotal: 166_398 }, when);
  assert.equal(p.phase, "running");
  assert.match(p.text.replace(/\s/g, " "), /^Hämtar nu – 83 000 artiklar, sida 82$/);
  assert.equal(p.percent, 49);
  assert.equal(p.canCancel, true);
});

test("Statusraden: utan känd total bara räknare; aldrig över 99 procent; första sidan innan något skrivits", () => {
  assert.equal(registerProgress({ ...base, running: { kind: "full", pages: 3, written: 3000, cancelling: false } }, when).percent, null);
  assert.equal(registerProgress({ ...base, running: { kind: "full", pages: 200, written: 200_000, cancelling: false }, knownTotal: 166_398 }, when).percent, 99);
  assert.equal(registerProgress({ ...base, running: { kind: "full", pages: 0, written: 0, cancelling: false } }, when).text, "Hämtar nu – första sidan");
  assert.equal(registerProgress({ ...base, running: { kind: "changes", pages: 1, written: 40, cancelling: false }, knownTotal: 1000 }, when).percent, null, "ändringar mäts inte mot hela katalogen");
});

test("Statusraden: avbryter, klart, fel och avbruten", () => {
  const cancelling = registerProgress({ ...base, running: { kind: "full", pages: 5, written: 5000, cancelling: true } }, when);
  assert.equal(cancelling.phase, "cancelling");
  assert.equal(cancelling.canCancel, false, "redan på väg att avbrytas");
  assert.equal(cancelling.polling, true);
  const done = registerProgress({ ...base, lastRun: { kind: "full", ok: true, message: "x", finishedAt: "2026-10-18T10:00:00Z", written: 166_398 } }, when);
  assert.equal(done.phase, "done");
  assert.match(done.text.replace(/\s/g, " "), /^Klart – 166 398 artiklar, \[2026-10-18\]$/);
  assert.equal(done.polling, false, "ingen avläsning när inget pågår");
  const failed = registerProgress({ ...base, lastRun: { kind: "full", ok: false, message: "Solars katalog svarade med fel (500).", finishedAt: "2026-10-18T10:00:00Z" } }, when);
  assert.equal(failed.phase, "failed");
  assert.match(failed.text, /Misslyckades .*Solars katalog svarade med fel \(500\)\./);
  const cancelled = registerProgress({ ...base, lastRun: { kind: "full", ok: false, message: "Avbruten.", finishedAt: "2026-10-18T10:00:00Z", cancelled: true } }, when);
  assert.equal(cancelled.phase, "cancelled");
  assert.match(cancelled.text, /^Avbruten /);
  assert.equal(registerProgress(base, when).text, "");
  assert.equal(registerProgress({ ...base, lastRun: { kind: "full", ok: false, message: "x".repeat(400), finishedAt: "2026-10-18T10:00:00Z" } }, when).text.length < 200, true, "felet kortas");
});

test("Avbryt: dra tillbaka en begäran, stoppa en pågående, annars inget", () => {
  assert.equal(cancelEffect({ requested: true, running: false, cancelling: false }), "withdraw");
  assert.equal(cancelEffect({ requested: false, running: true, cancelling: false }), "stop");
  assert.equal(cancelEffect({ requested: false, running: true, cancelling: true }), "none");
  assert.equal(cancelEffect({ requested: false, running: false, cancelling: false }), "none");
});

test("Förloppsstapelns total är senaste fullständiga, ej avbrutna hämtning", () => {
  const history = [
    { kind: "full", ok: false, written: 9000, cancelled: true },
    { kind: "changes", ok: true, written: 12 },
    { kind: "full", ok: true, written: 500, trial: true },
    { kind: "full", ok: true, written: 166_398 },
    { kind: "full", ok: true, written: 150_000 },
  ];
  assert.equal(knownRegisterTotal(history), 166_398);
  assert.equal(knownRegisterTotal([]), null);
});

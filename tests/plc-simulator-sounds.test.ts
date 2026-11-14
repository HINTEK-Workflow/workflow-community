import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDeviceState, type DeviceState } from "../lib/machine/simulator/surface/engine";
import { DEVICE_KINDS } from "../lib/machine/simulator/surface/devices";
import { CLICK_MERGE_MS, isLoopSound, loopLevel, loudestLoops, MAX_CLICKS, MAX_LOOPS, mergeClicks, SOUND_IDS, soundsOf, STANDARD_SOUNDS, type SoundDevice } from "../lib/machine/simulator/surface/sounds";

// PLC-simulatorn, ljud (2026-11-07: "Går det få ljud på summer och kontaktor när den drar? och fläkt ljud osv?"): which
// change of state gives which sound, tested without audio.

const state = (patch: Partial<DeviceState> = {}): DeviceState => ({ ...createDeviceState(), ...patch });

test("every function has its standard sound or none; contactor, relay, buzzer, fan and motor sound", () => {
  for (const [kind, sound] of Object.entries(STANDARD_SOUNDS)) {
    assert.ok((DEVICE_KINDS as readonly string[]).includes(kind), kind);
    assert.ok(SOUND_IDS.includes(sound), sound);
  }
  assert.equal(STANDARD_SOUNDS.kontaktor, "contactor");
  assert.equal(STANDARD_SOUNDS.rela, "relay");
  assert.equal(STANDARD_SOUNDS.summer, "buzzer");
  assert.equal(STANDARD_SOUNDS.tilluftsflakt, "fan");
  assert.equal(STANDARD_SOUNDS.motor, "motor");
  for (const silent of ["lampa", "tempgivare", "kalla24", "voltmeter"] as const) assert.equal(STANDARD_SOUNDS[silent], undefined, `${silent} is silent`);
  assert.equal(isLoopSound("buzzer"), true);
  assert.equal(isLoopSound("contactor"), false);
});

test("a contactor clicks when it pulls in and softer when it drops out; nothing on the first look or without a change", () => {
  const devices: SoundDevice[] = [{ id: "K1", kind: "kontaktor", sound: "contactor" }, { id: "S1", kind: "knapp", sound: "switch" }, { id: "L1", kind: "lampa", sound: null }];
  const off = { K1: state(), S1: state(), L1: state() };
  const on = { K1: state({ energised: true }), S1: state({ pressed: true }), L1: state({ energised: true }) };
  assert.deepEqual(soundsOf(devices, null, on).clicks, [], "opening the page is no change");
  assert.deepEqual(soundsOf(devices, off, off).clicks, []);
  assert.deepEqual(soundsOf(devices, off, on).clicks, [{ device: "K1", sound: "contactor", edge: "on" }, { device: "S1", sound: "switch", edge: "on" }]);
  assert.deepEqual(soundsOf(devices, on, off).clicks, [{ device: "K1", sound: "contactor", edge: "off" }, { device: "S1", sound: "switch", edge: "off" }]);
  assert.deepEqual(soundsOf(devices, { ...off, S1: state({ on: false }) }, { ...off, S1: state({ on: true }) }).clicks, [{ device: "S1", sound: "switch", edge: "on" }], "a toggle switch clicks too");
});

test("a buzzer sounds while energised; a fan and a motor follow their speed, so they run up and spin down", () => {
  const devices: SoundDevice[] = [{ id: "B1", kind: "summer", sound: "buzzer" }, { id: "F1", kind: "tilluftsflakt", sound: "fan" }, { id: "M1", kind: "motor", sound: "motor" }];
  const { loops, clicks } = soundsOf(devices, null, { B1: state({ energised: true }), F1: state({ speed: 0.4, energised: false }), M1: state({ speed: 0 }) });
  assert.deepEqual(clicks, []);
  assert.deepEqual(loops, [{ device: "B1", sound: "buzzer", level: 1 }, { device: "F1", sound: "fan", level: 0.4 }, { device: "M1", sound: "motor", level: 0 }]);
  assert.equal(loopLevel("buzzer", state()), 0);
  assert.equal(loopLevel("fan", state({ speed: 2 })), 1);
  const many = Array.from({ length: 10 }, (_, index) => ({ device: `F${index}`, sound: "fan" as const, level: index / 10 }));
  assert.equal(loudestLoops(many).length, MAX_LOOPS);
  assert.equal(loudestLoops(many)[0]!.level, 0.9, "the loudest first");
  assert.ok(!loudestLoops(many).some((loop) => loop.level === 0), "a stopped loop is not played");
});

test("many devices switching at once are no wall of noise: one per sound, a few at most, merged within 30 ms", () => {
  const last = new Map<string, number>();
  const clicks = Array.from({ length: 8 }, (_, index) => ({ device: `K${index}`, sound: "contactor" as const, edge: "on" as const }));
  assert.equal(mergeClicks(clicks, last, 1000).length, 1, "eight contactors pulling in at once: one click");
  assert.equal(mergeClicks(clicks.slice(0, 1), last, 1000 + CLICK_MERGE_MS - 1).length, 0, "within 30 ms: merged");
  assert.equal(mergeClicks(clicks.slice(0, 1), last, 1000 + CLICK_MERGE_MS).length, 1, "after 30 ms: a new click");
  const mixed = (["contactor", "relay", "valve", "switch"] as const).map((sound) => ({ device: sound, sound, edge: "on" as const }));
  assert.equal(mergeClicks(mixed, new Map(), 0).length, MAX_CLICKS, "never more than three at once");
  assert.equal(mergeClicks([{ device: "K1", sound: "contactor", edge: "on" }, { device: "K1", sound: "contactor", edge: "off" }], new Map(), 0).length, 2, "in and out are different sounds");
});

test("the sounds are made in code and the toggle is a remembered preference", () => {
  const player = readFileSync("features/plc-simulator/surface/sound-player.ts", "utf8");
  assert.doesNotMatch(player, /\.(?:mp3|ogg|wav)["'`]/, "no audio files: the standard sounds are synthesised");
  assert.match(player, /addEventListener\("pointerdown", start, true\)/, "audio starts on the first click");
  const toolbar = readFileSync("features/plc-simulator/desktop/tool-bar.tsx", "utf8");
  assert.match(toolbar, /usePreference<"on" \| "off">\("sound", "on"/);
  assert.match(toolbar, /data-testid="plc-sound"/);
});

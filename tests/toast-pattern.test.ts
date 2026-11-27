import assert from "node:assert/strict";
import test from "node:test";
import { FRESH_TOAST_MS, sentenceAlreadyShown, toastIsStale } from "@/lib/workflow/toast";

test("ett besked per händelse: samma mening som redan står på sidan ritas inte som toast", () => {
  assert.equal(sentenceAlreadyShown("Ange projektets start- och slutdatum.", ["Nytt projekt", "Ange projektets start- och slutdatum."]), true);
  assert.equal(sentenceAlreadyShown("Gör riskbedömningen innan du startar tiden.", ["Gör riskbedömningen innan du startar tiden. Då kan du börja."]), true);
  assert.equal(sentenceAlreadyShown("Offerten är sparad.", ["Något helt annat på sidan"]), false);
});

test("korta besked som Sparat jämförs aldrig med sidans text", () => {
  assert.equal(sentenceAlreadyShown("Sparat", ["Sparat"]), false);
});

test("ett besked från före sidbytet är inaktuellt, det som gav sidbytet och ett med Ångra är det inte", () => {
  const now = 100_000;
  assert.equal(toastIsStale({ at: now - FRESH_TOAST_MS - 1 }, now), true);
  assert.equal(toastIsStale({ at: now - 200 }, now), false);
  assert.equal(toastIsStale({ at: now - 10_000, actions: [{}] }, now), false);
});

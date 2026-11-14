import assert from "node:assert/strict";
import test from "node:test";
import { nativeDialogScreen, shortActionLabel } from "../lib/workflow/dialog-mode";

// Nivå 1 på mobil (2026-10-10): dialogs open as screens with Avbryt and the action in the top bar.
test("native dialog screen: every dialog but a small one at level 1; nothing changes outside level 1", () => {
  assert.equal(nativeDialogScreen({ native: true, size: "auto" }), true, "Nytt beslut, Skicka med e-post");
  assert.equal(nativeDialogScreen({ native: true, size: "view" }), true, "Bilkostnad, Ny planering");
  assert.equal(nativeDialogScreen({ native: true, size: "page" }), true);
  assert.equal(nativeDialogScreen({ native: true, size: "compact" }), false, "a short question stays a small dialog");
  assert.equal(nativeDialogScreen({ native: true, size: "compact", nativeScreen: true }), true, "Ändra tidplan asks to be a screen");
  assert.equal(nativeDialogScreen({ native: true, size: "auto", nativeScreen: false }), false);
  for (const size of ["auto", "view", "page", "compact"] as const) {
    assert.equal(nativeDialogScreen({ native: false, size, nativeScreen: true }), false, `level 2–3 and the computer keep ${size}`);
  }
});

test("short action label: the phone's short words, full label kept when it fits", () => {
  assert.equal(shortActionLabel("Spara"), "Spara");
  assert.equal(shortActionLabel("Rapportera"), "Skicka", "a long verb gets the phone's short word (cut at 360 px, 2026-10-10)");
  assert.equal(shortActionLabel("Spara rond"), "Spara");
  assert.equal(shortActionLabel("Klar"), "Klar", "seven characters fit");
  assert.equal(shortActionLabel("Spara ändringar"), "Spara");
  assert.equal(shortActionLabel("Skapa planering"), "Skapa");
  assert.equal(shortActionLabel("Spara beslut"), "Spara");
  assert.equal(shortActionLabel("Flytta jobb och bokningar"), "Flytta");
  assert.equal(shortActionLabel("Uppdatera raden"), "Spara");
  assert.equal(shortActionLabel("Lägg till plats"), "Lägg till", "a particle verb keeps its particle");
  assert.equal(shortActionLabel("Ta bort planeringen"), "Ta bort");
  assert.equal(shortActionLabel("  Skicka   förslaget "), "Skicka");
  assert.equal(shortActionLabel("Kontrollbesiktning"), "Kontrollbesiktning", "one long word is cut by the bar, not here");
  // Färdigställ with written time (simulation 2026-10-10): the bar keeps saying that the tap completes the job.
  assert.equal(shortActionLabel("Färdigställ"), "Färdigställ");
  assert.equal(shortActionLabel("Spara tid och färdigställ"), "Färdigställ");
  assert.equal(shortActionLabel("Flytta jobb och bokningar"), "Flytta", "only a finishing verb after och wins");
});

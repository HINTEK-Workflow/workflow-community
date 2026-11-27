import type { DeviceKindId } from "./devices";
import type { DeviceState } from "./engine";

// PLC-simulatorn, ljud (2026-11-07: "Går det få ljud på summer och kontaktor när den drar? och fläkt ljud osv?"): which
// change of a device's state gives which sound. Pure, so it is tested without audio; the player (features/plc-simulator/surface/
// sound-player.ts) synthesises the standard sounds in code – no recorded or third-party audio – or plays a device design's own file.
//
// Two sorts: a click is one short sound when the device changes (a contactor pulls in, a valve opens, a button is pressed), with a
// softer one when it drops out; a loop sounds as long as the device runs, louder with its speed (a buzzer, a fan, a motor).

export const SOUND_IDS = ["contactor", "relay", "valve", "switch", "buzzer", "fan", "motor", "pump", "alarm"] as const;
export type SoundId = (typeof SOUND_IDS)[number];
export const SOUND_LABELS: Record<SoundId, string> = {
  contactor: "Kontaktor: tungt klack", relay: "Relä: klack", valve: "Ventil: klick", switch: "Brytare: lätt klick",
  buzzer: "Summer: ton", fan: "Fläkt: sus", motor: "Motor: brum", pump: "Pump: lågt brum", alarm: "Larm: tvåtonsignal",
};
export const LOOP_SOUNDS: ReadonlySet<SoundId> = new Set(["buzzer", "fan", "motor", "pump", "alarm"]);
export const isLoopSound = (sound: SoundId) => LOOP_SOUNDS.has(sound);

/** The standard sound of each function; a function not here is silent (a lamp, a sensor, a supply). */
export const STANDARD_SOUNDS: Partial<Record<DeviceKindId, SoundId>> = {
  kontaktor: "contactor", rela: "relay", nodstoppsrela: "relay", ventil: "valve",
  knapp: "switch", knapp_lampa: "switch", nodstopp: "switch", vippa: "switch", valjare: "switch", gransbrytare: "switch", brandlarm: "switch",
  summer: "buzzer", larm: "alarm", motor: "motor", tilluftsflakt: "fan", franluftsflakt: "fan", cirkpump: "pump",
};

/** How loud a loop is now, 0–1: a fan, motor or pump follows its speed (so it runs up and spins down), the rest is on or off. */
export function loopLevel(sound: SoundId, state: DeviceState): number {
  if (sound === "fan" || sound === "motor" || sound === "pump") return Math.max(0, Math.min(1, state.speed));
  return state.energised ? 1 : 0;
}

/** Whether a click-sound device is "in": a switch by its hand (pressed, on), the rest by its coil. */
export function clickOn(sound: SoundId, state: DeviceState): boolean {
  return sound === "switch" ? state.pressed || state.on : state.energised;
}

export type SoundDevice = { id: string; kind: DeviceKindId; sound: SoundId | null };
export type Click = { device: string; sound: SoundId; edge: "on" | "off" };
export type Loop = { device: string; sound: SoundId; level: number };

/** The sounds one step of the engine gives: clicks for every device that changed, and the level of every loop. */
export function soundsOf(devices: readonly SoundDevice[], before: Readonly<Record<string, DeviceState>> | null, after: Readonly<Record<string, DeviceState>>): { clicks: Click[]; loops: Loop[] } {
  const clicks: Click[] = [];
  const loops: Loop[] = [];
  for (const device of devices) {
    const now = after[device.id];
    if (!device.sound || !now) continue;
    if (isLoopSound(device.sound)) { loops.push({ device: device.id, sound: device.sound, level: loopLevel(device.sound, now) }); continue; }
    const was = before?.[device.id];
    // The first look at a drawing is no change: nothing clicks when the page opens.
    if (!was) continue;
    const on = clickOn(device.sound, now);
    if (on !== clickOn(device.sound, was)) clicks.push({ device: device.id, sound: device.sound, edge: on ? "on" : "off" });
  }
  return { clicks, loops };
}

/** Clicks closer together than this are one sound; and never more than MAX_CLICKS in one go. */
export const CLICK_MERGE_MS = 30;
export const MAX_CLICKS = 3;
/**
 * Many devices switching at once must not be a wall of noise: one click per sound and edge in the same step, at most MAX_CLICKS,
 * and nothing of the same sound within CLICK_MERGE_MS of the last one. `last` (sound+edge → time) is updated with what is played.
 */
export function mergeClicks(clicks: readonly Click[], last: Map<string, number>, now: number): Click[] {
  const out: Click[] = [];
  for (const click of clicks) {
    const key = `${click.sound}:${click.edge}`;
    if (out.some((played) => `${played.sound}:${played.edge}` === key)) continue;
    const at = last.get(key);
    if (at !== undefined && now - at < CLICK_MERGE_MS) continue;
    if (out.length >= MAX_CLICKS) break;
    out.push(click);
    last.set(key, now);
  }
  return out;
}

/** At most this many loops sound at once, the loudest first. */
export const MAX_LOOPS = 6;
export const loudestLoops = (loops: readonly Loop[]) => [...loops].filter((loop) => loop.level > 0.01).sort((a, b) => b.level - a.level).slice(0, MAX_LOOPS);

"use client";

import { useEffect, useRef } from "react";
import { designedSound, soundHref, type DesignSound, type DeviceDesign } from "@/lib/machine/simulator/surface/device-designs";
import type { DeviceState } from "@/lib/machine/simulator/surface/engine";
import type { DeviceInst } from "@/lib/machine/simulator/surface/layout";
import { type Click, isLoopSound, loudestLoops, mergeClicks, soundsOf, type SoundDevice, type SoundId } from "@/lib/machine/simulator/surface/sounds";

// PLC-simulatorn, ljud (2026-11-07): the player. The standard sounds are made here with the Web Audio API – noise bursts and
// oscillators, nothing recorded – and a device design's own file is decoded once and played the same way. Quiet on purpose (one
// master gain), started only after the person's first click or key (a browser refuses sound before that, and nothing is logged).

const MASTER = 0.22;
type LoopVoice = { sound: SoundId; gain: GainNode; stop: () => void; own: boolean };

class SoundPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly loops = new Map<string, LoopVoice>();
  private readonly lastClick = new Map<string, number>();
  private readonly buffers = new Map<string, AudioBuffer | "loading" | "failed">();
  private gestureListener: (() => void) | null = null;

  /** Waits for the first click or key on the page, then makes the audio context. */
  arm() {
    if (this.context || this.gestureListener || typeof window === "undefined") return;
    const start = () => {
      window.removeEventListener("pointerdown", start, true);
      window.removeEventListener("keydown", start, true);
      this.gestureListener = null;
      this.open();
    };
    this.gestureListener = start;
    window.addEventListener("pointerdown", start, true);
    window.addEventListener("keydown", start, true);
  }

  /** Makes the audio context; only ever called from a click or a key, so the browser allows it. */
  open() {
    if (this.context) return;
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = MASTER;
      this.master.connect(this.context.destination);
      void this.context.resume().catch(() => undefined);
    } catch { this.context = null; }
  }

  get ready() { return this.context !== null && this.context.state !== "closed"; }

  /** Lyssna in PLC-apparater: a click in and out, or a loop for a second and a half. */
  preview(sound: SoundId, own: DesignSound | null) {
    this.open();
    if (!this.ready) return;
    if (own) { void new Audio(soundHref(own)).play().catch(() => undefined); return; }
    if (!isLoopSound(sound)) { this.click(sound, "on", null); window.setTimeout(() => this.click(sound, "off", null), 450); return; }
    const voice = this.startLoop(sound, null);
    if (!voice) return;
    const context = this.context!;
    voice.gain.gain.setTargetAtTime(1, context.currentTime, 0.15);
    window.setTimeout(() => voice.gain.gain.setTargetAtTime(0, context.currentTime, 0.12), 1500);
    window.setTimeout(voice.stop, 2100);
  }

  private noiseBuffer(context: AudioContext) {
    if (this.noise) return this.noise;
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }

  private ownBuffer(own: DesignSound): AudioBuffer | null {
    const context = this.context!;
    const key = `${own.format}:${own.data.length}:${own.data.slice(0, 48)}:${own.data.slice(-48)}`;
    const cached = this.buffers.get(key);
    if (cached instanceof AudioBuffer) return cached;
    if (!cached) {
      this.buffers.set(key, "loading");
      // Decoded from the design's own base64 – never fetched from anywhere.
      const binary = atob(own.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      void context.decodeAudioData(bytes.buffer)
        .then((buffer) => { this.buffers.set(key, buffer); }, () => { this.buffers.set(key, "failed"); });
    }
    return null;
  }

  /** One mechanical click: a short noise burst through a band filter and a thud underneath; the drop-out softer and higher. */
  private click(sound: SoundId, edge: "on" | "off", own: DesignSound | null) {
    const context = this.context!, out = this.master!;
    const now = context.currentTime;
    if (own) {
      const buffer = this.ownBuffer(own);
      if (!buffer) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = edge === "on" ? 0.9 : 0.5;
      source.buffer = buffer;
      source.connect(gain).connect(out);
      source.start(now);
      return;
    }
    const shape = { contactor: { freq: 900, length: 0.09, level: 1, thud: 90 }, relay: { freq: 1800, length: 0.05, level: 0.6, thud: 160 }, valve: { freq: 1300, length: 0.06, level: 0.55, thud: 120 }, switch: { freq: 2600, length: 0.03, level: 0.4, thud: 0 } }[sound as "contactor" | "relay" | "valve" | "switch"];
    if (!shape) return;
    const level = shape.level * (edge === "on" ? 1 : 0.55);
    const length = shape.length * (edge === "on" ? 1 : 0.7);
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context);
    const band = context.createBiquadFilter();
    band.type = "bandpass"; band.frequency.value = edge === "on" ? shape.freq : shape.freq * 1.4; band.Q.value = 1.2;
    const gain = context.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    source.connect(band).connect(gain).connect(out);
    source.start(now, Math.random() * 0.5, length + 0.02);
    if (shape.thud && edge === "on") {
      const thud = context.createOscillator();
      const thudGain = context.createGain();
      thud.frequency.setValueAtTime(shape.thud, now);
      thud.frequency.exponentialRampToValueAtTime(shape.thud / 2, now + length);
      thudGain.gain.setValueAtTime(level * 0.6, now);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + length);
      thud.connect(thudGain).connect(out);
      thud.start(now); thud.stop(now + length + 0.02);
    }
  }

  /** A loop that runs while the device runs: its nodes, with a gain the level steers. */
  private startLoop(sound: SoundId, own: DesignSound | null): LoopVoice | null {
    const context = this.context!, out = this.master!;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(out);
    const nodes: (AudioScheduledSourceNode)[] = [];
    if (own) {
      const buffer = this.ownBuffer(own);
      if (!buffer) { gain.disconnect(); return null; }
      const source = context.createBufferSource();
      source.buffer = buffer; source.loop = true;
      source.connect(gain); nodes.push(source);
    } else if (sound === "buzzer") {
      const tone = context.createOscillator(); tone.type = "square"; tone.frequency.value = 410;
      const soft = context.createBiquadFilter(); soft.type = "lowpass"; soft.frequency.value = 1600;
      const level = context.createGain(); level.gain.value = 0.18;
      tone.connect(soft).connect(level).connect(gain); nodes.push(tone);
    } else if (sound === "alarm") {
      const tone = context.createOscillator(); tone.type = "triangle"; tone.frequency.value = 800;
      const lfo = context.createOscillator(); lfo.type = "square"; lfo.frequency.value = 1.6;
      const depth = context.createGain(); depth.gain.value = 120;
      lfo.connect(depth).connect(tone.frequency);
      const level = context.createGain(); level.gain.value = 0.25;
      tone.connect(level).connect(gain); nodes.push(tone, lfo);
    } else {
      // Fan, motor, pump: filtered noise for the air or water and a low tone for the motor, pitched by the sort.
      const air = context.createBufferSource(); air.buffer = this.noiseBuffer(context); air.loop = true;
      const filter = context.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = sound === "fan" ? 900 : 300;
      const airLevel = context.createGain(); airLevel.gain.value = sound === "fan" ? 0.5 : 0.2;
      air.connect(filter).connect(airLevel).connect(gain);
      const hum = context.createOscillator(); hum.type = sound === "motor" ? "sawtooth" : "sine"; hum.frequency.value = sound === "motor" ? 100 : sound === "pump" ? 60 : 140;
      const humFilter = context.createBiquadFilter(); humFilter.type = "lowpass"; humFilter.frequency.value = 400;
      const humLevel = context.createGain(); humLevel.gain.value = sound === "fan" ? 0.08 : 0.25;
      hum.connect(humFilter).connect(humLevel).connect(gain);
      nodes.push(air, hum);
    }
    for (const node of nodes) node.start();
    return { sound, gain, own: own !== null, stop: () => { for (const node of nodes) { try { node.stop(); } catch { /* Already stopped. */ } } gain.disconnect(); } };
  }

  /** One step: the merged clicks, and every loop set to its level (a fan's pitch and loudness follow its speed). */
  play(clicks: readonly Click[], loops: readonly { device: string; sound: SoundId; level: number }[], owns: ReadonlyMap<string, DesignSound | null>) {
    if (!this.ready) return;
    const context = this.context!;
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    for (const click of mergeClicks(clicks, this.lastClick, performance.now())) this.click(click.sound, click.edge, owns.get(click.device) ?? null);
    const wanted = new Map(loudestLoops(loops).map((loop) => [loop.device, loop]));
    for (const [device, voice] of this.loops) {
      if (wanted.has(device) && wanted.get(device)!.sound === voice.sound) continue;
      voice.gain.gain.setTargetAtTime(0, context.currentTime, 0.08);
      const stop = voice.stop;
      window.setTimeout(stop, 400);
      this.loops.delete(device);
    }
    for (const [device, loop] of wanted) {
      let voice = this.loops.get(device);
      if (!voice) { const started = this.startLoop(loop.sound, owns.get(device) ?? null); if (!started) continue; voice = started; this.loops.set(device, voice); }
      voice.gain.gain.setTargetAtTime(loop.sound === "fan" || loop.sound === "motor" || loop.sound === "pump" ? 0.15 + 0.85 * loop.level : loop.level, context.currentTime, 0.12);
    }
  }

  silence() {
    for (const voice of this.loops.values()) voice.stop();
    this.loops.clear();
  }
}

let shared: SoundPlayer | null = null;
const player = () => (shared ??= new SoundPlayer());

/**
 * Plays the drawing's sounds while `enabled`: each new engine step is compared with the one before (clicks on changes, loops by
 * level). Off: everything stops at once. Nothing is made before the person's first click on the page.
 */
export function useDeviceSounds(enabled: boolean, devices: readonly DeviceInst[], states: Readonly<Record<string, DeviceState>>, override?: DeviceDesign | null) {
  const before = useRef<Readonly<Record<string, DeviceState>> | null>(null);
  useEffect(() => {
    if (enabled) player().arm();
    else { shared?.silence(); before.current = null; }
  }, [enabled]);
  useEffect(() => () => { shared?.silence(); }, []);
  useEffect(() => {
    if (!enabled) return;
    const sounding: SoundDevice[] = [];
    const owns = new Map<string, DesignSound | null>();
    for (const device of devices) {
      const { sound, own } = designedSound(device, override);
      sounding.push({ id: device.id, kind: device.kind, sound });
      owns.set(device.id, own);
    }
    const { clicks, loops } = soundsOf(sounding, before.current, states);
    before.current = states;
    player().play(clicks, loops.filter((loop) => isLoopSound(loop.sound)), owns);
  }, [enabled, devices, states, override]);
}

/** Plays a device's sound once, from a click (PLC-apparater's Lyssna). */
export const previewSound = (sound: SoundId, own: DesignSound | null) => player().preview(sound, own);

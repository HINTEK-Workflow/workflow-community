// PLC-simulatorn: a seeded random source and a run's id, the only parts of the old machine engine the simulator still needs.

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Base36 time plus four random characters. */
export function newRunId(nowMs: number, random: () => number) {
  let out = nowMs.toString(36);
  for (let index = 0; index < 4; index += 1) out += Math.floor(random() * 36).toString(36);
  return out;
}

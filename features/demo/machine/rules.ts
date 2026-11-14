// Demokopplingen (2026-11-04): the rules that simulate a future local AI beside a PLC, pure and without any AI. Only the public
// demo uses them; nothing in the product imports this file (tests/demo-machine.test.ts). What the visitor fills in, signal by signal,
// and what the signals do decide every word of the alarm text. The free text about the machine is shown and never read.

export type DemoMode = "traditional" | "mapped";
export const SIMULATION_MARK = "Simulering av framtida AI";
// Short (2026-11-05: a short "simulerad" mark, no long "finns inte i dag" texts); the mark itself says it is the future.
export const SIMULATION_TEXT = "Regler i webbläsaren, ingen AI anropas.";
export const HUMAN_DECIDES_TEXT = "Förslag är bara förslag. En människa beslutar, särskilt om säkerhet.";
export const SIMULATED_ON_CALL_TEXT = "Jouren kontaktas (simulerat: inget meddelande lämnar webbläsaren).";
export const NO_DESCRIPTION_TEXT = "Ingen beskrivning, inga förslag. Systemet vet inte vad maskinen gör förrän någon har sagt det.";

/** What a signal normally does: a short press, a run of a known time, off unless something is wrong, or only worth noting. */
export type Behaviour = "brief" | "timed" | "fault" | "info";
export const BEHAVIOUR_LABELS: Record<Behaviour, string> = { brief: "Kort tryck", timed: "Går en viss tid", fault: "Ska vara från", info: "Bara information" };
export type SignalRow = { id: string; signal: string; function: string; behaviour: Behaviour; maxCount: number; windowMin: number; expectedS: number; causes: string };
export type MachineDescription = { text: string; rows: SignalRow[] };
export const EMPTY_DESCRIPTION: MachineDescription = { text: "", rows: [] };

/** Signals the table can name: the digital terminals the PLC has. */
export const SIGNAL_CHOICES = [...Array.from({ length: 12 }, (_, index) => `DI${index}`), ...Array.from({ length: 8 }, (_, index) => `DO${index}`)];

/** The ready example. Every value is invented for the demo and comes from no machine, maker or standard. */
export const READY_DESCRIPTION: MachineDescription = {
  text: "Startknappen startar en fläkt som går i en minut. Motorskyddet stoppar fläkten vid fel.",
  rows: [
    { id: "ready-di0", signal: "DI0", function: "Startknappen", behaviour: "brief", maxCount: 5, windowMin: 2, expectedS: 60, causes: "Fläkten verkar inte starta, så någon försöker igen" },
    { id: "ready-di1", signal: "DI1", function: "Motorskyddet", behaviour: "fault", maxCount: 5, windowMin: 2, expectedS: 60, causes: "Fläkten går tungt eller har fastnat" },
    { id: "ready-do0", signal: "DO0", function: "Fläkten", behaviour: "timed", maxCount: 5, windowMin: 2, expectedS: 60, causes: "Någon eller något bröt driften" },
    { id: "ready-do1", signal: "DO1", function: "Larmutgången", behaviour: "info", maxCount: 5, windowMin: 2, expectedS: 60, causes: "" },
  ],
};

/** A description counts when it says what the machine does and at least one signal has a function. */
export const describedEnough = (description: MachineDescription) => description.text.trim().length > 0 && description.rows.some((row) => row.function.trim().length > 0);

export type CandidateOrigin = "taught" | "described" | "generic";
export const ORIGIN_LABELS: Record<CandidateOrigin, string> = { taught: "från ett tidigare fel", described: "från beskrivningen", generic: "allmänt antagande" };
export type Candidate = { text: string; origin: CandidateOrigin };
export type TaughtCause = { id: string; pattern: string; patternLabel: string; cause: string; times: number; firstAt: number; lastAt: number };

export type PatternKind = "press" | "stop" | "fault" | "report";
const GENERIC: Record<PatternKind, readonly string[]> = {
  report: ["Något har lossnat eller slitits", "En givare eller kabel ger fel signal"],
  press: ["Glapp i kontakt eller kabel", "Signalen studsar"],
  stop: ["Matningen bröts", "Styrningen fick en annan signal"],
  fault: ["Signalen är felkopplad", "Glapp i kontakt eller kabel"],
};

const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const seconds = (ms: number) => Math.round(ms / 1000);
const spanText = (ms: number) => { const s = Math.max(1, seconds(ms)); return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`; };
/** A label inside a sentence: only its first letter goes small, so a signal's name stays DI0. */
export const inSentence = (text: string) => text.charAt(0).toLocaleLowerCase("sv-SE") + text.slice(1);
export const rowName = (row: SignalRow) => `${row.function.trim()} (${row.signal})`;

/** Taught causes first (most often taught first, then the latest), then what the description names, then general assumptions, each said once. */
export function rankCandidates(pattern: string, taught: readonly TaughtCause[], described: readonly string[], generic: readonly string[]): Candidate[] {
  const learned = taught.filter((item) => item.pattern === pattern).sort((a, b) => b.times - a.times || b.lastAt - a.lastAt).map((item): Candidate => ({ text: item.cause, origin: "taught" }));
  const all = [...learned, ...described.map((text): Candidate => ({ text, origin: "described" })), ...generic.map((text): Candidate => ({ text, origin: "generic" }))];
  const seen = new Set<string>();
  return all.filter((item) => { const key = item.text.toLocaleLowerCase("sv-SE"); if (seen.has(key)) return false; seen.add(key); return true; });
}
/** The sentence that travels as a diagnosis. */
export const candidateSentence = (candidates: readonly Candidate[]) => {
  const named = candidates.slice(0, 2).map((item) => `${item.text} (${ORIGIN_LABELS[item.origin]})`);
  return named.length ? `Kan bero på: ${named.join(" eller ")}.` : "";
};

/** A taught cause: the same words on the same pattern count up; anything else is a new line. Returns the list anew. */
export function teach(taught: readonly TaughtCause[], input: { pattern: string; patternLabel: string; cause: string; id: string; at: number }): TaughtCause[] {
  const cause = input.cause.trim();
  if (!cause) return [...taught];
  const key = cause.toLocaleLowerCase("sv-SE");
  const found = taught.find((item) => item.pattern === input.pattern && item.cause.toLocaleLowerCase("sv-SE") === key);
  if (found) return taught.map((item) => item === found ? { ...item, times: item.times + 1, lastAt: input.at } : item);
  return [...taught, { id: input.id, pattern: input.pattern, patternLabel: input.patternLabel, cause, times: 1, firstAt: input.at, lastAt: input.at }];
}

export type Sample = { atMs: number; values: Readonly<Record<string, boolean>> };
export type ObserverLine = { tone: "info" | "note" | "alarm"; text: string };
/** A finished alarm: what the local AI would send to the intake, with what it is built from. */
export type Finished = { kind: PatternKind; signal: string; pattern: string; patternLabel: string; code: string; text: string; observed: string[]; mapping: string[]; candidates: Candidate[] };
export type Observer = { atMs: number; last: Record<string, boolean>; presses: Record<string, number[]>; startedAt: Record<string, number>; faultAt: Record<string, number>; pending: Record<string, boolean> };
export const createObserver = (): Observer => ({ atMs: 0, last: {}, presses: {}, startedAt: {}, faultAt: {}, pending: {} });

/** A press flurry is reported when it has been quiet this long, so the text says the whole count: press ten times and it says ten. */
export const SETTLE_MS = 3000;
/** A signal that went on this close before a stop is named as part of the stop. */
export const NEAR_STOP_MS = 2000;
/** A run within this share of the expected time is as expected. */
export const RUN_TOLERANCE = 0.1;

export const mappingLine = (row: SignalRow) => {
  const normal = row.behaviour === "brief" ? `kort tryck, högst ${row.maxCount} på ${row.windowMin} min` : row.behaviour === "timed" ? `går ${row.expectedS} s` : BEHAVIOUR_LABELS[row.behaviour].toLocaleLowerCase("sv-SE");
  return `${row.signal} = ${row.function.trim()}: ${normal}`;
};

/**
 * One reading of the signals. Returns the next state, what is written in the live log and any finished alarm. Called only when
 * something has changed or a flurry waits to be reported, so it costs nothing while the machine is quiet.
 */
export function observe(state: Observer, description: MachineDescription, taught: readonly TaughtCause[], sample: Sample): { state: Observer; log: ObserverLine[]; finished: Finished[] } {
  const next: Observer = { atMs: sample.atMs, last: { ...state.last }, presses: { ...state.presses }, startedAt: { ...state.startedAt }, faultAt: { ...state.faultAt }, pending: { ...state.pending } };
  const log: ObserverLine[] = [];
  const finished: Finished[] = [];
  const known = describedEnough(description);
  // What went on is read before what went off, so a protection that trips in the same reading as the stop is known when the stop is judged.
  const changes = Object.keys(sample.values).filter((signal) => Boolean(state.last[signal]) !== sample.values[signal]).sort((a, b) => Number(sample.values[b]) - Number(sample.values[a]));
  const rowOf = (signal: string) => description.rows.find((row) => row.signal === signal && row.function.trim().length > 0) ?? null;
  const anyRunning = description.rows.some((row) => row.behaviour === "timed" && state.last[row.signal]);
  for (const signal of changes) {
    const on = sample.values[signal];
    next.last[signal] = on;
    if (!known) { log.push({ tone: "info", text: `${signal} ${on ? "till" : "från"}. Ingen beskrivning, så inget förslag.` }); continue; }
    const row = rowOf(signal);
    if (!row) { log.push({ tone: "info", text: `${signal} ${on ? "till" : "från"}. Signalen har ingen funktion i tabellen.` }); continue; }
    if (row.behaviour === "info") { log.push({ tone: "info", text: `${rowName(row)} ${on ? "till" : "från"}.` }); continue; }
    if (row.behaviour === "brief") {
      if (!on) continue;
      const windowMs = row.windowMin * 60_000;
      const presses = [...(next.presses[signal] ?? []).filter((at) => sample.atMs - at <= windowMs), sample.atMs];
      next.presses[signal] = presses;
      if (presses.length > row.maxCount) { next.pending[signal] = true; log.push({ tone: "note", text: `${rowName(row)} till, ${presses.length} gånger. Normalt högst ${row.maxCount} på ${row.windowMin} min. Väntar på att det lugnar sig.` }); }
      else log.push({ tone: "info", text: `${rowName(row)} till, ${presses.length} ${presses.length === 1 ? "gång" : "gånger"} på ${row.windowMin} min. Det är normalt.` });
      continue;
    }
    if (row.behaviour === "fault") {
      if (!on) { log.push({ tone: "info", text: `${rowName(row)} från igen.` }); continue; }
      next.faultAt[signal] = sample.atMs;
      if (anyRunning) { log.push({ tone: "note", text: `${rowName(row)} till medan något går. Väntar på vad som händer.` }); continue; }
      const pattern = `fault:${signal}`;
      const text = `${row.function.trim()} (${signal}) gick till. Ska normalt vara från`;
      log.push({ tone: "alarm", text });
      finished.push({ kind: "fault", signal, pattern, patternLabel: `${rowName(row)} går till`, code: `AI-${signal}-FEL`, text, observed: [`${signal} gick till när inget annat gick.`], mapping: [mappingLine(row)], candidates: rankCandidates(pattern, taught, lines(row.causes), GENERIC.fault) });
      continue;
    }
    // A run of a known time.
    if (on) { next.startedAt[signal] = sample.atMs; log.push({ tone: "info", text: `${rowName(row)} startade. Förväntad gångtid ${row.expectedS} s.` }); continue; }
    const started = next.startedAt[signal];
    delete next.startedAt[signal];
    if (started === undefined) continue;
    const ranMs = sample.atMs - started, ran = seconds(ranMs), expected = row.expectedS;
    const margin = Math.max(1, expected * RUN_TOLERANCE);
    if (Math.abs(ranMs / 1000 - expected) <= margin) { log.push({ tone: "info", text: `${rowName(row)} gick ${ran} s, som förväntat.` }); continue; }
    const early = ranMs / 1000 < expected;
    const text = early ? `${row.function.trim()} stannade efter ${ran} s, förväntat ${expected} s` : `${row.function.trim()} gick ${ran} s, förväntat ${expected} s`;
    const nearby = description.rows.filter((other) => other.behaviour === "fault" && other.function.trim() && next.faultAt[other.signal] !== undefined && sample.atMs - next.faultAt[other.signal] <= NEAR_STOP_MS);
    const pattern = `${early ? "stop" : "long"}:${signal}`;
    const described = [...nearby.map((other) => `${other.function.trim()} (${other.signal}) gick till precis före stoppet`), ...lines(row.causes)];
    log.push({ tone: "alarm", text });
    finished.push({
      kind: "stop", signal, pattern, patternLabel: `${rowName(row)} ${early ? "stannar för tidigt" : "går för länge"}`, code: `AI-${signal}-${early ? "TID-KORT" : "TID-LANG"}`, text,
      observed: [`${signal} gick ${ran} s.`, ...nearby.map((other) => `${other.signal} gick till högst ${Math.ceil(NEAR_STOP_MS / 1000)} s före stoppet.`)],
      mapping: [mappingLine(row), ...nearby.map(mappingLine)], candidates: rankCandidates(pattern, taught, described, GENERIC.stop),
    });
  }
  // A flurry that has gone quiet is reported with its whole count.
  for (const signal of Object.keys(next.pending)) {
    const presses = next.presses[signal] ?? [];
    const row = rowOf(signal);
    const lastPress = presses[presses.length - 1] ?? 0;
    if (!row || !known) { delete next.pending[signal]; continue; }
    if (sample.atMs - lastPress < SETTLE_MS) continue;
    const pattern = `press:${signal}`;
    const text = `${row.function.trim()} (${signal}) gick till ${presses.length} gånger på ${spanText(lastPress - presses[0])}, normalt högst ${row.maxCount} på ${row.windowMin} min`;
    const related = description.rows.filter((other) => other.behaviour === "timed" && other.function.trim()).map((other) => `${other.function.trim()} (${other.signal}) gör kanske inte det den ska`);
    log.push({ tone: "alarm", text });
    finished.push({
      kind: "press", signal, pattern, patternLabel: `${rowName(row)} går till ovanligt ofta`, code: `AI-${signal}-OFTA`, text,
      observed: [`${signal} gick till ${presses.length} gånger på ${spanText(lastPress - presses[0])}.`], mapping: [mappingLine(row)],
      candidates: rankCandidates(pattern, taught, [...lines(row.causes), ...related], GENERIC.press),
    });
    delete next.pending[signal];
    next.presses[signal] = [];
  }
  return { state: next, log, finished };
}

/** What the operator page says before sending: only the machine's signals, what they have done and what has been taught; never the text the operator writes. */
export const OPERATOR_AI_NOTE = `${SIMULATION_MARK}. ${HUMAN_DECIDES_TEXT} Det du skriver visas men tolkas inte: bara maskinen, signalerna och det systemet lärt sig används.`;
export type OperatorAdvice = { text: string; basis: string };
const words = (text: string) => text.toLocaleLowerCase("sv-SE").split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3);

/**
 * Before an operator sends, on the machine the description is about. Taught causes first, with those sharing a word with the chosen
 * cause before the others (plain keywords, nothing more), what has been observed lately, one question and the checks the table gives.
 */
export function operatorAdvice(input: { description: MachineDescription; taught: readonly TaughtCause[]; recentAlarms: readonly string[]; cause: string }): OperatorAdvice[] {
  const { description, taught, recentAlarms, cause } = input;
  if (!describedEnough(description)) return [{ text: NO_DESCRIPTION_TEXT, basis: "Beskriv maskinen i Workflow-fönstret." }];
  const chosen = new Set(words(cause));
  const shares = (item: TaughtCause) => words(`${item.cause} ${item.patternLabel}`).some((word) => chosen.has(word)) ? 1 : 0;
  const learned = [...taught].sort((a, b) => shares(b) - shares(a) || b.times - a.times || b.lastAt - a.lastAt).slice(0, 2).map((item): OperatorAdvice => ({ text: item.cause, basis: `${ORIGIN_LABELS.taught}, ${inSentence(item.patternLabel)}` }));
  const seen = recentAlarms.slice(0, 1).map((text): OperatorAdvice => ({ text: `Senast observerat: ${text}`, basis: "Från PLC:ns signaler" }));
  const timed = description.rows.find((row) => row.behaviour === "timed" && row.function.trim());
  const question = timed ? [{ text: `Stannade ${timed.function.trim().toLocaleLowerCase("sv-SE")} innan de ${timed.expectedS} sekunderna gått?`, basis: `En fråga från beskrivningen: ${mappingLine(timed)}` }] : [];
  const checks = description.rows.filter((row) => row.behaviour === "fault" && row.function.trim()).map((row): OperatorAdvice => ({ text: `Se efter ${row.function.trim().toLocaleLowerCase("sv-SE")} (${row.signal})`, basis: `Från beskrivningen: ${mappingLine(row)}` }));
  return [...learned, ...seen, ...question, ...checks].slice(0, 5);
}
/** The suggestions a report's work order gets, in the same order as an alarm's. */
export function reportCandidates(pattern: string, description: MachineDescription, taught: readonly TaughtCause[]) {
  return rankCandidates(pattern, taught, description.rows.flatMap((row) => row.function.trim() ? lines(row.causes) : []), GENERIC.report);
}

/** True while a flurry waits to be reported: the reader then asks even without a change. */
export const needsTick = (state: Observer) => Object.keys(state.pending).length > 0;

/** The basis of a diagnosis, within the intake's 200 characters. */
export const basisText = (finished: Pick<Finished, "observed" | "mapping">) => `Observerat: ${finished.observed.join(" ")} Mappning: ${finished.mapping.join("; ")}`.slice(0, 200);

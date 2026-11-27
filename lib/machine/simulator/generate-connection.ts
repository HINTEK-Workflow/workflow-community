import type { LogEntry } from "./device";
import { maskText } from "./mask";

// PLC-simulatorn, Generera koppling automatiskt (the owner 2026-11-04): the steps, pure, with the calls handed in. The source is called
// Simulator; it is made when missing and reused when there. A new key, which goes straight to where keys are kept and is never returned
// or reported. The source is set to Av, which gives no work orders. A test event through the intake, as any outside device would send
// it. A step that fails stops the rest, and what the server said stands word for word.

export const SIMULATOR_SOURCE_NAME = "Simulator";
export const DEFAULT_COOLDOWN = 30;

export type SourceRow = { id: string; name: string; alarmMode: string; cooldownMinutes: number; status: string; displayHint?: string | null };
export type GeneratePorts = {
  list(): Promise<SourceRow[]>;
  create(name: string): Promise<{ id: string; token: string }>;
  rotate(id: string): Promise<{ id: string; token: string }>;
  setMode(id: string, mode: "off", cooldownMinutes: number): Promise<void>;
  /** Takes the key into the window's memory. True when it was a key. */
  useKey(token: string): boolean;
  /** The test event, through the intake with the key. */
  sendTest(): Promise<LogEntry | { refused: string }>;
};

export type GenerateStep = "find" | "create" | "key" | "mode" | "test";
export const STEP_TEXT: Record<GenerateStep, string> = {
  find: "Letar efter källan Simulator",
  create: "Skapar källan Simulator",
  key: "Skapar en ny källnyckel",
  mode: "Sätter källan på Av",
  test: "Skickar testhändelsen",
};
export type GenerateResult =
  | { ok: true; source: SourceRow; created: boolean; answer: LogEntry }
  | { ok: false; step: GenerateStep; error: string; source: SourceRow | null };

/** A failed call's text as the server said it, without anything shaped like a key. */
const said = (error: unknown) => maskText(error instanceof Error ? error.message : String(error));

export async function generateConnection(ports: GeneratePorts, onStep: (step: GenerateStep) => void = () => undefined): Promise<GenerateResult> {
  let source: SourceRow | null = null;
  let created = false;
  let step: GenerateStep = "find";
  const go = (next: GenerateStep) => { step = next; onStep(next); };
  try {
    go("find");
    const rows = await ports.list();
    const found = rows.find((row) => row.name === SIMULATOR_SOURCE_NAME) ?? null;
    let issued: { id: string; token: string };
    if (found) {
      go("key");
      issued = await ports.rotate(found.id);
      source = found;
    } else {
      go("create");
      issued = await ports.create(SIMULATOR_SOURCE_NAME);
      created = true;
      source = { id: issued.id, name: SIMULATOR_SOURCE_NAME, alarmMode: "off", cooldownMinutes: DEFAULT_COOLDOWN, status: "active" };
    }
    go("key");
    if (!ports.useKey(issued.token)) return { ok: false, step, error: "Svaret innehöll ingen källnyckel.", source };
    go("mode");
    await ports.setMode(source.id, "off", source.cooldownMinutes);
    source = { ...source, alarmMode: "off" };
    go("test");
    const answer = await ports.sendTest();
    if ("refused" in answer) return { ok: false, step, error: maskText(answer.refused), source };
    if (answer.status === null || answer.status >= 300 || answer.tone === "danger") return { ok: false, step, error: answer.responseBody ? `${answer.status ?? "Inget svar"}: ${answer.responseBody}` : answer.summary, source };
    return { ok: true, source, created, answer };
  } catch (error) {
    return { ok: false, step, error: said(error), source };
  }
}

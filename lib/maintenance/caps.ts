import { z } from "zod";
import { PART_LIMIT } from "./model";
import { PLACE_LIMIT } from "./place-model";

/**
 * Justerbart tak i Underhåll (0.92.0), utan databas. Hur många maskiner och platser ett företag får ha: dagens värden är förval
 * (5 000 delar per företag, som också är taket för maskiner, och 2 000 platser). Systemadministratören kan sätta ett lägre tak
 * per företag (Organization.maintenanceMachineCap / maintenancePlaceCap; null = förvalet), till exempel för ett mindre
 * abonnemang. Högre än förvalet går inte: listorna läses i högst så många rader. Servern prövar taket när en maskin eller plats
 * läggs till (lib/maintenance/server.ts, place-server.ts); det som redan finns tas aldrig bort.
 */
export const MACHINE_CAP_DEFAULT = PART_LIMIT;
export const PLACE_CAP_DEFAULT = PLACE_LIMIT;
export const CAP_MIN = 1;

export const capInputSchema = (ceiling: number) => z.number().int(`Skriv ett heltal.`).min(CAP_MIN, `Minst ${CAP_MIN}.`).max(ceiling, `Högst ${ceiling.toLocaleString("sv-SE")}.`).nullable();
export const machineCapInput = capInputSchema(MACHINE_CAP_DEFAULT);
export const placeCapInput = capInputSchema(PLACE_CAP_DEFAULT);

/** The cap that holds: the company's own when it is set and within the ceiling, else the default. */
export function effectiveCap(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= CAP_MIN && value <= fallback ? value : fallback;
}

/**
 * Whether one more may be added: the refusal in words, or null. `count` is how many there are now; a company already over a cap
 * that was lowered keeps what it has but cannot add more.
 */
export function capRefusal(kind: "machine" | "place", count: number, cap: number): string | null {
  if (count < cap) return null;
  const amount = cap.toLocaleString("sv-SE");
  return kind === "machine"
    ? `Företaget kan ha högst ${amount} ${cap === 1 ? "maskin" : "maskiner"} i Underhåll. Kontakta installationens administratör om ni behöver fler.`
    : `Företaget kan ha högst ${amount} ${cap === 1 ? "plats" : "platser"} i Underhåll. Kontakta installationens administratör om ni behöver fler.`;
}

/** The history line for a changed cap, or "" when it is left out or unchanged. */
export function capChangeText(kind: "machine" | "place", before: number | null | undefined, after: number | null | undefined): string {
  if (after === undefined || (before ?? null) === after) return "";
  const fallback = kind === "machine" ? MACHINE_CAP_DEFAULT : PLACE_CAP_DEFAULT;
  return `Underhåll: högst ${capText(after, fallback)} ${kind === "machine" ? "maskiner" : "platser"} (förut ${capText(before, fallback)}).`;
}

/** The line in the product administration: the cap as it holds, and whether it is the default. */
export function capText(value: number | null | undefined, fallback: number): string {
  const cap = effectiveCap(value, fallback);
  return `${cap.toLocaleString("sv-SE")}${cap === fallback ? " (förval)" : ""}`;
}

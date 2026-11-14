import { api } from "@/features/kfid/api";
import type { CapacityData } from "@/lib/workflow/capacity-summary";
import type { PlanningRound } from "@/lib/workflow/planning-rounds";

/**
 * What the capacity count reads for a period (2026-11-02): the bookings, people and absence, and the round occurrences. The
 * same read as Kalender, within the person's rights: the rounds are those of the forms they may read, so a person sees the load their
 * Kalender sees. A failed rounds read counts as no rounds and stops nothing. Local builds the same answer from its file.
 */
export type CapacityRead = (range: { from: string; to: string }) => Promise<{ data: CapacityData; rounds: PlanningRound[] }>;

export const cloudCapacityRead = (roundsOn: boolean): CapacityRead => async ({ from, to }) => {
  const [data, rounds] = await Promise.all([
    api<CapacityData>(`/api/planning-capacity?from=${from}&to=${to}`),
    roundsOn ? api<{ rounds: PlanningRound[] }>(`/api/form-schedules?planning=1&from=${from}&to=${to}`).then((read) => read.rounds).catch(() => []) : Promise.resolve([] as PlanningRound[]),
  ]);
  return { data, rounds };
};

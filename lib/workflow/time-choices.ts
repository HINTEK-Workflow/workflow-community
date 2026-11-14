/**
 * Välj jobb i Tid (användartest 2026-10-31, F4): the phone listed the first 60 jobs alphabetically, so a person's own job
 * starting with U never came. The choices are now ordered – the person's own jobs (responsible or booked, `mine` from the
 * server) first, then the jobs they reported time on lately, then the rest alphabetically – and never cut off; a search narrows
 * them. Pure, so the phone, the computer and the tests share it.
 */
export type TimeChoice = { id: string; title: string; kind: string; mine?: boolean; project?: { name: string } | null; timeEntries: readonly { startedAt: string }[] };

/** Lately reported jobs shown in their own group, at most. */
export const RECENT_CHOICES = 8;

const byTitle = (a: TimeChoice, b: TimeChoice) => Number(a.kind === "PROJECT") - Number(b.kind === "PROJECT") || a.title.localeCompare(b.title, "sv") || a.id.localeCompare(b.id);
const lastEntry = (task: TimeChoice) => task.timeEntries.reduce((latest, entry) => (entry.startedAt > latest ? entry.startedAt : latest), "");

export function groupTimeChoices<T extends TimeChoice>(tasks: readonly T[]): { mine: T[]; recent: T[]; rest: T[] } {
  const mine = tasks.filter((task) => task.mine).sort(byTitle);
  const recent = tasks.filter((task) => !task.mine && task.timeEntries.length).sort((a, b) => lastEntry(b).localeCompare(lastEntry(a)) || byTitle(a, b)).slice(0, RECENT_CHOICES);
  const taken = new Set([...mine, ...recent].map((task) => task.id));
  return { mine, recent, rest: tasks.filter((task) => !taken.has(task.id)).sort(byTitle) };
}

/** The choices whose title or project holds every word of the search (case and accents as typed, Swedish lower case). */
export function searchTimeChoices<T extends TimeChoice>(tasks: readonly T[], query: string): T[] {
  const words = query.toLocaleLowerCase("sv").split(/\s+/).filter(Boolean);
  if (!words.length) return [...tasks];
  return tasks.filter((task) => { const text = `${task.title} ${task.project?.name ?? ""}`.toLocaleLowerCase("sv"); return words.every((word) => text.includes(word)); });
}

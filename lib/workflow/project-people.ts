/**
 * The people of a project as name badges (2026-10-22): the responsible person first, then whoever has one of its
 * jobs, each once. Keyed by member id (the name when there is none) so the colours match the calendar's. Pure, so Mina
 * projekt, Översikt's project cards (Cloud, Local and the demo) and the tests read the same.
 */
export type ProjectPerson = { key: string; name: string };

export function projectPeople(
  project: { responsibleUserId?: string | null; responsibleName?: string | null },
  tasks: readonly { assignedToUserId?: string | null; assignedToName?: string | null }[],
): ProjectPerson[] {
  const people = new Map<string, string>();
  const add = (key: string | null | undefined, name: string | null | undefined) => {
    const label = name?.trim();
    if (label && !people.has(key || label)) people.set(key || label, label);
  };
  add(project.responsibleUserId, project.responsibleName);
  for (const task of tasks) add(task.assignedToUserId, task.assignedToName);
  return [...people].map(([key, name]) => ({ key, name }));
}

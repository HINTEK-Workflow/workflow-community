import { cn } from "@/lib/utils";
import type { ProjectPerson } from "@/lib/workflow/project-people";
import { personInitials, personSolidTone } from "./person-tone";

/**
 * Name badges (2026-10-22): the people's initials in their calendar colour, at most `max` and "+N" for the rest;
 * the names for a screen reader and as tooltips. Used on Mina projekt (cards and rows) and Översikt's project cards.
 */
export function PersonAvatars({ people, max = 4 }: { people: readonly ProjectPerson[]; max?: number }) {
  if (!people.length) return <span className="text-xs text-muted-foreground">Ingen ansvarig</span>;
  return <div className="flex items-center" data-testid="project-people">
    <span className="sr-only">Medarbetare: {people.map((person) => person.name).join(", ")}</span>
    {people.slice(0, max).map((person, index) => <span key={person.key} aria-hidden="true" title={person.name} className={cn("flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-card", personSolidTone(person.key), index ? "-ml-1.5" : "")}>{personInitials(person.name)}</span>)}
    {people.length > max ? <span aria-hidden="true" className="-ml-2 flex size-7 items-center justify-center rounded-full border-2 border-border bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-card">+{people.length - max}</span> : null}
  </div>;
}

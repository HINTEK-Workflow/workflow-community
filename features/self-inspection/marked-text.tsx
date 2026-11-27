"use client";

import Link from "next/link";
import { peopleOverview, type ContentView } from "@/lib/self-inspection/model";
import { selfInspectionHref, selfInspectionTabLabel, type SelfInspectionPart } from "@/lib/self-inspection/tabs";
import { levelRuleText, PROGRAM_MARKERS, splitMarkers, type ProgramMarker } from "@/lib/self-inspection/structure";
import { EreList } from "./organisation";
import { OrgTreeView } from "./org-tree";
import { ProgramText, Tag } from "./shared";

/**
 * The programme's text with its markers filled in (2026-11-24): a line that holds only {{roller}}, {{organisation}},
 * {{ere}}, {{personal}}, {{nivaregel}} or {{inhyrda}} shows what Workflow knows – from the version when it is approved, so it
 * is frozen with it. Only name, role and level of a person; never any other personal data.
 */
/**
 * Where each marker's content is kept, for an admin's "Ändra i …" under it (2026-11-24). Only in the page as it is shown
 * (`editLinks`); the editor shows the content without it (2026-11-25: the editor is only the text).
 */
const KEPT_IN: Record<ProgramMarker, SelfInspectionPart> = { roller: "roles", organisation: "organisation", ere: "roles", personal: "cards", nivaregel: "roles", inhyrda: "external" };
export function MarkedText({ text, content, className, editLinks = false }: { text: string; content: ContentView; className?: string; editLinks?: boolean }) {
  const parts = splitMarkers(text);
  if (!parts.some((part) => part.kind === "marker")) return <ProgramText text={text} className={className} />;
  return <div className="space-y-4">{parts.map((part, index) => part.kind === "text"
    ? <ProgramText key={index} text={part.text} className={className} />
    : <div key={index} data-testid={`self-inspection-marker-${part.marker}`} data-marker={part.marker}><MarkerBlock marker={part.marker} content={content} />
      {editLinks ? <p className="mt-1.5 text-xs text-muted-foreground">Fylls i av Workflow. <Link href={selfInspectionHref(KEPT_IN[part.marker])} className="text-primary hover:underline" data-testid="self-inspection-marker-link">Ändra i {selfInspectionTabLabel(KEPT_IN[part.marker])}</Link></p> : null}</div>)}</div>;
}

function MarkerBlock({ marker, content }: { marker: ProgramMarker; content: ContentView }) {
  if (marker === "organisation") return <OrgTreeView content={content} />;
  if (marker === "ere") return <EreList roles={content.roles} />;
  if (marker === "nivaregel") return <p className="rounded-lg border bg-muted/20 px-4 py-3 text-sm" data-testid="self-inspection-level-rule">{levelRuleText(content.levelYears)}</p>;
  if (marker === "roller") return <div className="space-y-3">
    {content.roles.map((role, index) => <section key={role.id ?? index} aria-label={role.name} className="rounded-xl border p-4">
      <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">{role.name}{role.level ? <Tag>Nivåkrav {role.level}</Tag> : null}{role.isEre ? <Tag tone="primary">ERE</Tag> : null}</h4>
      {role.description ? <p className="mt-1 text-sm leading-6">{role.description}</p> : null}
      {role.dutyGroups?.length ? <div className="mt-2 space-y-2">{role.dutyGroups.map((group, at) => <div key={at}>
        {group.title ? <p className="text-xs font-medium text-muted-foreground">{group.title}</p> : null}
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-sm">{group.text.split("\n").filter((line) => line.trim()).map((line, row) => <li key={row}>{line.trim()}</li>)}</ul>
      </div>)}</div> : role.duties ? <ProgramText text={role.duties} className="mt-2" /> : null}
    </section>)}
    {content.commonDuties ? <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-medium text-muted-foreground">Gemensamt för alla roller</p><ProgramText text={content.commonDuties} className="mt-1" /></div> : null}
  </div>;
  if (marker === "personal") {
    const staff = content.staff ?? peopleOverview(content).map((person) => ({ personId: person.personId, name: person.name, roles: person.roles, level: person.level || null }));
    return staff.length ? <div className="overflow-x-auto rounded-xl border" data-testid="self-inspection-staff">
      <table className="w-full min-w-[20rem] text-left text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th scope="col" className="px-3 py-2 font-medium">Person</th><th scope="col" className="px-3 py-2 font-medium">Roller</th><th scope="col" className="px-3 py-2 font-medium">Nivå</th></tr></thead>
        <tbody className="divide-y">{staff.map((person) => <tr key={person.personId}><td className="px-3 py-2 font-medium">{person.name || "Okänd person"}</td><td className="px-3 py-2">{person.roles.join(", ") || "–"}</td><td className="px-3 py-2">{person.level ?? "–"}</td></tr>)}</tbody>
      </table>
    </div> : <p className="text-sm text-muted-foreground">Inga personer är kopplade till programmet ännu.</p>;
  }
  const hired = content.external ?? [];
  return hired.length ? <div className="overflow-x-auto rounded-xl border" data-testid="self-inspection-hired">
    <table className="w-full min-w-[20rem] text-left text-sm">
      <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th scope="col" className="px-3 py-2 font-medium">Namn</th><th scope="col" className="px-3 py-2 font-medium">Uthyrande företag</th><th scope="col" className="px-3 py-2 font-medium">Roll</th><th scope="col" className="px-3 py-2 font-medium">Nivå</th></tr></thead>
      <tbody className="divide-y">{hired.map((person) => <tr key={person.id}><td className="px-3 py-2 font-medium">{person.name}</td><td className="px-3 py-2">{person.company || "–"}</td><td className="px-3 py-2">{person.role || "–"}</td><td className="px-3 py-2">{person.level}</td></tr>)}</tbody>
    </table>
  </div> : <p className="text-sm text-muted-foreground">Ingen inhyrd personal ingår i programmet.</p>;
}

/** The markers in words, for the editor's help (insert one on a line of its own). */
export const MARKER_HELP = Object.entries(PROGRAM_MARKERS).map(([key, label]) => ({ key: key as ProgramMarker, text: `{{${key}}}`, label }));

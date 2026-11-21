"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSearch } from "@/components/native";
import { findWorkProfileTitles, WORK_PROFILE, workProfileGroups, type WorkArea, type WorkProfile } from "@/lib/workflow/work-profile";

/**
 * The yrkesprofiler as a select's options, under the groups they belong to, with what the company works with first. All of
 * them are always offered: a company may mix every profile, per person. The one list for Användare, the guide and Mina
 * inställningar.
 */
export function WorkProfileOptions({ none, areas = [] }: { none: string; areas?: readonly WorkArea[] }) {
  return <>
    <option value="">{none}</option>
    {workProfileGroups(areas).map((group) => <optgroup key={group.area} label={group.label}>
      {group.profiles.map((profile) => <option key={profile} value={profile}>{WORK_PROFILE[profile].label}</option>)}
    </optgroup>)}
  </>;
}

/** The line under the select: what stands first, and which other titles the row stands for. */
export function workProfileHint(profile: WorkProfile): string {
  const { description, alternativeNames } = WORK_PROFILE[profile];
  return alternativeNames.length ? `${description} Gäller även ${alternativeNames.join(", ")}.` : description;
}

/**
 * The way to a title that has no row of its own (2026-11-04): "Driftelektriker" finds Underhållselektriker. A hit chooses the row
 * in the select beside it, so the three pages keep one way of saving.
 */
export function WorkProfileTitleSearch({ onPick, native = false }: { onPick: (profile: WorkProfile) => void; native?: boolean }) {
  const [query, setQuery] = useState("");
  const hits = findWorkProfileTitles(query);
  const label = "Sök din yrkestitel";
  return <div data-testid="work-profile-search">
    {native ? <NativeSearch value={query} onChange={setQuery} label={label} placeholder={label} />
      : <Input type="search" aria-label={label} placeholder={label} value={query} onChange={(event) => setQuery(event.target.value)} data-testid="work-profile-search-input" />}
    {query.trim().length >= 2 ? <ul className="mt-2 grid gap-1.5" aria-label="Träffar" data-testid="work-profile-search-hits">
      {hits.length ? hits.map((hit) => <li key={`${hit.profile}-${hit.title}`}>
        <button type="button" className="workflow-card tap-card flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 px-3.5 py-2 text-left text-sm" data-testid="work-profile-search-hit"
          onClick={() => { onPick(hit.profile); setQuery(""); }}>
          <span className="min-w-0 font-medium">{hit.title}</span>
          {hit.title !== WORK_PROFILE[hit.profile].label ? <span className="min-w-0 text-xs text-muted-foreground">Profil: {WORK_PROFILE[hit.profile].label}</span> : null}
        </button>
      </li>) : <li className="px-1 text-xs text-muted-foreground">Ingen titel matchar. Välj det som liknar ditt arbete mest i listan.</li>}
    </ul> : null}
  </div>;
}

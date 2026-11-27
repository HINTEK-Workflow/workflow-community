"use client";

import { api } from "@/features/kfid/api";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import type { BoardList, PlaylistList } from "./boards-api";

/**
 * What a screen or a link shows (Tavlor etapp 2, 2026-11-18): one published board or one playlist, chosen in one list. Only published
 * boards are offered – a screen and a link never show a draft.
 */
export function useTargetOptions() {
  const boards = useWorkspaceData<BoardList>("/api/boards?part=list", (signal) => api<BoardList>("/api/boards?part=list", { signal }));
  const playlists = useWorkspaceData<PlaylistList>("/api/boards?part=playlists", (signal) => api<PlaylistList>("/api/boards?part=playlists", { signal }).catch(() => ({ items: [], canEdit: false })));
  const published = (boards.data?.items ?? []).filter((item) => item.published);
  return {
    ready: Boolean(boards.data && playlists.data),
    boards: published,
    allBoards: boards.data?.items ?? [],
    playlists: playlists.data?.items ?? [],
    reloadPlaylists: () => playlists.reload(),
  };
}

export function TargetSelect({ id, value, onChange, options, testId }: { id: string; value: string; onChange: (value: string) => void; options: ReturnType<typeof useTargetOptions>; testId?: string }) {
  return <div className="grid min-w-0 content-start gap-1.5">
    <label htmlFor={id} className="field-label text-xs font-medium">Visar</label>
    <select id={id} className="form-select" value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} aria-describedby={`${id}-help`}>
      {!value ? <option value="">Välj…</option> : null}
      {options.boards.length ? <optgroup label="Tavlor">{options.boards.map((board) => <option key={board.id} value={`b:${board.id}`}>{board.name}</option>)}</optgroup> : null}
      {options.playlists.length ? <optgroup label="Spellistor">{options.playlists.map((playlist) => <option key={playlist.id} value={`p:${playlist.id}`}>{playlist.name}</option>)}</optgroup> : null}
    </select>
    <p id={`${id}-help`} className="text-xs text-muted-foreground">{options.ready && !options.boards.length ? "Det finns ingen publicerad tavla ännu. Publicera en tavla först." : "Bara publicerade tavlor visas. Siffrorna räknas med behörigheten hos den som publicerade."}</p>
  </div>;
}

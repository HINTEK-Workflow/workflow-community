"use client";

import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Panel } from "@/features/kfid/ui";
import { compareVersions, currentAppVersion, RELEASE_NOTES, releaseNoteFor, type ReleaseNote } from "@/lib/release-notes";
import { formatSwedishDate } from "@/lib/swedish-time";

const noteDate = (note: ReleaseNote) => formatSwedishDate(`${note.date}T12:00:00Z`, { dateStyle: "long" });

function NoteBody({ note }: { note: ReleaseNote }) {
  return <>
    <p className="text-sm leading-6">{note.summary}</p>
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">{note.items.map((item) => <li key={item}>{item}</li>)}</ul>
  </>;
}

/**
 * Nytt i version … (2026-10-06): under Hjälp, what the running version brings, with the earlier versions folded
 * below it. The text comes from lib/release-notes.ts, the same source as the newsletter.
 */
export function ReleaseNotesPanel() {
  const current = currentAppVersion();
  const shipped = RELEASE_NOTES.filter((note) => compareVersions(note.version, current) <= 0);
  const [latest, ...earlier] = shipped;
  if (!latest) return null;
  return <div id="nytt" className="scroll-mt-24">
    <Panel title={`Nytt i version ${latest.version}`} description={noteDate(latest)}
      icon={Sparkles}>
      <div data-testid="release-notes"><NoteBody note={latest} /></div>
      {earlier.length ? <details className="mt-4 rounded-lg border p-3" data-testid="release-notes-earlier">
        <summary className="cursor-pointer text-sm font-medium">Tidigare versioner</summary>
        <div className="mt-3 space-y-4">{earlier.map((note) => <section key={note.version}>
          <h3 className="text-sm font-semibold">Version {note.version} <span className="font-normal text-muted-foreground">· {noteDate(note)}</span></h3>
          <div className="mt-1"><NoteBody note={note} /></div>
        </section>)}</div>
      </details> : null}
    </Panel>
  </div>;
}

/** The version the notice is about: the running one, when it has notes and the person has not seen them. */
export function unseenReleaseVersion(seen: string | undefined) {
  const current = currentAppVersion();
  return releaseNoteFor(current) && seen !== current ? current : null;
}

/** A quiet line at the top after an update (2026-10-06), shown once per person and version. */
export function ReleaseNotice({ version, onSeen }: { version: string; onSeen: () => void }) {
  return <div className="notice mb-4 flex flex-wrap items-center gap-x-3 gap-y-1" role="status" data-testid="release-notice">
    <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
    <span className="min-w-0 flex-1">Workflow är uppdaterat till version {version}.</span>
    <Link href="/?view=help#nytt" className="font-medium underline" onClick={onSeen}>Se vad som är nytt</Link>
    <IconButton label="Stäng" onClick={onSeen}><X /></IconButton>
  </div>;
}

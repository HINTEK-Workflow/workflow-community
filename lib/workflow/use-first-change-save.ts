"use client";

import { useEffect, useRef } from "react";
import { AUTOSAVE_DELAY_MS } from "./autosave";

/**
 * Ny … öppnar redigeraren som utkast (Lika är rätt, 2026-11-14): a new offert, inköp or fakturaunderlag opens straight in
 * its editor, nothing is saved while the person only looks, and the draft is saved by itself after the first change – after
 * the same calm pause as the work order's autosave (lib/workflow/autosave.ts). It is saved once; after that the editor works as
 * for any saved draft (Spara). `ready` is false while what the server needs is missing (an offert's rubrik), or on a phone at
 * level 1, where a new document is made with Skapa. A failed save is tried again at the next change.
 *
 * The created document keeps its editor (`adoptCreated` + `editorKey`): the address gets its id without the editor being
 * drawn anew, so what is typed while it is saved stays.
 */
export function useFirstChangeSave({ isNew, dirty, ready, busy, change, save }: {
  isNew: boolean;
  dirty: boolean;
  ready: boolean;
  busy: boolean;
  /** Anything that changes with each edit (the draft itself), so the pause starts again while the person types. */
  change: unknown;
  save: () => Promise<unknown>;
}) {
  const started = useRef(false);
  const saveNow = useRef(save);
  useEffect(() => { saveNow.current = save; });
  // The same editor opened on a new document again (Nytt … after one made here): it is saved at its first change too.
  useEffect(() => { if (!isNew) started.current = false; }, [isNew]);
  useEffect(() => {
    if (!isNew || !dirty || !ready || busy || started.current) return;
    const timer = window.setTimeout(() => {
      started.current = true;
      void saveNow.current().then((done) => { if (!done) started.current = false; }, () => { started.current = false; });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isNew, dirty, ready, busy, change]);
}

const adopted = new Map<string, string>();
/** The document just created from a new editor in this tab (with that editor's key): its editor stays when the address gets the id. */
export function adoptCreated(id: string, key = "new") { adopted.set(id, key); }
/** The key of an editor drawn from the address: the key of the new editor that created the document, else the id. */
export function editorKey(id: string | null | undefined, fresh = "new") { return (id ? adopted.get(id) ?? id : fresh); }

/** The same as a part of the page, for an editor whose save is made after its early returns. Draws nothing. */
export function FirstChangeSave(props: Parameters<typeof useFirstChangeSave>[0]) {
  useFirstChangeSave(props);
  return null;
}

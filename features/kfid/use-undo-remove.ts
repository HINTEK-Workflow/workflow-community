"use client";

import { useCallback, useEffect, useRef } from "react";
import { removeRow, restoreRow, undoStillOffered, UNDO_REMOVE_MS, type RemovedRow } from "@/lib/workflow/undo-remove";
import { announce, withdrawAnnouncement } from "@/lib/workflow/toast";

/** Ctrl/Cmd+Z inside a text field undoes the typing, so the key is only ours when focus is somewhere else. */
const inTextField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Ångra borttagen rad (2026-10-11): removing a row is done at once and announced with a toast – "Raden är
 * borttagen" with Ångra for eight seconds – that puts the row back where it stood with everything it held. Ctrl/Cmd+Z
 * does the same for the last removed row when focus is not in a text field. `update` changes the list as a function of
 * its current value, so what was edited in the meantime is kept. `quiet` removes without a toast or an undo (a blank row
 * cleaned away when its screen is closed).
 */
export function useUndoRemove<T extends { id: string }>(update: (change: (list: T[]) => T[]) => void, defaultText = "Raden är borttagen.") {
  const last = useRef<{ removed: RemovedRow<T>; text: string } | null>(null);
  const updateRef = useRef(update);
  useEffect(() => { updateRef.current = update; });

  const undo = useCallback(() => {
    const entry = last.current;
    if (!entry || !undoStillOffered(entry.removed)) { last.current = null; return false; }
    last.current = null;
    updateRef.current((list) => restoreRow(list, entry.removed));
    withdrawAnnouncement(entry.text);
    return true;
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.defaultPrevented || inTextField(event.target)) return;
      if (undo()) event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo]);

  /** Removes the row now; `list` is the list the person sees (it tells where the row stood). */
  return useCallback((list: readonly T[], id: string, options: { text?: string; quiet?: boolean } = {}) => {
    const { removed } = removeRow(list, id);
    if (!removed) return;
    updateRef.current((current) => current.filter((item) => item.id !== id));
    if (options.quiet) return;
    const text = options.text ?? defaultText;
    last.current = { removed, text };
    announce(text, false, [{ label: "Ångra", run: () => { undo(); } }], UNDO_REMOVE_MS);
  }, [defaultText, undo]);
}

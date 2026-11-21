"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RunningTimer, StoppedTimer } from "@/lib/workflow/running-timer";
import type { SearchResponse, SearchType } from "@/lib/search/types";

type EditorActions = {
  // The open task editor (work order, protocol, risk assessment) registers its Save and unsaved state.
  save: () => void;
  canSave: boolean;
  busy: boolean;
  dirty: boolean;
  /** The page's own Avbryt (the same button as in its header): the floating navigation's Avbryt presses it (2026-10-27). */
  cancel?: () => void;
  /** The page's own way back ("Tillbaka till arbetsordern"), used by the floating Tillbaka instead of a plain step back. */
  back?: { label: string; run: () => void };
};
export type LocalStorageActions = {
  label: string;
  detail: string;
  attention: boolean;
  open: () => void;
};
/** Sök over the open Local file (2026-10-05): the same ranked groups as /api/search; `expand` is "Visa fler". */
export type LocalSearch = (query: string, options?: { expand?: SearchType | null }) => SearchResponse;
type LocalSearchRegistration = { run: LocalSearch };
const ActionsContext = createContext<EditorActions | null>(null);
const RegisterContext = createContext<React.Dispatch<React.SetStateAction<EditorActions | null>> | null>(null);
const LocalStorageContext = createContext<LocalStorageActions | null>(null);
const RegisterLocalStorageContext = createContext<React.Dispatch<React.SetStateAction<LocalStorageActions | null>> | null>(null);
const LocalSearchContext = createContext<LocalSearchRegistration | null>(null);
const RegisterLocalSearchContext = createContext<React.Dispatch<React.SetStateAction<LocalSearchRegistration | null>> | null>(null);
const NotificationCountContext = createContext<number | null>(null);
const RegisterNotificationCountContext = createContext<React.Dispatch<React.SetStateAction<number | null>> | null>(null);

/** The active workspace's own running timers for the top bar (2026-09-26), Cloud or Local. */
export type RunningTimerSource = {
  timers: RunningTimer[];
  /** Server time minus browser time, so the ticking clock does not depend on the browser's clock. */
  clockOffsetMs: number;
  /** Stops the entry; `keepShort` saves it even under a minute (the person answered "Spara ändå", 2026-10-12). */
  pause: (timer: RunningTimer, options?: { keepShort?: boolean }) => Promise<StoppedTimer[]>;
};
const RunningTimerContext = createContext<RunningTimerSource | null>(null);
const RegisterRunningTimerContext = createContext<React.Dispatch<React.SetStateAction<RunningTimerSource | null>> | null>(null);

export function WorkspaceActionsProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActions] = useState<EditorActions | null>(null);
  const [localStorage, setLocalStorage] = useState<LocalStorageActions | null>(null);
  const [localSearch, setLocalSearch] = useState<LocalSearchRegistration | null>(null);
  const [notificationCount, setNotificationCount] = useState<number | null>(null);
  const [runningTimers, setRunningTimers] = useState<RunningTimerSource | null>(null);
  return (
    <RegisterContext.Provider value={setActions}>
      <RegisterLocalStorageContext.Provider value={setLocalStorage}>
      <RegisterLocalSearchContext.Provider value={setLocalSearch}>
      <RegisterNotificationCountContext.Provider value={setNotificationCount}>
      <RegisterRunningTimerContext.Provider value={setRunningTimers}>
        <ActionsContext.Provider value={actions}>
          <LocalStorageContext.Provider value={localStorage}>
            <LocalSearchContext.Provider value={localSearch}>
              <NotificationCountContext.Provider value={notificationCount}>
                <RunningTimerContext.Provider value={runningTimers}>{children}</RunningTimerContext.Provider>
              </NotificationCountContext.Provider>
            </LocalSearchContext.Provider>
          </LocalStorageContext.Provider>
        </ActionsContext.Provider>
      </RegisterRunningTimerContext.Provider>
      </RegisterNotificationCountContext.Provider>
      </RegisterLocalSearchContext.Provider>
      </RegisterLocalStorageContext.Provider>
    </RegisterContext.Provider>
  );
}

export const useRunningTimers = () => useContext(RunningTimerContext);

/** Registers the active workspace's running timers; `undefined` means inactive and never overwrites another source. */
export function useRegisterRunningTimers(source: RunningTimerSource | null | undefined) {
  const register = useContext(RegisterRunningTimerContext);
  useEffect(() => {
    if (!register || source === undefined) return;
    register(source);
    return () => register(null);
  }, [register, source]);
}

export const useWorkspaceActions = () => useContext(ActionsContext);
export const useLocalStorageActions = () => useContext(LocalStorageContext);
export const useLocalWorkspaceSearch = () => useContext(LocalSearchContext)?.run ?? null;
export const useNotificationCount = () => useContext(NotificationCountContext);

// The active Cloud or Local workspace reports its current, already permission-filtered reminder count to the menu.
// `undefined` means the caller is inactive and must not overwrite another workspace's count.
export function useRegisterNotificationCount(count: number | null | undefined) {
  const register = useContext(RegisterNotificationCountContext);
  useEffect(() => {
    if (!register || count === undefined) return;
    register(count);
    return () => register(null);
  }, [count, register]);
}

// Both local and cloud editors register their actual save handler.
// Ref-backed callbacks always use the current fields, without registering on every keystroke.
// `restore`: a form opened as a page over another editor (features/kfid/dialog-page.tsx) hands the bar back to it on close.
export function useRegisterEditorActions(actions: EditorActions, options?: { restore?: boolean }) {
  const register = useContext(RegisterContext);
  const outer = useRef(useContext(ActionsContext));
  const restore = options?.restore ?? false;
  useEffect(() => {
    if (!restore || !register) return;
    const previous = outer.current;
    return () => { register(previous); };
  }, [restore, register]);
  const latest = useRef(actions);
  useEffect(() => { latest.current = actions; });
  const save = useCallback(() => {
    if (latest.current.canSave && !latest.current.busy) latest.current.save();
  }, []);
  const cancel = useCallback(() => { if (!latest.current.busy) latest.current.cancel?.(); }, []);
  const runBack = useCallback(() => { if (!latest.current.busy) latest.current.back?.run(); }, []);
  const { canSave, busy, dirty } = actions;
  const hasCancel = Boolean(actions.cancel);
  const backLabel = actions.back?.label ?? null;
  useEffect(() => {
    register?.({ save, canSave, busy, dirty, ...(hasCancel ? { cancel } : {}), ...(backLabel ? { back: { label: backLabel, run: runBack } } : {}) });
    return () => { if (!restore) register?.(null); };
  }, [register, save, canSave, busy, dirty, restore, hasCancel, cancel, backLabel, runBack]);
}

export function useRegisterLocalStorageActions(
  actions: Omit<LocalStorageActions, "open"> & { open: () => void } | null,
) {
  const register = useContext(RegisterLocalStorageContext);
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  const open = useCallback(() => latest.current?.open(), []);
  const label = actions?.label;
  const detail = actions?.detail;
  const attention = actions?.attention;
  useEffect(() => {
    if (!register) return;
    if (!label || !detail) {
      register(null);
      return;
    }
    register({ label, detail, attention: Boolean(attention), open });
    return () => register(null);
  }, [attention, detail, label, open, register]);
}

export function useRegisterLocalWorkspaceSearch(search: LocalSearch | null) {
  const register = useContext(RegisterLocalSearchContext);
  useEffect(() => {
    if (!register) return;
    register(search ? { run: search } : null);
    return () => register(null);
  }, [register, search]);
}

// Unsaved work outside the task editors (the Local .hwf file that has not been downloaded). Leaving through Logga ut
// asks with the in-app card; a reload or closed tab can only be guarded by the browser's own box (F20, 2026-09-29).
const unsavedWork = new Map<string, string>();
export function useRegisterUnsavedWork(key: string, reason: string | null) {
  useEffect(() => {
    if (reason) unsavedWork.set(key, reason);
    else unsavedWork.delete(key);
    return () => { unsavedWork.delete(key); };
  }, [key, reason]);
}
export function unsavedWorkReason() {
  return [...unsavedWork.values()][0] ?? null;
}

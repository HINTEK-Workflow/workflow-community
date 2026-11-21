"use client";

import { useEffect } from "react";

/**
 * Reads what a view shows: runs `load` when the component opens and again whenever `load` changes (a useCallback over
 * the inputs it reads), as `useEffect(() => { void load(); }, [load])` did. The call is started one microtask after
 * the effect, so the loader's state updates (a busy flag, then the answer) never run synchronously inside the effect
 * body (react-hooks/set-state-in-effect, 7.1); for the person nothing changes. `when` false skips the run.
 */
export function useLoadEffect(load: () => unknown, when = true) {
  useEffect(() => {
    if (!when) return;
    queueMicrotask(() => { void load(); });
  }, [load, when]);
}

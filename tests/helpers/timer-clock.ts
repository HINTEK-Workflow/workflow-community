import { mock } from "node:test";
import * as store from "../../features/kfid/local-workspace-store";

// A timer stopped within its first minute leaves no entry (F10, 2026-09-29). Tests that start and stop timers at once
// therefore run on a mocked clock that moves five minutes forward before every timer change or save.
let enabled = false;
function advance() {
  if (!enabled) {
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-29T06:00:00.000Z") });
    enabled = true;
  }
  mock.timers.tick(5 * 60_000);
}
export const updateLocalWorkflowTimer: typeof store.updateLocalWorkflowTimer = (...args) => { advance(); return store.updateLocalWorkflowTimer(...args); };
export const saveLocalWorkflowTaskRecord: typeof store.saveLocalWorkflowTaskRecord = (...args) => { advance(); return store.saveLocalWorkflowTaskRecord(...args); };

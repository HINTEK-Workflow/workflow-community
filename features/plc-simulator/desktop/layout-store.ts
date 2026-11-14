import { HELP_SEEN_KEY } from "@/lib/machine/simulator/help";
import { holdsKeyForm } from "@/lib/machine/simulator/mask";

// PLC-simulatorn, skrivbordet: the dock's layout, remembered on this device. Only which panels stand where and how large: the
// panels get no parameters, so nothing from a panel can reach this text, and the key-form guard stands here as it does for the
// drawing. Visa → Återställ layout removes it.

export const LAYOUT_STORAGE_KEY = "workflow-plc-simulator-layout-v1";
const MAX_LAYOUT_CHARS = 64 * 1024;

export function readLayoutText(): string | null {
  try {
    const text = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return text && text.length <= MAX_LAYOUT_CHARS ? text : null;
  } catch { return null; }
}
export function writeLayoutText(text: string) {
  if (text.length > MAX_LAYOUT_CHARS || holdsKeyForm(text)) return;
  try { window.localStorage.setItem(LAYOUT_STORAGE_KEY, text); } catch { /* Not remembered, nothing more. */ }
}
export function forgetLayoutText() {
  try { window.localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch { /* A closed store has nothing to remove. */ }
}

/** Hjälpen's first-time line has been used or closed on this device: only a mark, nothing from a panel. */
export function readHelpSeen() {
  try { return window.localStorage.getItem(HELP_SEEN_KEY) === "1"; } catch { return true; }
}
export function saveHelpSeen() {
  try { window.localStorage.setItem(HELP_SEEN_KEY, "1"); } catch { /* Shown again next time, nothing more. */ }
}

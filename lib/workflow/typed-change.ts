/**
 * "Något är ändrat" from what the person types or chooses inside an element (a dialog, a form page, a screen). The
 * listener sits on the element itself, so it hears the browser's input event before React's own handler at the root.
 * A state change made right there renders again in the middle of the event, and a controlled field drawn again with its
 * old value loses what was just typed: the first keystroke, a paste or an automated fill (2026-10-18, 2026-10-24).
 * So the change is reported once the event has been handled. React's own value updates never raise these events.
 * Browser-only, no React.
 */
export function listenForTypedChange(element: EventTarget, onChange: () => void): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const changed = () => {
    if (pending !== null) return;
    pending = setTimeout(() => { pending = null; onChange(); }, 0);
  };
  element.addEventListener("input", changed);
  element.addEventListener("change", changed);
  // A report already on its way is still made: the change happened (a state update after unmount does nothing).
  return () => {
    element.removeEventListener("input", changed);
    element.removeEventListener("change", changed);
  };
}

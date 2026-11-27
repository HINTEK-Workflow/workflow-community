"use client";

import { useState } from "react";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { formatSwedish } from "@/lib/swedish-time";
import { NOT_DONE_REASON_MAX, notDoneReasonSchema } from "@/lib/workflow/round-outcome";

/**
 * Ej utfört (2026-10-28, etapp 5): the small dialog that records that a round's occurrence will not be done, with a
 * required reason (labels above the field, as Utgår's dialog, features/workflow/task-cancel-dialog.tsx). The server decides;
 * no protocol is made. Used by Driftronder, the round's own screen on a phone and the round section of its work order.
 */
export function RoundNotDoneDialog({ target, onClose, onConfirm }: {
  /** The round and day to mark, or null when closed. */
  target: { title: string; date: string } | null;
  onClose: () => void;
  /** Resolves to an error message, or null when it was recorded. */
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parsed = notDoneReasonSchema.safeParse(reason);
  const issue = touched && !parsed.success ? parsed.error.issues[0]?.message ?? "" : "";
  const close = () => { setReason(""); setTouched(false); setError(""); onClose(); };
  const submit = async () => {
    setTouched(true);
    if (!parsed.success || busy) return;
    setBusy(true); setError("");
    try {
      const failure = await onConfirm(parsed.data);
      if (failure) setError(failure); else close();
    } finally { setBusy(false); }
  };
  const day = target ? formatSwedish(`${target.date}T12:00:00`, { dateStyle: "medium" }) : "";
  return <Modal open={Boolean(target)} onOpenChange={(open) => { if (!open) close(); }} title="Ej utfört" size="compact">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }} data-testid="round-not-done-dialog">
      <p className="text-sm text-muted-foreground">{target?.title} {day} görs inte. Tillfället sparas med anledning, namn och tid.</p>
      <label className="block space-y-2 text-xs font-medium text-muted-foreground">Anledning
        <textarea id="round-not-done-reason" aria-label="Anledning" aria-invalid={Boolean(issue)} aria-describedby={issue ? "round-not-done-issue" : undefined} className="form-textarea"
          maxLength={NOT_DONE_REASON_MAX} value={reason} placeholder="Till exempel: anläggningen var avställd" onChange={(event) => setReason(event.target.value)} onBlur={() => setTouched(true)} />
      </label>
      {issue ? <p id="round-not-done-issue" className="text-xs text-destructive">{issue}</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <DialogActions cancel={{ onClick: close }} primary={{ label: "Markera Ej utfört", type: "submit", busy, busyLabel: "Sparar…", testId: "round-not-done-confirm" }} />
    </form>
  </Modal>;
}

"use client";

import { useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { CANCEL_REASON_MAX, cancelReasonSchema } from "@/lib/workflow/task-cancel";
import { formatSwedish } from "@/lib/swedish-time";

/**
 * Utgår (2026-10-09): the small dialog that sets a job to Utgår with a short, required reason (never the browser's
 * confirm), and the notice a job that has utgått shows above its panels with the reason and Återuppta. The server decides.
 */
export function TaskCancelDialog({ open, onOpenChange, docWord, busy, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Arbetsordern", "Protokollet" or "Riskbedömningen". */
  docWord: string;
  busy: boolean;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const parsed = cancelReasonSchema.safeParse(reason);
  const issue = touched && !parsed.success ? parsed.error.issues[0]?.message ?? "" : "";
  const close = (value: boolean) => { if (!value) { setReason(""); setTouched(false); } onOpenChange(value); };
  const submit = async () => {
    setTouched(true);
    if (!parsed.success) return;
    if (await onConfirm(parsed.data)) close(false);
  };
  return <Modal open={open} onOpenChange={close} title="Sätt jobbet till Utgår" size="compact">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="text-sm text-muted-foreground">{docWord} görs inte men sparas skrivskyddad med sin historik. Det räknas inte som öppet, förfallet eller återstående. Du kan återuppta det senare.</p>
      <label className="block space-y-2 text-xs font-medium text-muted-foreground">Orsak
        <textarea id="task-cancel-reason" aria-label="Orsak" aria-invalid={Boolean(issue)} aria-describedby={issue ? "task-cancel-reason-issue" : undefined} className="form-textarea"
          maxLength={CANCEL_REASON_MAX} value={reason} placeholder="Till exempel: kunden avbeställde, ingår i en annan arbetsorder" onChange={(event) => setReason(event.target.value)} onBlur={() => setTouched(true)} />
      </label>
      {issue ? <p id="task-cancel-reason-issue" className="text-xs text-destructive">{issue}</p> : null}
      <DialogActions cancel={{ onClick: () => close(false) }} primary={{ label: "Sätt till Utgår", type: "submit", busy, busyLabel: "Sparar…", testId: "task-cancel-confirm" }} />
    </form>
  </Modal>;
}

/** The notice on a job that has utgått: when, why, and Återuppta for those who may edit it. */
export function TaskCancelledNotice({ docWord, reason, at, canRestore, busy, onRestore }: {
  docWord: string; reason: string; at?: string | null; canRestore: boolean; busy: boolean; onRestore: () => void;
}) {
  return <div className="notice flex flex-wrap items-start justify-between gap-3" role="status" data-testid="task-cancelled-notice">
    <div className="min-w-0 space-y-1">
      <p className="flex items-center gap-2 font-medium"><Ban aria-hidden="true" className="size-4 shrink-0" />{docWord} har utgått{at ? ` ${formatSwedish(at, { dateStyle: "short" })}` : ""} och är skrivskyddad.</p>
      {reason ? <p className="text-sm">Orsak: {reason}</p> : null}
      <p className="text-xs text-muted-foreground">Jobbet räknas inte som öppet eller förfallet. Rapporten blir inte färdigställd.</p>
    </div>
    {canRestore ? <Button type="button" variant="outline" disabled={busy} onClick={onRestore} data-testid="task-restore"><RotateCcw />Återuppta</Button> : null}
  </div>;
}

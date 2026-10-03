"use client";

import { useState } from "react";
import { AlertTriangle, Info, LoaderCircle, OctagonAlert, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { useAiAvailable } from "@/features/ai/proposal-client";

type Finding = { severity: "INFO" | "WARNING" | "CRITICAL"; where: string; title: string; explanation: string; recommendation: string };
type Review = { summary: string; findings: Finding[]; limitations: string[]; disclaimer: string };

const SEVERITY = {
  CRITICAL: { label: "Bör stoppa arbetet tills det är bedömt", icon: OctagonAlert, box: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30", tone: "text-red-700 dark:text-red-300" },
  WARNING: { label: "Bör kontrolleras", icon: AlertTriangle, box: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30", tone: "text-amber-700 dark:text-amber-300" },
  INFO: { label: "Upplysning", icon: Info, box: "border-border bg-muted/20", tone: "text-primary" },
} as const;

/**
 * "Granska med AI" (plan 2026-10-01, fas 3): Workflow AI's reviewer reads the saved protocol's technical values and
 * points at what a careful colleague would ask about. It changes nothing and decides nothing: the review is shown
 * for the person to read, always with the reminder that a behörig person makes the assessment. Shown only where the
 * company's AI is on.
 */
export function ProtocolReview({ taskId, controlId, disabled, unsaved }: { taskId?: string; controlId?: string; disabled?: boolean; unsaved?: string }) {
  const available = useAiAvailable();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  if (!available) return null;
  async function ask() {
    setOpen(true); setBusy(true); setReason(""); setReview(null);
    try {
      const response = await fetch("/api/ai/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(taskId ? { taskId } : { controlId }) });
      const result = await response.json().catch(() => ({})) as { review?: Review | null; reason?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Workflow AI kunde inte granska just nu.");
      if (!result.review) { setReason(result.reason || "Workflow AI kunde inte granska just nu."); return; }
      setReview(result.review);
    } catch (issue) { setReason(issue instanceof Error ? issue.message : "Workflow AI kunde inte granska just nu."); } finally { setBusy(false); }
  }
  return <>
    <Button type="button" variant="outline" disabled={disabled || busy || Boolean(unsaved) || (!taskId && !controlId)} onClick={() => void ask()}
      title={unsaved || "Workflow AI granskar de sparade mätvärdena och pekar på det som bör kontrolleras. Ingenting ändras. Kostar krediter."} data-testid="protocol-review-ai">
      <ScanSearch />Granska med AI
    </Button>
    <Modal open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }} title="Granskning av Workflow AI" className="max-w-2xl">
      <div className="space-y-4" data-testid="protocol-review">
        {busy ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Workflow AI läser de sparade mätvärdena …</p> : null}
        {review ? <>
          <p className="text-sm leading-6" data-testid="protocol-review-summary">{review.summary}</p>
          {review.findings.length ? <ul className="max-h-[50vh] space-y-2 overflow-y-auto">{review.findings.map((finding, index) => {
            const severity = SEVERITY[finding.severity];
            const Icon = severity.icon;
            return <li key={`${finding.where}-${index}`} className={cn("rounded-lg border p-3 text-sm", severity.box)} data-testid="protocol-review-finding" data-severity={finding.severity}>
              <p className="flex items-start gap-2 font-medium"><Icon className={cn("mt-0.5 size-4 shrink-0", severity.tone)} aria-hidden="true" /><span>{finding.title}<span className="sr-only"> – {severity.label}</span></span></p>
              <p className="mt-1 text-xs text-muted-foreground">{finding.where} · {severity.label}</p>
              <p className="mt-2 leading-6">{finding.explanation}</p>
              <p className="mt-1 leading-6"><span className="font-medium">Kontrollera: </span>{finding.recommendation}</p>
            </li>;
          })}</ul> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Granskningen hittade inget att anmärka på i de sparade värdena.</p>}
          {review.limitations.length ? <div className="text-xs leading-5 text-muted-foreground"><p className="font-medium">Det här kunde inte bedömas:</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{review.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          <p className="notice text-xs" data-testid="protocol-review-disclaimer">{review.disclaimer}</p>
        </> : null}
        {reason ? <p role="alert" className="text-sm leading-6">{reason}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Stäng</Button>
        </div>
      </div>
    </Modal>
  </>;
}

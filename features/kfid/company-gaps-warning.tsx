"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompanyGapsNote } from "./company-details-form";

/**
 * The warning in the dialogs that send a quote or an invoice basis (2026-11-04): what the company's documents still lack,
 * with a link to Företagsuppgifter. Sending is still allowed. Only a company administrator gets an answer from the server; for
 * anybody else, in the demo, or when the answer fails, nothing is shown. Nothing here reaches the customer's own quote link.
 */
export function CompanyGapsWarning({ className }: { className?: string }) {
  const [gaps, setGaps] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => {
    if ((window as typeof window & { __workflowDemo?: boolean }).__workflowDemo) return;
    let active = true;
    void fetch("/api/company-gaps", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { gaps?: { key: string; label: string }[] } | null) => { if (active && data?.gaps) setGaps(data.gaps); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!gaps.length) return null;
  return <div className={className} data-testid="company-gaps-warning">
    <CompanyGapsNote gaps={gaps} testId="company-gaps-warning-note" />
    <p className="mt-1 text-xs text-muted-foreground">Det går att skicka ändå. <Link href="/?view=company" className="font-medium text-primary underline underline-offset-4" data-testid="company-gaps-link">Fyll i under Företagsuppgifter</Link>.</p>
  </div>;
}

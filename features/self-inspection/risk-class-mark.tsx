"use client";

import { UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { RISK_CLASS_TEXTS, type RiskClass } from "@/lib/self-inspection/levels";

/**
 * A task type's required level ("Krävd nivå", 2026-10-07; called so instead of risk class since 2026-10-09) as a
 * small neutral mark (it is about the person, not a danger, 2026-10-09). Workflow's proposal says so ("förslag") until the company's admin sets a
 * level of their own under Egenkontroll → Krävd nivå.
 */
export function RiskClassMark({ value, suggested = false, className, onClick }: { value: RiskClass; suggested?: boolean; className?: string;
  /** An admin changes the class from the mark (a card under Ny uppgift); everyone else sees a plain label. */
  onClick?: () => void }) {
  const title = `Krävd nivå: ${RISK_CLASS_TEXTS[value]}.${suggested ? " Förslag från Workflow tills företagets administratör sätter en egen nivå." : ""}${onClick ? " Välj för att ändra." : ""}`;
  const classes = cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", indicatorBadge("neutral"), onClick && "cursor-pointer hover:brightness-95", className);
  const content = <><UserCheck className="size-3" aria-hidden="true" />Kräver nivå {value}{suggested ? " · förslag" : ""}</>;
  return onClick
    ? <button type="button" data-testid="risk-class-mark" data-risk-class={value} data-suggested={suggested || undefined} title={title} aria-label={`Krävd nivå ${value}${suggested ? " (förslag)" : ""}. Ändra krävd nivå.`} onClick={onClick} className={classes}>{content}</button>
    : <span data-testid="risk-class-mark" data-risk-class={value} data-suggested={suggested || undefined} title={title} className={classes}>{content}</span>;
}

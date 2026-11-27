import { cn } from "@/lib/utils";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";

/** The small status mark on Tjänster och nycklar (a key's state, its source, the central storage). */
export function StatusPill({ tone, children, testId }: { tone: IndicatorTone; children: React.ReactNode; testId?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium", indicatorBadge(tone))} data-testid={testId}>{children}</span>;
}

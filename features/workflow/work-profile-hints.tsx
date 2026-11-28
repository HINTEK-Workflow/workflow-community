"use client";

import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkProfile } from "@/features/workflow/use-work-view";
import { WORK_PROFILE } from "@/lib/workflow/work-profile";
import { cn } from "@/lib/utils";

/** The address that opens Visning, where the profile is chosen: Mer on the phone has the same row. */
const DISPLAY_SETTINGS_HREF = "/?view=settings&step=display";

/**
 * An empty list says what to do next for the person's work (2026-11-04): the yrkesprofil's first steps, without this page. Only what
 * the person may use reaches here (the shell filters by menuItemAllowed), and without a profile nothing is drawn.
 */
export function WorkProfileNextSteps({ here, className, center = false }: { here: string; className?: string; center?: boolean }) {
  const shell = useWorkProfile();
  const profile = shell?.effective.profile;
  const steps = (shell?.firstSteps ?? []).filter((step) => step.menu !== here).slice(0, 2);
  if (!profile || !steps.length) return null;
  return <div className={className} data-testid="work-profile-next-steps">
    <p className="text-xs text-muted-foreground">Som {WORK_PROFILE[profile].label} kan du också</p>
    <div className={center ? "mt-2 flex flex-wrap justify-center gap-2" : "mt-2 flex flex-wrap gap-2"}>
      {steps.map((step) => <Button key={step.href} asChild variant="outline" size="sm"><Link href={step.href}>{step.title}</Link></Button>)}
    </div>
  </div>;
}

/** The way to change what is shown (a profile only sets defaults, the person's own choice wins): at the foot, so nothing above it moves. */
export function WorkProfileChangeLink({ className }: { className?: string }) {
  const profile = useWorkProfile()?.effective.profile;
  if (!profile) return null;
  // On the phone the words and the link stand on their own lines (2026-11-28): side by side the link's 44 px touch
  // height pushed the words out of line. From sm they share one row, centred.
  return <p className={cn("flex flex-col items-start sm:flex-row sm:items-center sm:gap-1", className)} data-testid="work-profile-change">
    <span className="text-xs text-muted-foreground">Förval för {WORK_PROFILE[profile].label}.</span>
    <Link href={DISPLAY_SETTINGS_HREF} className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline sm:min-h-0"><SlidersHorizontal className="size-3.5" aria-hidden="true" />Ändra vad du ser</Link>
  </p>;
}

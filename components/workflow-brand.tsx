"use client";
import Link from "next/link";
import type { ShellBranding } from "@/lib/branding";
import { useInstance } from "@/components/instance-provider";
import { cn } from "@/lib/utils";

// 2026-09-26: the shell always shows the installation's name. A customer's uploaded logo belongs on reports and
// drives the Customer theme colors, but is never shown in navigation. Since 2026-10-03 the name is text only, in the
// self-hosted Gugi font, in every theme ("ta bort loggan och använd bara denna"); the favicon stays.
export function WorkflowBrand({
  className,
}: {
  branding?: ShellBranding;
  className?: string;
}) {
  const instance = useInstance();
  return (
    <Link
      href="/"
      className={cn(
        "flex w-full min-w-0 items-center gap-3 overflow-hidden",
        className,
      )}
      aria-label={`${instance.name} startsida`}
    >
      <span className="workflow-brand-text" data-testid="brand-text">{instance.name}</span>
    </Link>
  );
}

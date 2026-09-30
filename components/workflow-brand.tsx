"use client";
/* eslint-disable @next/next/no-img-element -- Static wordmark variants are selected by theme in CSS. */
import Link from "next/link";
import type { ShellBranding } from "@/lib/branding";
import { useInstance } from "@/components/instance-provider";
import { cn } from "@/lib/utils";

function HintekWordmark() {
  return (
    <img
      src="/brand/hintek-workflow-wordmark.png"
      srcSet="/brand/hintek-workflow-wordmark-512.png 512w, /brand/hintek-workflow-wordmark-1024.png 1024w, /brand/hintek-workflow-wordmark.png 1673w"
      sizes="(max-width: 1023px) 13rem, 12rem"
      alt=""
      aria-hidden="true"
      className="hintek-wordmark h-12 w-52 shrink-0 object-contain object-left"
    />
  );
}

// Daniel 2026-09-26: the shell always shows HINTEK Workflow. A customer's uploaded logo belongs on reports and
// drives the Customer theme colors, but is never shown in navigation. HINTEK Blue uses a Gugi text wordmark.
// Fas 1: another installation shows its own name as text; HINTEK's wordmark image only belongs to the default name.
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
      {instance.defaultBrand ? <HintekWordmark /> : null}
      <span className={instance.defaultBrand ? "workflow-brand-text" : "truncate text-lg font-semibold"} aria-hidden={instance.defaultBrand || undefined}>{instance.name}</span>
    </Link>
  );
}

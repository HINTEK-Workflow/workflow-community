"use client";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import type { ShellBranding } from "@/lib/branding";
import { useInstance } from "@/components/instance-provider";
import { cn } from "@/lib/utils";

type BrandFit = "full" | "short" | "none";

// 2026-09-26: the shell always shows the installation's name. A customer's uploaded logo belongs on reports and
// drives the Customer theme colors, but is never shown in navigation. Since 2026-10-03 the name is text only, in the
// self-hosted Gugi font, in every theme ("ta bort loggan och använd bara denna"); the favicon stays.
// The name is never cut (design standard, 2026-10-10): the whole name where it fits, else its first word ("HINTEK"),
// else nothing – measured against the room the bar actually leaves, so a running timer, a narrow phone (360 px at level
// 2–3 cut it to "Workflow Work", simulation 0.6.3) or a longer installation name all give whole words.
export function WorkflowBrand({
  className,
  href = "/",
}: {
  /** Where the name leads; the sign-in pages pass the public start page (lib/public-site.ts, startHref). */
  href?: string;
  branding?: ShellBranding;
  className?: string;
}) {
  const instance = useInstance();
  const short = instance.name.split(/\s+/)[0];
  const link = useRef<HTMLAnchorElement | null>(null);
  const fullRuler = useRef<HTMLSpanElement | null>(null);
  const shortRuler = useRef<HTMLSpanElement | null>(null);
  const [fit, setFit] = useState<BrandFit>("full");
  useLayoutEffect(() => {
    const box = link.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const room = box.clientWidth;
      // Not drawn (the top bar's brand on a computer is display: none): nothing to decide.
      if (!room) return;
      const full = fullRuler.current?.getBoundingClientRect().width ?? 0;
      const first = shortRuler.current?.getBoundingClientRect().width ?? 0;
      setFit(full <= room + 0.5 ? "full" : first <= room + 0.5 ? "short" : "none");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [instance.name]);
  return (
    <Link
      ref={link}
      href={href}
      className={cn(
        // 44 px tall on touch screens and below 1024 px (touch-target rule); overflow-hidden would clip a grown ::after.
        "relative flex w-full min-w-0 items-center gap-3 overflow-hidden max-lg:min-h-11 pointer-coarse:min-h-11",
        className,
      )}
      aria-label={`${instance.name} startsida`}
      data-brand-fit={fit}
    >
      {fit === "none" ? null : <span className="workflow-brand-text" data-testid="brand-text">{fit === "full" ? instance.name : short}</span>}
      {/* Rulers in the same font and size – the whole name and its first word – never seen. */}
      <span ref={fullRuler} className="workflow-brand-text workflow-brand-ruler" aria-hidden="true">{instance.name}</span>
      <span ref={shortRuler} className="workflow-brand-text workflow-brand-ruler" aria-hidden="true">{short}</span>
    </Link>
  );
}

"use client";
import { useId, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { Switch } from "@/components/ui/switch";
import type { IndicatorTone } from "@/features/workflow/indicator-tone";
import { cn } from "@/lib/utils";
import { StatusPill } from "./status-pill";
import type { ServiceToggle } from "./server-key-status";

/**
 * Översikt överst på sidan med nycklar och kopplingar (2026-11-11), the same on Tjänster och nycklar and under Kopplingar:
 * one tile per category, and in it one row per service with its connection status (Fungerar, Saknas, Fel …) and – apart from
 * it – its on/off switch, named, where the service can be switched. A switch saves at once: the page's toast says what
 * happened, and a switch that could not be changed goes back. The cards below hold the keys; on/off lives only here.
 */
export type OverviewService = { id: string; name: string; status: { label: string; tone: IndicatorTone; detail?: string } | null | undefined; toggle?: ServiceToggle };
export type OverviewCategory = { id: string; title: string; icon: LucideIcon; anchor?: string; services: OverviewService[] };

export function KeyOverview({ categories, actions, top, testId = "key-overview" }: {
  categories: OverviewCategory[]; actions?: React.ReactNode;
  /** A line above the tiles (the backup copy on Tjänster och nycklar). */
  top?: React.ReactNode; testId?: string;
}) {
  const jump = (event: React.MouseEvent<HTMLAnchorElement>, anchor: string) => {
    const target = document.getElementById(anchor);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const one = categories.length === 1;
  const titleId = useId();
  // Rutorna står för sig själva (2026-11-12): no card around the tiles and no lines between the rows; the heading with
  // its actions (Kontrollera och synka) and the line above the tiles stand over them, like a group's heading on the page.
  return <section className="space-y-3" aria-labelledby={titleId} data-testid={`${testId}-section`}>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 id={titleId} className="section-title">Översikt</h2>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
    {top}
    <div className="@container min-w-0">
      <ul className={cn("grid list-none gap-3 p-0", !one && "@2xl:grid-cols-2 @6xl:grid-cols-3")} aria-label="Tjänsternas status och av/på" data-testid={testId}>
        {/* Rubrikband (2026-11-21, variant A): the tile's title row on the grey band with a line under it, the rows on
            the card's white; flat, no shadow. A lone category has no title row and so no band. */}
        {categories.map((category) => <li key={category.id} className="min-w-0 overflow-hidden rounded-lg border bg-card" data-testid="key-overview-category" data-section={category.id}>
          {one ? null : <a href={category.anchor ? `#${category.anchor}` : undefined} onClick={category.anchor ? (event) => jump(event, category.anchor!) : undefined} data-testid="server-keys-overview-item" data-section={category.id}
            className="card-head flex min-h-11 min-w-0 items-center gap-3 px-3 py-2 transition-colors hover:text-primary" data-card-head="">
            <AreaIcon area="admin" icon={category.icon} />
            <span className="block min-w-0 truncate text-sm font-semibold" data-card-title>{category.title}</span>
          </a>}
          {/* One grid for the tile's rows (each row a subgrid), so the statuses stand in one column and the switches in theirs. */}
          <ul className="grid list-none grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-1 @md:grid-cols-[minmax(0,1fr)_auto_11rem]" data-key-overview-rows="">
            {category.services.map((service) => <OverviewRow key={service.id} service={service} />)}
          </ul>
        </li>)}
      </ul>
    </div>
  </section>;
}

function OverviewRow({ service }: { service: OverviewService }) {
  const { status, toggle } = service;
  const problem = status?.detail && (status.tone === "danger" || status.tone === "warning") ? status.detail : null;
  return <li className="col-span-full grid min-h-11 grid-cols-subgrid items-center gap-y-1 py-1.5" data-testid="key-overview-service" data-service={service.id}>
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium" title={service.name}>{service.name}</span>
      {problem ? <span className="line-clamp-2 text-xs leading-4 text-muted-foreground" data-testid="key-overview-problem">{problem}</span> : null}
    </span>
    {/* Left in its column, so every status of the tile starts at the same place. */}
    <span className="flex justify-start" data-testid="key-overview-status"><StatusPill tone={status?.tone ?? "neutral"}>{status?.label ?? "Hämtar…"}</StatusPill></span>
    {/* The switch's own column (reserved also where there is none), so the rows line up. */}
    <span className="col-span-2 flex min-w-0 justify-end @md:col-span-1">{toggle ? <OverviewSwitch name={service.name} toggle={toggle} id={service.id} /> : null}</span>
  </li>;
}

function OverviewSwitch({ id, name, toggle }: { id: string; name: string; toggle: ServiceToggle }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const shown = pending ?? toggle.on;
  const reason = toggle.disabledReason ?? null;
  const change = async (next: boolean) => {
    setPending(next);
    try { await toggle.onChange(next); } finally { setPending(null); }
  };
  const switchId = `overview-switch-${id}`;
  return <span className="flex min-w-0 items-center gap-2" title={reason ?? undefined}>
    <label htmlFor={switchId} className="min-w-0 cursor-pointer text-right text-xs leading-4 text-muted-foreground"><span className="line-clamp-2">{toggle.label}</span></label>
    <Switch id={switchId} checked={shown} disabled={pending !== null || Boolean(reason)} aria-label={`${name}: ${toggle.label}`} aria-describedby={reason ? `${switchId}-reason` : undefined}
      onCheckedChange={(next) => void change(next)} data-testid={toggle.testId ?? "service-switch"} data-service-switch="" data-service={id} data-disabled-reason={reason ?? undefined} />
    {reason ? <span id={`${switchId}-reason`} className="sr-only">{reason}</span> : null}
    <span className={cn("w-5 shrink-0 text-xs font-medium", shown ? "text-foreground" : "text-muted-foreground")} data-testid="key-overview-switch-state">{shown ? "På" : "Av"}</span>
  </span>;
}

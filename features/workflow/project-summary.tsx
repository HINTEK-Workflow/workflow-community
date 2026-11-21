"use client";

import { Input } from "@/components/ui/input";
import { ListToolbar, PageHeader } from "@/components/page-shell";
import { useEntryState } from "@/components/history-nav";
import { swedishDayKey } from "@/lib/swedish-time";
import { ProjectStatistics } from "./project-statistics";
import { PortfolioIssues, PortfolioTable, usePortfolio } from "./project-portfolio";

/**
 * Projektsammanställning (2026-10-09): the statistics across the company's projects as a page of its own under
 * Projekt – the same figures as Översikt → Statistik → Projekt (`/api/project-statistics`, company admins in Cloud).
 * The period and grouping are kept when the person opens a project and comes back. Above the statistics sits the portfolio
 * (plan 1M, 2026-10-11): one row per ongoing project with its figures, and the obstacles and delays across projects.
 */
export function ProjectSummaryPage() {
  const today = swedishDayKey(new Date());
  const [filters, setFilters] = useEntryState("project-summary", { from: `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`, to: today, bucket: "auto" });
  const { data: portfolio, error: portfolioError } = usePortfolio();
  const [filter, setFilter] = useEntryState<"ongoing" | "closed">("project-summary.portfolio", "ongoing");
  return <div data-testid="project-summary">
    {/* No button to Planering (2026-10-30): both are reached from the page Projekt. */}
    <PageHeader title="Projektstatistik" description="Företagets projekt: hinder, förfallet, startade, avslutade, status och ansvariga." />
    <div className="mb-6 space-y-6">
      <PortfolioTable portfolio={portfolio} error={portfolioError} filter={filter} onFilter={setFilter} />
      {portfolio ? <PortfolioIssues issues={portfolio.issues} /> : null}
    </div>
    <ListToolbar label="Period och gruppering" className="mb-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">Från datum
          <Input type="date" aria-label="Från datum" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Till datum
          <Input type="date" aria-label="Till datum" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Gruppering
          <select className="form-select" aria-label="Gruppering" value={filters.bucket} onChange={(event) => setFilters((current) => ({ ...current, bucket: event.target.value }))}>
            <option value="auto">Automatisk</option>
            <option value="day">Dag</option>
            <option value="week">Vecka</option>
            <option value="month">Månad</option>
          </select>
        </label>
      </div>
    </ListToolbar>
    <ProjectStatistics from={filters.from} to={filters.to} bucket={filters.bucket} />
  </div>;
}

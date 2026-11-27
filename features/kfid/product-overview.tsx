"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, CreditCard, FileText, KeyRound, PlayCircle, Server } from "lucide-react";
import { PageHeader, PageSkeleton } from "@/components/page-shell";
import { RowChevron } from "@/components/row-chevron";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { COMPANY_PAYMENT_LABEL, COMPANY_PAYMENT_TONE, paymentSumText } from "@/lib/kfid/customer-company-list";
import { companyHref, NEW_COMPANY_DAYS, type ProductOverview } from "@/lib/kfid/product-overview";
import { SERVER_UPDATES_HREF } from "@/lib/ops/host-status";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { api } from "./api";
import { Empty, Panel } from "./ui";

const day = (iso: string | null) => iso ? formatSwedish(iso, { dateStyle: "medium" }) : "";
const rowClass = "tap-card flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)]";
/** A card's way to another page (sidans knappar, 2026-11-02): an outline button in the card's head, not a bare text link. */
const GoTo = ({ href, children }: { href: string; children: React.ReactNode }) => <Button asChild size="sm" variant="outline"><Link href={href}>{children}</Link></Button>;

/** Produktöversikten (beslut 11, 2026-11-01): the superadmin's start page. Metadata only; the server decides who reads it. */
export function ProductOverviewPage() {
  const [data, setData] = useState<ProductOverview | null>(null);
  const [error, setError] = useState("");
  useLoadEffect(async () => {
    try { setData(await api<ProductOverview>("/api/superadmin/product-overview", { cache: "no-store" })); }
    catch (cause) { setError((cause as Error).message); }
  });
  return <div className="space-y-6" data-testid="product-overview">
    <PageHeader title="Produktöversikt" description="Det som behöver din uppmärksamhet just nu." />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    {!data && !error ? <PageSkeleton title={false} panels={2} rows={3} label="Hämtar översikten…" /> : null}
    {data ? <div className="@container"><div className="grid items-start gap-6 @4xl:grid-cols-2 [&>*]:min-w-0">
      {data.paymentProblems ? <Panel icon={CreditCard} title="Betalningar att åtgärda" data-testid="overview-payments">
        {data.paymentProblems.length ? <ul className="divide-y rounded-lg border">{data.paymentProblems.map((item) => <li key={item.id}>
          <Link href={companyHref(item.id)} className={rowClass} data-testid="overview-payment-row">
            <span className="min-w-0 flex-1 basis-40 truncate font-medium">{item.name}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{paymentSumText(item.ore)}{item.since ? ` · sedan ${day(item.since)}` : ""}</span>
            <Badge variant="outline" className={indicatorBadge(COMPANY_PAYMENT_TONE[item.status])}>{COMPANY_PAYMENT_LABEL[item.status]}</Badge>
            <RowChevron />
          </Link>
        </li>)}</ul> : <Empty compact title="Inga betalningsproblem" description="Alla betalningar är i ordning." />}
      </Panel> : null}
      <Panel icon={Building2} title="Kundföretag" actions={<GoTo href="/?view=customer_companies">Alla företag</GoTo>}>
        <dl className="mb-3 grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Totalt</dt><dd className="font-semibold tabular-nums">{data.counts.total}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Aktiva</dt><dd className="font-semibold tabular-nums">{data.counts.active}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Pausade</dt><dd className="font-semibold tabular-nums">{data.counts.paused}</dd></div>
        </dl>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Nya senaste {NEW_COMPANY_DAYS} dagarna</h3>
        {data.newCompanies.length ? <ul className="divide-y rounded-lg border">{data.newCompanies.map((item) => <li key={item.id}>
          <Link href={companyHref(item.id)} className={rowClass}><span className="min-w-0 flex-1 basis-40 truncate font-medium">{item.name}</span><span className="text-xs tabular-nums text-muted-foreground">{day(item.createdAt)}</span><RowChevron /></Link>
        </li>)}</ul> : <Empty compact title="Inga nya företag" description={`Inget företag har skapats de senaste ${NEW_COMPANY_DAYS} dagarna.`} />}
      </Panel>
      {/* Besök (2026-11-04): demo starts, a short figure with the way to Beteendeanalys. Visits, not people. */}
      {data.visits ? <Panel icon={PlayCircle} title="Besök" actions={<GoTo href="/?view=behavior_analytics">Beteendeanalys</GoTo>} data-testid="overview-visits">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Demostarter</dt><dd className="text-xl font-semibold tabular-nums" data-testid="overview-visits-demo">{data.visits.demoStarts.toLocaleString("sv-SE")}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Startsidan</dt><dd className="text-xl font-semibold tabular-nums" data-testid="overview-visits-landing">{(data.visits.landing ?? 0).toLocaleString("sv-SE")}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Tillåter statistik</dt><dd className="text-xl font-semibold tabular-nums">{data.visits.consentRate == null ? "–" : `${data.visits.consentRate.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} %`}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Senaste {data.visits.days} dagarna. Besök, inte personer; startsidan räknas bara med samtycke.</p>
      </Panel> : null}
      {/* Utgångna och snart utgående (kundresa 2026-11-07, M44), each row to Tjänster och nycklar. */}
      <Panel icon={KeyRound} title="Nycklar att förnya" actions={<GoTo href="/?view=server_keys">Tjänster och nycklar</GoTo>}>
        {data.keys.length ? <ul className="divide-y rounded-lg border" data-testid="overview-keys">{data.keys.map((key) => <li key={key.id}>
          <Link href="/?view=server_keys" className={rowClass}>
            <span className="min-w-0 flex-1 basis-40 truncate font-medium">{key.name}</span>
            <span className={key.expired ? "text-xs font-medium tabular-nums text-destructive" : "text-xs tabular-nums text-muted-foreground"}>{key.expired ? `Gick ut ${day(key.expiresAt)}` : `Går ut ${day(key.expiresAt)}`}</span>
            <RowChevron />
          </Link>
        </li>)}</ul> : <Empty compact title="Inget att förnya" description="Ingen nyckel har gått ut eller går ut de närmaste två veckorna." />}
      </Panel>
      <Panel icon={Server} title="Servrar och driftlarm" actions={<GoTo href={SERVER_UPDATES_HREF}>Servrarna</GoTo>}>
        {data.serverAlarms.length ? <ul className="space-y-2 text-sm">{data.serverAlarms.map((line) => <li key={line} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{line}</span></li>)}</ul>
          : <Empty compact title="Inga larm" description="Servrarna har inget att rapportera." />}
      </Panel>
      {/* PDF-mallar (2026-11-03): an upgrade changed a default under the owner's own text; only shown while something waits. */}
      {data.pdfTemplatesFlagged ? <Panel icon={FileText} title="PDF-mallar" actions={<GoTo href="/?view=pdf_templates">Öppna mallarna</GoTo>}>
        <p className="flex items-center gap-2 text-sm" data-testid="overview-pdf-templates"><Badge variant="outline" className={indicatorBadge("warning")}>{data.pdfTemplatesFlagged}</Badge>block där förvalet ändrades efter en uppdatering.</p>
      </Panel> : null}
    </div></div> : null}
  </div>;
}

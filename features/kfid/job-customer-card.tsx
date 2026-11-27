"use client";

import Link from "next/link";
import { ClipboardList, Contact, MapPin } from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { customerTitle } from "@/lib/kfid/customer-name";
import type { JobCustomerCardData } from "@/lib/kfid/job-access";
import { Panel } from "./ui";

type ContactFields = { name?: string; company?: string; address?: string; postalCode?: string; city?: string; email?: string; phone?: string; mobile?: string };

/**
 * Kunden via jobbet (beslut 10, 2026-11-01): what a person with a job at the customer sees without the right Kunder.
 * Contact, the job's place and the person's own jobs here; the server sends nothing else (lib/kfid/job-access.ts).
 */
export function JobCustomerCard({ data }: { data: Pick<JobCustomerCardData, "customer" | "places" | "jobs"> }) {
  const customer = data.customer as ContactFields;
  const title = customerTitle({ name: customer.name ?? "", company: customer.company ?? "", customerType: (data.customer as { customerType?: string }).customerType ?? null });
  const addressOf = (place: Pick<ContactFields, "address" | "postalCode" | "city">) => [place.address, [place.postalCode, place.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const contact: [string, string | undefined][] = [["Företag", customer.company], ["Kontaktperson", customer.name], ["Adress", addressOf(customer)], ["E-post", customer.email], ["Telefon", customer.phone], ["Mobil", customer.mobile]];
  return <div className="space-y-6" data-testid="job-customer-card">
    <PageHeader title={title} description="Det du behöver för ditt jobb hos kunden." />
    <div className="@container"><div className="grid items-start gap-6 @4xl:grid-cols-2 [&>*]:min-w-0">
      <Panel icon={Contact} title="Kontaktuppgifter">
        <dl className="grid gap-3 text-sm @lg:grid-cols-2">
          {contact.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="[overflow-wrap:anywhere]">{value}</dd></div>)}
        </dl>
      </Panel>
      <Panel icon={MapPin} title="Plats">
        {data.places.length ? <ul className="space-y-2 text-sm" data-testid="job-customer-places">{data.places.map((place) => <li key={place.id}><p className="font-medium [overflow-wrap:anywhere]">{place.name}</p><p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{addressOf(place)}</p></li>)}</ul>
          : <p className="text-sm text-muted-foreground">Jobbet har ingen plats.</p>}
      </Panel>
      <Panel icon={ClipboardList} title="Dina jobb här">
        <ul className="divide-y rounded-lg border text-sm">{data.jobs.map((job) => <li key={job.id}><Link className="tap-card block truncate px-3 py-2" href={`/?view=workflow_task&taskId=${encodeURIComponent(job.id)}&taskType=${encodeURIComponent(job.kind)}`}>{job.title}</Link></li>)}</ul>
      </Panel>
    </div></div>
  </div>;
}

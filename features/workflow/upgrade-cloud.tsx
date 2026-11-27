import { Bot, Cloud, KeyRound, Sparkles, Users } from "lucide-react";
import { Panel } from "@/features/kfid/ui";

/**
 * Cloud-gränsen på ett ställe i appen (plan 1K, 2026-10-11): what exists only in Cloud, the same list as
 * MEMORY.md, each point checked against the code that gates it (lib/workflow/menu-items.ts, lib/catalogue/access.ts,
 * the project page's `!local`, app/api/places/address-lookup, features/kfid/notice-settings.tsx). Display only: the
 * gates themselves are unchanged.
 */
export const CLOUD_ONLY_FEATURES: readonly string[] = [
  "Offerter", "Fakturaunderlag", "Inköp och artiklar", "Personalliggare", "Rapportarkiv", "Tidplan", "Projektstatistik", "Import", "Underhåll", "Operatörssidan",
  "Adressförslag från kartnålen", "E-post och push för notiser", "Workflow AI, API och MCP",
];

/**
 * Uppgradera till Cloud (2026-10-03): a free company in Local meets what Cloud adds instead of a credit balance
 * it cannot use – AI, and therefore credits, only works in Cloud. Buying happens below for the company's admin.
 */
export function UpgradeToCloud({ admin }: { admin: boolean }) {
  const points = [
    { icon: Sparkles, title: "Workflow AI", text: "Chatt, förslag, granskning och import med AI. AI-krediter köps när företaget har Cloud." },
    { icon: Users, title: "Hela teamet", text: "Medarbetare arbetar i samma projekt och uppgifter, från dator, surfplatta och telefon." },
    { icon: Cloud, title: "Lagring på servern", text: "Ingen egen fil att hålla reda på. Filen från Local kan läsas in med serverlagring." },
    { icon: KeyRound, title: "API och MCP", text: "Koppla ChatGPT, Claude eller egna system till företagets data." },
  ];
  return <Panel title="Uppgradera till serverlagring" description="Gratis i Local: arbetsordrar, kontroller, tid och kunder i en egen fil, för en person. Cloud lägger till kollegorna och det som kräver att uppgifterna finns på servern."
    icon={Bot}>
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="upgrade-cloud">
      {points.map((point) => <li key={point.title} className="flex gap-3 rounded-lg border p-3">
        <point.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0"><span className="block truncate text-sm font-medium" title={point.title} data-card-title="">{point.title}</span><span className="block text-xs text-muted-foreground">{point.text}</span></span>
      </li>)}
    </ul>
    <div className="mt-4 space-y-1.5" data-testid="cloud-only-list">
      <p className="text-sm font-medium">Finns bara med serverlagring</p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Finns bara med serverlagring">
        {CLOUD_ONLY_FEATURES.map((feature) => <li key={feature} className="rounded-full border bg-card px-2.5 py-0.5 text-xs text-muted-foreground">{feature}</li>)}
      </ul>
    </div>
    <p className="mt-4 text-sm text-muted-foreground">{admin ? "Beställ Cloud nedan. Krediter för AI kan köpas när Cloud är aktivt." : "Prata med företagets administratör om ni vill uppgradera."}</p>
  </Panel>;
}

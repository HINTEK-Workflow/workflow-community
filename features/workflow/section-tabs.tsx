"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Building2, CreditCard, Factory, FileText, HelpCircle, History, KeyRound, Mail, PanelsTopLeft, Settings2, Sparkles, Tags, Users } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { view: string; label: string; icon: LucideIcon };

/**
 * Menystädning (2026-10-01: "vissa menyval kan ligga under en befintlig knapp"): the company's settings are
 * tabs under Mitt företag, and the product owner's pages tabs under Produktadministration, instead of one menu button
 * each. The pages and their addresses are the same; only the way there changed.
 */
// Since 2026-10-02 also what belongs to the company but lay elsewhere: its places, its report settings and its credits;
// and the product owner's prices and AI, which shared one long page with the customer companies.
export const COMPANY_VIEWS = ["administration", "facilities", "company_settings", "credits", "ai_settings", "integrations", "history_retention"] as const;
export const PRODUCT_VIEWS = ["customer_companies", "pricing_admin", "ai_admin", "landing_editor", "mail_settings"] as const;

export function companyTabs(options: { admin: boolean; cloud: boolean; ai: boolean; integrations: boolean; credits: boolean }): Tab[] {
  return [
    ...(options.admin ? [{ view: "administration", label: "Företag och användare", icon: Users }] : []),
    { view: "facilities", label: "Platser", icon: Factory },
    ...(options.admin ? [{ view: "company_settings", label: "Rapporter och logotyp", icon: FileText }] : []),
    ...(options.credits ? [{ view: "credits", label: "Krediter", icon: CreditCard }] : []),
    ...(options.ai && options.cloud ? [{ view: "ai_settings", label: "HINTEK AI", icon: Sparkles }] : []),
    ...(options.admin && options.cloud && options.integrations ? [{ view: "integrations", label: "API och MCP", icon: KeyRound }] : []),
    ...(options.admin && options.cloud ? [{ view: "history_retention", label: "Historik och lagring", icon: History }] : []),
  ];
}

// Everything that is settings is one menu button, Inställningar, with tabs (2026-10-02: "allt är under
// inställningar"): the person's own settings, the company's pages and Hjälp. Produktadministration holds only what is
// beyond those, and only for the superadmin.
export const SETTINGS_VIEWS = ["settings", "help", ...COMPANY_VIEWS] as const;
export function settingsTabs(options: Parameters<typeof companyTabs>[0]): Tab[] {
  return [{ view: "settings", label: "Mina inställningar", icon: Settings2 }, ...companyTabs(options), { view: "help", label: "Hjälp", icon: HelpCircle }];
}

export function productTabs(options: { landingEditor: boolean; pricing: boolean; ai: boolean }): Tab[] {
  return [
    { view: "customer_companies", label: "Kundföretag", icon: Building2 },
    ...(options.pricing ? [{ view: "pricing_admin", label: "Priser", icon: Tags }] : []),
    ...(options.ai ? [{ view: "ai_admin", label: "AI", icon: Sparkles }] : []),
    ...(options.landingEditor ? [{ view: "landing_editor", label: "Landningssidan", icon: PanelsTopLeft }] : []),
    { view: "mail_settings", label: "E-post", icon: Mail },
  ];
}

export function SectionTabs({ label, tabs, current }: { label: string; tabs: Tab[]; current: string }) {
  const router = useRouter();
  if (tabs.length < 2) return null;
  // No sideways scrolling (2026-10-02: the scroll bar under Inställningar): on a phone one picker; on a wider
  // screen the tabs wrap onto a second line as chips, all visible at once, at most the ordinary content width.
  return <div className="mx-auto mb-6 w-full max-w-[76rem]">
    <label className="block sm:hidden">
      <span className="sr-only">{label}</span>
      <select className="form-select" aria-label={label} value={current} onChange={(event) => router.push(`/?view=${event.target.value}`)} data-testid="section-tabs-picker">
        {tabs.map((tab) => <option key={tab.view} value={tab.view}>{tab.label}</option>)}
      </select>
    </label>
    <nav aria-label={label} className="section-tabs hidden flex-wrap gap-2 border-b pb-4 sm:flex" data-testid="section-tabs">
      {tabs.map((tab) => <Link key={tab.view} href={`/?view=${tab.view}`} aria-current={tab.view === current ? "page" : undefined}
        className={cn("flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors", tab.view === current ? "border-primary/30 bg-secondary font-medium text-secondary-foreground ring-1 ring-primary/15" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
        <tab.icon className={cn("size-4", tab.view === current ? "text-primary" : "")} aria-hidden="true" />{tab.label}
      </Link>)}
    </nav>
  </div>;
}

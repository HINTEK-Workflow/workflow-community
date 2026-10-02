"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Building2, CreditCard, Factory, FileText, History, KeyRound, Mail, PanelsTopLeft, Sparkles, Tags, Users } from "lucide-react";
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
  if (tabs.length < 2) return null;
  // The same width and place on every tab (2026-10-01: the row jumped sideways on Landningssidan, whose page
  // is wider): at most the ordinary content width, centred like it. Only sideways scrolling on a narrow screen – the
  // active tab's underline overlapping the border must never give the row a vertical scrollbar.
  return <nav aria-label={label} className="section-tabs mx-auto mb-6 flex w-full max-w-[76rem] gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--border)]" data-testid="section-tabs">
    {tabs.map((tab) => <Link key={tab.view} href={`/?view=${tab.view}`} aria-current={tab.view === current ? "page" : undefined}
      className={cn("flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm transition-colors", tab.view === current ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground")}>
      <tab.icon className={cn("size-4", tab.view === current ? "text-primary" : "")} aria-hidden="true" />{tab.label}
    </Link>)}
  </nav>;
}

import Link from "next/link";
import { LEGAL_LINKS } from "@ee/present";
import { cn } from "@/lib/utils";
import { pricesHref } from "@/lib/public-site";

/**
 * The one row of legal links (2026-10-08: "samma överallt"): the app's footer, the landing page's footer and every
 * legal document page use it, so the names and the order never differ. Priser is shown where the installation has a
 * landing page with prices; `site` is its separate public address when it has one (lib/public-site.ts).
 */
/**
 * A short label (DPA) keeps its full name for screen readers and as a tooltip (2026-11-11). The name read aloud starts
 * with the visible word, "DPA – Personuppgiftsbiträdesavtal" (WCAG 2.5.3, granskningen 2026-11-24): a word in parentheses
 * does not count as part of the name, so "Personuppgiftsbiträdesavtal (DPA)" did not contain what the link shows.
 */
export const fullName = (link: { label: string }) => {
  const full = (link as { full?: string }).full;
  if (!full) return {};
  const spoken = full.replace(/\s*\([^)]*\)/g, "").trim();
  return { "aria-label": spoken.toLowerCase().includes(link.label.toLowerCase()) ? spoken : `${link.label} – ${spoken}`, title: full };
};

export function LegalLinks({ prices = false, site, className, linkClassName, current, label = "Juridiska dokument" }: { prices?: boolean; site?: string; className?: string; linkClassName?: string; /** The document shown on this page: marked aria-current. */ current?: string; label?: string }) {
  return <nav aria-label={label} className={cn("flex flex-wrap gap-x-4 gap-y-1", className)}>
    {prices ? <Link href={pricesHref(site)} className={linkClassName}>Priser</Link> : null}
    {LEGAL_LINKS.map((link) => <Link key={link.key} href={`/legal/${link.key}`} className={linkClassName} aria-current={current === link.key ? "page" : undefined} {...fullName(link)}>{link.label}</Link>)}
  </nav>;
}

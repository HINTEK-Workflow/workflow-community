import Link from "next/link";
import { WorkflowBrand } from "@/components/workflow-brand";
import { shellBranding } from "@/lib/branding";
import { startHref } from "@/lib/public-site";

export function AuthShell({ title, description, children, below }: { title: string; description: string; children: React.ReactNode; /** Quiet extra content directly under the card (the login page's link to the demo and the news). */ below?: React.ReactNode }) {
  const start = startHref();
  return <main className="public-page flex min-h-dvh flex-col items-center justify-center px-4 py-10">
    {/* The name inside the card, in the brand's dark blue (2026-10-03). */}
    <section className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xs sm:p-8"><WorkflowBrand branding={shellBranding()} className="auth-brand mb-6" href={start} /><h1 className="page-title">{title}</h1><p className="page-description mt-2">{description}</p><div className="mt-7">{children}</div></section>
    {below}
    <Link href={start} className="mt-6 text-sm text-muted-foreground hover:text-foreground" data-testid="auth-start-link">Tillbaka till startsidan</Link>
  </main>;
}

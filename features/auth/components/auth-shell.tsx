import Link from "next/link";
import { WorkflowBrand } from "@/components/workflow-brand";
import { shellBranding } from "@/lib/branding";
import { startHref } from "@/lib/public-site";

/**
 * The card of the sign-in pages (Logga in, Glömt lösenord, Skapa konto, Rapportera fel …). Its content sits in `.auth-form`
 * (app/globals.css, docs/ui-system.md "Inloggningskortet"): every field and button there is 40 px high (44 px on touch), the
 * labels the same size, whichever form component draws them (2026-11-16: "samma utseende").
 */
export function AuthShell({ title, description, children, below }: { title: string; description: string; children: React.ReactNode; /** Quiet extra content directly under the card (the login page's link to Rapportera fel). */ below?: React.ReactNode }) {
  const start = startHref();
  return <main className="public-page flex min-h-dvh flex-col items-center justify-center px-4 py-10">
    {/* The name inside the card, in the brand's dark blue (2026-10-03). */}
    <section className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xs sm:p-8"><WorkflowBrand branding={shellBranding()} className="auth-brand mb-6" href={start} /><h1 className="page-title">{title}</h1><p className="page-description mt-2">{description}</p><div className="auth-form mt-7">{children}</div></section>
    {below}
    <Link href={start} className={`${below ? "mt-3" : "mt-6"} text-sm text-muted-foreground hover:text-foreground`} data-testid="auth-start-link">Tillbaka till startsidan</Link>
  </main>;
}

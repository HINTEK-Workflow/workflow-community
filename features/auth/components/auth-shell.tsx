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
  // On a phone (under 640 px) the card has no frame: the page is the card, from the top, like an app's own sign-in (mobil 2026-11-18, app/globals.css .auth-card).
  return <main className="auth-page public-page flex min-h-dvh flex-col items-center justify-center px-4 py-10">
    {/* The name inside the card, in the brand's dark blue (2026-10-03). */}
    <section className="auth-card w-full max-w-md rounded-xl border bg-card p-6 shadow-xs sm:p-8"><WorkflowBrand branding={shellBranding()} className="auth-brand mb-6" href={start} /><h1 className="page-title">{title}</h1><p className="page-description mt-2">{description}</p><div className="auth-form mt-7">{children}</div></section>
    {below}
    <Link href={start} className={`${below ? "mt-3" : "mt-6"} text-sm text-muted-foreground hover:text-foreground`} data-testid="auth-start-link">Tillbaka till startsidan</Link>
  </main>;
}

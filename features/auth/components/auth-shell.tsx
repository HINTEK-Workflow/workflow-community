import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WorkflowBrand } from "@/components/workflow-brand";
import { shellBranding } from "@/lib/branding";

export function AuthShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
    {/* The name inside the card, in the brand's dark blue (2026-10-03). */}
    <section className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xs sm:p-8"><WorkflowBrand branding={shellBranding()} className="auth-brand mb-6" /><h1 className="page-title">{title}</h1><p className="page-description mt-2">{description}</p><div className="mt-7">{children}</div></section>
    <Link href="/" className="mt-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Tillbaka till startsidan</Link>
  </main>;
}

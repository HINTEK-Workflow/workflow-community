import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Sidan hittades inte" };

/** A mistyped or removed address (totalkontrollen F9, 2026-09-29): the HINTEK look in Swedish, with a way back. */
export default function NotFound() {
  return (
    <main className="landing landing-grid flex min-h-dvh items-center justify-center bg-background px-4 py-16 text-foreground">
      <section className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-[0_24px_60px_-24px_rgba(17,51,81,0.35)]" aria-labelledby="not-found-title">
        <Link href="/" className="landing-brand text-xl" aria-label="HINTEK Workflow startsida">HINTEK Workflow</Link>
        <span className="mx-auto mt-6 flex size-12 items-center justify-center rounded-xl bg-secondary text-primary"><SearchX className="size-6" /></span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">Fel 404</p>
        <h1 id="not-found-title" className="mt-2 text-2xl font-extrabold tracking-tight">Sidan hittades inte</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Adressen finns inte eller har flyttats. Kontrollera stavningen, eller gå vidare härifrån.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/" className="landing-button landing-button-primary"><ArrowLeft className="size-4" />Till startsidan</Link>
          <Link href="/login" className="landing-button landing-button-outline">Logga in</Link>
        </div>
      </section>
    </main>
  );
}

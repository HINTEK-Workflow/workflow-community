import type { Metadata } from "next";
import Link from "next/link";
import { publicInstance } from "@/lib/instance";
import { confirmationValid } from "@/lib/mail/newsletter-subscribers";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `Nyhetsbrev | ${publicInstance().name}`, robots: { index: false, follow: false } };
}

/**
 * Bekräfta nyhetsbrevet (2026-11-12): the link in the confirmation mail opens this page, and only its button makes the
 * address active – a mail filter that opens links in advance confirms nothing (as with Avböj, security review 2026-10-04).
 */
export default async function NewsletterConfirmPage({ searchParams }: { searchParams: Promise<{ status?: string; t?: string }> }) {
  const { status, t } = await searchParams;
  const { name } = publicInstance();
  if (t && !status && (await confirmationValid(t))) return (
    <main className="mx-auto w-full max-w-xl px-4 py-16 sm:px-8">
      <h1 className="page-title">Bekräfta nyhetsbrevet</h1>
      <p className="page-description mt-3">Tryck på knappen för att få nyhetsbrevet från {name} till din e-post.</p>
      <form method="post" action="/api/newsletter/confirm" className="mt-6">
        <input type="hidden" name="t" value={t} />
        <button type="submit" className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="newsletter-confirm">Bekräfta</button>
      </form>
    </main>
  );
  const ok = status === "ok";
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16 sm:px-8">
      <h1 className="page-title">{ok ? "Klart – du får nu nyhetsbrevet" : "Länken fungerar inte"}</h1>
      <p className="page-description mt-3" data-testid="newsletter-confirm-result">
        {ok
          ? "Varje nyhetsbrev har en länk längst ned där du avslutar prenumerationen när du vill."
          : "Länken har redan använts eller gäller inte längre (den gäller i 48 timmar). Du kan anmäla dig igen på webbplatsen."}
      </p>
      <Link href="/" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">Till webbplatsen</Link>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { publicInstance } from "@/lib/instance";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `Nyhetsbrev | ${publicInstance().name}` };
}

/** After the link in a newsletter (2026-10-03). */
export default async function UnsubscribedPage({ searchParams }: { searchParams: Promise<{ status?: string; u?: string; s?: string; t?: string; kind?: string }> }) {
  const { status, u, s, t, kind } = await searchParams;
  // A user's link (?u=) or a landing page subscriber's (?s=, 2026-11-12); the route checks the signature again on the press.
  const who = u ? `u=${encodeURIComponent(u)}` : s ? `s=${encodeURIComponent(s)}` : "";
  const subscriber = Boolean(s) || kind === "subscriber";
  const { name } = publicInstance();
  // The link in the mail asks first (security review 2026-10-04); nothing changes until the button is pressed.
  if (status === "confirm" && who && t) return (
    <main className="mx-auto w-full max-w-xl px-4 py-16 sm:px-8">
      <h1 className="page-title">Avböj nyhetsbrev?</h1>
      <p className="page-description mt-3">{subscriber ? `Du får då inga fler nyhetsbrev från ${name}, och adressen tas bort.` : `Du får då inga fler nyhetsbrev från ${name}. Viktig information om ditt konto och tjänsten kan fortfarande skickas.`}</p>
      <form method="post" action={`/api/newsletter/unsubscribe?${who}&t=${encodeURIComponent(t)}`} className="mt-6">
        <input type="hidden" name="confirm" value="1" />
        <button type="submit" className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="unsubscribe-confirm">Avböj nyhetsbrev</button>
      </form>
    </main>
  );
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16 sm:px-8">
      <h1 className="page-title">{status === "ok" ? "Du får inga fler nyhetsbrev" : "Länken fungerar inte"}</h1>
      <p className="page-description mt-3" data-testid="unsubscribe-result">
        {status === "ok" && subscriber
          ? `Du har avböjt nyhetsbrev från ${name}, och adressen är borttagen. Du kan följa nyhetsbrevet igen på webbplatsen.`
          : status === "ok"
          ? `Du har avböjt nyhetsbrev från ${name}. Viktig information om ditt konto och tjänsten kan fortfarande skickas. Du kan säga ja igen under Mina inställningar.`
          : "Länken är inte giltig. Du kan i stället avböja nyhetsbrev under Mina inställningar → Nyheter i Workflow."}
      </p>
      <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">Till inloggningen</Link>
    </main>
  );
}

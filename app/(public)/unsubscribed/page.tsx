import type { Metadata } from "next";
import Link from "next/link";
import { publicInstance } from "@/lib/instance";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `Nyhetsbrev | ${publicInstance().name}` };
}

/** After the link in a newsletter (2026-10-03). */
export default async function UnsubscribedPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { name } = publicInstance();
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16 sm:px-8">
      <h1 className="page-title">{status === "ok" ? "Du får inga fler nyhetsbrev" : "Länken fungerar inte"}</h1>
      <p className="page-description mt-3" data-testid="unsubscribe-result">
        {status === "ok"
          ? `Du har avböjt nyhetsbrev från ${name}. Viktig information om ditt konto och tjänsten kan fortfarande skickas. Du kan säga ja igen under Mina inställningar.`
          : "Länken är inte giltig. Du kan i stället avböja nyhetsbrev under Mina inställningar → Nyheter i Workflow."}
      </p>
      <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">Till inloggningen</Link>
    </main>
  );
}

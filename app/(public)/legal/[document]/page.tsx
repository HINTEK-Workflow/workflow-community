import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import { LegalDocumentContent } from "@/components/legal-document";

// The published versions (scripts/legal/publish-legal-documents.ts); each document keeps its own version.
const documents = {
  terms: { title: "Tjänstevillkor", version: "2026-09-30.1", file: "terms-2026-09-30.1.md" },
  privacy: { title: "Integritetspolicy", version: "2026-09-30.1", file: "privacy-2026-09-30.1.md" },
  dpa: { title: "Personuppgiftsbiträdesavtal", version: "2026-09-14.1", file: "dpa-2026-09-14.1.md" },
  "credit-terms": { title: "Kreditvillkor", version: "2026-09-30.1", file: "credit-terms-2026-09-30.1.md" },
} as const;

type DocumentKey = keyof typeof documents;

export function generateStaticParams() {
  return Object.keys(documents).map((document) => ({ document }));
}

export async function generateMetadata({ params }: { params: Promise<{ document: string }> }): Promise<Metadata> {
  const { document } = await params;
  const entry = documents[document as DocumentKey];
  return { title: entry ? `${entry.title} | HINTEK Workflow` : "Juridiskt dokument" };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  const entry = documents[document as DocumentKey];
  if (!entry) notFound();
  const content = await readFile(`${process.cwd()}/docs/legal/final/${entry.file}`, "utf8");

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">
          ← Till inloggningen
        </Link>
        <span className="text-xs text-muted-foreground">HINTEK Workflow · version {entry.version}</span>
      </div>
      <article className="rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
        <h1 className="mb-6 text-2xl font-bold">{entry.title}</h1>
        <LegalDocumentContent content={content} />
      </article>
      <nav aria-label="Juridiska dokument" className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link href="/legal/terms" className="hover:underline">Tjänstevillkor</Link>
        <Link href="/legal/privacy" className="hover:underline">Integritetspolicy</Link>
        <Link href="/legal/dpa" className="hover:underline">DPA</Link>
        <Link href="/legal/credit-terms" className="hover:underline">Kreditvillkor</Link>
      </nav>
    </main>
  );
}

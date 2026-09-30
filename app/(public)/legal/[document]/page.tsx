import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL_LINKS } from "@ee/present";
import { LegalDocumentContent } from "@/components/legal-document";
import { serverExtensions } from "@/lib/extensions/server";
import { publicInstance } from "@/lib/instance";
import { INSTALLATION_DOCUMENTS, isInstallationDocument, readInstallationDocument } from "@/lib/legal/installation-documents";

export const dynamic = "force-dynamic";

type Shown =
  | { kind: "text"; title: string; version: string | null; content: string }
  | { kind: "purpose"; title: string; purpose: readonly string[]; file: string };

/**
 * The legal documents (2026-09-30): HINTEK's published texts come from ee/; any other installation shows its
 * own file from legal/<key>.md, or a short description of what the document is for until the operator has added it.
 */
async function documentFor(key: string): Promise<Shown | null> {
  if (!LEGAL_LINKS.some((link) => link.key === key)) return null;
  const hintek = await serverExtensions.legalDocument(key);
  if (hintek) return { kind: "text", ...hintek };
  if (!isInstallationDocument(key)) return null;
  const entry = INSTALLATION_DOCUMENTS[key];
  const own = await readInstallationDocument(key);
  return own ? { kind: "text", title: entry.title, version: null, content: own }
    : { kind: "purpose", title: entry.title, purpose: entry.purpose, file: `legal/${key}.md` };
}

export async function generateMetadata({ params }: { params: Promise<{ document: string }> }): Promise<Metadata> {
  const { document } = await params;
  const shown = await documentFor(document);
  return { title: shown ? `${shown.title} | ${publicInstance().name}` : "Juridiskt dokument" };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  const shown = await documentFor(document);
  if (!shown) notFound();
  const { name } = publicInstance();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">
          ← Till inloggningen
        </Link>
        <span className="text-xs text-muted-foreground">{name}{shown.kind === "text" && shown.version ? ` · version ${shown.version}` : ""}</span>
      </div>
      <article className="rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
        <h1 className="mb-6 text-2xl font-bold">{shown.title}</h1>
        {shown.kind === "text" ? <LegalDocumentContent content={shown.content} /> : <div className="space-y-4 text-sm leading-6">
          {shown.purpose.map((line) => <p key={line}>{line}</p>)}
          <p className="notice">
            Den här installationen har ännu ingen egen text här. Den som driver installationen ansvarar för att lägga in
            den: skriv texten i filen <code>{shown.file}</code> i installationsmappen, så visas den på den här sidan.
          </p>
        </div>}
      </article>
      <nav aria-label="Juridiska dokument" className="mt-6 flex flex-wrap gap-4 text-sm">
        {LEGAL_LINKS.map((link) => <Link key={link.key} href={`/legal/${link.key}`} className="hover:underline">{link.label}</Link>)}
      </nav>
    </main>
  );
}

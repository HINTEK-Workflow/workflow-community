import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalDocumentContent, legalVersionLine } from "@/components/legal-document";
import { LegalLinks } from "@/components/legal-links";
import { publicInstance } from "@/lib/instance";
import { appHref, startHref } from "@/lib/public-site";
import { getCurrentUser } from "@/lib/auth/session";
import { shownLegalDocument as documentFor } from "@/lib/legal/shown-document";
import { indexablePublicSite } from "@/lib/seo/server";
import { publicDocumentMetadata } from "@/lib/site-metadata";
import { serverExtensions } from "@/lib/extensions/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ document: string }> }): Promise<Metadata> {
  const { document } = await params;
  const shown = await documentFor(document);
  // On the public site, while the landing page is published, a document with a text may be found (Sökmotorer, 2026-11-10;
  // robots.txt and the sitemap name it); on the app's address it stays out of search like the rest of the app.
  const open = shown?.kind === "text" ? await indexablePublicSite() : null;
  if (shown && open) return publicDocumentMetadata(publicInstance().name, open.site.siteOrigin, document, shown.title);
  // The layout's template adds " | <name>"; the title here is the document's own.
  return { title: shown ? shown.title : "Juridiskt dokument" };
}

/**
 * A legal document as the public website shows its policies (2026-11-11): no card, the text straight on the page in a 760 px
 * reading column, the title (H1 32 px), a small light box with version, date and the other documents, then the text in the
 * shared type scale ("Typografi – Workflow styr"). Workflow's installation has the landing page's top and footer while the
 * landing page is published (serverExtensions.publicChrome); otherwise, and in the community edition, the page has its own
 * plain links. Every link here opens in the same window.
 */
export default async function LegalDocumentPage({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  const shown = await documentFor(document);
  if (!shown) notFound();
  const { name, publicSiteUrl, features } = publicInstance();
  // Opened from Hjälp → Om Workflow (2026-10-24, analysens fråga 5): the signed-in person goes back to Workflow, not
  // to the login; and without a separate public site Priser (/#priser) would only open the app's Hem, so it is left out.
  const signedIn = Boolean(await getCurrentUser().catch(() => null));
  // The shared top and footer lead to the landing page's parts (#priser); on the app's own address a signed-in person would only
  // reach the app's Hem, so they get the plain page there (as Priser above).
  const chrome = signedIn && !publicSiteUrl ? null : ((await serverExtensions.publicChrome?.().catch(() => null)) ?? null);
  // Signed in (2026-11-12): also back to the company's site and the product's site, from the owner's own top (the landing
  // editor's Sidhuvud); without one (Community, or the blue bar switched off) the public start page, when there is one.
  const siteLinks = signedIn ? ((await serverExtensions.publicSiteLinks?.().catch(() => [])) ?? []) : [];
  const start = startHref();
  const versionLine = shown.kind === "text" ? legalVersionLine(shown.content) : null;
  const version = versionLine ?? (shown.kind === "text" && shown.version ? `Version ${shown.version}` : name);

  return (
    <div className="landing public-page flex min-h-dvh flex-col bg-card text-foreground" data-testid="legal-page">
      {chrome?.header}
      <main className="flex-1 px-[clamp(1rem,4vw,2rem)] py-[clamp(2rem,5vw,3.5rem)]">
        <div className="mx-auto max-w-[760px]">
          {/* Back links: always for a signed-in person; without the shared top also the login and the start page (2026-11-06). */}
          {signedIn || !chrome ? <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {/* The page is also shown on the separate public site (2026-10-15); the login is always the app's. Text only, no arrow. */}
            <Link href={appHref(signedIn ? "/" : "/login")} className="public-link" data-testid="legal-back">
              {signedIn ? "Tillbaka till Workflow" : "Till inloggningen"}
            </Link>
            {siteLinks.map((link) => <a key={link.href} href={link.href} className="public-link" data-testid="legal-site-link">{link.label}</a>)}
            {/* Signed in without a separate public site "/" is Workflow itself, already linked above. */}
            {(!signedIn && features.landingEditor) || (signedIn && !siteLinks.length && start !== "/") ? <Link href={start} className="public-link" data-testid="legal-start">Till startsidan</Link> : null}
          </p> : null}
          <h1 className="text-[2rem] font-bold leading-[1.2] tracking-[-0.01em]">{shown.title}</h1>
          <div className="mt-4 rounded-lg bg-[#f4f7fb] px-4 py-3 text-sm leading-[1.65] text-[#46566b]" data-testid="legal-version">
            <p>{version}</p>
            <LegalLinks current={document} label="Andra dokument" className="mt-1" linkClassName="public-link aria-[current=page]:!text-foreground" />
          </div>
          <div className="mt-8">
            {shown.kind === "text" ? <LegalDocumentContent content={shown.content} page /> : <div className="space-y-4 text-base leading-[1.65]">
              {shown.purpose.map((line) => <p key={line}>{line}</p>)}
              <p className="notice">
                Den här installationen har ännu ingen egen text här. Den som driver installationen ansvarar för att lägga in
                den: skriv texten i filen <code>{shown.file}</code> i installationsmappen, så visas den på den här sidan.
              </p>
            </div>}
          </div>
          {chrome ? null : <LegalLinks prices={features.landingEditor && !(signedIn && !publicSiteUrl)} site={publicSiteUrl} className="mt-10 border-t pt-6 text-sm" linkClassName="public-link" />}
        </div>
      </main>
      {chrome?.footer}
    </div>
  );
}

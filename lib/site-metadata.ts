import type { Metadata } from "next";
import type { LandingSeo } from "@/lib/extensions/types";

/**
 * The page title, description and link preview (Open Graph, X) of the installation (2026-11-07, före marknadsföringen):
 * they lead with what the product does now – editable controls, machine connection and alarms, the operator terminal and
 * AI – and then work orders. The picture is app/opengraph-image.tsx (the name in plain text, never the icon and wordmark).
 */
export const SITE_TAGLINE = "kontroller, maskinlarm och arbetsorder";
export const SITE_DESCRIPTION = "Egna kontroller och egenkontroller, maskinkoppling med larm, operatörsterminal och AI. Larm och avvikelser blir arbetsorder.";

/** The generated share picture (app/opengraph-image.tsx). */
const DEFAULT_IMAGE = { url: "/opengraph-image", width: 1200, height: 630 } as const;

/** The default page title of the installation, also the landing editor's placeholder. */
export const defaultSiteTitle = (name: string) => `${name} – ${SITE_TAGLINE}`;

/** Own texts and picture for the preview (the landing editor's Sökmotorer, 2026-11-10); empty means the defaults. */
export type PreviewOverrides = { title?: string; description?: string; image?: { url: string; alt: string } | null };

/** The shared link preview; `url` is the page's own address (the public site's start page, or the app). */
export function sitePreview(name: string, url: string, own: PreviewOverrides = {}): Pick<Metadata, "openGraph" | "twitter"> {
  const title = own.title?.trim() || defaultSiteTitle(name);
  const description = own.description?.trim() || SITE_DESCRIPTION;
  // An own picture has no known size; the generated one has.
  const image = own.image?.url ? { url: own.image.url, alt: own.image.alt || title } : { ...DEFAULT_IMAGE, alt: defaultSiteTitle(name) };
  return {
    // The picture is named here too: a page that sets its own openGraph (the public start page) would otherwise lose the
    // file-based one of the root layout.
    openGraph: { type: "website", locale: "sv_SE", siteName: name, title, description, url, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

/**
 * The languages of a public page (hreflang). Swedish only today; another language is one more entry here and its own
 * address (languages-future, 2026-11-04), so nothing else has to change.
 */
export function pageLanguages(url: string): Record<string, string> {
  return { "sv-SE": url, "x-default": url };
}

/**
 * The metadata of the public site's start page while it may be indexed (app/page.tsx): indexable, its own canonical
 * address, the landing editor's own title, description, share picture and Search Console code when they are set.
 */
export function publicStartMetadata(name: string, siteOrigin: string, seo: LandingSeo | undefined): Metadata {
  const url = `${siteOrigin}/`;
  const title = seo?.title.trim();
  const description = seo?.description.trim();
  return {
    metadataBase: new URL(siteOrigin),
    ...(title ? { title: { absolute: title } } : {}),
    ...(description ? { description } : {}),
    robots: { index: true, follow: true },
    alternates: { canonical: url, languages: pageLanguages(url) },
    ...sitePreview(name, url, { title, description, image: seo?.image ?? null }),
    ...(seo?.googleVerification ? { verification: { google: seo.googleVerification } } : {}),
  };
}

/** The metadata of a legal document on the public site while it may be indexed: indexable on its own address. */
export function publicDocumentMetadata(name: string, siteOrigin: string, key: string, title: string): Metadata {
  const url = `${siteOrigin}/legal/${key}`;
  const description = `${title} för ${name}.`;
  return {
    metadataBase: new URL(siteOrigin),
    title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: url, languages: pageLanguages(url) },
    ...sitePreview(name, url, { title: `${title} | ${name}`, description }),
  };
}

/** A feature page's own title and description (the landing editor's Funktionssidor, 2026-11-14); empty search texts mean its heading and lead. */
export type FeaturePageSeo = { path: string; title: string; description: string };

/**
 * The metadata of a feature page (/funktioner/<adress>, 2026-11-14). On the public site while it may be indexed: indexable on its
 * own canonical address with its own preview; elsewhere (the app's address) only its title, and the app's noindex applies.
 */
export function featurePageMetadata(name: string, siteOrigin: string | null, page: FeaturePageSeo): Metadata {
  const description = page.description.length > 200 ? `${page.description.slice(0, 197).trimEnd()}…` : page.description;
  if (!siteOrigin) return { title: page.title, description };
  const url = `${siteOrigin}${page.path}`;
  return {
    metadataBase: new URL(siteOrigin),
    title: page.title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: url, languages: pageLanguages(url) },
    ...sitePreview(name, url, { title: `${page.title} | ${name}`, description }),
  };
}

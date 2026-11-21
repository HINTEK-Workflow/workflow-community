import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { serverExtensions } from "@/lib/extensions/server";
import type { WebsiteExtras } from "@/lib/extensions/types";
import { openCompanyKey, sealCompanyKey } from "@/lib/integrations/company-keys";
import { ApiError } from "@/lib/kfid/errors";
import { keyRing } from "@/lib/security/key-ring";
import { open } from "@/lib/security/sealing";
import { codeChanges, codeChangeText, editProblem } from "./guard";
import { siteLookView } from "./look-server";
import { NO_STYLES, siteOrigin, siteRoot, themeStyles, type ThemeStyles } from "./frame";
import { renderedPreviews } from "./rendered";
import { canvasLook, postContentHtml, type PageCss } from "./site-css";
import { tagAttribute } from "./blocks";
import {
  baseUrlProblem, checkConnection, discoverRestBase, fetchPublic, fetchSiteImage, getMedia, imageSignature, isOnSite, listMedia, MEDIA_TYPES, fetchSitePage, frontPageId, getPage, getPageDrawing, getPageSummary, listPages, normalSiteUrl, renderBlock, uploadMedia,
  WpError, writePage, type WpConfig, type WpPage,
} from "./wp-client";
import { normalSeo, sameSeo, seoMetaPayload, seoProblem, storedSeo, type PageSeo } from "./seo";

/**
 * Min webbsida (2026-11-10; one site 2026-11-09) on the server: a company's connection to its own WordPress, the drafts,
 * Publicera with a backup first, Återställ and the pictures. Everything is the company's own: every function takes the
 * company (organizationId) the API checked, and every row read or written is that company's – never another's.
 *
 * - The application password is sealed with the company's own data key (lib/integrations/company-keys.ts, bound to the
 *   company) and never returned. The first site's row ('site') was sealed before that with the installation's ring; it is
 *   opened with its old context once and resealed with the company's key.
 * - Publicera and Återställ first store the page as WordPress has it now, and refuse (409) when WordPress changed the page
 *   after the editor opened it.
 * - The audit is the company's own and names the page and what was done – never the page's text, never the password.
 * - An extension (ee/) may add to one company's site (serverExtensions.websiteExtras): pages first and automatic blocks.
 */
export type Actor = { userId: string; organizationId: string };
const KEY_ID = "website-application-password";
/** The first site's row and how its password was sealed before 2026-11-10. */
const LEGACY_ROW = "site";
const LEGACY_CONTEXT = "ee-website:application-password";
const KEEP_BACKUPS = 30;

export const connectionRow = (organizationId: string) => prisma.websiteConnection.findUnique({ where: { organizationId } });
type Row = NonNullable<Awaited<ReturnType<typeof connectionRow>>>;

/** The password, or null when it cannot be opened; the first site's old sealing is resealed with the company's key. */
async function openPassword(row: Row): Promise<string | null> {
  if (!row.passwordCipher || !row.organizationId) return null;
  if (row.passwordCipher.startsWith("v3.")) {
    try { return await openCompanyKey(row.organizationId, KEY_ID, row.passwordCipher); } catch { return null; }
  }
  if (row.id !== LEGACY_ROW) return null;
  const legacy = open("central", row.passwordCipher, LEGACY_CONTEXT, keyRing());
  if (!legacy.ok) return null;
  try {
    const resealed = await sealCompanyKey(row.organizationId, KEY_ID, legacy.value);
    await prisma.websiteConnection.updateMany({ where: { id: row.id, organizationId: row.organizationId, passwordCipher: row.passwordCipher }, data: { passwordCipher: resealed } });
  } catch { /* opened all the same; resealed the next time */ }
  return legacy.value;
}

/** The company's connection, or null when it is not complete (then nothing reaches WordPress and nothing fails). */
export async function connectionConfig(organizationId: string): Promise<WpConfig | null> {
  const row = await connectionRow(organizationId).catch(() => null);
  if (!row?.username || !row.passwordCipher || baseUrlProblem(row.baseUrl)) return null;
  const password = await openPassword(row);
  return password ? { baseUrl: row.baseUrl, username: row.username, password } : null;
}

async function requireConfig(organizationId: string) {
  const config = await connectionConfig(organizationId);
  if (!config) throw new ApiError(409, "Webbplatsen är inte kopplad. Fyll i adress, användarnamn och applikationslösenord under Koppling.");
  return config;
}

/** WordPress's failures as the API's: a short Swedish text, a status the editor understands (never 401, which signs out). */
export function asApiError(error: unknown): unknown {
  if (error instanceof WpError) return new ApiError(error.status === 401 ? 502 : error.status, error.message);
  return error;
}
const wp = async <T>(work: () => Promise<T>) => { try { return await work(); } catch (error) { throw asApiError(error); } };

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

/** What ee/ adds to this company's site, or null (always null without ee/, and for every company it does not apply to). */
export async function websiteExtras(organizationId: string): Promise<WebsiteExtras | null> {
  try { return (await serverExtensions.websiteExtras?.(organizationId)) ?? null; } catch { return null; }
}

// ---------- the connection ----------

export type ConnectionView = {
  siteUrl: string; baseUrl: string; username: string | null;
  passwordStored: boolean; passwordUnreadable: boolean; configured: boolean; updatedAt: string | null;
  /** A line about the extension's automatic blocks (ee/), or null. */
  extras: { status: string | null; error: string | null } | null;
};

export async function connectionView(organizationId: string, extras?: WebsiteExtras | null): Promise<ConnectionView> {
  const row = await connectionRow(organizationId);
  const password = row ? await openPassword(row) : null;
  const unreadable = Boolean(row?.passwordCipher) && password === null;
  const shown = extras === undefined ? await websiteExtras(organizationId) : extras;
  return {
    siteUrl: row?.siteUrl ?? (row ? siteRoot(row.baseUrl) ?? "" : ""), baseUrl: row?.baseUrl ?? "", username: row?.username ?? null,
    passwordStored: Boolean(row?.passwordCipher), passwordUnreadable: unreadable,
    configured: Boolean(row?.username && row.passwordCipher && !unreadable && !baseUrlProblem(row.baseUrl)),
    updatedAt: row?.updatedAt.toISOString() ?? null,
    extras: shown ? { status: shown.status ?? null, error: shown.error ?? null } : null,
  };
}

/**
 * Saves the site's address (the REST address is found from it, or – Avancerat – given), the user and (a value) or removes
 * (null) the application password. A new address is checked on the network before anything is saved.
 */
export async function saveConnection(actor: Actor, input: { siteUrl?: string; baseUrl?: string | null; username?: string | null; password?: string | null }) {
  const { organizationId } = actor;
  const row = await connectionRow(organizationId);
  const previousSite = row?.siteUrl ?? (row ? siteRoot(row.baseUrl) : null) ?? "";
  const siteUrl = input.siteUrl === undefined ? previousSite : normalSiteUrl(input.siteUrl) ?? "";
  if (input.siteUrl !== undefined && input.siteUrl.trim() && !siteUrl) throw new ApiError(400, "Adressen är inte en giltig webbadress.");
  let baseUrl = row?.baseUrl ?? "";
  const given = input.baseUrl?.trim();
  if (given) {
    const problem = baseUrlProblem(given);
    if (problem) throw new ApiError(400, problem);
    baseUrl = given;
  } else if (siteUrl && (siteUrl !== previousSite || !baseUrl || input.baseUrl === null)) {
    baseUrl = await wp(() => discoverRestBase(siteUrl));
  }
  if (!baseUrl) throw new ApiError(400, "Fyll i webbplatsens adress.");
  const username = input.username === undefined ? row?.username ?? null : input.username?.trim() || null;
  const password = input.password === undefined ? undefined : input.password?.replace(/\s+/g, "") || null;
  if (password && password.length < 16) throw new ApiError(400, "Applikationslösenordet ser för kort ut. Klistra in hela lösenordet från WordPress.");
  const passwordCipher = password === undefined ? row?.passwordCipher ?? null : password === null ? null : await sealCompanyKey(organizationId, KEY_ID, password);
  const data = { siteUrl: siteUrl || null, baseUrl, username, passwordCipher, updatedById: actor.userId };
  if (row) await prisma.websiteConnection.update({ where: { id: row.id }, data: { ...data, updatedAt: new Date() } });
  else await prisma.websiteConnection.create({ data: { ...data, organizationId } });
  const changes = [
    siteUrl !== previousSite || baseUrl !== (row?.baseUrl ?? "") ? "adressen" : null,
    username !== (row?.username ?? null) ? "användarnamnet" : null,
    password === null ? "applikationslösenordet togs bort" : password ? "applikationslösenordet byttes" : null,
  ].filter(Boolean);
  if (changes.length) await audit(actor, "website_connection", `Kopplingen till webbplatsens WordPress ändrades: ${changes.join(", ")}.`);
  return connectionView(organizationId);
}

/** Removes the company's connection (the drafts and backups stay until the company removes them or is erased). */
export async function removeConnection(actor: Actor) {
  const removed = await prisma.websiteConnection.deleteMany({ where: { organizationId: actor.organizationId } });
  if (removed.count) await audit(actor, "website_connection", "Kopplingen till webbplatsens WordPress togs bort.");
  return connectionView(actor.organizationId);
}

export async function checkWebsite(organizationId: string): Promise<{ ok: boolean; message: string }> {
  const config = await connectionConfig(organizationId);
  if (!config) return { ok: false, message: "Fyll i adress, användarnamn och applikationslösenord först." };
  try {
    const me = await checkConnection(config);
    return me.canEditPages
      ? { ok: true, message: `Kopplingen fungerar${me.name ? ` (${me.name})` : ""}.` }
      : { ok: false, message: "Inloggningen fungerar, men användaren får inte redigera sidor och ladda upp bilder." };
  } catch (error) {
    return { ok: false, message: error instanceof WpError ? error.message : "Kopplingen kunde inte kontrolleras." };
  }
}

// ---------- pages, drafts and backups ----------

/**
 * The company's pages: the front page first (WordPress's own setting, when the user may read it; an extension's own order
 * first when it has one), then by title.
 */
export async function listWebsitePages(organizationId: string, extras?: WebsiteExtras | null) {
  const config = await requireConfig(organizationId);
  const [pages, drafts, front] = await Promise.all([
    wp(() => listPages(config)),
    prisma.websitePageDraft.findMany({ where: { organizationId }, select: { pageId: true, updatedAt: true } }),
    frontPageId(config),
  ]);
  const shown = extras === undefined ? await websiteExtras(organizationId) : extras;
  const first = [...(shown?.firstPages ?? []), ...(front ? [front] : [])].filter((id, index, all) => all.indexOf(id) === index);
  const savedAt = new Map(drafts.map((draft) => [draft.pageId, draft.updatedAt.toISOString()]));
  const rank = (id: number) => { const at = first.indexOf(id); return at < 0 ? first.length : at; };
  return pages
    .map((page) => ({ ...page, draftSavedAt: savedAt.get(page.id) ?? null }))
    .sort((left, right) => rank(left.id) - rank(right.id) || left.title.localeCompare(right.title, "sv"));
}

const backupList = (organizationId: string, pageId: number) => prisma.websitePageBackup.findMany({ where: { organizationId, pageId }, orderBy: { createdAt: "desc" }, take: KEEP_BACKUPS, select: { id: true, reason: true, modified: true, createdAt: true } })
  .then((rows) => rows.map((row) => ({ id: row.id, reason: row.reason, modified: row.modified, createdAt: row.createdAt.toISOString() })));
const draftOf = (organizationId: string, pageId: number) => prisma.websitePageDraft.findUnique({ where: { organizationId_pageId: { organizationId, pageId } } });

/** The share pictures named by these SEO values, for the panel's preview (best effort: a missing one is left out). */
async function seoMedia(config: WpConfig, ...values: (PageSeo | null)[]) {
  const ids = [...new Set(values.map((value) => value?.image ?? 0).filter((id) => id > 0))].slice(0, 2);
  const found = await Promise.all(ids.map((id) => getMedia(config, id).catch(() => null)));
  return found.flatMap((media) => (media ? [media] : []));
}

/**
 * A page as WordPress has it, the draft saved in Workflow and the backups. `seo` is null when the site has no SEO meta (then
 * the editor shows no panel and sends none); a draft's own SEO values count only while the site still has them.
 */
export async function openWebsitePage(organizationId: string, pageId: number) {
  const config = await requireConfig(organizationId);
  const page = await wp(() => getPage(config, pageId));
  const [draft, backups] = await Promise.all([draftOf(organizationId, pageId), backupList(organizationId, pageId)]);
  const { content, seo, ...summary } = page;
  const draftSeo = seo ? storedSeo(draft?.seo) : null;
  const draftSeoBase = seo ? storedSeo(draft?.seoBase) : null;
  return {
    page: summary, content, seo,
    seoMedia: seo ? await seoMedia(config, seo, draftSeo) : [],
    draft: draft ? {
      content: draft.content, baseModified: draft.baseModified, revision: draft.revision, updatedAt: draft.updatedAt.toISOString(),
      seo: draftSeo, seoBase: draftSeoBase,
      stale: draft.baseModified !== page.modified || Boolean(draftSeoBase && !sameSeo(draftSeoBase, seo)),
    } : null,
    backups,
  };
}

const conflict = () => Object.assign(new ApiError(409, "Sidan har ändrats i WordPress sedan du öppnade den. Ladda om sidan för att se den nya versionen."), { conflict: true });
const otherTab = () => new ApiError(409, "Utkastet har sparats från en annan flik. Ladda om sidan.");

export type SeoInput = { seo?: PageSeo | null; seoBase?: PageSeo | null };

/** The editor's SEO values checked and cleaned (400 with the reason), or null when none were sent. */
function checkedSeo(input: SeoInput): PageSeo | null {
  if (!input.seo) return null;
  const value = normalSeo(input.seo);
  const problem = seoProblem(value);
  if (problem) throw new ApiError(400, problem);
  return value;
}

/** Saves the editor's page as a draft in Workflow (nothing reaches WordPress). `revision` is the draft's the editor read (0: none). */
export async function saveWebsiteDraft(actor: Actor, pageId: number, input: { content: string; baseModified: string; revision: number } & SeoInput) {
  const { organizationId } = actor;
  const config = await requireConfig(organizationId);
  const page = await wp(() => getPage(config, pageId));
  const problem = editProblem(page.content, input.content);
  if (problem) throw new ApiError(400, problem);
  // SEO values are kept only for a site that has them; WordPress's values when the editor opened the page go with them.
  const seo = page.seo ? checkedSeo(input) : null;
  const seoBase = seo ? (input.seoBase ? normalSeo(input.seoBase) : page.seo) : null;
  const seoData = { seo: seo ?? Prisma.DbNull, seoBase: seoBase ?? Prisma.DbNull };
  const existing = await prisma.websitePageDraft.findUnique({ where: { organizationId_pageId: { organizationId, pageId } }, select: { id: true, revision: true } });
  if ((existing?.revision ?? 0) !== input.revision) throw otherTab();
  const saved = existing
    ? await prisma.websitePageDraft.update({ where: { id: existing.id, organizationId, revision: input.revision }, data: { content: input.content, baseModified: input.baseModified, ...seoData, title: page.title, revision: { increment: 1 }, updatedById: actor.userId, updatedAt: new Date() } }).catch(() => { throw otherTab(); })
    : await prisma.websitePageDraft.create({ data: { organizationId, pageId, title: page.title, content: input.content, baseModified: input.baseModified, ...seoData, updatedById: actor.userId } }).catch(() => { throw otherTab(); });
  await audit(actor, "website_draft", `Sparade ett utkast av webbplatsens sida ${page.title} (id ${pageId}).`);
  return { revision: saved.revision, updatedAt: saved.updatedAt.toISOString(), stale: input.baseModified !== page.modified || Boolean(seoBase && !sameSeo(seoBase, page.seo)) };
}

export async function discardWebsiteDraft(actor: Actor, pageId: number) {
  const removed = await prisma.websitePageDraft.deleteMany({ where: { organizationId: actor.organizationId, pageId } });
  if (removed.count) await audit(actor, "website_draft_discard", `Kastade utkastet av webbplatsens sida (id ${pageId}).`);
  return { ok: true };
}

/** Stores the page as WordPress has it now (the company's own backups; the oldest beyond 30 per page are removed). */
export async function backup(organizationId: string, page: WpPage, reason: string, actorId: string | null) {
  await prisma.websitePageBackup.create({ data: { organizationId, pageId: page.id, title: page.title, content: page.content, modified: page.modified, seo: page.seo ?? Prisma.DbNull, reason, createdById: actorId } });
  const old = await prisma.websitePageBackup.findMany({ where: { organizationId, pageId: page.id }, orderBy: { createdAt: "desc" }, skip: KEEP_BACKUPS, select: { id: true } });
  if (old.length) await prisma.websitePageBackup.deleteMany({ where: { organizationId, id: { in: old.map((row) => row.id) } } });
}

/**
 * Publicera: the page as WordPress has it now is stored as a backup, then the new markup is written. Refused when WordPress
 * changed the page after `baseModified` (the editor offers to reload), or when the markup breaks the rules (guard.ts).
 */
export async function publishWebsitePage(actor: Actor, pageId: number, input: { content: string; baseModified: string } & SeoInput) {
  const { organizationId } = actor;
  const config = await requireConfig(organizationId);
  const current = await wp(() => getPage(config, pageId));
  if (current.modified !== input.baseModified) throw conflict();
  const problem = editProblem(current.content, input.content, { publishing: true });
  if (problem) throw new ApiError(400, problem);
  // Sökmotorer och delning: the meta only for a site that has it, and only what differs from WordPress's values now. Values
  // changed in WordPress since the editor opened the page are never overwritten unseen (WordPress need not move `modified`).
  const wanted = checkedSeo(input);
  let meta: Record<string, string | number | boolean> | null = null;
  if (wanted && current.seo) {
    if (input.seoBase && !sameSeo(normalSeo(input.seoBase), current.seo)) throw conflict();
    meta = seoMetaPayload(wanted, current.seo);
    if (meta && wanted.image > 0 && wanted.image !== current.seo.image && !(await wp(() => getMedia(config, wanted.image)))) throw new ApiError(400, "Delningsbilden finns inte i webbplatsens mediabibliotek.");
  } else if (wanted && !current.seo && input.seoBase && !sameSeo(wanted, normalSeo(input.seoBase))) {
    throw new ApiError(409, "Webbplatsen tar inte längre emot sökmotoruppgifter (tillägget för dem är avstängt). Ladda om sidan.");
  }
  const contentChanged = input.content !== current.content;
  if (!contentChanged && !meta) {
    await prisma.websitePageDraft.deleteMany({ where: { organizationId, pageId } });
    const { content: _unchanged, seo, ...page } = current;
    void _unchanged;
    return { page, content: current.content, seo, unchanged: true, backups: await backupList(organizationId, pageId) };
  }
  await backup(organizationId, current, "publish", actor.userId);
  const { seo: writtenSeo, ...written } = await wp(() => writePage(config, pageId, { content: contentChanged ? input.content : undefined, meta }));
  await prisma.websitePageDraft.deleteMany({ where: { organizationId, pageId } });
  const seoNote = meta ? ` Sökmotorer och delning ändrades (${seoFieldNames(meta)}).` : "";
  await audit(actor, "website_publish", `Publicerade webbplatsens sida ${current.title} (id ${pageId}). Sidan före ändringen är sparad.${seoNote}`);
  // Code on the site (an html block added or changed, a locked block's code): an event of its own – what, never the code.
  const code = codeChangeText(codeChanges(current.content, input.content));
  if (code) await audit(actor, "website_html", `Kod på webbplatsens sida ${current.title} (id ${pageId}): ${code}.`);
  return { page: written, content: input.content, seo: meta ? writtenSeo ?? wanted : current.seo, unchanged: false, backups: await backupList(organizationId, pageId) };
}

/** Which SEO fields a write changes, by name (the audit never holds the texts). */
function seoFieldNames(meta: Record<string, unknown>) {
  const names: Record<string, string> = { hintek_seo_title: "titel", hintek_seo_description: "beskrivning", hintek_seo_noindex: "sökmotorer", hintek_seo_image: "delningsbild" };
  return Object.keys(meta).map((key) => names[key] ?? key).join(", ");
}

/** Återställ: writes one of the company's stored backups back (the page as it is now becomes a backup first). */
export async function restoreWebsiteBackup(actor: Actor, backupId: string, input: { baseModified: string }) {
  const { organizationId } = actor;
  const config = await requireConfig(organizationId);
  const stored = await prisma.websitePageBackup.findFirst({ where: { id: backupId, organizationId } });
  if (!stored) throw new ApiError(404, "Säkerhetskopian finns inte.");
  const current = await wp(() => getPage(config, stored.pageId));
  if (current.modified !== input.baseModified) throw conflict();
  await backup(organizationId, current, "restore", actor.userId);
  // The backup's SEO values go back too – only when it has them and the site still takes them.
  const storedValues = storedSeo(stored.seo);
  const meta = storedValues && current.seo ? seoMetaPayload(storedValues, current.seo) : null;
  const { seo: writtenSeo, ...written } = await wp(() => writePage(config, stored.pageId, { content: stored.content, meta }));
  await prisma.websitePageDraft.deleteMany({ where: { organizationId, pageId: stored.pageId } });
  await audit(actor, "website_restore", `Återställde webbplatsens sida ${current.title} (id ${stored.pageId}) till versionen från ${stored.createdAt.toISOString().slice(0, 16).replace("T", " ")}.${meta ? ` Sökmotorer och delning återställdes (${seoFieldNames(meta)}).` : ""}`);
  return { page: written, content: stored.content, seo: meta ? writtenSeo ?? storedValues : current.seo, backups: await backupList(organizationId, stored.pageId) };
}

export async function uploadWebsiteImage(actor: Actor, file: { bytes: Uint8Array; name: string; type: string }) {
  const config = await requireConfig(actor.organizationId);
  const media = await wp(() => uploadMedia(config, file));
  await audit(actor, "website_media", `Laddade upp en bild till webbplatsens mediabibliotek (id ${media.id}).`);
  return media;
}

/** Whether the page was changed in WordPress: its `modified` now (the editor asks now and then, without the markup). */
export async function websitePageModified(organizationId: string, pageId: number) {
  const config = await requireConfig(organizationId);
  const page = await wp(() => getPageSummary(config, pageId));
  return { modified: page.modified };
}

/** A dynamic locked block as WordPress draws it on the page (null: WordPress does not draw it on its own). */
export async function renderWebsiteBlock(organizationId: string, pageId: number, name: string, attributes: Record<string, unknown>) {
  const config = await requireConfig(organizationId);
  const html = await wp(() => renderBlock(config, name, attributes, pageId));
  return { html: html === null ? null : html.slice(0, 2_000_000) };
}

const STYLE_CACHE_MS = 10 * 60_000;
const STYLE_CACHE_MAX = 500;
const styleCache = new Map<string, { at: number; styles: ThemeStyles }>();
/** The frames get the site's own fonts and body font (always the newest look; it is not cached with the theme's css). */
async function withLook(organizationId: string, styles: ThemeStyles): Promise<ThemeStyles> {
  try { const look = await siteLookView(organizationId); return { ...styles, fontCss: look.fontCss, baseFont: look.baseFont }; } catch { return styles; }
}

/** The css the page loads, in document order: its <style> elements and its own stylesheets (read here, on the server). */
async function pageCss(html: string, pageUrl: string, origin: string): Promise<PageCss[]> {
  const head = html.slice(0, Math.max(0, html.search(/<\/head>/i)) || Math.min(html.length, 1_000_000));
  const sources: PageCss[] = [];
  let sheets = 0;
  for (const match of head.matchAll(/<link\b[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    if (match[0].toLowerCase().startsWith("<style")) { sources.push({ css: match[1] ?? "", url: pageUrl }); continue; }
    const tag = match[0];
    if (!/\bstylesheet\b/i.test(tagAttribute(tag, "rel") ?? "") || /^print$/i.test((tagAttribute(tag, "media") ?? "").trim())) continue;
    let url: URL;
    try { url = new URL((tagAttribute(tag, "href") ?? "").replace(/&amp;/g, "&"), pageUrl); } catch { continue; }
    if (url.origin !== origin || ++sheets > 20) continue;
    try {
      const answer = await fetchPublic(url.href, { accept: "text/css,*/*;q=0.1", maxBytes: 1024 * 1024 });
      if (answer.status === 200 && answer.type === "text/css") sources.push({ css: answer.bytes.toString("utf8"), url: url.href });
    } catch { /* a sheet that cannot be read is left out */ }
  }
  // Styles printed in the body (a block's css printed late, a plugin's) count too.
  const body = html.slice(head.length);
  for (const match of body.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) sources.push({ css: match[1] ?? "", url: pageUrl });
  return sources;
}

/**
 * The site's look for the preview frames and the canvas: the stylesheets and inline css of the page as a visitor gets it (a
 * public GET of the page's own address on the site; the front page for a page that is not public), the canvas's scoped css and
 * the elements around the content (lib/website/site-css.ts), and how WordPress draws the page's shortcodes and dynamic blocks
 * (lib/website/rendered.ts: the public page's content, else WordPress's own drawing in the REST answer). Kept ten minutes per
 * company, site, page and version of the page.
 */
export async function websiteThemeStyles(organizationId: string, pageId: number): Promise<ThemeStyles> {
  const config = await requireConfig(organizationId);
  const origin = siteOrigin(config.baseUrl);
  let drawing: Awaited<ReturnType<typeof getPageDrawing>> | null = null;
  try { drawing = await getPageDrawing(config, pageId); } catch { drawing = null; }
  const key = `${organizationId}\u0000${config.baseUrl}\u0000${pageId}\u0000${drawing?.modified ?? ""}`;
  const cached = styleCache.get(key);
  if (cached && Date.now() - cached.at < STYLE_CACHE_MS) return withLook(organizationId, cached.styles);
  let styles: ThemeStyles = NO_STYLES;
  try {
    const published = Boolean(drawing?.link && drawing.status === "publish");
    const address = published ? drawing!.link : siteRoot(config.baseUrl);
    if (origin && address) {
      const html = await fetchSitePage(config, address);
      styles = { ...themeStyles(html, address, origin), canvas: canvasLook(html, await pageCss(html, address, origin)) };
      // The public page draws the published content: its shortcodes once each, as a visitor sees them.
      const live = published ? postContentHtml(html) : null;
      if (drawing) {
        const fromPage = live ? renderedPreviews(drawing.raw, live) : {};
        const fromRest = drawing.rendered ? renderedPreviews(drawing.raw, drawing.rendered) : {};
        styles.rendered = { ...fromRest, ...fromPage };
      }
    }
  } catch { styles = NO_STYLES; }
  if (styleCache.size >= STYLE_CACHE_MAX) styleCache.delete(styleCache.keys().next().value!);
  styleCache.set(key, { at: Date.now(), styles });
  return withLook(organizationId, styles);
}

/** The company's site origin for the frame's policy (null while nothing is saved: then nothing from outside is allowed). */
export async function websiteFrameOrigin(organizationId: string) {
  const row = await connectionRow(organizationId).catch(() => null);
  return row ? siteOrigin(row.baseUrl) : null;
}

/** A picture on the company's site, for the editor's preview. */
export async function websiteImage(organizationId: string, address: string) {
  const row = await connectionRow(organizationId);
  if (!row) throw new ApiError(409, "Webbplatsen är inte kopplad.");
  return wp(() => fetchSiteImage({ baseUrl: row.baseUrl }, address));
}

// ---------- pictures on other sites (2026-11-10) ----------

const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Kopiera till mediabiblioteket: a picture a page shows from another site (it can disappear there, and the editor cannot show it)
 * is fetched once by the server – a public https address only, under net.ts's rules, at most 10 MB, a picture type whose first
 * bytes match it – and uploaded to the company's own media library the usual way. The editor then points the block at the copy.
 */
/** A public picture on another site: https only (net.ts), at most 10 MB, a picture type whose first bytes match it. */
async function fetchOtherImage(address: string): Promise<{ bytes: Buffer; type: string }> {
  let url: URL;
  try { url = new URL(address); } catch { throw new ApiError(400, "Bildens adress är ogiltig."); }
  const file = await wp(() => fetchPublic(url.href, { accept: "image/png,image/jpeg,image/webp,image/gif", maxBytes: IMPORT_MAX_BYTES })).catch((error) => {
    throw error instanceof ApiError && /stor/.test(error.message) ? new ApiError(413, "Bilden är för stor (högst 10 MB).") : error;
  });
  if (file.status !== 200) throw new ApiError(502, "Bilden kunde inte hämtas från den andra webbplatsen.");
  if (!MEDIA_TYPES[file.type] || !imageSignature(file.bytes, file.type)) throw new ApiError(400, "Filen är inte en bild som kan kopieras (PNG, JPEG, WebP eller GIF).");
  return { bytes: file.bytes, type: file.type };
}

/**
 * A picture for a post's background (Inlägg, 2026-11-10), fetched by the server and never by the browser: one on the company's
 * own site as the editor's preview reads it, one elsewhere under the same rules as Kopiera till mediabiblioteket.
 */
export async function fetchImageForPost(organizationId: string, address: string): Promise<{ bytes: Buffer; type: string }> {
  const config = await requireConfig(organizationId);
  if (isOnSite(config, address)) {
    const image = await wp(() => fetchSiteImage(config, address));
    if (!imageSignature(image.bytes, image.type)) throw new ApiError(400, "Filen är inte en bild.");
    return image;
  }
  return fetchOtherImage(address);
}

/** The newest pictures of the company's media library (Inlägg: Välj från webbplatsen). */
export async function websiteMedia(organizationId: string) {
  const config = await requireConfig(organizationId);
  return wp(() => listMedia(config));
}

export async function importWebsiteImage(actor: Actor, address: string) {
  const config = await requireConfig(actor.organizationId);
  if (isOnSite(config, address)) throw new ApiError(400, "Bilden ligger redan på webbplatsen.");
  const url = new URL(address);
  const file = await fetchOtherImage(address);
  const name = decodeURIComponent(url.pathname.split("/").pop() ?? "").slice(0, 120) || "bild";
  const media = await wp(() => uploadMedia(config, { bytes: new Uint8Array(file.bytes), name, type: file.type }));
  await audit(actor, "website_media", `Kopierade en bild från ${url.hostname} till webbplatsens mediabibliotek (id ${media.id}).`);
  return media;
}

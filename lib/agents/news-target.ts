import type { Context } from "@/lib/kfid/server";
import { canWriteCompanyNews, publishCompanyNews } from "@/lib/news/server";

/**
 * Intern nyhet (2026-11-21: "BUILD an internal Nyheter page now"): the agents' adapter to the company's Nyheter, built on the
 * branch `nyheter` (lib/news/server.ts). Its contract, called with exactly these names:
 *
 *   publishCompanyNews(actor: Context, input: { title: string; body?: string; status?: "published" | "draft"; source?: "agent" | "manual";
 *     sourceRef: string; mission?: { id?: string; name: string }; pinned?: boolean }): Promise<{ post: NewsPostView; href: string; created: boolean; removed: boolean }>
 *   canWriteCompanyNews(actor: Context): boolean | Promise<boolean>   (an admin, the module `news` on, server storage)
 *
 * The actor is the mission owner's own Context (lib/agents/server.ts asOwner). It is idempotent on (company, source, sourceRef): the
 * run's key never makes a second post, and a post a person removed stays removed (`removed`). href is /?view=news&post=<id>.
 *
 * Wired 2026-11-21 when nyheter and agenter met. Were the two set to null, the target Intern nyhet would be offered nowhere
 * (checkMission refuses it, the page hides it) and templates would fall back to a report.
 */
export type CompanyNewsInput = { title: string; body?: string; status?: "published" | "draft"; source?: "agent" | "manual"; sourceRef: string; mission?: { id?: string; name: string }; pinned?: boolean };
export type CompanyNewsResult = { post: { id: string; status?: string } & Record<string, unknown>; href: string; created: boolean; removed: boolean };
export type CompanyNewsPublisher = (actor: Context, input: CompanyNewsInput) => Promise<CompanyNewsResult>;
export type CompanyNewsGate = (actor: Context) => boolean | Promise<boolean>;

export const COMPANY_NEWS: CompanyNewsPublisher | null = publishCompanyNews as unknown as CompanyNewsPublisher;
export const CAN_WRITE_NEWS: CompanyNewsGate | null = canWriteCompanyNews;

export const newsTargetAvailable = () => COMPANY_NEWS !== null;
/** Whether this owner may publish internal news (only an admin's mission can). */
export async function ownerMayWriteNews(ctx: Context) {
  if (!COMPANY_NEWS) return false;
  return CAN_WRITE_NEWS ? Boolean(await CAN_WRITE_NEWS(ctx)) : ctx.admin;
}
export const NEWS_TITLE_MAX = 120;
export const NEWS_BODY_MAX = 4_000;

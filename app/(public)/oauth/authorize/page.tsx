import { notFound } from "next/navigation";
import { serverExtensions } from "@/lib/extensions/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Where a company admin approves an app that wants to use the MCP server (OAuth 2.1, in ee/); not found without it. */
export default async function OAuthAuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const decision = await serverExtensions.oauthAuthorize(params);
  if (decision.kind === "hidden") notFound();
  return decision.node;
}

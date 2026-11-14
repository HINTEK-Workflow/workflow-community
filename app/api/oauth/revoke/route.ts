// Part of the open core since 2026-10-03 (lib/extensions/core-routes.ts).
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("oauth/revoke");
export const POST = route.POST;
export const OPTIONS = route.OPTIONS;

// Part of the open core since 2026-10-03 (lib/extensions/core-routes.ts).
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("oauth/authorization-server");
export const GET = route.GET;
export const OPTIONS = route.OPTIONS;

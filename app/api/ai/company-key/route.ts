// Part of the open core (lib/extensions/core-routes.ts): Använd företagets egen AI-nyckel (2026-11-27).
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("ai/company-key");
export const GET = route.GET;
export const POST = route.POST;

// Google's answer to Koppla YouTube (2026-11-20), part of the open core (lib/extensions/core-routes.ts).
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("youtube/callback");
export const GET = route.GET;

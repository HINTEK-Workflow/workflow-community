// Min webbsida (2026-11-10), part of the open core (lib/extensions/core-routes.ts).
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("website/media");
export const GET = route.GET;
export const POST = route.POST;

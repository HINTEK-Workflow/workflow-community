// Part of the open core (lib/extensions/core-routes.ts): machine intake of a device's own JSON with the source's format profile.
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("ingest/raw");
export const POST = route.POST;

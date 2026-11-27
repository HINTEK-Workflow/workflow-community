// Part of the open core (lib/extensions/core-routes.ts): machine intake, one key per source.
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("ingest/events");
export const POST = route.POST;

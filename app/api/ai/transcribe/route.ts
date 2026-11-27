// Part of the open core (lib/extensions/core-routes.ts): Tal till text for Workflow AI's chat (2026-11-21).
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("ai/transcribe");
export const POST = route.POST;

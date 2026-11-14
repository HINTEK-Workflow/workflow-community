// Part of the open core (lib/extensions/core-routes.ts): the company admin's machine sources and their keys.
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("machine-sources");
export const GET = route.GET;
export const POST = route.POST;

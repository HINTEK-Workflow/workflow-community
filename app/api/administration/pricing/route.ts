// Lives in ee/ (Fas 2, 2026-09-30); answers 404 in an installation without it.
import { eeRoute } from "@/lib/extensions/server";

export const dynamic = "force-dynamic";
const route = eeRoute("administration/pricing");
export const GET = route.GET;
export const PUT = route.PUT;
export const PATCH = route.PATCH;

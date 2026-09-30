// Lives in ee/ (Fas 2, 2026-09-30); answers 404 in an installation without it.
import { eeRoute } from "@/lib/extensions/server";

export const runtime = "nodejs";
const route = eeRoute("stripe/portal");
export const POST = route.POST;

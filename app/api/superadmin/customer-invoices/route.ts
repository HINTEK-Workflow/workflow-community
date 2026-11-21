// Fakturor (2026-11-04; in the core since 2026-11-10): every edition, loaded on first use (lib/extensions/core-routes.ts).
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("superadmin/customer-invoices");
export const GET = route.GET;
export const POST = route.POST;

import { staffRegisterExport } from "@/lib/staff-register/routes";

export const dynamic = "force-dynamic";

/** Personalliggare, steg 1: the Kontrollvy as CSV or PDF; the handler lives in lib/staff-register/routes.ts. */
export const GET = (request: Request) => staffRegisterExport(request);

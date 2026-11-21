import { staffRegisterGet, staffRegisterPost } from "@/lib/staff-register/routes";

export const dynamic = "force-dynamic";

/**
 * Personalliggare, steg 1 (2026-10-09). The handlers live in lib/staff-register/routes.ts. The staff register is
 * exempt from the Cloud payment block (a legal duty on site); see the comment there. Every other check is unchanged.
 */
export const GET = (request: Request) => staffRegisterGet(request);
export const POST = (request: Request) => staffRegisterPost(request);

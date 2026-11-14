// Frånvaro (2026-10-29): lib/absence/server.ts – the rules of lib/workflow/absence.ts for Cloud.
import { GET as getAbsence, POST as postAbsence } from "@/lib/absence/server";

export const dynamic = "force-dynamic";
export const GET = getAbsence;
export const POST = postAbsence;

import { access, constants } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Readiness for monitoring (drift, 2026-09-30): the database answers and the private file storage is writable. Answers
 * only "ok" or which part failed – never versions, paths, counts or error text. /api/health stays a cheap liveness check.
 */
export async function GET() {
  const checks: Record<string, boolean> = { database: false, storage: false };
  try { await prisma.$queryRaw`SELECT 1`; checks.database = true; } catch { /* reported as false */ }
  try { await access(path.resolve(env.STORAGE_ROOT), constants.W_OK); checks.storage = true; } catch { /* reported as false */ }
  const ok = Object.values(checks).every(Boolean);
  return NextResponse.json({ status: ok ? "ok" : "fail", checks, timestamp: new Date().toISOString() }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

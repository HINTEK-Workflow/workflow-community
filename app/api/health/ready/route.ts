import { access, constants } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { failedMigrations, type MigrationRow } from "@/lib/migration-state";

export const dynamic = "force-dynamic";

// Migreringssäkerhet (2026-10-28): the migration state is read at most once per MIGRATIONS_CACHE_MS, so frequent
// polling costs one small query every few seconds.
const MIGRATIONS_CACHE_MS = 5_000;
let migrationsCache: { at: number; ok: boolean } | null = null;

async function migrationsOk() {
  const now = Date.now();
  if (migrationsCache && now - migrationsCache.at < MIGRATIONS_CACHE_MS) return migrationsCache.ok;
  const rows = await prisma.$queryRaw<MigrationRow[]>`SELECT migration_name, started_at, finished_at, rolled_back_at, (logs IS NOT NULL) AS has_logs
    FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  const ok = failedMigrations(rows, now).length === 0;
  migrationsCache = { at: now, ok };
  return ok;
}

/**
 * Readiness for monitoring (drift, 2026-09-30): the database answers, no migration is failed or left half done
 * (2026-10-28; one running right now is allowed for a while, lib/migration-state.ts), and the private file storage is
 * writable. Answers only "ok" or which part failed – never versions, paths, counts, migration names or error text.
 * /api/health stays a cheap liveness check.
 */
export async function GET() {
  const checks: Record<string, boolean> = { database: false, migrations: false, storage: false };
  try { await prisma.$queryRaw`SELECT 1`; checks.database = true; } catch { /* reported as false */ }
  if (checks.database) try { checks.migrations = await migrationsOk(); } catch { /* reported as false */ }
  try { await access(path.resolve(env.STORAGE_ROOT), constants.W_OK); checks.storage = true; } catch { /* reported as false */ }
  const ok = Object.values(checks).every(Boolean);
  return NextResponse.json({ status: ok ? "ok" : "fail", checks, timestamp: new Date().toISOString() }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

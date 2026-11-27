// Start guard (migreringssäkerhet, 2026-10-28): run by scripts/ops/container-start.sh after migrate deploy and
// before the app starts. Exit 0 when every migration this image ships is applied and finished and none is failed or
// half done; exit 1 otherwise, so the app never serves on an incomplete or incompatible schema. Migrations in the
// database that this image does not know (an app rollback after an additive migration) are allowed and noted.
// Prints migration names and short reasons only – never the URL, rows or error details with values.
//
//   npx tsx scripts/ops/schema-guard.ts
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { nodePgConfig } from "../../lib/database-url";
import { judgeSchema, type MigrationRow } from "../../lib/migration-state";

const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");

function localMigrations() {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(MIGRATIONS, entry.name, "migration.sql")))
    .map((entry) => entry.name).sort();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error("the schema name in DATABASE_URL is not a plain identifier");
  const client = new Client({ ...nodePgConfig(databaseUrl), connectionTimeoutMillis: 15_000, statement_timeout: 15_000 });
  await client.connect();
  try {
    const { rows } = await client.query<MigrationRow>(
      `SELECT migration_name, started_at, finished_at, rolled_back_at FROM "${schema}"."_prisma_migrations"`);
    const verdict = judgeSchema(localMigrations(), rows);
    for (const note of verdict.notes) console.log(`schema-guard: ${note}`);
    if (!verdict.ok) {
      for (const problem of verdict.problems.slice(0, 20)) console.error(`schema-guard: ${problem}`);
      console.error("schema-guard: the database schema does not match this version; the app is NOT started. See the section on updating in INSTALLATION.md.");
      process.exit(1);
    }
    console.log(`schema-guard: ok (${rows.length} migration rows)`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const code = (error as { code?: string })?.code;
  console.error(`schema-guard: could not check the schema (${code ?? (error instanceof Error ? error.message.slice(0, 120) : "unknown error")}); the app is NOT started.`);
  process.exit(1);
});

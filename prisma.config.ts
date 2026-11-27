import "dotenv/config";
import { defineConfig } from "prisma/config";
import { prismaCliUrl, withMigrationTimeouts } from "./lib/database-url";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // The CLI verifies TLS only in its own URL form (lib/database-url.ts). MIGRATE_LOCK_TIMEOUT and
    // MIGRATE_STATEMENT_TIMEOUT (set by scripts/ops/container-start.sh) limit lock waits and long statements (2026-10-28).
    url: process.env.DATABASE_URL ? withMigrationTimeouts(prismaCliUrl(process.env.DATABASE_URL)) : undefined,
  },
});

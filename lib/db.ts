import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import { nodePgConfig } from "@/lib/database-url";
import { safeErrorLine } from "@/lib/kfid/error-log";

declare global {
  var prisma: ReturnType<typeof createClient> | undefined;
}

const databaseUrl = new URL(env.DATABASE_URL);
const adapter = new PrismaPg(
  // Verified TLS when the database is on its own server (lib/database-url.ts).
  nodePgConfig(env.DATABASE_URL),
  { schema: databaseUrl.searchParams.get("schema") ?? "public" },
);

/**
 * Prisma's own error log (2026-10-13): it is taken as an event and written as one cleaned line (lib/kfid/error-log.ts),
 * so a database error never puts values from a row into the server log – only the cause, constraint and table names.
 */
function createClient() {
  const client = new PrismaClient({
    adapter,
    log: [{ emit: "event", level: "error" }, ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout", level: "warn" } as const] : [])],
  });
  client.$on("error", (event) => console.error(`prisma:error ${safeErrorLine(event.message)}`));
  return client;
}

export const prisma = global.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

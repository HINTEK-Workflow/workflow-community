import { prisma } from "@/lib/db";
import { quotedSchema } from "./trgm-sql";

let cache: { schema: string | null; at: number } | null = null;

/**
 * The schema pg_trgm is installed in, or null when it is not installed (Sök and the article search still work, only
 * typing errors are handled differently). Read from pg_extension and kept for five minutes.
 */
export async function trigramSchema(): Promise<string | null> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.schema;
  const rows = await prisma.$queryRaw<{ schema: string }[]>`
    SELECT n.nspname AS "schema" FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'`;
  const schema = rows[0]?.schema ?? null;
  cache = { schema: schema && quotedSchema(schema) ? schema : null, at: Date.now() };
  return cache.schema;
}

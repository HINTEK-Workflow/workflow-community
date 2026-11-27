import { Prisma } from "@prisma/client";

/**
 * pg_trgm's operator and functions, qualified with the schema the extension lives in (2026-10-12). Without the schema a
 * query only finds `<%` and word_similarity() when that schema is on the search path: the isolated test schemas
 * (scripts/qa/run-isolated-schema-test.cjs) set search_path to their own schema while the extension stays in public, and
 * failed with "operator does not exist: unknown <% text". The schema is read from pg_extension (lib/search/trgm.ts), so
 * production keeps working wherever the extension was created. `true` (or no schema) keeps the unqualified names.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

/** A schema name safe to put in SQL text, double-quoted; null for anything that is not a plain identifier. */
export function quotedSchema(schema: string | null | undefined): string | null {
  return schema && IDENTIFIER.test(schema) ? `"${schema}"` : null;
}

export type TrigramSql = {
  /** `word <% text`: the word is similar to some part of the text (pg_trgm.word_similarity_threshold). */
  wordSimilar: (word: Prisma.Sql | string, text: Prisma.Sql) => Prisma.Sql;
  /** word_similarity(word, text), 0..1. */
  wordSimilarity: (word: Prisma.Sql | string, text: Prisma.Sql) => Prisma.Sql;
};

const asSql = (value: Prisma.Sql | string) => (typeof value === "string" ? Prisma.sql`${value}::text` : value);

export function trigramSql(schema?: string | boolean | null): TrigramSql {
  const quoted = typeof schema === "string" ? quotedSchema(schema) : null;
  const operator = Prisma.raw(quoted ? `OPERATOR(${quoted}.<%)` : "<%");
  const similarity = Prisma.raw(quoted ? `${quoted}.word_similarity` : "word_similarity");
  return {
    wordSimilar: (word, text) => Prisma.sql`(${asSql(word)} ${operator} ${text})`,
    wordSimilarity: (word, text) => Prisma.sql`${similarity}(${asSql(word)}, ${text})`,
  };
}

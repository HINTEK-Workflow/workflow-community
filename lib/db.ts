import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";

declare global {
  var prisma: PrismaClient | undefined;
}

const databaseUrl = new URL(env.DATABASE_URL);
const adapter = new PrismaPg(
  { connectionString: env.DATABASE_URL },
  { schema: databaseUrl.searchParams.get("schema") ?? "public" },
);

export const prisma =
  global.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

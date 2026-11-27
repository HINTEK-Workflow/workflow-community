import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { authOptionsForRequest } from "@/lib/auth/config";
import { microsoftProvider, microsoftSignInConfig } from "@/lib/auth/microsoft";

type Context = { params: Promise<{ nextauth: string[] }> };

/**
 * The sign-in routes, built per request: Google's keys entered under Servernycklar apply at once without a restart
 * (2026-10-09), and Microsoft (2026-10-11) is added only while it is switched on, configured and checked – its keys
 * live sealed in the database; while it is not ready the provider does not exist at all.
 */
async function handler(request: NextRequest, context: Context) {
  const [options, microsoft] = await Promise.all([authOptionsForRequest(), microsoftSignInConfig()]);
  return NextAuth(request, context, microsoft ? { ...options, providers: [...options.providers, microsoftProvider(microsoft)] } : options);
}

export { handler as GET, handler as POST };

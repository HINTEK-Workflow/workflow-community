import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { ApiError, failure } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/**
 * Nyhetsutskick (2026-10-03): the people who said yes to news about changes and improvements, for the
 * installation's superadmin – a count, or the list as CSV (?format=csv). Only active accounts; nothing else is shared.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new ApiError(401, "Logga in för att fortsätta.");
    if (user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
    const where = { newsletterOptInAt: { not: null }, isActive: true };
    if (new URL(request.url).searchParams.get("format") !== "csv")
      return NextResponse.json({ count: await prisma.user.count({ where }) }, { headers: { "Cache-Control": "private, no-store" } });
    const people = await prisma.user.findMany({ where, orderBy: { newsletterOptInAt: "asc" }, select: { email: true, name: true, newsletterOptInAt: true }, take: 10_000 });
    const lines = [["E-post", "Namn", "Sa ja"].map(csvCell).join(";"), ...people.map((person) => [person.email, person.name ?? "", person.newsletterOptInAt!.toISOString().slice(0, 10)].map(csvCell).join(";"))];
    return new Response(`﻿${lines.join("\r\n")}\r\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="nyhetsutskick.csv"', "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

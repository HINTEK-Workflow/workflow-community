import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isQaRole, localRoleQaEnabled, localRoleQaSessionCookie, QA_ROLE_EMAILS } from "@/lib/auth/access";

export async function POST(request: Request) {
  const role = process.env.KFID_LOCAL_ROLE_QA_ROLE;
  const origin = request.headers.get("origin");
  if (
    !localRoleQaEnabled() ||
    !isQaRole(role) ||
    origin !== new URL(env.APP_URL).origin
  ) return new Response("Inte tillgängligt.", { status: 403 });

  const user = await prisma.user.findUnique({
    where: { email: QA_ROLE_EMAILS[role] },
    select: {
      id: true, email: true, role: true, isActive: true, activeOrganizationId: true,
      organizationMemberships: {
        where: { isActive: true, organization: { isActive: true } },
        select: { role: true, organizationId: true },
      },
    },
  });
  const requiredRole = role === "worker" ? "MEMBER" : "OWNER";
  // The synthetic superadmin must really be a superadmin, and the other two must not be.
  if ((role === "superadmin") !== (user?.role === "SUPERADMIN")) return new Response("QA-kontot har fel roll.", { status: 409 });
  if (!user?.isActive || !user.activeOrganizationId ||
      !user.organizationMemberships.some((member) => member.organizationId === user.activeOrganizationId && member.role === requiredRole)) {
    return new Response("QA-kontot saknas eller har fel roll.", { status: 409 });
  }
  const token = await encode({
    secret: env.AUTH_SECRET,
    maxAge: 60 * 60 * 8,
    token: { sub: user.id, email: user.email, role: user.role },
  });
  const response = NextResponse.redirect(new URL("/?view=stats", env.APP_URL), 303);
  response.cookies.set(localRoleQaSessionCookie()!, token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

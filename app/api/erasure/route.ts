import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { ErasureError, eraseCompany, erasePersonTx, erasureBlocker, removeMemberDataTx } from "@/lib/auth/erasure";
import { remove } from "@/lib/kfid/storage";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { isHintekOrganization } from "@/lib/branding";
import { ApiError, body, checkOrigin, context, failure, requireAdmin } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

/**
 * Radering av personuppgifter (2026-10-03, three levels): "self" – the person erases their own account (and a
 * company where nobody else is a member); "member" – a company admin erases a member's; "company" – the superadmin
 * erases a whole customer company. Every erasure is logged with counts, never with the content.
 */
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("self"), confirm: z.literal("RADERA", { error: "Skriv RADERA för att bekräfta." }), password: z.string().max(200).optional() }),
  z.object({ action: z.literal("member"), userId: z.string().min(1).max(100), organizationId: z.string().min(1).max(100) }),
  z.object({ action: z.literal("company"), organizationId: z.string().min(1).max(100), confirmName: z.string().trim().max(200) }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const command = input.parse(await body(request));

    if (command.action === "self") {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { passwordHash: true, organizationMemberships: { where: { isActive: true }, select: { organizationId: true } } } });
      if (user.passwordHash && !(command.password && await verifyPassword(command.password, user.passwordHash))) throw new ApiError(403, "Lösenordet stämmer inte.");
      const blocker = await erasureBlocker(ctx.user.id);
      if (blocker) throw new ApiError(409, blocker);
      // A company where the person is the only member goes with the account; the others keep their data.
      const alone: string[] = [];
      for (const { organizationId } of user.organizationMemberships)
        if (!(await prisma.organizationMember.count({ where: { organizationId, isActive: true, userId: { not: ctx.user.id } } }))) alone.push(organizationId);
      // A company that cannot be erased stops with a clear answer, never a 500 (2026-10-13).
      try { for (const organizationId of alone) await eraseCompany(organizationId, ctx.user.id); }
      catch (error) { if (error instanceof ErasureError) throw new ApiError(409, error.message); throw error; }
      const stillThere = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { isActive: true } });
      // The person's competence cards are the company's documentation: kept three months like every card of someone who
      // left, then deleted by the nightly job (2026-10-07, one rule however the person leaves).
      if (stillThere.isActive) await prisma.$transaction(async (tx) => {
        const counts = await erasePersonTx(tx, ctx.user.id, { keepCompetenceCards: true });
        await tx.administrationEvent.createMany({ data: user.organizationMemberships.filter((item) => !alone.includes(item.organizationId)).map(({ organizationId }) => ({
          actorId: ctx.user.id, organizationId, action: "person_erased", detail: `En medarbetare raderade sitt konto: ${JSON.stringify(counts)}.` })) });
      });
      return NextResponse.json({ ok: true, companies: alone.length });
    }

    if (command.action === "member") {
      requireAdmin(ctx);
      if (command.organizationId !== ctx.organizationId) throw new ApiError(403, "Byt till företaget först.");
      if (command.userId === ctx.user.id) throw new ApiError(409, "Radera ditt eget konto under Mina inställningar.");
      const membership = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: command.userId } }, select: { id: true, role: true, user: { select: { role: true } } } });
      if (!membership) throw new ApiError(404, "Personen är inte medlem i företaget.");
      if (membership.user.role === "SUPERADMIN") throw new ApiError(403, "Installationens superadmin raderas inte här.");
      if (membership.role === "OWNER" && ctx.memberRole !== "OWNER") throw new ApiError(403, "Bara en ägare kan radera en annan ägares uppgifter.");
      // Ny bekräftelse (säkerhetsgranskningen 2026-11-24, G-21): a sign-in or a confirmation within the last ten minutes.
      await requireFreshAuth(ctx.user.id, ctx.auth);
      const others = await prisma.organizationMember.count({ where: { userId: command.userId, organizationId: { not: ctx.organizationId }, isActive: true } });
      const removedFiles: string[] = [];
      const result = await prisma.$transaction(async (tx) => {
        // Someone who also works for another company keeps their account there; here the membership goes with what was
        // personal to them in this company (2026-10-13).
        if (others) {
          removedFiles.push(...await removeMemberDataTx(tx, ctx.organizationId, command.userId));
          await tx.organizationMember.delete({ where: { id: membership.id } });
          await tx.user.updateMany({ where: { id: command.userId, activeOrganizationId: ctx.organizationId }, data: { activeOrganizationId: null } });
          await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "person_erased", detail: "En medarbetare togs bort ur företaget. Personen har konto i ett annat företag, där uppgifterna finns kvar." } });
          return { anonymised: false };
        }
        // The card is kept three months, like that of a member who is removed; the admin can delete it earlier under Egenkontroll.
        const counts = await erasePersonTx(tx, command.userId, { keepCompetenceCards: true });
        await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "person_erased", detail: `En medarbetares personuppgifter raderades: ${JSON.stringify(counts)}.` } });
        return { anonymised: true };
      });
      for (const path of removedFiles) await remove(path);
      return NextResponse.json({ ok: true, ...result });
    }

    if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
    const company = await prisma.organization.findUnique({ where: { id: command.organizationId }, select: { id: true, name: true, slug: true, domain: true, isActive: true } });
    if (!company) throw new ApiError(404, "Företaget finns inte.");
    if (company.id === ctx.organizationId || isHintekOrganization(company)) throw new ApiError(403, "Installationens eget företag kan inte raderas här.");
    if (command.confirmName !== company.name) throw new ApiError(400, "Skriv företagets namn exakt för att bekräfta.");
    await requireFreshAuth(ctx.user.id, ctx.auth);
    try { return NextResponse.json({ ok: true, ...(await eraseCompany(company.id, ctx.user.id)) }); }
    catch (error) { if (error instanceof ErasureError) throw new ApiError(409, error.message); throw error; }
  } catch (error) {
    return failure(error);
  }
}

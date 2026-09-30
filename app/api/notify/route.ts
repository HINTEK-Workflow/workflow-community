import { NextResponse } from "next/server";
import { z } from "zod";
import {
  context,
  checkOrigin,
  body,
  failure,
  ownedControl,
  ApiError,
  requireCloudStorage,
  requireWorkflowPermission,
} from "@/lib/kfid/server";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    const input = z
      .object({ id: z.string().max(100), email: z.email() })
      .parse(await body(request));
    const control = await ownedControl(ctx, input.id);
    requireWorkflowPermission(ctx, "kfid", "report");
    if (control.postedAt && Date.now() - control.postedAt.getTime() < 60_000)
      throw new ApiError(429, "Vänta en minut innan du skickar igen.");
    const url = new URL(
      `/?view=new&id=${encodeURIComponent(control.id)}`,
      env.APP_URL,
    ).toString();
    const text = `${ctx.organization.name} har sparat kontrollen ${control.title}.\n\nÖppna kontrollen: ${url}\n\nInloggning och behörighet till företaget krävs. Under testperioden är åtkomst begränsad till testkontot.`;
    const escape = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]!,
      );
    await sendSystemEmail({
      to: input.email,
      subject: "Kontroll före idrifttagning · HINTEK Workflow – kontroll sparad",
      text,
      html: `<p>${escape(text).replace(/\n/g, "<br>")}</p>`,
    });
    await prisma.control.update({
      where: { id: control.id },
      data: { postedAt: new Date(), postedTo: input.email },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

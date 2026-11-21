import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { copyDevice, createDevice, deviceEditorView, importDevices, publishDevice, resetDevice, saveDeviceDraft } from "@/lib/machine/simulator/device-designs-server";
import { parseDeviceFile, standardDesign } from "@/lib/machine/simulator/surface/device-designs";
import { isDeviceKind } from "@/lib/machine/simulator/surface/devices";

export const dynamic = "force-dynamic";

/**
 * PLC-apparater (2026-11-06): Installation's editor of the simulator's devices. Workflow's superadmin only; every call
 * checks the session and the role, a change also the Origin, the rate and the revision the editor read. Product content only – no
 * company's data is read or returned here.
 */
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return ctx;
}
const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await deviceEditorView(), { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const key = z.string().min(1).max(16);
const revision = z.number().int().min(0);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), key, revision, design: z.unknown() }),
  z.object({ action: z.literal("publish"), key, revision }),
  z.object({ action: z.literal("reset"), key, revision }),
  z.object({ action: z.literal("copy"), key, function: z.string().max(24).nullable().default(null) }),
  z.object({ action: z.literal("create"), function: z.string().max(24), name: z.string().max(60).default("") }),
  z.object({ action: z.literal("import"), text: z.string().max(3 * 1024 * 1024), choices: z.array(z.enum(["replace", "new"])).max(50).default([]) }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    if (!(await hitRateLimit(RATE_RULES.pdfTemplateSave, `plc-device:${ctx.user.id}`)).allowed) throw new ApiError(429, "Många ändringar den senaste timmen. Vänta en stund.");
    const input = requestSchema.parse(await body(request));
    const actor = { userId: ctx.user.id, organizationId: ctx.organizationId };
    switch (input.action) {
      case "save": return NextResponse.json(await saveDeviceDraft(actor, input.key, input.revision, input.design), { headers: noStore });
      case "publish": return NextResponse.json(await publishDevice(actor, input.key, input.revision), { headers: noStore });
      case "reset": return NextResponse.json(await resetDevice(actor, input.key, input.revision), { headers: noStore });
      case "copy": {
        // The copy starts from what the editor shows: the draft, else the published design, else the standard one.
        const item = (await deviceEditorView()).items.find((entry) => entry.key === input.key);
        const from = item?.draft ?? item?.published ?? (isDeviceKind(input.key) ? standardDesign(input.key) : null);
        if (!from) throw new ApiError(404, "Apparaten finns inte.");
        return NextResponse.json(await copyDevice(actor, from, input.function), { headers: noStore });
      }
      case "create": return NextResponse.json(await createDevice(actor, input.function, input.name), { headers: noStore });
      case "import": {
        const parsed = parseDeviceFile(input.text);
        if (!parsed.ok) return NextResponse.json({ error: parsed.errors[0], errors: parsed.errors }, { status: 400, headers: noStore });
        return NextResponse.json(await importDevices(actor, parsed.devices.map((device, index) => ({ ...device, mode: input.choices[index] === "replace" && device.key ? "replace" as const : "new" as const }))), { headers: noStore });
      }
    }
  } catch (error) {
    return failure(error);
  }
}

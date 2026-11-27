import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure } from "@/lib/kfid/server";
import { publicInstance } from "@/lib/instance";
import { readLimitedFormData } from "@/lib/security/limited-body";
import {
  ICON_MAX_BYTES, ICON_SIZES, ICON_TYPES, IconError, builtInIconUrls, iconOfSize, ownIconUrls, readOwnIcon, removeInstanceIcon, saveInstanceIcon, type IconSize,
} from "@/lib/instance-icon";

export const dynamic = "force-dynamic";

/**
 * Appikonen (2026-11-10, val D): GET hands out the installation's own icon in one size – public, as the browser and
 * the home screen fetch it before anyone signs in; ?meta=1 tells the superadmin what is in force. POST uploads a new one and
 * DELETE goes back to the built-in icon: the superadmin only, where the installation may have its own (features.ownIcon),
 * Origin checked, written to the history. The picture is read and drawn again on the server; nothing else of the file is kept.
 */
async function superadmin() {
  const ctx = await context();
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  if (!publicInstance().features.ownIcon) throw new ApiError(404, "Finns inte i den här installationen.");
  return ctx;
}

const view = async () => {
  const icon = await readOwnIcon();
  return { own: Boolean(icon), changedAt: icon?.changedAt ?? null, icons: icon ? ownIconUrls(icon.version) : builtInIconUrls() };
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("meta") === "1") {
      await superadmin();
      return NextResponse.json(await view(), { headers: { "Cache-Control": "private, no-store" } });
    }
    const size = url.searchParams.get("size");
    if (!size || !(ICON_SIZES as readonly string[]).includes(size)) throw new ApiError(400, "Okänd storlek.");
    const icon = publicInstance().features.ownIcon ? await readOwnIcon() : null;
    if (!icon) throw new ApiError(404, "Ingen egen ikon.");
    const png = await iconOfSize(icon.png, size as IconSize);
    // The address carries the version: a new icon is a new address, so this one may be kept.
    const versioned = url.searchParams.get("v") === icon.version;
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    if (Number(request.headers.get("content-length")) > ICON_MAX_BYTES + 200_000) throw new ApiError(413, "Bilden får vara högst 2 MB.");
    const form = await readLimitedFormData(request, ICON_MAX_BYTES + 200_000);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new ApiError(400, "Välj en bild.");
    if (file.size > ICON_MAX_BYTES) throw new ApiError(413, "Bilden får vara högst 2 MB.");
    if (!(ICON_TYPES as readonly string[]).includes(file.type)) throw new ApiError(400, "Välj PNG, JPEG eller WebP.");
    try { await saveInstanceIcon(new Uint8Array(await file.arrayBuffer())); }
    catch (error) { if (error instanceof IconError) throw new ApiError(400, error.message); throw error; }
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "instance_icon", detail: "Laddade upp en egen appikon." } });
    return NextResponse.json(await view(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    await removeInstanceIcon();
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "instance_icon", detail: "Tog bort den egna appikonen. Den inbyggda används igen." } });
    return NextResponse.json(await view(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

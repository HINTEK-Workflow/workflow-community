import { NextResponse } from "next/server";
import { failure } from "@/lib/kfid/server";
import { frameCsp, frameShellHtml } from "@/lib/website/frame";
import { websiteFrameOrigin } from "@/lib/website/server";
import { websiteAdmin } from "./website";

/**
 * Min webbsida:s förhandsvisning (2026-11-10): the shell document of the editor's preview frames (lib/website/frame.ts). It
 * holds no data – only the script that writes what the editor posts to it – and its policy is in this answer: sandboxed (an
 * opaque origin, even when opened on its own), scripts and styles inline or from the company's own connected site, no fetch,
 * no forms, framed by the app only. next.config.ts leaves this path out of its own CSP header, which would replace this one.
 * The company's admin only, like the rest of the page.
 */
export async function GET() {
  try {
    const ctx = await websiteAdmin();
    return new NextResponse(frameShellHtml(), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": frameCsp(await websiteFrameOrigin(ctx.organizationId), { header: true }),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    return failure(error);
  }
}

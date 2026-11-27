import type { MetadataRoute } from "next";
import { publicInstance } from "@/lib/instance";
import { SITE_DESCRIPTION } from "@/lib/site-metadata";
import { instanceIconUrls } from "@/lib/instance-icon";

export const dynamic = "force-dynamic";

/**
 * The install manifest (a route of its own since 2026-11-07, so only the app links it: app/layout.tsx leaves the link out on
 * the public site, which answers 404 here, lib/public-site.ts).
 */
async function manifest(): Promise<MetadataRoute.Manifest> {
  const { name, features } = publicInstance();
  // The installation's icon (lib/instance-icon.ts): its own when the superadmin uploaded one, otherwise the built-in.
  const icons = await instanceIconUrls(features.ownIcon);
  return {
    name,
    short_name: "Workflow",
    description: SITE_DESCRIPTION,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f7fb",
    // The menu and top bar of Workflow Blue, so the installed app has one colour from the status bar down.
    theme_color: "#113351",
    categories: ["business", "productivity"],
    lang: "sv",
    icons: [
      { src: icons["192"], sizes: "192x192", type: "image/png" },
      { src: icons["512"], sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icons.maskable, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Straight to the work from the home screen icon (2026-10-02).
    shortcuts: [
      { name: "Uppgifter", url: "/?view=tasks" },
      { name: "Ny uppgift", url: "/?view=new_task" },
      { name: "Tid", url: "/?view=time" },
    ],
  };
}

export async function GET() {
  return new Response(JSON.stringify(await manifest()), { headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" } });
}

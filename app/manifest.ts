import type { MetadataRoute } from "next";
import { publicInstance } from "@/lib/instance";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const { name } = publicInstance();
  return {
    name,
    short_name: "Workflow",
    description: "Projekt, arbetsorder, riskbedömning, kontroller, planering och tidrapport på ett ställe.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f7fb",
    // The menu and top bar of HINTEK Blue, so the installed app has one colour from the status bar down.
    theme_color: "#113351",
    categories: ["business", "productivity"],
    lang: "sv",
    icons: [
      { src: "/icons/hintek-workflow-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/hintek-workflow-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      { src: "/icons/hintek-workflow-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Straight to the work from the home screen icon (2026-10-02).
    shortcuts: [
      { name: "Mina uppgifter", url: "/?view=tasks" },
      { name: "Ny uppgift", url: "/?view=new_task" },
      { name: "Tidrapport", url: "/?view=time" },
    ],
  };
}

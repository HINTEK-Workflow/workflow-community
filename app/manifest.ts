import type { MetadataRoute } from "next";
import { publicInstance } from "@/lib/instance";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const { name } = publicInstance();
  return {
    name: `${name} – Kontroll före idrifttagning`,
    short_name: "Workflow",
    description: `Kontroll före idrifttagning och andra arbetsmoduler i ${name}.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#174c72",
    lang: "sv",
    icons: [
      { src: "/icons/hintek-workflow-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/hintek-workflow-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}

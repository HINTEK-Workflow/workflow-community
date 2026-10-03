import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Fas 2 (2026-09-30): the core reaches HINTEK's commercial part only through these three modules; without ee/ (the
// community edition) they resolve to the neutral versions in lib/extensions. Mirrors the paths in tsconfig.json.
const hasEe = existsSync(path.join(process.cwd(), "ee", "server.ts"));
const eeAliases = {
  "@ee/server": path.join(process.cwd(), hasEe ? "ee/server.ts" : "lib/extensions/none/server.ts"),
  "@ee/client": path.join(process.cwd(), hasEe ? "ee/client.tsx" : "lib/extensions/none/client.tsx"),
  "@ee/present": path.join(process.cwd(), hasEe ? "ee/present.ts" : "lib/extensions/none/present.ts"),
};

// The version shown in the menu (2026-10-03: the version number instead of "Beta" and "Förhandsversion").
const version = (JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // The separate pricing page is gone (2026-09-29); old links go to the landing page's price section.
  async redirects() {
    return [{ source: "/pricing", destination: "/#priser", permanent: true }];
  },
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, ...eeAliases };
    return config;
  },
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;

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

// API routes that set their own Cache-Control (path after /api/, as regex alternatives): the mailing images (public,
// immutable), the map's status and tiles, the QR image and the product pictures (private, cached), the live stream (no-cache, no-transform) and
// the OAuth token and client registration for MCP clients, which answer with exactly "no-store" and Pragma: no-cache as RFC 6749 5.1 asks.
const API_OWN_CACHING = ["mailing-images/", "map/status", "map/tiles/", "places/qr", "product-image", "workflow-tasks/live", "oauth/token", "oauth/register"];

// COOP and CORP (Z1, ISO review 2026-11-20; tests/security-headers.test.ts), as regex alternatives after the first "/". Each path
// gets one value from here: a header here would replace a route's own, so the routes that set CORP themselves are left out.
// - COOP_OPEN_PATHS: sign-in and OAuth, which a window of another site may open (MCP clients) – no COOP.
// - CORP_OWN: the routes that set their own CORP – the mailing and Meta images (cross-origin), the landing pictures and films
//   (same-site) and the website editor's frame (same-origin).
// - CORP_PUBLIC: public static media that may be shown on other sites (cross-origin).
const COOP_OPEN_PATHS = ["login(?:/|$)", "register(?:/|$)", "oauth/", "invite(?:/|$)", "api/auth/", "api/oauth/"];
const CORP_OWN = ["api/mailing-images/", "api/meta/image/", "landing-images/", "landing-films/", "api/website/frame"];
const CORP_PUBLIC = ["landing/", "brand/", "icons/", "opengraph-image", "favicon\\.ico$"];

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // No "X-Powered-By: Next.js" (security review 2026-10-04): nothing about the software is told to a visitor.
  poweredByHeader: false,
  // The image build on the server runs out of memory in Next's own type check (v0.6.4 release: heap limit about 2 GB).
  // Types are checked as a separate step that gates every deploy (npm run typecheck, which scripts/ops/release-local.sh runs before
  // a release is pushed), as Next's memory guide advises; only the Dockerfile sets SKIP_BUILD_TYPECHECK.
  typescript: { ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "1" },
  // Security headers on every answer (security review 2026-10-04), whatever proxy is in front: the app may only be
  // framed by itself (the form builder previews a page of its own), no plug-ins or foreign <base>, no MIME guessing, a
  // short referrer, only camera, microphone and position for the app itself, and HTTPS remembered for a year (ignored over http).
  // The CSP leaves out the answers that set a stricter one themselves (a header here would replace theirs): the
  // sandboxed web version of a mailing (/m/…), the mailing images and the website editor's preview frame (lib/website/frame.ts).
  async headers() {
    return [{
      source: "/((?!m/|api/mailing-images/|api/website/frame).*)",
      headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" }],
    }, {
      // S3 (review 2026-10-20): no API answer is kept by a browser or a cache in between – customer data, sessions and
      // downloads alike. A header here replaces the route's own, so the answers that choose their own caching are left
      // out (API_OWN_CACHING; tests/api-cache-control.test.ts keeps the list and the routes together).
      source: `/api/((?!${API_OWN_CACHING.join("|")}).*)`,
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    }, {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // interest-cohort (FLoC) is unknown to today's browsers and gave a console warning on every page (simulation 0.6.3).
        // microphone=(self) (2026-11-21): HINTEK AI's chat records a spoken message in the app itself (only after a press, and the
        // browser still asks); the audio goes only to Workflow's own /api/ai/transcribe, never to a third party, and no frame from
        // another origin gets the microphone.
        { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(self), payment=(), usb=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
        // Telefonens första bild (lib/workflow/first-frame.ts): Chromium browsers send the window's size with the following
        // requests, so the server draws the right layout for a narrow window or a tablet too. No Critical-CH: the first
        // visit is never fetched twice; without the size a phone is still known (Sec-CH-UA-Mobile, User-Agent).
        { key: "Accept-CH", value: "Sec-CH-UA-Mobile, Sec-CH-Viewport-Width, Sec-CH-Viewport-Height" },
      ],
    }, {
      // Z1 (ISO review 2026-11-20, ZAP 90004): a page another site opens gets no handle on the app's window. Not same-origin:
      // the sign-in and OAuth pages (COOP_OPEN_PATHS) must keep the browser's default, and a page with same-origin would lose
      // its "Logga in igen" tab, which goes to /login and closes itself from /login/klar through window.opener.
      source: `/((?!${COOP_OPEN_PATHS.join("|")}).*)`,
      headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
    }, {
      // An MCP client (an AI app on the web) opens /oauth/authorize in a popup, which may pass /login, and reads its own
      // callback through window.opener; any COOP on these pages would cut that link. Stated outright, so ZAP sees a choice.
      source: `/((?:${COOP_OPEN_PATHS.join("|")}).*)`,
      headers: [{ key: "Cross-Origin-Opener-Policy", value: "unsafe-none" }],
    }, {
      // No answer is read into another site's page – except public media and the routes that choose for themselves (CORP_OWN).
      source: `/((?!${[...CORP_OWN, ...CORP_PUBLIC].join("|")}).*)`,
      headers: [{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }],
    }, {
      // Public media that other places show: logos, icons and pictures on hintek.se and in e-mail (web mail loads them from its
      // own page), the link-preview image. Nothing private is under these paths.
      source: `/((?:${CORP_PUBLIC.join("|")}).*)`,
      headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }],
    }];
  },
  // The separate pricing page is gone (2026-09-29); old links go to the landing page's price section.
  async redirects() {
    return [{ source: "/pricing", destination: "/#priser", permanent: true }];
  },
  webpack(config) {
    // unzipper 0.12 (via exceljs, since buffers left 2026-11-20) requires the AWS S3 client inside Open.s3_v3, which Workflow never
    // calls; without the alias webpack cannot resolve it and the build fails.
    config.resolve.alias = { ...config.resolve.alias, ...eeAliases, "@aws-sdk/client-s3": false };
    return config;
  },
  experimental: {
    cpus: 1,
    // proxy.ts (2026-10-15) makes Next buffer every request body, by default only the first 10 MB. The largest upload is a
    // price file (MAX_PRICE_FILE_BYTES 60 MB + 1 MB form); each route still enforces its own, smaller limit.
    proxyClientMaxBodySize: 62_000_000,
  },
};

export default nextConfig;

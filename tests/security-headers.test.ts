import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../next.config";

// Z1 (ISO review 2026-11-20, ZAP 90004): Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy from next.config.ts. Every
// path gets at most one value per header from the config (a config header replaces a route's own), and the exceptions stay:
// sign-in and OAuth without COOP (an MCP client's popup reads its callback through window.opener), public media cross-origin,
// and the routes that set their own CORP untouched.

async function headersFor() {
  const rules = (await nextConfig.headers!()).map((rule) => ({ match: getPathMatch(rule.source), headers: rule.headers }));
  return (pathname: string) => {
    const found: Record<string, string[]> = {};
    for (const rule of rules) if (rule.match(pathname) !== false)
      for (const header of rule.headers) if (/^Cross-Origin-/.test(header.key)) (found[header.key] ??= []).push(header.value);
    return found;
  };
}

test("app pages, API answers, screens and customer links get COOP same-origin-allow-popups and CORP same-origin", async () => {
  const of = await headersFor();
  for (const pathname of ["/", "/kunder", "/skarm", "/visa/abc", "/offert/abc", "/faktura/abc", "/filmer", "/api/workspace", "/api/health", "/sw.js", "/plc-popout.html", "/loginx", "/m/abc"])
    assert.deepEqual(of(pathname), { "Cross-Origin-Opener-Policy": ["same-origin-allow-popups"], "Cross-Origin-Resource-Policy": ["same-origin"] }, pathname);
});

test("sign-in and OAuth keep the browser's default COOP, so a popup opened by an MCP client keeps its opener", async () => {
  const of = await headersFor();
  for (const pathname of ["/login", "/login/klar", "/register", "/invite/abc", "/oauth/authorize", "/api/auth/signout", "/api/auth/callback/google", "/api/oauth/token"])
    assert.deepEqual(of(pathname)["Cross-Origin-Opener-Policy"], ["unsafe-none"], pathname);
});

test("public media may be shown on other sites; routes with their own CORP get none from the config", async () => {
  const of = await headersFor();
  for (const pathname of ["/landing/hintek-logo.png", "/brand/logo.png", "/icons/workflow-192.png", "/opengraph-image", "/favicon.ico"])
    assert.deepEqual(of(pathname)["Cross-Origin-Resource-Policy"], ["cross-origin"], pathname);
  for (const pathname of ["/api/mailing-images/k1", "/api/meta/image/k1", "/landing-images/a.png", "/landing-films/a.mp4", "/api/website/frame"])
    assert.equal(of(pathname)["Cross-Origin-Resource-Policy"], undefined, pathname);
  // ...and those routes really do set one themselves.
  for (const file of ["app/api/mailing-images/[key]/route.ts", "app/api/meta/image/[key]/route.ts", "lib/api-handlers/website-frame.ts"])
    assert.match(readFileSync(file, "utf8"), /"Cross-Origin-Resource-Policy": "(cross-origin|same-origin)"/, file);
});

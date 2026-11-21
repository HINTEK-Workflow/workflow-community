import type { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { FLOW_MINUTES, flowCookieValue, type FlowCookie } from "@/lib/operator/microsoft-group";

/** The started Microsoft sign-in's cookie (state, nonce, PKCE verifier): short, HttpOnly, only for the Microsoft routes. */
export const FLOW_COOKIE = "wf_operator_ms";
const options = () => ({ httpOnly: true, secure: new URL(env.APP_URL).protocol === "https:", sameSite: "lax" as const, path: "/operator/api/microsoft" });
export const setFlowCookie = (response: NextResponse, flow: FlowCookie) => response.cookies.set(FLOW_COOKIE, flowCookieValue(flow), { ...options(), maxAge: FLOW_MINUTES * 60 });
export const clearFlowCookie = (response: NextResponse) => response.cookies.set(FLOW_COOKIE, "", { ...options(), maxAge: 0 });
/** Where the company's admin comes back to (the page Operatörskonton). */
export const ADMIN_RETURN = "/?view=operator_accounts";

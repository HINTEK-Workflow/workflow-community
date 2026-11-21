// Part of the open core since 2026-10-03 (lib/extensions/core-routes.ts).
import { NextResponse } from "next/server";
import { coreRoute } from "@/lib/extensions/core-routes";

export const dynamic = "force-dynamic";
const route = coreRoute("v1/tool");
export const POST = route.POST;

/** A tool is called with POST (R2-API-01 / API-17): any other method answers 405 with a short JSON body and the Allow header. */
const usePost = () => NextResponse.json({ error: "Använd POST." }, { status: 405, headers: { Allow: "POST" } });
export const GET = usePost;
export const PUT = usePost;
export const PATCH = usePost;
export const DELETE = usePost;

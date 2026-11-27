import { NextResponse } from "next/server";
import { failure } from "@/lib/kfid/server";
import { requireOperator } from "@/lib/operator/session";
import { operatorPageData } from "@/lib/operator/reports-server";

export const dynamic = "force-dynamic";

/** The signed-in operator's page: the machines the account sees, the company's causes, the own reports and their on-call state. */
export async function GET(request: Request) {
  try {
    // ?poll=1: the page asks for the on-call state; that is not activity (the inactivity clock runs on).
    const operator = await requireOperator({ touch: new URL(request.url).searchParams.get("poll") !== "1" });
    return NextResponse.json(await operatorPageData(operator), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

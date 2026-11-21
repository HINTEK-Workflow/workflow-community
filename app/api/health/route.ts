import { NextResponse } from "next/server";
import { publicInstance } from "@/lib/instance";

export async function GET() {
  return NextResponse.json({
    name: publicInstance().name,
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}

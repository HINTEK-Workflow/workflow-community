import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Kakor (2026-10-03): the details are a pop-up, not a page; an old or shared link opens the pop-up.
export default async function CookiesPage() {
  redirect((await getCurrentUser()) ? "/?view=stats&kakor=1" : "/login?kakor=1");
}

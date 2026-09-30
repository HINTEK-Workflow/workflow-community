import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  await requireUser();
  const { checkout } = await searchParams;
  const status = checkout === "success" || checkout === "canceled" ? `&checkout=${checkout}` : "";
  redirect(`/?view=credits${status}`);
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { FormPreviewFrame } from "@/features/workflow/form-preview-frame";

export const dynamic = "force-dynamic";

/**
 * The phone frame of the form builder's preview (Daniel 2026-09-28): the task editor at a phone's real width, drawn
 * only from what the builder sends it. Signed-in users only; the page holds no data of its own.
 */
export default async function FormPreviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <FormPreviewFrame />;
}

import { redirect } from "next/navigation";
import { isQaRole, localRoleQaEnabled } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export default function RoleQaPage() {
  if (!localRoleQaEnabled()) redirect("/");
  const role = process.env.KFID_LOCAL_ROLE_QA_ROLE;
  if (!isQaRole(role)) redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-5 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-primary">Endast lokal QA</p>
        <h1 className="page-title mt-2">{role === "owner" ? "Kundföretagets admin" : role === "worker" ? "Kundföretagets medarbetare" : "HINTEK superadmin (QA)"}</h1>
        <p className="page-description mt-3">Fiktiv testinloggning mot den isolerade testdatabasen. Ingen kund får åtkomst via denna sida.</p>
      </div>
      <form action="/api/qa/session" method="post">
        <button className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
          Öppna testarbetsytan
        </button>
      </form>
      <p className="text-xs text-muted-foreground">Varje QA-roll har en egen lokal session. Du kan därför jämföra rollerna i flera flikar i samma webbläsare.</p>
    </main>
  );
}

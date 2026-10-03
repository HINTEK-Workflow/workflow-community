import type { Metadata } from "next";
import Link from "next/link";
import { COOKIES, COOKIE_NOTICE_VERSION } from "@/lib/cookies";
import { publicInstance } from "@/lib/instance";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `Kakor | ${publicInstance().name}` };
}

/** Kakor (2026-10-03): the full list behind the cookie notice, readable without signing in. */
export default function CookiesPage() {
  const { name } = publicInstance();
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">← Till inloggningen</Link>
        <span className="text-xs text-muted-foreground">{name} · uppdaterad {COOKIE_NOTICE_VERSION}</span>
      </div>
      <h1 className="page-title">Kakor och lokal lagring</h1>
      <p className="page-description mt-3">
        {name} använder bara kakor och lokal lagring i webbläsaren som är nödvändiga för tjänsten du använder: att logga in,
        att skydda inloggningen och att komma ihåg dina egna val. Därför behövs inget samtycke, men du ska veta vad som sparas.
        Inga kakor används för statistik, annonser eller spårning, och ingenting hämtas från andra webbplatser.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[40rem] text-left text-sm" data-testid="cookie-table">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="p-3 font-medium">Namn</th><th className="p-3 font-medium">Typ</th><th className="p-3 font-medium">Varför</th><th className="p-3 font-medium">Hur länge</th></tr>
          </thead>
          <tbody className="divide-y">
            {COOKIES.map((entry) => <tr key={entry.name} className="align-top">
              <td className="p-3 font-mono text-xs">{entry.name}</td>
              <td className="p-3">{entry.kind}</td>
              <td className="p-3">{entry.purpose}</td>
              <td className="p-3 text-muted-foreground">{entry.lifetime}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Du kan ta bort kakor och lokal lagring i webbläsarens inställningar. Då loggas du ut och dina lokala val försvinner.
        Hur personuppgifter behandlas står i integritetspolicyn.
      </p>
    </main>
  );
}

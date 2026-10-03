"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel, Field } from "./ui";
import { api } from "./api";
export function Profile({
  notify,
}: {
  notify: (message: string, error?: boolean) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<{
      name: string | null;
      email: string;
      hasPassword: boolean;
      google: boolean; newsletter?: boolean; googleAccounts?: { id: string; email: string }[];
    } | null>(null),
    [name, setName] = useState(""),
    [currentPassword, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirm] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("googleLink");
    if (!result) return;
    notify(result === "ok" ? "Google-kontot är kopplat. Du kan nu logga in med det." : result === "google_linked_elsewhere" ? "Det Google-kontot är redan kopplat till ett annat konto i Workflow." : result === "google_unverified_email" ? "Google-kontot måste ha en verifierad e-postadress." : "Google-kontot kunde inte kopplas.", result !== "ok");
    const url = new URL(window.location.href);
    url.searchParams.delete("googleLink");
    window.history.replaceState(null, "", url.toString());
  }, [notify]);
  useEffect(() => {
    void api<NonNullable<typeof data>>("/api/profile")
      .then((d) => {
        setData(d);
        setName(d.name || "");
      })
      .catch((e) => notify(e.message, true));
  }, [notify]);
  async function save(input: unknown) {
    setBusy(true);
    try {
      await api("/api/profile", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if ((input as { action?: string }).action === "password") {
        // Every session from before the change has ended, this one too: sign in again with the new password.
        await signOut({ callbackUrl: "/login?reset=1" });
        return;
      }
      notify("Ditt konto är uppdaterat.");
      setCurrent("");
      setPassword("");
      setConfirm("");
      router.refresh();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Ditt konto" description={data?.email}>
      <div className="grid gap-6 lg:grid-cols-2">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ action: "profile", name });
          }}
        >
          <Field
            id="profile-name"
            label="Ditt namn / utförare"
            value={name}
            onChange={setName}
            required
          />
          <p className="text-xs text-muted-foreground">
            Namnet används för nya kontroller. E-postadressen är din inloggning
            och ändras inte här.
          </p>
          <Button className="mobile-form-action" disabled={busy || !data}>Spara namn</Button>
          <div className="space-y-2 rounded-lg border p-3 text-sm" data-testid="profile-google">
            <p className="font-medium">Google-konton</p>
            {data?.googleAccounts?.length ? <ul className="space-y-1">{data.googleAccounts.map((account) => <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="break-all">{account.email || "Google-konto"}</span>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void api("/api/profile", { method: "POST", body: JSON.stringify({ action: "google_unlink", id: account.id }) }).then(() => { notify("Google-kontot är bortkopplat."); setData((current) => current ? { ...current, googleAccounts: current.googleAccounts?.filter((item) => item.id !== account.id) } : current); }).catch((e) => notify((e as Error).message, true))}>Ta bort</Button>
            </li>)}</ul> : <p className="text-xs text-muted-foreground">Inget Google-konto är kopplat.</p>}
            <p className="text-xs text-muted-foreground">Koppla ett Google-konto, till exempel en privat reservadress, så kan du logga in med det till det här kontot.</p>
            <Button type="button" variant="outline" size="sm" disabled={busy || !data} onClick={() => void api("/api/profile", { method: "POST", body: JSON.stringify({ action: "google_link_start" }) }).then(() => signIn("google", { callbackUrl: "/?view=settings&googleLink=ok" })).catch((e) => notify((e as Error).message, true))}>Koppla Google-konto</Button>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" data-testid="profile-newsletter">
            <Checkbox className="mt-0.5" checked={Boolean(data?.newsletter)} disabled={busy || !data}
              onCheckedChange={(value) => { setData((current) => current ? { ...current, newsletter: value === true } : current); void api("/api/profile", { method: "POST", body: JSON.stringify({ action: "newsletter", on: value === true }) }).then(() => notify(value === true ? "Du får nyheter om Workflow." : "Du får inga nyhetsmejl.")).catch((e) => notify((e as Error).message, true)); }} />
            <span><span className="block font-medium">Nyheter i Workflow</span><span className="block text-xs text-muted-foreground">Mejl om ändringar och förbättringar i appen. Sparas direkt.</span></span>
          </label>
        </form>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== confirmPassword) {
              notify("De nya lösenorden matchar inte.", true);
              return;
            }
            void save({ action: "password", currentPassword, password });
          }}
        >
          {data?.hasPassword ? (
            <>
              <Field
                id="profile-current-password"
                type="password"
                label="Nuvarande lösenord"
                value={currentPassword}
                onChange={setCurrent}
                required
              />
              <Field
                id="profile-password"
                type="password"
                label="Nytt lösenord (minst 12 tecken)"
                value={password}
                onChange={setPassword}
                required
              />
              <Field
                id="profile-confirm-password"
                type="password"
                label="Bekräfta nytt lösenord"
                value={confirmPassword}
                onChange={setConfirm}
                required
              />
              <Button className="mobile-form-action" variant="outline" disabled={busy}>
                Byt lösenord
              </Button>
            </>
          ) : null}
          <Link
            href="/forgot-password"
            className="block text-sm text-primary hover:underline"
          >
            Skapa / återställ lösenord via e-post
          </Link>
        </form>
      </div>
    </Panel>
  );
}

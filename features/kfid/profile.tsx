"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
      google: boolean;
    } | null>(null),
    [name, setName] = useState(""),
    [currentPassword, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirm] = useState(""),
    [busy, setBusy] = useState(false);
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
            Namnet används för nya kontroller. E-postadressen är låst till
            testkontot.
          </p>
          <Button className="mobile-form-action" disabled={busy || !data}>Spara namn</Button>
          <p className="text-xs text-muted-foreground">
            {data?.google
              ? "Google är kopplat till kontot."
              : "Google kan användas med samma verifierade testadress."}
          </p>
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

"use client";
import { useEffect, useState } from "react";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "./ui";
import { api } from "./api";
import { sectionKeys, sections } from "@/lib/kfid/model";
type Suggestions = Record<string, string[]>;
type Data = {
  personal: Suggestions;
  company: Suggestions;
  global: Suggestions;
  builtin: Suggestions;
  admin: boolean;
  superadmin: boolean;
};
const choices = [
  ["meta", "Grunduppgifter – alla fält"],
  ...["proj", "perf", "ctrl", "client", "instr", "sn"].map((key) => [
    `meta.${key}`,
    `Grunduppgifter · ${{ proj: "Projekt", perf: "Utfört av", ctrl: "Kontrollerat av", client: "Kontaktperson", instr: "Instrument", sn: "Serienummer" }[key]}`,
  ]),
  ...sectionKeys.flatMap((k) => [
    [k, `${sections[k].title} – alla fält`],
    ...sections[k].fields
      .filter((f) => !f.type && !f.options)
      .map((f) => [`${k}.${f.key}`, `${sections[k].title} · ${f.label}`]),
    [`${k}.comment`, `${sections[k].title} · Kommentar`],
  ]),
  ["vis", "Visuell kontroll / sammanfattning"],
];
export function SuggestionsEditor({
  notify,
  refresh,
}: {
  notify: (text: string, error?: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [scope, setScope] = useState<"personal" | "company" | "global">("personal"),
    [field, setField] = useState("iso"),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void api<Data>("/api/suggestions")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setText(data?.[scope][field]?.join("\n") || "");
  }, [data, scope, field]);
  async function save(reset = false) {
    if (!data) return;
    setBusy(true);
    try {
      const values = { ...data[scope] };
      if (reset) delete values[field];
      else
        values[field] = [
          ...new Set(
            text
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        ];
      await api("/api/suggestions", {
        method: "POST",
        body: JSON.stringify({ scope, values }),
      });
      setData({ ...data, [scope]: values });
      notify(
        reset
          ? "Egna förslag borttagna. Ärvda förslag används."
          : "Autoförslagen är sparade.",
      );
      await refresh();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const inherited = data
    ? ((scope === "personal"
        ? (data.company[field] ?? data.global[field] ?? data.builtin[field])
        : scope === "company"
          ? (data.global[field] ?? data.builtin[field])
          : data.builtin[field]) ?? [])
    : [];
  return (
    <Panel
      title="Autoförslag per kontrollmoment"
      description="Personliga förslag har företräde framför företagets och de gemensamma förslagen."
    >
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !data ? (
        <p className="page-description">Hämtar autoförslag…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Nivå
              <select
                aria-label="Nivå för autoförslag"
                className="form-select"
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
              >
                <option value="personal">Mina förslag</option>
                {data.admin && (
                  <option value="company">Företagets förslag</option>
                )}
                {data.superadmin && (
                  <option value="global">Gemensamma standardförslag</option>
                )}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Kontrollmoment / fält
              <select
                aria-label="Förslagsfält"
                className="form-select"
                value={field}
                onChange={(e) => setField(e.target.value)}
              >
                {choices.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label
            className="block text-xs text-muted-foreground"
            htmlFor="structured-suggestions"
          >
            Ett förslag per rad
          </label>
          <textarea
            id="structured-suggestions"
            className="form-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={inherited.join("\n") || "Lägg till dina förslag här"}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Ärvda förslag: {inherited.join(" · ") || "Inga på denna nivå."}
          </p>
          <div className="mobile-form-actions flex flex-wrap gap-2">
            <Button className="mobile-form-action" disabled={busy} onClick={() => void save()}>
              <Save />
              Spara autoförslag
            </Button>
            <Button
              className="mobile-form-action"
              variant="outline"
              disabled={busy}
              onClick={() => void save(true)}
            >
              <RotateCcw />
              Använd ärvda förslag
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

"use client";
import { Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  sections,
  evaluate,
  type SectionKey,
  type Measurement,
  type Field as FieldDefinition,
} from "@/lib/kfid/model";
import { Field } from "./ui";
/** Shared visual headings; each field keeps its own accessible label. */
export function MeasurementHeader({ section }: { section: SectionKey }) {
  return (
    <div className="measurement-head measurement-grid" aria-hidden="true">
      <span />
      {sections[section].fields.map((field) => (
        <span key={field.key}>{field.label}</span>
      ))}
      <span>Kommentar</span>
      <span className="text-center">Godkänd</span>
      <span />
    </div>
  );
}
export function MeasurementRow({
  section,
  row,
  index,
  auto,
  disabled,
  onChange,
  onRemove,
  onImage,
  suggestions,
}: {
  section: SectionKey;
  row: Measurement;
  index: number;
  auto: boolean;
  disabled: boolean;
  onChange: (field: string, value: string | boolean) => void;
  onRemove: () => void;
  onImage: () => void;
  suggestions: (field: string) => string[];
}) {
  const uid = String(row.uid),
    ok = auto ? evaluate(section, row) : row.ok === true;
  function field(key: string) {
    const f: FieldDefinition =
      key === "comment"
        ? { key, label: "Kommentar" }
        : sections[section].fields.find((f) => f.key === key)!;
    return f.type === "checkbox" ? (
      <label key={key} className="measurement-check">
        <span>{f.label}</span>
        <Checkbox
          aria-label={`${f.label}, rad ${index + 1}`}
          checked={row[key] === true}
          onCheckedChange={(v) => onChange(key, v === true)}
        />
      </label>
    ) : (
      <Field
        key={key}
        id={`${uid}-${key}`}
        className={["name", "objekt", "place", "std", "comment"].includes(key) ? "measurement-wide" : undefined}
        label={
          section === "rcd"
            ? f.label.replace("Utlösningsström", "Utlösn. ström")
            : f.label
        }
        type={f.type || "text"}
        options={f.options}
        value={String(row[key] ?? "")}
        suggestions={!f.type && !f.options ? suggestions(key) : undefined}
        onChange={(v) => onChange(key, v)}
      />
    );
  }
  const tools = (
    <div className="measurement-tools">
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        aria-label={`Rad ${index + 1}`}
      >
        {index + 1}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="measurement-camera size-8 shrink-0"
        aria-label={`Bild för rad ${index + 1}`}
        onClick={onImage}
      >
        <Camera className="size-5" />
      </Button>
    </div>
  );
  const assessment = (
    <label className="measurement-check">
      <span className={ok ? "text-emerald-700" : "text-muted-foreground"}>
        Godkänd
      </span>
      <Checkbox
        aria-label={`Godkänd, rad ${index + 1}`}
        checked={ok}
        className={auto && !disabled ? "measurement-auto-result" : undefined}
        disabled={auto || disabled}
        onCheckedChange={(v) => onChange("ok", v === true)}
      />
    </label>
  );
  const remove = (
    <Button
      variant="ghost"
      size="icon"
      className="measurement-remove size-8"
      aria-label={`Ta bort rad ${index + 1}`}
      onClick={onRemove}
    >
      <Trash2 className="size-5 text-muted-foreground" />
    </Button>
  );
  return (
    <fieldset
      disabled={disabled}
      className={`measurement-row measurement-${section}`}
      data-example={row.example === true || undefined}
      aria-label={`${sections[section].title}, rad ${index + 1}${row.example === true ? ", exempeldata" : ""}`}
    >
      {section === "rcd" ? (
        <>
          <div className="rcd-top">
            {tools}
            {[
              "std",
              "type",
              "uclim",
              "idn",
              "idp",
              "idn_measured",
              "comment",
            ].map(field)}
          </div>
          <div className="rcd-bottom">
            <span className="rcd-indent" />
            {[
              "place",
              "t1p",
              "t1n",
              "t5p",
              "t5n",
              "uc",
              "ntrip05",
              "btnok",
            ].map(field)}
            {assessment}
            {remove}
          </div>
          <p className="rcd-guidance text-xs leading-5 text-muted-foreground">
            Profil {String(row.std)}: 1× ≤{" "}
            {row.std === "TNIT" ? 400 : row.std === "TT" ? 200 : 300} ms, 5× ≤
            40 ms. Autobedömningen använder tider och testknapp; granska övriga
            provvärden separat.
          </p>
        </>
      ) : (
        <div className="measurement-grid">
          {tools}
          {sections[section].fields.map((f) => field(f.key))}
          {field("comment")}
          {assessment}
          {remove}
        </div>
      )}
    </fieldset>
  );
}

"use client";
import { useState } from "react";
import { RotateCcw, Calculator as CalculatorIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, Field } from "./ui";
import {
  calculate,
  calculatorModes,
  calculatorFields,
  calculatorDefaults,
  type CalculatorMode,
} from "@/lib/kfid/calculator";
export function Calculator() {
  const [mode, setMode] = useState<CalculatorMode>("power3"),
    [values, setValues] = useState(calculatorDefaults("power3"));
  const calculated = calculate(mode, values);
  return (
    <Panel
      title="Elkraftskalkylator"
      description="Fem beräkningslägen för Kontroll före idrifttagning."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => setValues(calculatorDefaults(mode))}
        >
          <RotateCcw />
          Nollställ
        </Button>
      }
    >
      <label
        className="mb-2 block text-xs font-medium text-muted-foreground"
        htmlFor="calculator-mode"
      >
        Beräkning
      </label>
      <select
        id="calculator-mode"
        className="form-select mb-5"
        value={mode}
        onChange={(e) => {
          const m = e.target.value as CalculatorMode;
          setMode(m);
          setValues(calculatorDefaults(m));
        }}
      >
        {Object.entries(calculatorModes).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <div className="grid gap-4 sm:grid-cols-2">
        {calculatorFields[mode].map((f) => (
          <Field
            key={`${mode}-${f.key}`}
            id={`calculator-${f.key}`}
            label={f.label}
            value={values[f.key] || ""}
            type={f.options ? "text" : "number"}
            options={f.options}
            onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
          />
        ))}
      </div>
      <div className="mt-5 rounded-xl bg-secondary p-5" role="status">
        <div className="mb-3 flex items-center gap-2 font-medium text-primary">
          <CalculatorIcon className="size-4" />
          Resultat
        </div>
        {calculated.result ? (
          <>
            <dl className="space-y-3">
              {calculated.result.map((r) => (
                <div
                  key={r.label}
                  className="flex flex-wrap justify-between gap-2 text-sm"
                >
                  <dt>{r.label}</dt>
                  <dd className="font-semibold">
                    {r.value.toLocaleString("sv-SE", {
                      maximumFractionDigits: 3,
                    })}{" "}
                    {r.unit}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              {calculated.note}
            </p>
          </>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            {calculated.error}
          </p>
        )}
      </div>
    </Panel>
  );
}

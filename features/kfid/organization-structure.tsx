"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "./api";
import { Panel } from "./ui";

type Department = { id: string; name: string; isActive: boolean };
type Site = { id: string; name: string; isActive: boolean; departments: Department[] };

export function OrganizationStructure({ notify, editable = true }: { notify: (message: string, error?: boolean) => void; editable?: boolean }) {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteName, setSiteName] = useState("");
  const [departmentNames, setDepartmentNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await api<{ sites: Site[] }>("/api/organization-structure");
      setSites(result.sites);
      setError("");
    } catch (issue) {
      setError((issue as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function update(input: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(true);
    try {
      await api("/api/organization-structure", { method: "POST", body: JSON.stringify(input) });
      await load();
      notify(success);
      return true;
    } catch (issue) {
      notify((issue as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Platser och avdelningar" description="Frivillig struktur för större företag. Alla medarbetare kan fortfarande se företagets arbete; platsen begränsar inte behörighet.">
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
      {editable && <form className="mb-5 flex flex-col gap-2 sm:flex-row" onSubmit={async (event) => {
        event.preventDefault();
        const name = siteName.trim();
        if (!name) return;
        if (await update({ action: "site_save", name }, "Platsen är sparad.")) setSiteName("");
      }}>
        <Input aria-label="Ny plats" placeholder="Ny plats, till exempel Göteborg" value={siteName} onChange={(event) => setSiteName(event.target.value)} maxLength={120} required />
        <Button type="submit" disabled={busy || !siteName.trim()} className="w-full sm:w-auto">Lägg till plats</Button>
      </form>}
      {!sites.length && <p className="text-sm text-muted-foreground">Inga platser är skapade. Små företag kan fortsätta arbeta utan dem.</p>}
      <div className="space-y-3">
        {sites.map((site) => (
          <div key={site.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{site.name} {!site.isActive && <span className="font-normal text-muted-foreground">(pausad)</span>}</h3>
              {editable && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void update({ action: "site_status", id: site.id, isActive: !site.isActive }, site.isActive ? "Platsen är pausad." : "Platsen är aktiv.")}>
                {site.isActive ? "Pausa plats" : "Aktivera plats"}
              </Button>}
            </div>
            <ul className="mt-3 space-y-2">
              {site.departments.map((department) => (
                <li key={department.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{department.name}{!department.isActive && " (pausad)"}</span>
                  {editable && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void update({ action: "department_status", id: department.id, isActive: !department.isActive }, department.isActive ? "Avdelningen är pausad." : "Avdelningen är aktiv.")}>
                    {department.isActive ? "Pausa" : "Aktivera"}
                  </Button>}
                </li>
              ))}
            </ul>
            {editable && site.isActive && <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={async (event) => {
              event.preventDefault();
              const name = departmentNames[site.id]?.trim();
              if (!name) return;
              if (await update({ action: "department_save", siteId: site.id, name }, "Avdelningen är sparad."))
                setDepartmentNames((current) => ({ ...current, [site.id]: "" }));
            }}>
              <Input aria-label={`Ny avdelning på ${site.name}`} placeholder="Ny avdelning" value={departmentNames[site.id] || ""} onChange={(event) => setDepartmentNames((current) => ({ ...current, [site.id]: event.target.value }))} maxLength={120} required />
              <Button type="submit" variant="secondary" disabled={busy || !departmentNames[site.id]?.trim()} className="w-full sm:w-auto">Lägg till avdelning</Button>
            </form>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

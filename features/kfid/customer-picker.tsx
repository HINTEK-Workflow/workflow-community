"use client";
import { useEffect, useState } from "react";
import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "./ui";
import { api, action } from "./api";
import type { CustomerItem } from "./types";
export function CustomerPicker({
  open,
  onOpenChange,
  onSelect,
  localCustomers,
  onCreateLocal,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (c: CustomerItem) => void;
  localCustomers?: CustomerItem[];
  onCreateLocal?: (data: {
    name: string;
    company: string;
    email: string;
    address: string;
    phone: string;
  }) => Promise<CustomerItem>;
}) {
  const [query, setQuery] = useState(""),
    [items, setItems] = useState<CustomerItem[]>([]),
    [error, setError] = useState(""),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState({
      name: "",
      company: "",
      email: "",
      address: "",
      phone: "",
    });
  useEffect(() => {
    if (!open) return;
    if (localCustomers) {
      const needle = query.trim().toLocaleLowerCase("sv-SE");
      setItems(
        localCustomers
          .filter((customer) => !customer.deletedAt)
          .filter((customer) =>
            [
              customer.name,
              customer.company,
              customer.email,
              customer.address,
              customer.phone,
            ].some((value) =>
              value.toLocaleLowerCase("sv-SE").includes(needle),
            ),
          )
          .sort((a, b) => a.name.localeCompare(b.name, "sv-SE"))
          .slice(0, 20),
      );
      setError("");
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(
      () =>
        void api<{ items: CustomerItem[] }>(
          `/api/records?kind=customers&sort=name&direction=asc&limit=20&q=${encodeURIComponent(query)}`,
          { signal: abort.signal },
        )
          .then((r) => {
            setItems(r.items);
            setError("");
          })
          .catch((e) => {
            if (!abort.signal.aborted) setError(e.message);
          }),
      200,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, query, localCustomers]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Välj eller skapa kund"
    >
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Sök kund att koppla"
            className="h-10 pl-10"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök hela kundregistret…"
          />
        </div>
        <Button variant="outline" onClick={() => setCreate((v) => !v)}>
          <Plus />
          Ny kund
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {create && (
        <form
          className="mt-5 space-y-4 rounded-lg border p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const c = onCreateLocal
                ? await onCreateLocal(draft)
                : await action<{ id: string }>({
                    action: "customer_save",
                    data: draft,
                  }).then((saved) =>
                    api<CustomerItem>(
                      `/api/workspace?action=customer&id=${saved.id}`,
                    ),
                  );
              onSelect(c);
              onOpenChange(false);
              setCreate(false);
              setDraft({
                name: "",
                company: "",
                email: "",
                address: "",
                phone: "",
              });
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries({
              name: "Kontaktperson",
              company: "Företag",
              email: "E-post",
              address: "Adress",
              phone: "Telefon",
            }).map(([key, label]) => (
              <Field
                key={key}
                id={`picker-${key}`}
                label={label}
                required={key === "name"}
                type={key === "email" ? "email" : "text"}
                value={draft[key as keyof typeof draft]}
                onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
              />
            ))}
          </div>
          <Button disabled={busy} type="submit">
            Spara och koppla kunden
          </Button>
        </form>
      )}
      <div className="mt-5 max-h-80 overflow-y-auto">
        {items.map((c) => (
          <button
            key={c.id}
            className="flex w-full items-center justify-between gap-4 rounded-lg border-b p-3 text-left hover:bg-secondary"
            onClick={() => {
              onSelect(c);
              onOpenChange(false);
            }}
          >
            <span>
              <span className="block text-sm font-medium">
                {c.name}
                {c.company ? ` · ${c.company}` : ""}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {c.email} {c.address}
              </span>
            </span>
            <span className="text-xs text-primary">Koppla</span>
          </button>
        ))}
        {!items.length && (
          <p className="py-5 text-sm text-muted-foreground">
            Inga kunder matchar sökningen.
          </p>
        )}
      </div>
    </Modal>
  );
}

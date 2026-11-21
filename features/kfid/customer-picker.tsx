"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "./ui";
import { api, action } from "./api";
import { useConfirm } from "./confirm";
import { DUPLICATE_CUSTOMER_QUESTION, findDuplicateCustomer } from "./customer-options";
import type { CustomerItem } from "./types";
import { compareCustomerTitles, customerLine } from "@/lib/kfid/customer-name";
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
  const [confirm, confirmElement] = useConfirm();
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
  // Local filters its own list while rendering; a new search or opening again clears an earlier error, as the search
  // in the effect did (React's "adjust state when a value changes").
  const localItems = useMemo(() => {
    if (!localCustomers) return null;
    const needle = query.trim().toLocaleLowerCase("sv-SE");
    return localCustomers
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
      .sort(compareCustomerTitles)
      .slice(0, 20);
  }, [localCustomers, query]);
  const [searched, setSearched] = useState({ open, query, localCustomers });
  if (localCustomers && (searched.open !== open || searched.query !== query || searched.localCustomers !== localCustomers)) {
    setSearched({ open, query, localCustomers });
    if (open) setError("");
  }
  useEffect(() => {
    if (!open || localCustomers) return;
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
    <>
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Välj eller skapa kund"
      size="compact"
    >
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Sök kund att koppla"
            className="pl-10"
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
          className="field-group mt-5 space-y-4 rounded-lg border p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const duplicate = onCreateLocal ? null : await findDuplicateCustomer(draft.name, draft.company);
              if (duplicate) {
                const answer = await confirm({ title: "Kunden finns redan", message: DUPLICATE_CUSTOMER_QUESTION, confirmLabel: "Skapa ändå", alternative: { label: "Öppna den som finns" } });
                if (answer === "alternative") { onSelect(duplicate); onOpenChange(false); setCreate(false); return; }
                if (!answer) return;
              }
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
        {(localItems ?? items).map((c) => (
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
                {customerLine(c)}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {c.email} {c.address}
              </span>
            </span>
            <span className="text-xs text-primary">Välj</span>
          </button>
        ))}
        {!(localItems ?? items).length && (
          <p className="py-5 text-sm text-muted-foreground">
            Inga kunder matchar sökningen.
          </p>
        )}
      </div>
    </Modal>
    {confirmElement}
    </>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/features/kfid/api";
import { cn } from "@/lib/utils";
import { ADDRESS_ATTRIBUTION_TEXT } from "@/lib/map/attribution";
import { ADDRESS_SEARCH_DEBOUNCE_MS, addressSearchText, type AddressChoice, type AddressSuggestion } from "@/lib/geo/address-search";

/**
 * Whether the installation offers addresses from Lantmäteriet (2026-10-08): asked once per page, like the map
 * status. Without a sign-in that passed its check, in Local and in the demo the answer is no and every address field is
 * a plain text field exactly as before.
 */
let lookupRequest: Promise<boolean> | null = null;
export function useAddressLookupStatus() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const demo = (window as typeof window & { __workflowDemo?: boolean }).__workflowDemo;
    if (demo) return;
    lookupRequest ??= fetch("/api/places/address-lookup").then((response) => response.ok ? response.json().then((data: { available?: boolean }) => Boolean(data.available)) : false).catch(() => false);
    let active = true;
    void lookupRequest.then((value) => { if (active) setAvailable(value); });
    return () => { active = false; };
  }, []);
  return available;
}

/**
 * Gatuadress med sökning (2026-10-15): the street field searches Lantmäteriet's addresses while the person types,
 * the way Benämning searches the catalogue (`ArticleSearchField`): from three characters and a short pause, the
 * suggestions fold out right under the field – as wide as the field, never past the screen, over it when there is no room
 * under it. Choosing one fills street and number, postnummer and postort, and gives the address point for a pin. Typing
 * freely always works: nothing is filled until a suggestion is chosen, and without access the field is a plain text field.
 * The typed text goes to our own server in a POST body (never in a URL) and from there to Lantmäteriet; it is never logged.
 */
export function AddressSearchField({ id, label, value, onChange, onPick, available, disabled = false, maxLength = 200, className, testId = "address-search" }: {
  id: string; label: string;
  value: string; onChange: (value: string) => void;
  /** The chosen address. The point is null when Lantmäteriet gave none (the pin is then left as it is). */
  onPick: (choice: AddressChoice) => void;
  /** From useAddressLookupStatus: false gives a plain text field. */
  available: boolean;
  disabled?: boolean; maxLength?: number; className?: string; testId?: string;
}) {
  const listId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  // Searches start only from what the person typed, never from a saved value being drawn, and stop after a choice.
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [answered, setAnswered] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState({ above: false, max: 288 });
  const measure = () => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 104;
    const above = rect.top - 72;
    const flip = below < 200 && above > below;
    setPlacement({ above: flip, max: Math.max(120, Math.min(288, flip ? above : below)) });
  };
  const query = available && typed && !disabled ? addressSearchText(value) : null;

  useEffect(() => {
    if (!query) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      api<{ suggestions?: AddressSuggestion[] }>("/api/places/address-lookup", { method: "POST", body: JSON.stringify({ action: "search", text: query }), cache: "no-store" })
        .then((data) => { if (current) { setSuggestions(data.suggestions ?? []); setAnswered(query); setError(""); setActive(-1); } })
        .catch((cause: Error) => { if (current) { setSuggestions([]); setAnswered(query); setError(cause.message || "Adresserna kunde inte hämtas."); } })
        .finally(() => { if (current) setSearching(false); });
    }, ADDRESS_SEARCH_DEBOUNCE_MS);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query]);

  const shown = query ? suggestions : [];
  const listOpen = open && Boolean(query) && (searching || picking || Boolean(error) || shown.length > 0 || answered === query);

  const close = () => { setOpen(false); setTyped(false); setSuggestions([]); setAnswered(null); setActive(-1); };
  const pick = async (suggestion: AddressSuggestion) => {
    setPicking(true); setError("");
    try {
      const data = await api<{ found?: boolean; choice?: AddressChoice; reason?: string }>("/api/places/address-lookup", { method: "POST", body: JSON.stringify({ action: "pick", id: suggestion.id }), cache: "no-store" });
      if (data.found && data.choice) { onPick(data.choice); close(); return; }
      setError(data.reason || "Lantmäteriet hittar inte adressen.");
    } catch (cause) {
      // The suggestion's own parts still fill the fields when the address itself could not be fetched; only the pin waits.
      if (suggestion.address) { onPick({ address: suggestion.address, postalCode: suggestion.postalCode, city: suggestion.city, point: null, source: "" }); close(); return; }
      setError((cause as Error).message || "Adressen kunde inte hämtas.");
    } finally { setPicking(false); }
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && listOpen) { event.preventDefault(); setOpen(false); return; }
    if (!listOpen || !shown.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (index + 1) % shown.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index <= 0 ? shown.length - 1 : index - 1)); }
    else if (event.key === "Enter" && active >= 0) { event.preventDefault(); void pick(shown[active]); }
  };

  return <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
    <Label htmlFor={id} className="field-label text-xs font-medium">{label}</Label>
    <div ref={box} className="relative min-w-0" data-testid={testId}>
      {available ? <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /> : null}
      <Input id={id} value={value} maxLength={maxLength} disabled={disabled} autoComplete="off" spellCheck={false}
        placeholder={available ? "Sök adress eller skriv den själv" : undefined}
        role={available ? "combobox" : undefined} aria-expanded={available ? listOpen : undefined} aria-controls={available ? listId : undefined} aria-autocomplete={available ? "list" : undefined}
        aria-activedescendant={listOpen && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(event) => { onChange(event.target.value); if (available) { setTyped(true); setOpen(true); measure(); } }}
        onFocus={() => { if (typed) { setOpen(true); measure(); } }} onBlur={() => setOpen(false)} onKeyDown={onKeyDown}
        className={cn(available && "pl-8")} />
      {listOpen ? <div className={cn("absolute left-0 z-40 w-full max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg", placement.above ? "bottom-full mb-1" : "top-full mt-1")} data-testid={`${testId}-results`}>
        {(searching || picking || answered !== query) && !error && !shown.length ? <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground" role="status"><LoaderCircle className="size-3.5 animate-spin" />Söker adresser…</p> : null}
        {picking && shown.length ? <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground" role="status"><LoaderCircle className="size-3.5 animate-spin" />Hämtar adressen…</p> : null}
        {error ? <p role="alert" className="px-2 py-2 text-xs text-destructive">{error} Skriv adressen själv.</p> : null}
        {!searching && !error && !shown.length && answered === query ? <p className="px-2 py-2 text-xs text-muted-foreground" data-testid={`${testId}-none`}>Inga adresser hittades. Skriv adressen själv, eller fler tecken.</p> : null}
        {shown.length ? <ul id={listId} role="listbox" aria-label="Adresser" className="overflow-y-auto overscroll-contain" style={{ maxHeight: placement.max }}>
          {shown.map((suggestion, index) => <li key={suggestion.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}
            className={cn("flex min-h-11 cursor-pointer items-center rounded-lg px-2 py-1.5 text-left text-sm", index === active ? "bg-secondary" : "hover:bg-secondary")}
            onPointerDown={(event) => event.preventDefault()} onClick={() => void pick(suggestion)} onMouseMove={() => setActive(index)} data-testid={`${testId}-hit`}>
            <span className="min-w-0 truncate">{suggestion.label}</span>
          </li>)}
        </ul> : null}
        <p className="px-2 pb-1 pt-1.5 text-[11px] leading-4 text-muted-foreground" data-testid={`${testId}-attribution`}>{ADDRESS_ATTRIBUTION_TEXT}</p>
      </div> : null}
    </div>
  </div>;
}


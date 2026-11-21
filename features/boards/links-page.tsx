"use client";

import { useState } from "react";
import { Ban, KeyRound, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { EditorMoreMenu } from "@/components/editor-ribbon";
import { PageHeader } from "@/components/page-shell";
import { DelayedSkeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, DialogActions, Empty, Field, Modal, NoPermission, RowsSkeleton } from "@/features/kfid/ui";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { appAddress, type BoardsAccess } from "@/lib/boards/access";
import { LINK_BASE_PATH } from "@/lib/boards/guard";
import { LINK_STATE_LABEL } from "@/lib/boards/screens";
import { LINKS_SENTENCE } from "@/lib/boards/tabs";
import { formatSwedish } from "@/lib/swedish-time";
import { announce, notice } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { boardsPost, targetOfValue, type LinkItem, type LinkList, type MadeLink } from "./boards-api";
import { TargetSelect, useTargetOptions } from "./target-select";
import { WaysOutHelp } from "./ways-out-help";

/**
 * Delade länkar (Tavlor och skärmar etapp 2, 2026-11-18; named so 2026-11-19 to set them apart from Fasta skärmar; plan 6.2–6.4, frågorna 8–9): the shared links of the company's boards – who they are
 * for, what they show, until when, with a code or not, and when they were last used. Ny länk shows its address and QR code once; the
 * address can be renewed (the old one stops at once), and a link can get a new code, lose its code, be blocked or removed.
 */
const TONE: Record<LinkItem["state"], IndicatorTone> = { active: "success", expired: "neutral", revoked: "danger", locked: "warning" };
const day = (iso: string) => formatSwedish(iso, { day: "numeric", month: "short", year: "numeric" });
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => String(byte % 10)).join("");

export function LinksPage({ access }: { access: BoardsAccess }) {
  const read = useWorkspaceData<LinkList>("/api/boards?part=links", (signal) => api<LinkList>("/api/boards?part=links", { signal, cache: "no-store" }));
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState<{ link: MadeLink; name: string } | null>(null);
  const [coding, setCoding] = useState<LinkItem | null>(null);
  const [confirm, confirmElement] = useConfirm();
  if (!access.publish) return <NoPermission page />;
  const linkStart = appAddress(access, `${LINK_BASE_PATH}#k=`);
  if (access.demo) return <div className="space-y-5" data-testid="board-links">
    <PageHeader title="Tavlor" description={LINKS_SENTENCE} />
    <WaysOutHelp />
    <p className="notice" role="status" data-testid="boards-demo-links">Delade länkar kan inte skapas i demon. I Workflow får varje länk en egen hemlig adress som börjar med {linkStart}</p>
  </div>;
  const act = async (body: Record<string, unknown>, done: string) => {
    try { await boardsPost(body); notice(done); void read.reload(); }
    catch (error) { announce(error instanceof Error ? error.message : "Det gick inte.", true); }
  };
  const items = read.data?.items;
  return <div className="space-y-5" data-testid="board-links">
    {confirmElement}
    <PageHeader title="Tavlor" description={LINKS_SENTENCE}
      actions={<Button type="button" onClick={() => setCreating(true)} data-testid="link-new"><Plus aria-hidden="true" />Ny delad länk</Button>} />
    <WaysOutHelp />
    {read.error ? <p role="alert" className="notice text-destructive">{read.error}</p> : null}
    {!items ? <DelayedSkeleton><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={4} label="Hämtar länkar…" /></div></DelayedSkeleton>
      : !items.length ? <div className="rounded-xl border bg-card"><Empty title="Inga delade länkar än" description={`${LINKS_SENTENCE} Länken visar en publicerad tavla, med slutdatum och kod om du vill. Adressen börjar med ${linkStart}`}>
        <Button type="button" onClick={() => setCreating(true)}><Plus aria-hidden="true" />Ny delad länk</Button>
      </Empty></div>
      : <div className="divide-y overflow-hidden rounded-xl border bg-card" role="list" aria-label="Delade länkar">{items.map((item) => <div key={item.id} role="listitem" className="flex flex-wrap items-center gap-3 px-3.5 py-3 text-sm" data-testid="link-row">
        <AreaIcon area="project" icon={Link2} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="truncate font-semibold">{item.name}</span>
            <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", indicatorBadge(TONE[item.state]))}>{LINK_STATE_LABEL[item.state]}</span></span>
          <span className="block truncate text-xs text-muted-foreground">{[`Visar ${item.shows}`, item.expiresAt ? `gäller till ${day(item.expiresAt)}` : "gäller tills vidare", item.code ? "med kod" : "utan kod", item.names ? "namn kan synas" : "inga namn", item.lastUsedAt ? `använd ${day(item.lastUsedAt)}` : "inte använd än"].join(" · ")}</span>
        </span>
        <EditorMoreMenu label={`Åtgärder för ${item.name}`} testId="link-menu" items={[
          { label: "Ny adress", icon: RefreshCw, onSelect: async () => {
            if (!(await confirm({ title: "Ge länken en ny adress?", message: "Den gamla adressen slutar fungera direkt, också för den som har den öppen.", confirmLabel: "Ny adress" }))) return;
            try { const link = await boardsPost<MadeLink>({ action: "renew_link", id: item.id }); setMade({ link, name: item.name }); void read.reload(); } catch (error) { announce(error instanceof Error ? error.message : "Det gick inte.", true); }
          } },
          { label: item.code ? "Byt kod" : "Lägg till kod", icon: KeyRound, onSelect: () => setCoding(item) },
          ...(item.code ? [{ label: "Ta bort koden", icon: KeyRound, onSelect: () => void act({ action: "link_code", id: item.id, code: null }, "Koden är borttagen. Länken visar inga namn.") }] : []),
          ...(item.state !== "revoked" ? [{ label: "Spärra", icon: Ban, danger: true, onSelect: async () => { if (await confirm({ title: `Spärra ${item.name}?`, message: "Länken slutar fungera direkt.", confirmLabel: "Spärra", tone: "danger" })) void act({ action: "revoke_link", id: item.id }, "Länken är spärrad."); } }] : []),
          { label: "Ta bort", icon: Trash2, danger: true, onSelect: async () => { if (await confirm({ title: `Ta bort ${item.name}?`, message: "Länken slutar fungera och försvinner ur listan.", confirmLabel: "Ta bort", tone: "danger" })) void act({ action: "delete_link", id: item.id }, "Länken är borttagen."); } },
        ]} />
      </div>)}</div>}
    {creating ? <NewLinkDialog defaultUntil={read.data?.defaultUntil ?? ""} onClose={() => setCreating(false)} onMade={(link, name) => { setCreating(false); setMade({ link, name }); void read.reload(); }} /> : null}
    {made ? <MadeLinkDialog made={made.link} name={made.name} address={made.link.address.startsWith("/") ? appAddress(access, made.link.address) : made.link.address} onClose={() => setMade(null)} /> : null}
    {coding ? <CodeDialog link={coding} onClose={() => setCoding(null)} onDone={() => { setCoding(null); void read.reload(); }} /> : null}
  </div>;
}

function NewLinkDialog({ defaultUntil, onClose, onMade }: { defaultUntil: string; onClose: () => void; onMade: (link: MadeLink, name: string) => void }) {
  const options = useTargetOptions();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [until, setUntil] = useState(defaultUntil);
  const [forever, setForever] = useState(false);
  const [useCode, setUseCode] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) { announce("Ge länken ett namn, till exempel vem den är till.", true); return; }
    if (!target) { announce("Välj vad länken ska visa.", true); return; }
    setBusy(true);
    try {
      const link = await boardsPost<MadeLink>({ action: "create_link", link: { name: name.trim(), target: targetOfValue(target), until: forever ? null : until, code: useCode ? code : null } });
      onMade(link, name.trim());
    } catch (error) { announce(error instanceof Error ? error.message : "Länken kunde inte skapas.", true); }
    finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Ny delad länk" size="form">
    <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void create(); }} data-testid="link-new-dialog">
      <p className="text-sm text-muted-foreground" data-testid="link-new-sentence">{LINKS_SENTENCE}</p>
      <Field id="link-name" label="Namn" value={name} onChange={(value) => setName(value.slice(0, 60))} required placeholder="Till exempel Kunden Nollpunkten" help="Bara för er egen lista." />
      <TargetSelect id="link-target" value={target} onChange={setTarget} options={options} testId="link-target" />
      <Field id="link-until" label="Gäller till och med" type="date" value={until} onChange={setUntil} help="90 dagar som förval." />
      <CheckField id="link-forever" label="Tills vidare" description="Går bara att välja för tavlor som inte visar namn. Du kan alltid spärra länken." checked={forever} onChange={setForever} />
      <CheckField id="link-use-code" label="Kräv kod" description="Den som öppnar länken skriver en kod på 6–10 siffror. Namn kan bara visas när länken har både kod och slutdatum." checked={useCode} onChange={(value) => { setUseCode(value); if (value && !code) setCode(randomCode()); }} />
      {useCode ? <Field id="link-code" label="Kod" value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 10))} help="Skicka koden på ett annat sätt än länken." /> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Skapa länk", type: "submit", busy, busyLabel: "Skapar…", testId: "link-create" }} />
    </form>
  </Modal>;
}

function MadeLinkDialog({ made, name, address, onClose }: { made: MadeLink; name: string; /** The whole address with the app's origin. */ address: string; onClose: () => void }) {
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={`Länken ${name}`} size="form">
    <div className="space-y-4" data-testid="link-made">
      <p className="text-sm text-muted-foreground">Adressen visas bara nu. Kopiera den eller låt någon skanna QR-koden. Behöver du den igen ger du länken en ny adress.</p>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2"><code className="min-w-0 flex-1 break-all text-xs" data-testid="link-address">{address}</code><CopyButton value={address} label="Kopiera" /></div>
      {/* eslint-disable-next-line @next/next/no-img-element -- an SVG made on our own server, as a data address */}
      <img src={`data:image/svg+xml;utf8,${encodeURIComponent(made.qr)}`} alt="QR-kod till länken" className="mx-auto size-48 rounded-lg bg-white p-2" />
      <DialogActions primary={{ label: "Klar", onClick: onClose }} />
    </div>
  </Modal>;
}

function CodeDialog({ link, onClose, onDone }: { link: LinkItem; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(randomCode);
  const [busy, setBusy] = useState(false);
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={link.code ? "Byt kod" : "Lägg till kod"} size="compact">
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      try { await boardsPost({ action: "link_code", id: link.id, code }); notice("Koden är sparad. Skicka den på ett annat sätt än länken."); onDone(); }
      catch (error) { announce(error instanceof Error ? error.message : "Koden kunde inte sparas.", true); }
      finally { setBusy(false); }
    }}>
      <Field id="new-link-code" label="Kod" value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 10))} help="6–10 siffror. Fem fel spärrar länken en kvart." />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", disabled: code.length < 6 }} />
    </form>
  </Modal>;
}

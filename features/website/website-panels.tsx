"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, CornerLeftUp, ExternalLink, Globe, ImagePlus, Maximize2, Plus, RotateCcw, Trash2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { SecretField } from "@/features/kfid/secret-field";
import { KEY_STATUS, KeyCard, KeyFields, KeyTextField, type KeyCardStatus } from "@/features/integrations/key-card";
import { useServerKeySectionStatus } from "@/features/integrations/server-key-status";
import { AdvancedFold } from "@/features/workflow/section-tabs";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import type { WebsiteAutoClient } from "@/lib/extensions/types";
import { blockFromMarkup, blockImage, buttonLink, headingLevel, htmlCode, htmlCodeProblem, isHtml, isLocked, safeHref, serializeBlock, spacerHeight, typeOf, type BlockNode } from "@/lib/website/blocks";
import { CodeEditor } from "./code-editor";
import { imageAddress } from "./website-canvas";

const field = "field-stack";
const fieldLabel = "text-xs font-medium";

/** What the selected block's panel can do; the editor makes each change one step in the undo history. */
export type BlockPanelApi = {
  canMoveUp: boolean; canMoveDown: boolean; hasParent: boolean; inAuto: boolean;
  move: (delta: -1 | 1) => void;
  remove: () => void;
  selectParent: () => void;
  change: (next: (block: BlockNode) => BlockNode) => void;
  setHeadingLevel: (level: number) => void;
  setLink: (href: string) => void;
  setImage: (image: { url?: string; id?: number | null; alt?: string }) => void;
  setSpacer: (px: number) => void;
  setCode: (code: string) => void;
  /** A locked block's new markup (Avancerat). */
  replace: (block: BlockNode) => void;
  setAuto: (kind: string | null) => void;
  addInside: () => void;
  /** The extension's automatic blocks (ee/) and what they are written from; null: none on this site. */
  auto: { client: WebsiteAutoClient; sources: unknown } | null;
  /** The page in WordPress's own editor. */
  wordpressUrl: string | null;
  /** The html block's code beside its preview, the whole height (Öppna stort). */
  large: boolean;
  openLarge: () => void;
};

/** Uploads a picture to the site's media library; its id and address. */
async function uploadPicture(file: File) {
  const form = new FormData();
  form.append("file", file);
  return api<{ id: number; url: string }>("/api/website/media", { method: "POST", body: form });
}

function PictureField({ block, panel, label }: { block: BlockNode; panel: BlockPanelApi; label: string }) {
  const image = blockImage(block);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [alt, setAlt] = useState(image?.alt ?? "");
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError("");
    try { const media = await uploadPicture(file); panel.setImage({ url: media.url, id: media.id }); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const src = image?.url ? imageAddress(image.url) : "";
  return <div className="space-y-3">
    {/* eslint-disable-next-line @next/next/no-img-element -- the site's picture through the app's own server. */}
    {src ? <img src={src} alt="" className="max-h-40 w-full rounded-md border object-contain" /> : <p className="text-xs text-muted-foreground">Ingen bild vald.</p>}
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label={label} onChange={(event) => void pick(event.target.files?.[0])} data-testid="site-image-file" />
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}><ImagePlus />{busy ? "Laddar upp…" : label}</Button>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <p className="text-xs text-muted-foreground">Bilden laddas upp till webbplatsens mediabibliotek direkt.</p>
    {typeOf(block) !== "cover" ? <div className={field}><label htmlFor="site-image-alt" className={fieldLabel}>Bildtext för skärmläsare</label>
      <Input id="site-image-alt" maxLength={300} value={alt} onChange={(event) => setAlt(event.target.value)} onBlur={() => { if (alt !== (image?.alt ?? "")) panel.setImage({ alt }); }} />
    </div> : null}
  </div>;
}

function LinkField({ block, panel }: { block: BlockNode; panel: BlockPanelApi }) {
  const current = buttonLink(block);
  const [href, setHref] = useState(current);
  const bad = href.trim() !== "" && !safeHref(href);
  return <div className={field}>
    <label htmlFor="site-button-link" className={fieldLabel}>Länk</label>
    <Input id="site-button-link" maxLength={500} value={href} aria-invalid={bad || undefined} onChange={(event) => setHref(event.target.value)} onBlur={() => { if (!bad && href.trim() && href.trim() !== current) panel.setLink(href.trim()); }} />
    <p className={bad ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{bad ? "Börja med https://, /, mailto: eller tel:." : "Till exempel /index.php/kontakta-oss/"}</p>
  </div>;
}

/**
 * An html block's code: every change goes to the page at once (the preview follows after a short pause; one undo step per
 * block). Code with WordPress's block comments is kept in the field only, with the reason, until it is fixed.
 */
export function HtmlCodeField({ block, panel, large = false }: { block: BlockNode; panel: BlockPanelApi; large?: boolean }) {
  const external = htmlCode(block);
  const [code, setCode] = useState(external);
  const [seen, setSeen] = useState(external);
  // Undo, redo or another change of the block from outside the field: the field shows it.
  if (external !== seen) { setSeen(external); if (external !== code) setCode(external); }
  const problem = htmlCodeProblem(code);
  const change = (next: string) => { setCode(next); if (!htmlCodeProblem(next)) panel.setCode(next); };
  const id = large ? "site-html-code-large" : "site-html-code";
  return <div className={cn(field, large && "flex min-h-0 flex-1 flex-col")}>
    <label htmlFor={id} className={fieldLabel}>Kod</label>
    <CodeEditor id={id} label="HTML-kod" value={code} onChange={change} invalid={Boolean(problem)} testId={id} className={large ? "min-h-[20rem] flex-1" : "h-[26rem]"} />
    {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
    <p className="text-xs text-muted-foreground">Förhandsvisningen visar ändringen direkt. Tab drar in, Esc och sedan Tab lämnar fältet, Ctrl+S sparar utkastet.</p>
  </div>;
}

/** Avancerat: a locked block's markup by hand – one block of the same name; WordPress may want to repair it afterwards. */
function LockedCodeField({ block, panel }: { block: BlockNode; panel: BlockPanelApi }) {
  const [code, setCode] = useState(() => serializeBlock(block));
  const [error, setError] = useState("");
  const apply = () => {
    const result = blockFromMarkup(code, block.name);
    if ("error" in result) { setError(result.error); return; }
    setError("");
    panel.replace(result.block);
  };
  return <div className="space-y-3 px-4 pb-4">
    <p className="text-xs leading-5 text-muted-foreground">WordPress kan behöva reparera blocket när sidan öppnas där. Kontrollera förhandsvisningen innan du publicerar.</p>
    <CodeEditor id="site-locked-code" label="Blockets kod" value={code} onChange={(next) => { setCode(next); setError(""); }} invalid={Boolean(error)} testId="site-locked-code" className="h-72" />
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <Button type="button" variant="outline" size="sm" disabled={code === serializeBlock(block)} onClick={apply} data-testid="site-locked-apply"><Check />Använd koden</Button>
  </div>;
}

function SpacerField({ block, panel }: { block: BlockNode; panel: BlockPanelApi }) {
  const current = spacerHeight(block);
  const [value, setValue] = useState(String(current));
  return <div className={field}><label htmlFor="site-spacer" className={fieldLabel}>Höjd (px)</label>
    <Input id="site-spacer" type="number" inputMode="numeric" min={1} max={2000} value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => { const px = Number(value); if (px >= 1 && px <= 2000 && px !== current) panel.setSpacer(px); else setValue(String(current)); }} />
  </div>;
}

/** The selected block's settings, in the panel on the left (or a layer on smaller screens). */
export function BlockPanel({ block, panel }: { block: BlockNode; panel: BlockPanelApi }) {
  const type = typeOf(block);
  const locked = isLocked(block);
  const auto = panel.auto?.client.kindOf(block) ?? null;
  const inside: Partial<Record<string, string>> = { list: "Ny punkt", buttons: "Ny knapp", columns: "Ny kolumn" };
  return <div className="space-y-4 text-sm" data-testid="site-block-settings" data-site-panel={type}>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!panel.canMoveUp || panel.inAuto} onClick={() => panel.move(-1)}><ArrowUp />Flytta upp</Button>
      <Button type="button" variant="outline" size="sm" disabled={!panel.canMoveDown || panel.inAuto} onClick={() => panel.move(1)}><ArrowDown />Flytta ned</Button>
      {panel.hasParent ? <Button type="button" variant="ghost" size="sm" onClick={panel.selectParent}><CornerLeftUp />Markera yttre block</Button> : null}
      {!panel.inAuto ? <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={panel.remove}><Trash2 />Ta bort</Button> : null}
    </div>

    {locked ? <div className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">Blocket <span className="font-mono">{block.name}</span> kommer från WordPress eller ett tillägg. Flytta eller ta bort det här. Innehållet ändrar du i WordPress.</p>
      {panel.wordpressUrl ? <Button type="button" variant="outline" size="sm" asChild><a href={panel.wordpressUrl} target="_blank" rel="noopener noreferrer" data-testid="site-open-wordpress"><ExternalLink />Öppna i WordPress</a></Button> : null}
      <AdvancedFold summary="Redigera blockets kod" testId="site-locked-advanced"><LockedCodeField key={block.id} block={block} panel={panel} /></AdvancedFold>
    </div> : null}
    {panel.inAuto ? <p className="text-xs leading-5 text-muted-foreground">Den här texten skrivs av Workflow. Markera den yttre gruppen för att ändra kopplingen.</p> : null}
    {isHtml(block) && !panel.large ? <>
      <Button type="button" variant="outline" size="sm" onClick={panel.openLarge} data-testid="site-html-large"><Maximize2 />Öppna stort</Button>
      <HtmlCodeField key={block.id} block={block} panel={panel} />
    </> : null}
    {isHtml(block) && panel.large ? <p className="text-xs text-muted-foreground">Koden är öppen i stort läge.</p> : null}

    {type === "heading" ? <div className={field}><label htmlFor="site-heading-level" className={fieldLabel}>Nivå</label>
      <select id="site-heading-level" className="form-select" value={headingLevel(block)} onChange={(event) => panel.setHeadingLevel(Number(event.target.value))}>
        {[2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>Rubrik {level}</option>)}
      </select></div> : null}
    {type === "button" ? <LinkField key={`${block.id}:${buttonLink(block)}`} block={block} panel={panel} /> : null}
    {type === "image" ? <PictureField key={`${block.id}:${blockImage(block)?.alt}`} block={block} panel={panel} label="Byt bild" /> : null}
    {type === "cover" ? <PictureField key={block.id} block={block} panel={panel} label="Byt bakgrundsbild" /> : null}
    {type === "media-text" ? <PictureField key={`${block.id}:${blockImage(block)?.alt}`} block={block} panel={panel} label="Byt bild" /> : null}
    {type === "spacer" ? <SpacerField key={`${block.id}:${spacerHeight(block)}`} block={block} panel={panel} /> : null}
    {inside[type] && !panel.inAuto ? <Button type="button" variant="outline" size="sm" onClick={panel.addInside}><Plus />{inside[type]}</Button> : null}

    {type === "group" && !panel.inAuto && panel.auto ? <div className={field}>
      <label htmlFor="site-auto" className={fieldLabel}>Uppdateras automatiskt</label>
      <select id="site-auto" className="form-select" value={auto ?? ""} onChange={(event) => panel.setAuto(event.target.value || null)} data-testid="site-auto-kind">
        <option value="">Nej</option>
        {panel.auto.client.kinds.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
      </select>
      <p className="text-xs text-muted-foreground">{panel.auto.client.note(auto, panel.auto.sources)}</p>
    </div> : null}

    {["paragraph", "heading", "list-item", "button"].includes(type) && !panel.inAuto ? <p className="text-xs text-muted-foreground">Texten ändrar du direkt på sidan. Skift+Enter ger en ny rad.</p> : null}
  </div>;
}

/** The backups of the page: Återställ writes one back to WordPress (the page as it is now is saved first). */
export function BackupList({ backups, busy, onRestore }: { backups: { id: string; reason: string; createdAt: string }[]; busy: boolean; onRestore: (id: string) => void }) {
  const reason: Record<string, string> = { publish: "Före publicering", restore: "Före återställning" };
  if (!backups.length) return <p className="px-4 pb-4 text-xs text-muted-foreground">Inga tidigare versioner ännu. En sparas varje gång Workflow skriver sidan.</p>;
  return <ul className="divide-y border-t" data-testid="site-backups">
    {backups.slice(0, 10).map((backup) => <li key={backup.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
      <span className="min-w-0"><span className="block font-medium text-foreground">{formatSwedish(backup.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
        <span className="text-muted-foreground">{reason[backup.reason] ?? "Före automatisk uppdatering"}</span></span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRestore(backup.id)}><RotateCcw />Återställ</Button>
    </li>)}
  </ul>;
}

export type ConnectionState = {
  siteUrl: string; baseUrl: string; username: string | null; passwordStored: boolean; passwordUnreadable: boolean; configured: boolean; updatedAt: string | null;
  extras: { status: string | null; error: string | null } | null;
};

/** The first steps before a site is connected: one short line each. */
export function ConnectionSteps() {
  return <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground" data-testid="site-connection-steps">
    <li>I WordPress: gå till Användare → Profil → Applikationslösenord och skapa ett med namnet Workflow.</li>
    <li>Här: fyll i webbplatsens adress, ditt användarnamn i WordPress och lösenordet. Tryck Spara.</li>
    <li>Tryck Kontrollera.</li>
  </ol>;
}

/**
 * The connection to the company's WordPress (the shared key card, 2026-11-11): the site's own address (the REST address is found
 * from it; Mer sets it by hand), the user and the application password (dots and a bin, never the value), all saved by the
 * card's one Spara. The steps, the REST address and removing the connection are under Mer.
 */
export function ConnectionCard({ connection, onChanged, notify, after }: { connection: ConnectionState; onChanged: (next: ConnectionState) => void; notify: (text: string, error?: boolean) => void;
  /** Under the fields: the way on to Min webbsida. */
  after?: React.ReactNode }) {
  // A missing address (an older answer, the demo) is an empty field, never a crash (N3 2026-11-12).
  const [siteUrl, setSiteUrl] = useState(connection.siteUrl ?? "");
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl ?? "");
  const [username, setUsername] = useState(connection.username ?? "");
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const post = async (input: Record<string, unknown>) => {
    setBusy(true);
    try {
      const result = await api<{ connection?: ConnectionState; check?: { ok: boolean; message: string } | null }>("/api/website", { method: "POST", body: JSON.stringify(input) });
      if (result.connection) { onChanged(result.connection); setBaseUrl(result.connection.baseUrl ?? ""); setSiteUrl(result.connection.siteUrl ?? ""); }
      if (result.check) { setCheck(result.check); notify(result.check.message, !result.check.ok); }
      setPassword(""); setRemovePassword(false);
      return result;
    } catch (cause) { notify((cause as Error).message, true); return null; } finally { setBusy(false); }
  };
  const input = () => {
    const changes: Record<string, unknown> = { action: "connection" };
    if (siteUrl.trim() !== (connection.siteUrl ?? "")) changes.siteUrl = siteUrl.trim();
    if (baseUrl.trim() !== (connection.baseUrl ?? "")) changes.baseUrl = baseUrl.trim() || null;
    if (username.trim() !== (connection.username ?? "")) changes.username = username.trim() || null;
    if (removePassword) changes.password = null; else if (password) changes.password = password;
    return changes;
  };
  const dirty = Object.keys(input()).length > 1;
  const save = async () => {
    const result = await post(input());
    if (result && !result.check) notify("Kopplingen är sparad.");
    return Boolean(result);
  };
  const disconnect = async () => {
    if (await confirm({ title: "Ta bort kopplingen?", message: "Workflow slutar nå webbplatsen. Sidorna i WordPress ändras inte. Ta också bort applikationslösenordet i WordPress.", confirmLabel: "Ta bort", tone: "danger" }))
      if (await post({ action: "disconnect" })) notify("Kopplingen är borttagen.");
  };
  const status: KeyCardStatus = connection.passwordUnreadable ? { ...KEY_STATUS.failed, problem: "Lösenordet kan inte läsas längre. Klistra in det igen." }
    : !connection.configured ? KEY_STATUS.missing : check ? (check.ok ? KEY_STATUS.works : { ...KEY_STATUS.failed, problem: check.message }) : KEY_STATUS.untested;
  useServerKeySectionStatus("website", { label: status.label, tone: status.tone, detail: status.problem ?? undefined, name: "WordPress-webbplatsen" });
  const extras = connection.extras;
  return <div className="h-full" data-testid="site-connection">{confirmElement}<KeyCard icon={Globe} title="WordPress-webbplatsen" status={status} statusTestId="site-connection-status"
    check={{ onClick: () => void post({ action: "check" }), busy, disabled: busy || !connection.configured, label: "Kontrollera kopplingen", testId: "site-check" }}
    save={{ dirty, onSave: save }} saveTestId="site-connection-save" actions={after}
    more={<>
      <ConnectionSteps />
      <p>Inget installeras på webbplatsen.</p>
      {extras?.status ? <p>{extras.status}</p> : null}
      {extras?.error ? <p className="text-red-700 dark:text-red-300">{extras.error}</p> : null}
      <KeyTextField id="site-base-url" label="REST-adress" value={baseUrl} maxLength={300} onChange={setBaseUrl} placeholder="https://example.se/wp-json/" hint="Hittas själv från adressen. Fyll bara i om den inte hittas." removeLabel="Töm REST-adressen" />
      {connection.updatedAt ? <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void disconnect()} data-testid="site-disconnect"><Unplug />Ta bort kopplingen</Button> : null}
    </>} moreOpenWhen={Boolean(extras?.error) || !connection.configured} moreTestId="site-connection-more">
    <KeyFields>
      <KeyTextField id="site-url" label="Webbplatsens adress" type="url" inputMode="url" value={siteUrl} maxLength={300} autoComplete="url" onChange={setSiteUrl} placeholder="https://example.se" testId="site-url" removeLabel="Töm adressen" />
      <KeyTextField id="site-username" label="Användarnamn i WordPress" value={username} maxLength={200} onChange={setUsername} removeLabel="Töm användarnamnet" />
      <SecretField keepBin id="site-password" label="Applikationslösenord" autoComplete="new-password" value={password} onChange={(value) => { setPassword(value); setRemovePassword(false); }} stored={connection.passwordStored} removed={removePassword} placeholder="Klistra in från WordPress"
        removeLabel="Ta bort applikationslösenordet" busy={busy} onRemove={() => { setPassword(""); setRemovePassword(true); }} onUndo={() => setRemovePassword(false)} noManager />
    </KeyFields>
  </KeyCard></div>;
}

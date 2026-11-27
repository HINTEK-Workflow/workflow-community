"use client";

import { useCallback, useState } from "react";
import { useLoadEffect } from "@/lib/use-load-effect";
import { Bot, OctagonX, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { AUTO_CHANNELS, CAP_MAX, type AutoPublishRule, type Caps } from "@/lib/content-assignments/auto-publish";
import { formatSwedish } from "@/lib/swedish-time";

/**
 * Publicera uppdrag via API utan godkännande (2026-11-25), under Inlägg: the company's own rule, OFF by default. When it is off
 * every innehållsuppdrag from an external system waits for Godkänn in Schemalagt. Turning it on needs a fresh sign-in; Stoppa turns it
 * off at once. Every automatic approval is logged and shown in Schemalagt with the key.
 */
type KeyRow = { id: string; name: string; canAutopublish: boolean; expiresAt: string | null };
type State = { rule: AutoPublishRule; keys: KeyRow[] };
const LABEL: Record<string, string> = { linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram" };

export function AutoPublishSettings() {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<{ enabled: boolean; channels: string[]; keyIds: string[]; caps: Caps } | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await api<State>("/api/meta/posts?autopublish=1", { cache: "no-store" });
      setState(next);
      setDraft({ enabled: next.rule.enabled, channels: next.rule.channels, keyIds: next.rule.keyIds, caps: next.rule.caps });
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); }
  }, []);
  useLoadEffect(load);
  const send = async (body: object, done: string) => {
    setBusy(true);
    try {
      const next = await api<State>("/api/meta/posts", { method: "POST", body: JSON.stringify(body) });
      setState(next);
      setDraft({ enabled: next.rule.enabled, channels: next.rule.channels, keyIds: next.rule.keyIds, caps: next.rule.caps });
      setMessage({ text: done });
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); } finally { setBusy(false); }
  };
  const toggle = (list: string[], value: string, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((item) => item !== value));
  const cap = (channel: string, part: "day" | "week", value: string) => setDraft((current) => current && {
    ...current, caps: { ...current.caps, [channel]: { ...(current.caps[channel as keyof Caps] ?? { day: 0, week: 0 }), [part]: Math.max(0, Math.min(CAP_MAX[part], Number(value) || 0)) } },
  });

  return <Panel icon={Bot} title="Uppdrag via API" description="Utkast som ett externt system har gett i uppdrag läggs i Schemalagt och väntar på att du godkänner dem. Här kan du låta valda nycklar få sina uppdrag godkända automatiskt." collapsible defaultCollapsed foldKey="posts-autopublish">
    {!state || !draft ? <p className="text-sm text-muted-foreground">Hämtar…</p> : <div className="space-y-4" data-testid="autopublish">
      <p className="text-sm">{state.rule.enabled ? "Automatiskt godkännande är på." : state.rule.stoppedAt ? `Stoppat ${formatSwedish(state.rule.stoppedAt, { dateStyle: "medium", timeStyle: "short" })}. Alla uppdrag väntar på godkännande.` : "Av. Alla uppdrag väntar på godkännande."}</p>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><Checkbox checked={draft.enabled} onCheckedChange={(value) => setDraft({ ...draft, enabled: value === true })} data-testid="autopublish-enabled" />Publicera uppdrag via API utan godkännande</label>
      <fieldset className="space-y-2" disabled={!draft.enabled}>
        <legend className="text-sm font-medium">Kanaler och tak</legend>
        {AUTO_CHANNELS.map((channel) => <div key={channel} className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex min-h-11 w-32 cursor-pointer items-center gap-2"><Checkbox checked={draft.channels.includes(channel)} onCheckedChange={(value) => setDraft({ ...draft, channels: toggle(draft.channels, channel, value === true) })} />{LABEL[channel]}</label>
          <label className="flex items-center gap-2">Per dag <Input type="number" min={0} max={CAP_MAX.day} className="w-20" value={draft.caps[channel]?.day ?? 0} onChange={(event) => cap(channel, "day", event.target.value)} /></label>
          <label className="flex items-center gap-2">Per vecka <Input type="number" min={0} max={CAP_MAX.week} className="w-20" value={draft.caps[channel]?.week ?? 0} onChange={(event) => cap(channel, "week", event.target.value)} /></label>
        </div>)}
      </fieldset>
      <fieldset className="space-y-1" disabled={!draft.enabled}>
        <legend className="text-sm font-medium">Nycklar som får godkännas automatiskt</legend>
        {state.keys.length ? state.keys.map((key) => <label key={key.id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={draft.keyIds.includes(key.id)} disabled={!key.canAutopublish} onCheckedChange={(value) => setDraft({ ...draft, keyIds: toggle(draft.keyIds, key.id, value === true) })} />
          {key.name}{key.canAutopublish ? "" : " (saknar behörigheten att godkännas automatiskt)"}
        </label>) : <p className="text-sm text-muted-foreground">Inga nycklar. Skapa en under Kopplingar → API och MCP.</p>}
      </fieldset>
      <p className="text-xs text-muted-foreground">Varje automatiskt godkännande loggas och syns i Schemalagt med nyckelns namn. Publiceringen följer plattformarnas regler och företagets spärr för publicering som vanligt.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void send({ action: "autopublish-save", rule: draft }, "Regeln är sparad.")} data-testid="autopublish-save"><Save />Spara</Button>
        {state.rule.enabled ? <Button type="button" variant="outline" disabled={busy} onClick={() => void send({ action: "autopublish-stop" }, "Automatiskt godkännande är stoppat.")} data-testid="autopublish-stop"><OctagonX />Stoppa</Button> : null}
      </div>
      {message ? <p className={message.error ? "notice text-destructive" : "notice"} role="status">{message.text}</p> : null}
    </div>}
  </Panel>;
}

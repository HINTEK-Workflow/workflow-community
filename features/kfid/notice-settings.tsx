"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, Mail } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { availableNoticeKinds, MACHINE_ALARM_NIGHT_HINT, MACHINE_ALARM_NIGHT_LABEL } from "@/lib/workflow/notice-channels";
import { createNoticeSaveQueue, type NoticeChange } from "@/lib/workflow/notice-save-queue";
import { Panel } from "./ui";
import { api } from "./api";
import { useWorkspaceData } from "./use-workspace-data";

type Kind = { key: string; label: string; description: string };
type Data = {
  demo?: boolean;
  preference: { email: boolean; push: boolean; kinds: string[]; machineAlarmNight?: boolean; requiredNotices?: boolean };
  kinds: Kind[];
  email: { available: boolean; reason: string | null };
  push: { available: boolean; reason: string | null; publicKey: string; devices: number };
};
/** What this browser can do: push needs a service worker, the Push API and notifications (on iPhone and iPad only for an installed app). */
type Device = "checking" | "unsupported" | "blocked" | "off" | "on";

const NOTICE_DESCRIPTION = "Notiserna kan också komma som e-post eller push. Det som kräver åtgärd kommer från början, resten väljer du själv. Sparas direkt.";
const base64UrlToBytes = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};
const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
/** The service worker of Workflow, with a short wait: it is only registered in a production build. */
async function workerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  const registered = await navigator.serviceWorker.register("/sw.js");
  await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 5000))]);
  return registered;
}

/**
 * Notiser (2026-10-07): the reminders in the bell can also come as e-mail and as web push – the person's own
 * choice, nothing on from the start, saved the moment it is made. The bell is always on. E-mail and push follow the
 * kinds picked here; a member gets their own, an admin the team's, because the notices are the bell's own.
 *
 * Stabil sidladdning (2026-10-23): the answer is kept in the tab's memory (useWorkspaceData), and until the first one has
 * come the card already has its real rows – the kinds are known here – disabled and busy, so the card does not grow
 * under the page when the answer comes.
 */
export function NoticeSettings({ notify, cloud, superadmin = false }: { notify: (message: string, error?: boolean) => void; cloud: boolean; superadmin?: boolean }) {
  const read = useWorkspaceData<Data>(cloud ? "/api/notice-settings" : null, (signal) => api<Data>("/api/notice-settings", { cache: "no-store", signal }));
  const data = read.data;
  const [device, setDevice] = useState<Device>("checking");
  const [busy, setBusy] = useState(false);
  // The saves go one at a time, in the order they were made: quick ticks sent side by side could reach the server the
  // other way round, and the last answer written (an older choice) lost the newer one (mail2, QA 2026-10-24). Each one
  // sends the latest choice as a whole, so a queued save never carries kinds from an older render.
  const [saving] = useState(() => createNoticeSaveQueue(async (choice) => { await api("/api/notice-settings", { method: "PUT", body: JSON.stringify(choice) }); }));

  const checkDevice = useCallback(async (publicKey?: string) => {
    if (!pushSupported()) { setDevice("unsupported"); return; }
    if (Notification.permission === "denied") { setDevice("blocked"); return; }
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      // A subscription made with another key (the installation replaced its keys) is no longer one.
      const key = subscription?.options.applicationServerKey;
      const same = !publicKey || !key || (new Uint8Array(key).length === base64UrlToBytes(publicKey).length && new Uint8Array(key).every((byte, index) => byte === base64UrlToBytes(publicKey)[index]));
      setDevice(subscription && same ? "on" : "off");
    } catch { setDevice("off"); }
  }, []);

  const loaded = data !== undefined;
  const demo = Boolean(data?.demo);
  // The demo answers `{ demo: true }` only (features/demo/demo-backend.ts): no push part to read the key from.
  const publicKey = data && !demo ? data.push.publicKey : undefined;
  // What this device can do is asked once the answer (and its push key) is there, one microtask after the effect.
  useEffect(() => { if (loaded && !demo) queueMicrotask(() => void checkDevice(publicKey)); }, [loaded, demo, publicKey, checkDevice]);
  useEffect(() => { if (read.error) notify(read.error, true); }, [read.error, notify]);

  if (!cloud) return <Panel icon={Bell} title="Notiser" description="Påminnelserna i klockan kan också komma som e-post eller push.">
    <p className="flex items-start gap-3 text-sm text-muted-foreground" data-testid="notice-settings"><Bell className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />Med lokal lagring finns bara klockan, eftersom servern inte kan läsa den lokala filen. E-post och push finns med serverlagring.</p>
  </Panel>;
  if (demo) return <Panel icon={Bell} title="Notiser" description="Påminnelserna i klockan kan också komma som e-post eller push.">
    <p className="text-sm text-muted-foreground" data-testid="notice-settings">Notiser per e-post och push går inte att prova i demon. Klockan i toppraden visar påminnelserna.</p>
  </Panel>;

  const preference = data?.preference ?? { email: false, push: false, kinds: [] };
  const kinds: readonly Kind[] = data?.kinds ?? availableNoticeKinds({ superadmin });
  // Each queued save is the whole latest choice (createNoticeSaveQueue), never one built from this render's preference.
  const save = (change: NoticeChange) => {
    if (!data) return;
    const { choice, done } = saving.change({ email: preference.email, kinds: preference.kinds, machineAlarmNight: Boolean(preference.machineAlarmNight), requiredNotices: preference.requiredNotices !== false }, change);
    read.mutate((current) => current ? { ...current, preference: { ...current.preference, ...choice } } : data);
    done.catch(async (error: Error) => {
      notify(error.message, true);
      // What the server holds is shown again once the saves still on their way have been answered.
      await saving.idle();
      await read.reload();
    });
  };
  const toggleKind = (key: string, on: boolean) => save({ kind: "kind", key, on });
  const toggleRequired = (on: boolean) => { save({ kind: "required", on }); notify(on ? "Det som kräver åtgärd kommer med e-post och push." : "Det som kräver åtgärd kommer bara i listan."); };
  // Integrationsmotorn E6: the person's own yes to machine alarms at night (off from the start; the company decides too).
  const toggleNight = (on: boolean) => { save({ kind: "night", on }); notify(on ? "Maskinlarm kan komma även på natten, när företaget valt dygnet runt." : "Maskinlarm kommer inte på natten."); };
  const toggleEmail = (on: boolean) => { save({ kind: "email", on }); notify(on ? "Du får de valda notiserna som e-post." : "Du får inga notiser som e-post."); };

  const togglePush = async (on: boolean) => {
    if (!data) return;
    setBusy(true);
    try {
      const registration = await workerRegistration();
      if (!on) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) { await api("/api/notice-settings/push", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }); await subscription.unsubscribe(); }
        notify("Push är avstängt på den här enheten.");
      } else {
        if ((await Notification.requestPermission()) !== "granted") { setDevice(Notification.permission === "denied" ? "blocked" : "off"); notify("Webbläsaren tillåter inte notiser. Ändra det i webbläsarens inställningar för sidan.", true); return; }
        let subscription = await registration.pushManager.getSubscription();
        const wanted = base64UrlToBytes(data.push.publicKey);
        const key = subscription?.options.applicationServerKey ? new Uint8Array(subscription.options.applicationServerKey) : null;
        if (subscription && !(key && key.length === wanted.length && key.every((byte, index) => byte === wanted[index]))) {
          await api("/api/notice-settings/push", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => undefined);
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
        await api("/api/notice-settings/push", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
        notify("Push är påslaget på den här enheten.");
      }
      const fresh = await api<Data>("/api/notice-settings", { cache: "no-store" });
      read.mutate(() => fresh);
      await checkDevice(fresh.push.publicKey);
    } catch (error) { notify((error as Error).message || "Push kunde inte ändras.", true); } finally { setBusy(false); }
  };

  // Before the answer: the same rows, disabled and without their test ids (nothing to read or click yet).
  const id = (name: string) => loaded ? name : undefined;
  const chosen = new Set(preference.kinds);
  const channelOn = preference.email || device === "on";
  const pushDisabled = !data || busy || !data.push.available || device === "unsupported" || device === "blocked" || device === "checking";
  return <Panel icon={Bell} title="Notiser" description={NOTICE_DESCRIPTION}>
    <div className="space-y-4" data-testid={id("notice-settings")} aria-busy={loaded ? undefined : true}>
      {/* No inner headings with a grey line (UX-punkt 6, 2026-10-22): the groups keep their names for screen readers. */}
      <fieldset className="min-w-0 space-y-3 text-sm" disabled={!loaded}>
        <legend className="sr-only">Hur du får dem</legend>
        <label className="flex items-start gap-3"><Checkbox className="mt-0.5" checked disabled />
          <span><span className="flex items-center gap-1.5 font-medium"><Bell className="size-3.5" aria-hidden="true" />Klockan</span><span className="block text-xs text-muted-foreground">Alltid på.</span></span></label>
        <label className={`flex items-start gap-3 ${loaded ? "cursor-pointer" : ""}`}><Checkbox className="mt-0.5" checked={preference.email} disabled={!loaded} onCheckedChange={(value) => toggleEmail(value === true)} data-testid={id("notice-email")} />
          <span><span className="flex items-center gap-1.5 font-medium"><Mail className="size-3.5" aria-hidden="true" />E-post</span>
            <span className="block text-xs text-muted-foreground">Ett samlat e-postmeddelande med det som är nytt, aldrig mer än en gång per notis.</span>
            {data?.email.reason ? <span className="mt-1 block text-xs text-muted-foreground" data-testid="notice-email-note">{data.email.reason}</span> : null}</span></label>
        <label className={`flex items-start gap-3 ${pushDisabled ? "" : "cursor-pointer"}`}><Checkbox className="mt-0.5" checked={device === "on"} disabled={pushDisabled} onCheckedChange={(value) => void togglePush(value === true)} data-testid={id("notice-push")} />
          <span><span className="flex items-center gap-1.5 font-medium"><BellRing className="size-3.5" aria-hidden="true" />Push på den här enheten</span>
            <span className="block text-xs text-muted-foreground">En kort notis på enheten, även när Workflow inte är öppet.{data?.push.devices ? ` Push är påslaget på ${data.push.devices === 1 ? "1 enhet" : `${data.push.devices} enheter`}.` : ""}</span>
            {data && !data.push.available ? <span className="mt-1 block text-xs text-muted-foreground" data-testid="notice-push-note">{data.push.reason}</span>
              : device === "unsupported" ? <span className="mt-1 block text-xs text-muted-foreground" data-testid="notice-push-note">Den här webbläsaren stöder inte push. På iPhone och iPad fungerar det när Workflow är installerat som app på hemskärmen.</span>
                : device === "blocked" ? <span className="mt-1 block text-xs text-muted-foreground" data-testid="notice-push-note">Webbläsaren blockerar notiser från den här sidan. Tillåt dem i webbläsarens inställningar för sidan.</span> : null}</span></label>
      </fieldset>
      <fieldset className="min-w-0 space-y-3 pt-2 text-sm" disabled={!loaded}>
        <legend className="sr-only">Vilka notiser</legend>
        <label className={`flex items-start gap-3 ${loaded ? "cursor-pointer" : ""}`}><Checkbox className="mt-0.5" checked={preference.requiredNotices !== false} disabled={!loaded} onCheckedChange={(value) => toggleRequired(value === true)} data-testid={id("notice-required")} />
          <span><span className="font-medium">Kräver åtgärd</span><span className="block text-xs text-muted-foreground">Hinder, anmälningspliktigt, avvikelse med hög grad, felanmälan och frånvarokrock. På från början.</span></span></label>
        <p className="text-xs text-muted-foreground">Välj vilka notiser du vill få med e-post och push. Som medlem får du notiser om dina egna uppgifter, och som administratör om hela teamets.</p>
        {kinds.map((kind) => <div key={kind.key} className="space-y-2">
          <label className={`flex items-start gap-3 ${loaded ? "cursor-pointer" : ""}`}><Checkbox className="mt-0.5" checked={chosen.has(kind.key)} disabled={!loaded} onCheckedChange={(value) => toggleKind(kind.key, value === true)} data-testid={id(`notice-kind-${kind.key}`)} />
            <span><span className="font-medium">{kind.label}</span><span className="block text-xs text-muted-foreground">{kind.description}</span></span></label>
          {kind.key === "MACHINE_ALARM" && chosen.has(kind.key) && loaded ? <label className="ml-7 flex cursor-pointer items-start gap-3">
            <Checkbox className="mt-0.5" checked={Boolean(preference.machineAlarmNight)} onCheckedChange={(value) => toggleNight(value === true)} data-testid="notice-machine-night" />
            <span><span className="font-medium">{MACHINE_ALARM_NIGHT_LABEL}</span><span className="block text-xs text-muted-foreground">{MACHINE_ALARM_NIGHT_HINT}</span></span></label> : null}
        </div>)}
        {channelOn && !preference.kinds.length ? <p className="text-xs text-amber-700 dark:text-amber-300" role="status" data-testid="notice-kinds-hint">Välj minst en sort här, annars skickas inget.</p> : null}
      </fieldset>
    </div>
  </Panel>;
}

"use client";

import { useSyncExternalStore } from "react";
import { Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/features/kfid/ui";
import { INSTALL_PROMPT_EVENT } from "@/features/kfid/app-registration";

const subscribe = (notify: () => void) => {
  window.addEventListener(INSTALL_PROMPT_EVENT, notify);
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", notify);
  return () => { window.removeEventListener(INSTALL_PROMPT_EVENT, notify); media.removeEventListener("change", notify); };
};
/** "app" when Workflow already runs installed, "offer" when the browser can install it now, otherwise "manual". */
const state = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true ? "app" : window.hintekInstallPrompt ? "offer" : "manual";

/**
 * Installera som app (2026-10-02: "mobilen / paddan ska även kunna ha PWA"): Workflow on the home screen of a
 * phone or tablet, in its own window without the browser's address bar. Android, Chrome and Edge install with one
 * button; iPhone and iPad through the share menu, which a web page cannot open by itself.
 */
export function InstallApp() {
  const mode = useSyncExternalStore(subscribe, state, () => "manual");
  return <Panel title="Installera som app" description="Workflow på hemskärmen på mobil, surfplatta eller dator.">
    <div className="flex items-start gap-3 text-sm" data-testid="install-app" data-install-mode={mode}>
      <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      {mode === "app" ? <p>Workflow körs som installerad app på den här enheten.</p>
        : mode === "offer" ? <div className="space-y-3">
          <p>Installera Workflow, så öppnas det i ett eget fönster från hemskärmen eller startmenyn.</p>
          <Button type="button" onClick={() => { const prompt = window.hintekInstallPrompt; if (prompt) void prompt.prompt().then(() => prompt.userChoice).then(() => { window.hintekInstallPrompt = null; window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT)); }).catch(() => undefined); }}><Download />Installera</Button>
        </div>
          : <div className="space-y-2">
            <p>Lägg Workflow på hemskärmen, så öppnas det i ett eget fönster:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li><span className="font-medium text-foreground">iPhone och iPad (Safari):</span> tryck på Dela och välj Lägg till på hemskärmen.</li>
              <li><span className="font-medium text-foreground">Android (Chrome):</span> öppna menyn ⋮ och välj Installera app eller Lägg till på startskärmen.</li>
              <li><span className="font-medium text-foreground">Dator (Chrome eller Edge):</span> välj installationsikonen i adressfältet.</li>
            </ul>
          </div>}
    </div>
  </Panel>;
}

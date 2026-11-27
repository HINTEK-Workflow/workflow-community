"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { api } from "@/features/kfid/api";
import { LinkedInCard } from "@/features/linkedin/linkedin-card";
import { MetaCard } from "@/features/meta/meta-card";
import { YouTubeCard } from "@/features/youtube/youtube-card";
import type { YouTubeView } from "@/lib/youtube/server";
import { ConnectionCard, type ConnectionState } from "@/features/website/website-panels";
import { webAreaStatus, type AreaStatus } from "@/lib/integrations/connection-areas";
import type { LinkedInView } from "@/lib/linkedin/server";
import type { MetaView } from "@/lib/meta/server";
import { KeyCardGrid, KeyCardLink, KeyCardsGuard } from "./key-card";
import { KeyOverview } from "./key-overview";
import { sameSectionStatus, ServerKeyStatusReport, type ServerKeySectionId, type ServerKeySectionStatus } from "./server-key-status";

export const WEBSITE_HREF = "/?view=company_website";

/**
 * Webb och sociala medier under Kopplingar (2026-11-10; the shared key cards 2026-11-11): the keys of Min webbsida and of
 * Inlägg live here, each on its own key card – the WordPress site (address, user, application password), Facebook och
 * Instagram (the company's own Meta app) and LinkedIn (its own LinkedIn app, 2026-11-11) – two equal columns where the room is there. The overview on top holds each
 * service's status and the switch Publicering, which saves at once. Min webbsida and Inlägg show no key fields of their own;
 * they link here when nothing is connected. The list's status line follows the cards.
 */
export function WebArea({ notify, onStatus }: { notify: (text: string, error?: boolean) => void; onStatus: (status: AreaStatus) => void }) {
  const [website, setWebsite] = useState<ConnectionState | null>(null);
  const [websiteError, setWebsiteError] = useState("");
  const [meta, setMeta] = useState<MetaView | null>(null);
  const [linkedin, setLinkedin] = useState<LinkedInView | null>(null);
  const [youtube, setYoutube] = useState<YouTubeView | null>(null);
  const [reported, setReported] = useState<Partial<Record<ServerKeySectionId, ServerKeySectionStatus>>>({});
  const report = useCallback((id: ServerKeySectionId, status: ServerKeySectionStatus) => setReported((current) => sameSectionStatus(current[id], status) ? current : { ...current, [id]: status }), []);
  useEffect(() => {
    let active = true;
    void api<{ connection: ConnectionState }>("/api/website?part=connection", { cache: "no-store" })
      .then((result) => { if (active) setWebsite(result.connection); }).catch((cause) => { if (active) setWebsiteError((cause as Error).message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!website && !meta && !linkedin && !youtube) return;
    onStatus(webAreaStatus(website, meta ? { status: meta.status, page: meta.page?.name ?? null, instagram: meta.instagram?.username ?? null } : null,
      linkedin ? { status: linkedin.status, author: linkedin.author?.name ?? null } : null, youtube ? { status: youtube.status, channel: youtube.channel?.name ?? null } : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the list follows the cards' own state
  }, [website, meta, linkedin, youtube]);
  const websiteStatus = websiteError ? { label: "Kunde inte läsas", tone: "danger" as const, detail: websiteError } : reported.website;

  return <ServerKeyStatusReport.Provider value={report}>
    <KeyCardsGuard>
      <div className="space-y-6">
        <KeyOverview testId="web-overview" categories={[{ id: "web", title: "Webb och sociala medier", icon: Globe, services: [
          { id: "website", name: reported.website?.name ?? "WordPress-webbplatsen", status: websiteStatus },
          { id: "meta", name: reported.meta?.name ?? "Facebook och Instagram", status: reported.meta, toggle: reported.meta?.toggle },
          { id: "linkedin", name: reported.linkedin?.name ?? "LinkedIn", status: reported.linkedin, toggle: reported.linkedin?.toggle },
          { id: "youtube", name: reported.youtube?.name ?? "YouTube", status: reported.youtube, toggle: reported.youtube?.toggle },
        ] }]} />
        <KeyCardGrid label="Webb och sociala medier" testId="web-area-grid">
          <li className="min-w-0" data-testid="web-area-website">
            {websiteError ? <p className="notice text-destructive" role="alert">{websiteError}</p>
              : !website ? <p className="text-xs text-muted-foreground">Hämtar…</p>
                : <ConnectionCard key={`${website.siteUrl}:${website.baseUrl}:${website.username ?? ""}`} connection={website} onChanged={setWebsite} notify={notify}
                  after={website.configured ? <KeyCardLink href={WEBSITE_HREF} icon={Globe} testId="web-open-website">Öppna Min webbsida</KeyCardLink> : null} />}
          </li>
          <li className="min-w-0" data-testid="web-area-meta"><MetaCard notify={notify} onChanged={setMeta} /></li>
          <li className="min-w-0" data-testid="web-area-linkedin"><LinkedInCard notify={notify} onChanged={setLinkedin} /></li>
          <li className="min-w-0" data-testid="web-area-youtube"><YouTubeCard notify={notify} onChanged={setYoutube} /></li>
        </KeyCardGrid>
      </div>
    </KeyCardsGuard>
  </ServerKeyStatusReport.Provider>;
}

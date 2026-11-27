import { graph, MetaError, type GraphTransport } from "./graph";

/**
 * Instagram (2026-11-10) behind one interface, so the second way – "Instagram API with Instagram Login" on graph.instagram.com,
 * without a Facebook page – can be added later as another implementation without touching the publishing flow.
 *
 * Today's implementation is the Facebook Login one: the Instagram professional account linked to the company's Facebook page,
 * reached on graph.facebook.com with the page token. Publishing is two steps: a container (the picture's public address and
 * the caption; Instagram fetches the picture itself), then – when the container's status_code is FINISHED – media_publish.
 * A test makes the container and waits for FINISHED, but never publishes it (an unpublished container expires by itself).
 *
 * Karusell (2026-11-16, Meta's Content Publishing guide): one child container per picture (is_carousel_item=true, no caption), then
 * a CAROUSEL container with the children's ids and the caption, then media_publish of that one.
 * AI (2026-11-16): is_ai_generated=true is Instagram's own self-disclosure ("AI info"), set on the post's container – the single
 * picture, the story or the carousel – and never on a carousel child (Meta refuses it there).
 */
export type InstagramAccount = { id: string; token: string };
export type ContainerStatus = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED" | "UNKNOWN";

export interface InstagramPublisher {
  /** How many posts the account may still publish in the current 24 hours, or null when it cannot be read. */
  remainingToday(account: InstagramAccount): Promise<number | null>;
  /** `story` (2026-11-13): a story container (media_type STORIES); a story has no caption. `carouselItem` (2026-11-16): a carousel's child. */
  createContainer(account: InstagramAccount, input: { imageUrl: string; caption: string; story?: boolean; carouselItem?: boolean; aiGenerated?: boolean }): Promise<string>;
  /** Karusell (2026-11-16): the carousel's own container from its children (2–20, already FINISHED). */
  createCarousel(account: InstagramAccount, input: { children: readonly string[]; caption: string; aiGenerated?: boolean }): Promise<string>;
  containerStatus(account: InstagramAccount, containerId: string): Promise<ContainerStatus>;
  publish(account: InstagramAccount, containerId: string): Promise<string>;
}

const STATUSES: readonly ContainerStatus[] = ["FINISHED", "IN_PROGRESS", "ERROR", "EXPIRED", "PUBLISHED"];

/** Facebook Login for Business: the page's linked Instagram account on graph.facebook.com. */
export function facebookLoginInstagram(transport: GraphTransport): InstagramPublisher {
  return {
    async remainingToday(account) {
      try {
        const answer = await graph<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(transport, { method: "GET", path: `${account.id}/content_publishing_limit`, params: { fields: "quota_usage,config", access_token: account.token } });
        const row = answer.data?.[0];
        if (typeof row?.quota_usage !== "number" || typeof row.config?.quota_total !== "number") return null;
        return Math.max(0, row.config.quota_total - row.quota_usage);
      } catch (error) {
        if (error instanceof MetaError && error.kind !== "other") throw error;
        return null;
      }
    },
    async createContainer(account, input) {
      const ai = input.aiGenerated && !input.carouselItem ? { is_ai_generated: true } : {};
      const answer = await graph<{ id?: string }>(transport, { method: "POST", path: `${account.id}/media`, params: input.carouselItem
        ? { image_url: input.imageUrl, is_carousel_item: true, access_token: account.token }
        : input.story
          ? { image_url: input.imageUrl, media_type: "STORIES", ...ai, access_token: account.token }
          : { image_url: input.imageUrl, caption: input.caption, ...ai, access_token: account.token } });
      if (!answer.id) throw new MetaError("Instagram gav inget id tillbaka.", "other", 502);
      return answer.id;
    },
    async createCarousel(account, input) {
      if (input.children.length < 2 || input.children.length > 20) throw new MetaError("En karusell har 2–20 bilder.", "other", 400);
      const answer = await graph<{ id?: string }>(transport, { method: "POST", path: `${account.id}/media`, params: {
        media_type: "CAROUSEL", children: input.children.join(","), caption: input.caption, ...(input.aiGenerated ? { is_ai_generated: true } : {}), access_token: account.token,
      } });
      if (!answer.id) throw new MetaError("Instagram gav inget id tillbaka.", "other", 502);
      return answer.id;
    },
    async containerStatus(account, containerId) {
      const answer = await graph<{ status_code?: string }>(transport, { method: "GET", path: containerId, params: { fields: "status_code", access_token: account.token } });
      return STATUSES.find((status) => status === answer.status_code) ?? "UNKNOWN";
    },
    async publish(account, containerId) {
      const answer = await graph<{ id?: string }>(transport, { method: "POST", path: `${account.id}/media_publish`, params: { creation_id: containerId, access_token: account.token } });
      if (!answer.id) throw new MetaError("Instagram gav inget id tillbaka.", "other", 502);
      return answer.id;
    },
  };
}

/** Waits until the container is FINISHED (Instagram fetches and checks the picture first). */
export async function waitForContainer(publisher: InstagramPublisher, account: InstagramAccount, containerId: string, options: { attempts?: number; delayMs?: number } = {}) {
  const attempts = options.attempts ?? 15;
  const delay = options.delayMs ?? 2000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await publisher.containerStatus(account, containerId);
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new MetaError("Instagram kunde inte hämta eller godta bilden.", "other", 502);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new MetaError("Instagram blev inte klar med bilden i tid. Försök igen om en stund.", "network", 504);
}

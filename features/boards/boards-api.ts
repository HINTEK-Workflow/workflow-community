"use client";

import { api } from "@/features/kfid/api";
import type { BoardLayout, Distance } from "@/lib/boards/model";
import type { MetricKey, MetricGroup } from "@/lib/boards/metrics";
import type { CardData, ShapeKind } from "@/lib/boards/shapes";
import type { Period } from "@/lib/boards/period";
import type { PeopleChoice, Visibility } from "@/lib/boards/privacy";
import type { TableColumn } from "@/lib/boards/table";

/**
 * Tavlornas sidor talk to /api/boards only (the server checks every call). The answers' shapes as the pages read them; the server's
 * own code stays in lib/boards/*-server.ts and never reaches the browser.
 */
export type BoardListItem = {
  id: string; name: string; description: string; updatedAt: string; updatedBy: string; mine: boolean; cards: number; orientation: BoardLayout["orientation"];
  published: { number: number; publishedAt: string } | null;
};
export type BoardList = { items: BoardListItem[]; canEdit: boolean; canPublish: boolean };
export type MetricOption = { key: MetricKey; label: string; description: string; group: MetricGroup; shape: ShapeKind; unit: string | null; personal: boolean; periods: Period[]; period: Period | null; compares: boolean };
export type BoardDetail = {
  id: string; name: string; description: string; revision: number; updatedAt: string;
  draft: BoardLayout | null;
  published: { id: string; number: number; publishedAt: string; layout: BoardLayout; visibility: Visibility } | null;
  canEdit: boolean; canPublish: boolean; metrics: MetricOption[];
};
export type BoardFeedAnswer = { at: string; cards: Record<string, CardData> };
export type PublishPreview = { layout: BoardLayout; cards: { id: string; personal: boolean; people: PeopleChoice }[]; personal: boolean; receivers: { screens: string[]; links: string[] } };
export type TableListItem = { id: string; name: string; description: string; columns: TableColumn[]; rows: number; updatedAt: string; updatedBy: string };
export type TableDetail = { id: string; name: string; description: string; revision: number; columns: TableColumn[]; rows: { id: string; values: Record<string, string | number | null> }[]; canEdit: boolean };

export const boardsGet = <T,>(query: string) => api<T>(`/api/boards?${query}`);
export const boardsPost = <T = Record<string, unknown>,>(body: Record<string, unknown>) => api<T>("/api/boards", { method: "POST", body: JSON.stringify(body) });

/** The address of a board's picture inside the app; a screen and a link use their own (features/boards/board-player.tsx). */
export const appImageUrl = (id: string) => `/api/boards/images/${encodeURIComponent(id)}`;

export async function uploadBoardImage(file: File): Promise<{ id: string }> {
  const form = new FormData();
  form.set("file", file);
  return api<{ id: string }>("/api/boards/images", { method: "POST", body: form });
}

export const boardHref = (id: string, edit = false) => `/?view=boards&board=${encodeURIComponent(id)}${edit ? "&edit=1" : ""}`;

// ---------- etapp 2: screens, links and playlists ----------

export type ScreenStatus = "online" | "offline" | "revoked" | "disconnected";
export type ScreenSettingsValue = { theme: "dark" | "light"; reloadHour: number | null; burnIn: boolean; /** Avstånd: null follows the board. */ distance: Distance | null; /** Skärmstorlek in inches: null is the distance's usual size. */ inches?: number | null };
export type ScreenItem = {
  id: string; name: string; placeName: string; status: ScreenStatus; lastSeenAt: string | null; shows: string;
  target: { boardId: string | null; playlistId: string | null }; settings: ScreenSettingsValue; size: string | null; client: string | null; version: string | null;
};
export type ScreenList = { items: ScreenItem[]; canManage: boolean };
export type PairingInfo = { code: string; askedAt: string; expiresAt: string; client: string; size: string | null; sameNetwork: boolean };
export type LinkItem = { id: string; name: string; state: "active" | "expired" | "revoked" | "locked"; code: boolean; names: boolean; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; shows: string };
export type LinkList = { items: LinkItem[]; defaultUntil: string };
export type MadeLink = { id: string; address: string; qr: string };
export type PlaylistItemValue = { boardId: string; seconds: number };
export type PlaylistListItem = { id: string; name: string; items: PlaylistItemValue[]; updatedAt: string };
export type PlaylistList = { items: PlaylistListItem[]; canEdit: boolean };
/** A target as the screen and link forms choose it: "b:<id>" for a board, "p:<id>" for a playlist. */
export const targetValue = (target: { boardId: string | null; playlistId: string | null }) => target.boardId ? `b:${target.boardId}` : target.playlistId ? `p:${target.playlistId}` : "";
export const targetOfValue = (value: string) => value.startsWith("p:") ? { playlistId: value.slice(2) } : { boardId: value.slice(2) };

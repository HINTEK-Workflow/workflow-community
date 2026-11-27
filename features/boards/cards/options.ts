"use client";

import { useEffect, useState } from "react";
import { boardsGet } from "../boards-api";

/**
 * What the properties panel may offer a newer card (GET /api/boards?part=sources): the board files, a sheet's columns, the machines
 * and the signals. The server answers only for a person who may change boards; the machines only with Underhåll's right.
 */
type Answer<T> = { items?: T[]; columns?: T[]; refused?: boolean; demo?: boolean };
type State<T> = { key: string; items: T[]; refused: boolean; demo: boolean; error: string | null };
const kept = new Map<string, Promise<Answer<unknown>>>();

export function forgetSourceOptions(kind?: string) {
  for (const key of [...kept.keys()]) if (!kind || key.startsWith(`${kind}:`)) kept.delete(key);
}

export function useSourceOptions<T>(kind: "files" | "sheet" | "machines" | "signals", id?: string, version = 0) {
  const key = `${kind}:${id ?? ""}:${version}`;
  const skip = kind === "sheet" && !id;
  const [state, setState] = useState<State<T>>({ key: "", items: [], refused: false, demo: false, error: null });
  useEffect(() => {
    if (skip) return;
    let active = true;
    const cacheKey = `${kind}:${id ?? ""}`;
    let request = kept.get(cacheKey);
    if (!request) {
      request = boardsGet<Answer<unknown>>(`part=sources&kind=${kind}${id ? `&id=${encodeURIComponent(id)}` : ""}`);
      kept.set(cacheKey, request);
      request.catch(() => kept.delete(cacheKey));
    }
    request.then((answer) => { if (active) setState({ key, items: (answer.items ?? answer.columns ?? []) as T[], refused: Boolean(answer.refused), demo: Boolean(answer.demo), error: null }); })
      .catch((error: unknown) => { if (active) setState({ key, items: [], refused: false, demo: false, error: error instanceof Error ? error.message : "Uppgifterna kunde inte hämtas." }); });
    return () => { active = false; };
  }, [kind, id, key, skip]);
  if (skip) return { items: [] as T[], refused: false, demo: false, loading: false, error: null };
  const current = state.key === key;
  return { items: current ? state.items : [], refused: current && state.refused, demo: current && state.demo, loading: !current, error: current ? state.error : null };
}

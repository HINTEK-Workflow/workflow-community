"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Maximize2, Minimize2, Minus, Network, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { Segmented } from "@/features/workflow/work-list";
import { cn } from "@/lib/utils";
import { rolesFor, runsText, seenVisible, testedText, wasTested, type SeenFilter } from "@/lib/sitemap/observed";
import type { SitemapData, SitemapEdge, SitemapNode, SitemapObservation, SitemapRef, SitemapRole, SitemapService } from "@/lib/sitemap/types";
import { IconButton } from "@/components/ui/icon-button";

/**
 * Webbplatskartan (2026-10-24: "en del av avancerade inställningar för produktionsadmin. Man ska även kunna tända
 * och släcka om jag är prodadmin, kundföretag eller användare."): the stand-alone map (scripts/sitemap/template.html) as a
 * part of Installation → Drift och säkerhet → Avancerat. The same drawing – a column per level, the kinds of line
 * that are switched on and off, single items hidden with "Via en enskild post" lines, the observations, the direction,
 * search and zoom – in the app's tokens and shared controls, plus Visa som: only the boxes and lines a role reaches. The
 * data is read from /api/superadmin/sitemap (the superadmin only) when the person asks for it, never with the page.
 */

const W = 236, H = 28, ROW = 34, TOP = 40, SUBW = W + 14, MIN_GAP = 48, READ_K = 0.85;
const ROOT_ORDER = ["v:stats", "e:dator", "e:flikrad", "e:delad", "e:server", "e:publik", "e:extern"];
const KIND_ORDER: Record<string, number> = { group: 0, entry: 0, view: 1, variant: 2, popup: 3, public: 1, step: 4, section: 5, modal: 6, dead: 7, service: 1 };
const KIND_LABEL: Record<string, string> = { view: "Vy", variant: "Variant av vy", group: "Menygrupp", entry: "Ingång", popup: "Popup/panel", public: "Publik sida", step: "Steg (step=)", section: "Avsnitt (section=)", modal: "Popup (Modal)", dead: "Finns inte", service: "Extern tjänst" };
/** Externa tjänster (2026-10-25): the box's tag says which way it talks; its colour whose key it uses. */
const DIRECTION_TAG: Record<string, string> = { out: "UT", in: "IN", both: "UT+IN" };
const TYPE_LABEL: Record<string, string> = { "work-order": "Arbetsorder", control: "Uppgift/kontroll", risk: "Risk", round: "Driftrond", time: "Tid", customer: "Kund", project: "Projekt", quote: "Offert/inköp", purchase: "Inköp", instrument: "Instrument", tools: "Verktyg", calendar: "Kalender", neutral: "Neutral", checkin: "Checka in", new: "Ny", notice: "Notis" };
const KNOWN_TYPES = new Set(["work-order", "control", "risk", "round", "time", "customer", "project", "quote", "purchase", "instrument", "neutral", "tools", "calendar"]);
const COND_TAG: Record<string, string> = { admin: "ADMIN", superadmin: "SUPER", tillval: "TILLVAL", cloud: "CLOUD", "visa mer": "VISA MER", "eget val": "VAL", "behörighet": "BEH", demo: "DEMO" };
const LEVEL_NAME = ["Start och ingångar", "Menygrupper", "Sidor och listor", "Flikar, delsidor, detaljer", "Popupar, steg, avsnitt", "Djupare"];
const ROLE_LABEL: Record<SitemapRole, string> = { superadmin: "Produktadmin", admin: "Kundföretagets admin", member: "Användare" };
const SEEN_KIND: Record<SitemapObservation["kind"], string> = { finding: "Fynd", robotNode: "Ruta som saknas i koden", robotEdge: "Väg som saknas i koden", roleMap: "Roller: koden mot appen", back: "Bakåt" };
const OPEN_STATUS = new Set(["öppet"]);
const OBS_KIND: Record<string, string> = { old: "Länk till gammal adress", multi: "Dubbel väg från menyn", device: "Bara på en enhet", noin: "Ingen inkommande länk", redirectOnly: "Vy som bara nås som omdirigering", same: "Samma namn", dead: "Död länk" };
const DIR_KEY = "wfmap-dir";

type Role = "all" | SitemapRole;
type Device = "all" | "desktop" | "phone";
type Cond = "show" | "mark" | "hide";
type Dir = "rtl" | "ltr";
type Point = { x: number; y: number };
type Way = { edge: SitemapEdge; from: string; to: string };
type Via = { from: string; to: string; ways: Way[]; cond: string | null };
type Drawn = { key: string; d: string; cat: string; from: string; to: string; className: string; edge?: number; via?: number; width?: number };
type Detail = { kind: "node"; id: string; note?: string } | { kind: "edge"; index: number; from: string } | { kind: "via"; index: number } | { kind: "overview" };
type Tip = { x: number; y: number; title: string; lines: { text: string; file?: boolean }[] };
type Observation = { kind: string; id: string; text: string; refs?: SitemapRef[] };

const typeVar = (type: string) => `var(--type-${KNOWN_TYPES.has(type) ? type : "neutral"})`;
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);
const refText = (ref?: SitemapRef | null) => (ref ? `${ref.file}${ref.line ? `:${ref.line}` : ""}` : "");
const edgeDevice = (edge: SitemapEdge) => edge.device ?? (edge.cat === "menu" ? "desktop" : edge.cat === "phone" ? "phone" : "both");
const deviceHides = (device: Device, edge: SitemapEdge) => {
  const own = edgeDevice(edge);
  return (device === "desktop" && own === "phone") || (device === "phone" && own === "desktop");
};
/** Visa som: the robot's roles where it tried (followRobot), else the code's. */
const roleHas = (role: Role, item: { roles?: SitemapRole[]; appRoles?: SitemapRole[] }, followRobot = false) => {
  const roles = rolesFor(item, followRobot);
  return role === "all" || !roles || roles.includes(role);
};

/** The line follows the tree's direction: out of the box's front (right going left → right, left going right → left). */
function edgePath(a: Point, b: Point, dir: Dir) {
  const s = dir === "rtl" ? -1 : 1;
  const x1 = s > 0 ? a.x + W : a.x, y1 = a.y + H / 2, x2 = s > 0 ? b.x : b.x + W, y2 = b.y + H / 2;
  if ((x2 - x1) * s > 10) {
    const dx = s * Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  const bend = s * (70 + Math.min(160, Math.abs(y2 - y1) / 12));
  return `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
}

/** The part on Drift och säkerhet: a button that fetches the map (or the map at once when the address names it). */
export function SiteMap({ autoLoad = false }: { autoLoad?: boolean }) {
  const [data, setData] = useState<SitemapData | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try { setData(await api<SitemapData>("/api/superadmin/sitemap", { cache: "no-store" })); setState("idle"); }
    catch (error) { setMessage((error as Error).message); setState("error"); }
  }, []);
  const started = useRef(false);
  useEffect(() => {
    if (!autoLoad || started.current) return;
    started.current = true;
    void load();
  }, [autoLoad, load]);
  return <Panel icon={Network} title="Webbplatskarta" description="Sidor, flikar, popupar och externa tjänster och vägarna mellan dem, räknat ur koden vid bygget.">
    <div data-testid="sitemap-part">
      {data ? <SiteMapView data={data} /> : <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => void load()} disabled={state === "loading"} data-testid="sitemap-open"><Network />Visa kartan</Button>
        {state === "loading" ? <span className="text-sm text-muted-foreground" role="status">Hämtar…</span> : null}
        {state === "error" ? <span className="text-sm text-destructive" role="alert">{message}</span> : null}
      </div>}
    </div>
  </Panel>;
}

function LegendHeading({ children }: { children: ReactNode }) {
  return <h3 className="mt-4 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{children}</h3>;
}
function CheckRow({ checked, onChange, children, count, testId }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode; count?: number | string; testId?: string }) {
  return <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
    <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} data-testid={testId} />
    <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    {count !== undefined ? <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span> : null}
  </label>;
}

export function SiteMapView({ data }: { data: SitemapData }) {
  const byId = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data]);
  const catOf = useMemo(() => new Map(data.cats.map((cat) => [cat.key, cat])), [data]);
  const maxLevel = useMemo(() => Math.max(0, ...data.nodes.map((node) => node.level || 0)), [data]);
  const [cats, setCats] = useState<Record<string, boolean>>(() => Object.fromEntries(data.cats.map((cat) => [cat.key, cat.on])));
  const [cond, setCond] = useState<Cond>("show");
  const [device, setDevice] = useState<Device>("all");
  const [levels, setLevels] = useState<Record<number, boolean>>({});
  const [kinds, setKinds] = useState<Record<string, boolean>>({ step: true, section: true, modal: false, public: true, service: true });
  const [shared, setShared] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [role, setRole] = useState<Role>("all");
  // Provat i appen (2026-10-24): Visa Allt · Provat i appen · Bara i koden, and Visa som after the robot's roles.
  const observed = data.observed ?? null;
  const [seen, setSeen] = useState<SeenFilter>("all");
  const [followRobot, setFollowRobot] = useState(true);
  const robotRoles = Boolean(observed) && followRobot;
  const [dir, setDirState] = useState<Dir>(() => { try { return window.localStorage.getItem(DIR_KEY) === "ltr" ? "ltr" : "rtl"; } catch { return "rtl"; } });
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [anom, setAnom] = useState(false);
  const [legendOpen, setLegendOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  // "Håll Ctrl för att zooma" for a moment when the wheel scrolls the page over the map (2026-10-24).
  const [ctrlHint, setCtrlHint] = useState(false);
  const ctrlHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const vpRef = useRef<SVGGElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const matchAt = useRef(-1);
  const levelOn = useCallback((level: number) => levels[level] !== false, [levels]);
  const setDir = (next: Dir) => { setDirState(next); try { window.localStorage.setItem(DIR_KEY, next); } catch { /* storage is optional */ } };

  // Anomalies: a mark per box (shown with Visa avvikelser) and the lines they concern.
  const { anomNodes, anomEdges, observations, tried } = useMemo(() => {
    const A = data.anomalies;
    const marks = new Map<string, { code: string; text: string }[]>();
    const add = (id: string, code: string, text: string) => { if (!marks.has(id)) marks.set(id, []); marks.get(id)!.push({ code, text }); };
    A.noIncoming.forEach((x) => add(x.id, "0", `Ingen väg in: ${x.note}`));
    A.multiMenu.forEach((x) => add(x.id, "2", `Flera menyvägar (${x.device}${x.byDefault ? "" : ", bara med egna val"}): ${x.ways.join(" · ")}`));
    A.oneDevice.forEach((x) => add(x.id, x.device === "bara dator" ? "D" : "T", `Nås ${x.device}: ${x.note}`));
    (A.sameName ?? []).forEach((x) => add(x.id, "N", `Samma namn: ${x.note}`));
    A.dead.forEach((x) => { add(x.from, "X", `Död länk: ${x.reason}`); add(x.to, "X", `Död länk hit: ${x.reason}`); });
    (A.oldAddress ?? []).forEach((x) => add(x.from, "G", `Länkar till gammal adress ${byId.get(x.to)?.label ?? x.to}`));
    const rows: Observation[] = [];
    (A.oldAddress ?? []).forEach((x) => rows.push({ kind: "old", id: x.from, text: `→ ?view=${byId.get(x.to)?.view ?? x.to}`, refs: x.refs }));
    A.multiMenu.forEach((x) => rows.push({ kind: "multi", id: x.id, text: `${x.device}${x.byDefault ? " (med standardval)" : " (bara med egna val)"}: ${x.ways.join(" · ")}` }));
    A.oneDevice.forEach((x) => rows.push({ kind: "device", id: x.id, text: `${x.device}: ${x.note}`, refs: byId.get(x.id)?.refs }));
    A.noIncoming.forEach((x) => rows.push({ kind: /gammal adress/.test(x.note) ? "redirectOnly" : "noin", id: x.id, text: x.note, refs: byId.get(x.id)?.refs }));
    (A.sameName ?? []).forEach((x) => rows.push({ kind: "same", id: x.id, text: x.note, refs: x.refs }));
    A.dead.forEach((x) => rows.push({ kind: "dead", id: x.from, text: `→ ${byId.get(x.to)?.label ?? x.to}: ${x.reason}`, refs: x.refs }));
    return { anomNodes: marks, anomEdges: new Set([...A.dead, ...(A.oldAddress ?? [])].map((x) => `${x.from}|${x.to}`)), observations: rows, tried: A.observed ?? [] };
  }, [data, byId]);

  // Placement: a tree with a column per level. Many leaves under one parent are split into 2–4 sub-columns, and the gap
  // between the levels is worked out from the width, so the map fills it (2026-10-24: "dra ut det rejält på bredden").
  const layout = useMemo(() => {
    const visible = new Set(data.nodes.filter((n) => levelOn(n.level) && kinds[n.kind] !== false && (showItems || !n.item) && roleHas(role, n, robotRoles) && seenVisible(n, seen)).map((n) => n.id));
    const kids = new Map<string, string[]>(), roots: string[] = [];
    for (const n of data.nodes) {
      if (!visible.has(n.id)) continue;
      let p = n.parent;
      while (p && !visible.has(p)) p = byId.get(p)?.parent ?? null;
      if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p)!.push(n.id); } else roots.push(n.id);
    }
    const rank = (id: string) => { const at = ROOT_ORDER.indexOf(id); return at < 0 ? 99 : at; };
    roots.sort((a, b) => rank(a) - rank(b));
    for (const list of kids.values()) list.sort((a, b) => (KIND_ORDER[byId.get(a)!.kind] ?? 9) - (KIND_ORDER[byId.get(b)!.kind] ?? 9));
    const shown = [...Array(maxLevel + 1).keys()].filter(levelOn);
    const perLevel: Record<number, number> = {};
    visible.forEach((id) => { const l = byId.get(id)!.level; perLevel[l] = (perLevel[l] || 0) + 1; });
    const stageW = Math.max(600, (stageWidth || 1200) - 40);
    let extra = Math.floor((stageW / READ_K - shown.length * W - Math.max(0, shown.length - 1) * MIN_GAP) / SUBW);
    const cap: Record<number, number> = {};
    shown.forEach((l) => { cap[l] = 1; });
    while (extra-- > 0) {
      const best = shown.filter((l) => cap[l] < 4 && (perLevel[l] || 0) > cap[l] * 8).sort((a, b) => (perLevel[b] || 0) / cap[b] - (perLevel[a] || 0) / cap[a])[0];
      if (best === undefined) break;
      cap[best] += 1;
    }
    const meta = new Map<string, { y: number; sub: number }>();
    let y = TOP;
    const place = (id: string) => {
      const children = kids.get(id) ?? [];
      if (!children.length) { meta.set(id, { y, sub: 0 }); y += ROW; return; }
      const branches = children.filter((c) => (kids.get(c) ?? []).length), leaves = children.filter((c) => !(kids.get(c) ?? []).length);
      branches.forEach(place);
      if (leaves.length) {
        const cols = Math.max(1, Math.min(cap[byId.get(leaves[0])!.level] || 1, Math.ceil(leaves.length / 6)));
        const rows = Math.ceil(leaves.length / cols);
        leaves.forEach((c, j) => meta.set(c, { y: y + (j % rows) * ROW, sub: Math.floor(j / rows) }));
        y += rows * ROW;
      }
      const ys = children.map((c) => meta.get(c)!.y);
      meta.set(id, { y: (Math.min(...ys) + Math.max(...ys)) / 2, sub: 0 });
    };
    roots.forEach((r) => { place(r); y += ROW * 0.7; });
    const subs: Record<number, number> = {};
    meta.forEach((m, id) => { const l = byId.get(id)!.level; subs[l] = Math.max(subs[l] || 1, m.sub + 1); });
    const levelWidth: Record<number, number> = {};
    shown.forEach((l) => { levelWidth[l] = (subs[l] || 1) * SUBW - 14; });
    const sum = shown.reduce((t, l) => t + levelWidth[l], 0);
    const gap = Math.max(MIN_GAP, shown.length > 1 ? (stageW - sum) / (shown.length - 1) : 0);
    const levelStart: Record<number, number> = {};
    let x = 20;
    (dir === "rtl" ? [...shown].reverse() : shown).forEach((l) => { levelStart[l] = x; x += levelWidth[l] + gap; });
    const pos = new Map<string, Point>();
    meta.forEach((m, id) => pos.set(id, { x: levelStart[byId.get(id)!.level] + m.sub * SUBW, y: m.y }));
    return { visible, pos, height: y, levelStart, shown, totalWidth: x - gap + 20 };
  }, [data, byId, maxLevel, levelOn, kinds, showItems, role, robotRoles, seen, dir, stageWidth]);

  /** The nearest shown box above a hidden one (for a hidden single item: the list it is opened from). */
  const visibleAncestor = useCallback((id: string) => {
    let p: string | null = id, hops = 0;
    while (p && hops++ < 30) { if (layout.visible.has(p)) return p; p = byId.get(p)?.parent ?? null; }
    return null;
  }, [layout, byId]);
  const isHiddenItem = useCallback((id: string) => Boolean(byId.get(id)?.item && !showItems), [byId, showItems]);

  // The lines: every visible one, and a way into or out of a hidden single item drawn from/to the nearest shown box ("via").
  const { drawn, viaList } = useMemo(() => {
    const out: Drawn[] = [];
    const viaMap = new Map<string, Via>();
    data.edges.forEach((e, i) => {
      const sources = shared && e.also ? [e.from, ...e.also] : [e.from];
      for (const from of sources) {
        const to = e.to;
        if (!cats[e.cat] || !roleHas(role, e, robotRoles) || !seenVisible(e, seen) || (e.cond && cond === "hide") || deviceHides(device, e)) continue;
        if (!showItems && e.cat !== "tree" && (isHiddenItem(from) || isHiddenItem(to))) {
          const vf = visibleAncestor(from), vt = visibleAncestor(to);
          if (!vf || !vt || vf === vt || !cats.via) continue;
          const key = `${vf}|${vt}`;
          if (!viaMap.has(key)) viaMap.set(key, { from: vf, to: vt, ways: [], cond: e.cond ?? null });
          const via = viaMap.get(key)!;
          if (!e.cond) via.cond = null;
          via.ways.push({ edge: e, from, to });
          continue;
        }
        if (!layout.visible.has(from) || !layout.visible.has(to)) continue;
        const a = layout.pos.get(from), b = layout.pos.get(to);
        if (!a || !b) continue;
        const className = cn("edge", `cat-${e.cat}`, e.cond && cond === "mark" && "cond-mark", e.dead && "dead", anomEdges.has(`${from}|${to}`) && "anom-edge");
        out.push({ key: `${i}|${from}`, d: edgePath(a, b, dir), cat: e.cat, from, to, className, edge: i });
      }
    });
    const vias = [...viaMap.values()];
    vias.forEach((via, index) => {
      const a = layout.pos.get(via.from), b = layout.pos.get(via.to);
      if (!a || !b) return;
      out.push({ key: `via|${via.from}|${via.to}`, d: edgePath(a, b, dir), cat: "via", from: via.from, to: via.to, via: index,
        className: cn("edge cat-via", via.cond && cond === "mark" && "cond-mark"), width: Math.min(4, 1.2 + Math.log2(via.ways.length) * 0.6) });
    });
    return { drawn: out, viaList: vias };
  }, [data, cats, role, robotRoles, seen, cond, device, shared, showItems, isHiddenItem, visibleAncestor, layout, anomEdges, dir]);

  // Focus: the chosen box's lines in and out are lit, the rest dimmed.
  const lit = useMemo(() => {
    if (!selected) return null;
    const edges = new Set<string>(), boxes = new Set<string>([selected]);
    for (const line of drawn) if (line.from === selected || line.to === selected) { edges.add(line.key); boxes.add(line.from); boxes.add(line.to); }
    return { edges, boxes };
  }, [selected, drawn]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return [...layout.visible].filter((id) => {
      const n = byId.get(id)!;
      return [n.label, n.id, n.address ?? "", n.view ?? "", ...n.refs.map((r) => r.file)].join(" ").toLowerCase().includes(q);
    });
  }, [search, layout, byId]);
  const matchSet = useMemo(() => new Set(matches ?? []), [matches]);

  // Zoom and panning: set on the viewport directly, so a drag never draws the map again.
  const applyView = useCallback(() => {
    const v = view.current;
    vpRef.current?.setAttribute("transform", `translate(${v.x},${v.y}) scale(${v.k})`);
  }, []);
  const fit = useCallback(() => {
    const width = svgRef.current?.getBoundingClientRect().width || 1200;
    // The width decides (2026-10-24): the text can be read at once; the height is scrolled.
    view.current = { k: Math.max(READ_K, Math.min(1, width / (layout.totalWidth || 1200))), x: 4, y: 8 };
    applyView();
  }, [layout.totalWidth, applyView]);
  const zoomBy = (factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const v = view.current, mx = rect.width / 2, my = rect.height / 2, k = Math.min(3, Math.max(0.08, v.k * factor));
    view.current = { x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k), k };
    applyView();
  };
  const panTo = useCallback((id: string) => {
    const at = layout.pos.get(id), rect = svgRef.current?.getBoundingClientRect();
    if (!at || !rect) return;
    const k = view.current.k < 0.6 ? 0.85 : view.current.k;
    view.current = { k, x: rect.width / 2 - (at.x + W / 2) * k, y: rect.height / 2 - (at.y + H / 2) * k };
    applyView();
  }, [layout, applyView]);

  // The stage's width (debounced) for the layout, and a new fit when the direction, the legend or the width changes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") { setStageWidth(1200); return; }
    let timer = 0;
    const observer = new ResizeObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(() => setStageWidth(stage.getBoundingClientRect().width), 150); });
    observer.observe(stage);
    setStageWidth(stage.getBoundingClientRect().width);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);
  const fitKey = `${dir}|${legendOpen}|${stageWidth}|${fullscreen}`;
  useEffect(() => { fit(); }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps -- a new fit only when the frame changes, not on every filter

  // The wheel scrolls the page as anywhere else (2026-10-24: the page and the map scrolled at once); with Ctrl (or a
  // pinch on the touchpad) it zooms the map. Dragging moves the map.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        setTip(null); setCtrlHint(true);
        if (ctrlHintTimer.current) clearTimeout(ctrlHintTimer.current);
        ctrlHintTimer.current = setTimeout(() => setCtrlHint(false), 1500);
        return;
      }
      event.preventDefault();
      const v = view.current;
      const rect = svgRef.current!.getBoundingClientRect(), mx = event.clientX - rect.left, my = event.clientY - rect.top;
      const k = Math.min(3, Math.max(0.08, v.k * Math.exp(-event.deltaY * 0.0015)));
      view.current = { x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k), k };
      applyView();
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [applyView]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelected(null); setDetail(null); } };
    const onFullscreen = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFullscreen); };
  }, []);

  const select = useCallback((id: string, pan: boolean, note?: string) => {
    setSelected(id); setDetail({ kind: "node", id, note });
    if (pan) panTo(id);
  }, [panTo]);
  /** Marks the box – or, among hidden single items, the nearest shown box above it, with a note. */
  const selectVisible = (id: string) => {
    if (layout.visible.has(id)) { select(id, true); return; }
    const up = visibleAncestor(id);
    if (up) select(up, true, `Iakttagelsen gäller ${byId.get(id)?.label ?? id} (i en enskild post – kryssa Visa enskilda poster för att se den).`);
  };

  const viaText = (way: Way) => {
    const label = (id: string | null) => (id ? byId.get(id)?.label ?? id : "?");
    const parts = [label(visibleAncestor(way.from))];
    if (isHiddenItem(way.from)) parts.push(`(öppna ${label(way.from)})`);
    if (isHiddenItem(way.to)) parts.push(`(öppna ${label(way.to)})`);
    parts.push(label(visibleAncestor(way.to)));
    return parts.join(" → ");
  };

  // Pointer: drag to move; a click (no drag) on a box, a line or the empty stage.
  const targetOf = (element: Element | null) => ({
    box: element?.closest<SVGGElement>("[data-node]")?.dataset.node ?? null,
    line: element?.closest<SVGPathElement>("[data-line]") ?? null,
  });
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, vx: view.current.x, vy: view.current.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) {
      const dx = event.clientX - d.x, dy = event.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; setDragging(true); }
      if (d.moved) { view.current = { ...view.current, x: d.vx + dx, y: d.vy + dy }; applyView(); setTip(null); return; }
    }
    showTip(event);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    setDragging(false);
    if (wasDrag) return;
    const { box, line } = targetOf(document.elementFromPoint(event.clientX, event.clientY));
    if (box) select(box, false);
    else if (line?.dataset.via !== undefined) setDetail({ kind: "via", index: Number(line.dataset.via) });
    else if (line?.dataset.edge !== undefined) setDetail({ kind: "edge", index: Number(line.dataset.edge), from: line.dataset.from ?? "" });
    else { setSelected(null); setDetail(null); }
  };
  const showTip = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { box, line } = targetOf(event.target as Element);
    if (!box && !line) { if (tip) setTip(null); return; }
    const lines: Tip["lines"] = [];
    let title = "";
    if (box) {
      const n = byId.get(box)!;
      title = n.label;
      lines.push({ text: `${KIND_LABEL[n.kind] ?? n.kind}${n.address ? ` · ${n.address}` : ""}` });
      if (n.service) lines.push({ text: n.service.purpose }, { text: `${n.service.directionLabel} · ${n.service.ownerLabel}: ${n.service.key}` });
      if (observed && n.tested !== undefined) lines.push({ text: testedText(n) });
      n.refs.slice(0, 3).forEach((r) => lines.push({ text: refText(r), file: true }));
      (anomNodes.get(n.id) ?? []).forEach((a) => lines.push({ text: `Avvikelse: ${a.text}` }));
    } else if (line?.dataset.via !== undefined) {
      const via = viaList[Number(line.dataset.via)];
      if (!via) return;
      title = `Via en enskild post · ${via.ways.length} ${via.ways.length === 1 ? "väg" : "vägar"}`;
      via.ways.slice(0, 5).forEach((w) => { lines.push({ text: viaText(w) }); const r = w.edge.refs[0]; if (r) lines.push({ text: refText(r), file: true }); });
      if (via.ways.length > 5) lines.push({ text: `… och ${via.ways.length - 5} till (klicka på linjen)` });
    } else if (line) {
      const e = data.edges[Number(line.dataset.edge)];
      if (!e) return;
      title = `${byId.get(line.dataset.from ?? e.from)?.label ?? e.from} → ${byId.get(e.to)?.label ?? e.to}`;
      lines.push({ text: `${catOf.get(e.cat)?.label ?? e.cat}${e.label ? ` · ${e.label}` : ""}${e.cond ? ` · villkor: ${e.cond}` : ""}${e.dead ? ` · DÖD: ${e.reason}` : ""}` });
      if (observed) lines.push({ text: testedText(e) });
      e.refs.slice(0, 4).forEach((r) => lines.push({ text: refText(r), file: true }));
    }
    const box2 = wrapRef.current?.getBoundingClientRect();
    // Kept inside the map's frame, so a tooltip never widens the page.
    const x = Math.max(0, Math.min(event.clientX - (box2?.left ?? 0) + 14, (box2?.width ?? 0) - 330));
    setTip({ x, y: event.clientY - (box2?.top ?? 0) + 14, title, lines });
  };

  // The drawing, kept as one element so a tooltip or a drag never draws the map again.
  const drawing = useMemo(() => <>
    <defs>
      {data.cats.map((cat) => <marker key={cat.key} id={`sitemap-arrow-${cat.key}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill={cat.color} />
      </marker>)}
    </defs>
    <g ref={vpRef}>
      <g>
        {layout.shown.map((level) => <g key={level}>
          <text className="colhead" x={layout.levelStart[level]} y={18}>{`Nivå ${level} · ${LEVEL_NAME[level] ?? LEVEL_NAME[5]}`}</text>
          <line className="colline" x1={layout.levelStart[level] - 10} x2={layout.levelStart[level] - 10} y1={26} y2={layout.height} />
        </g>)}
      </g>
      <g>
        {drawn.map((line) => {
          const cat = catOf.get(line.cat);
          return <path key={line.key} d={line.d} className={cn(line.className, lit?.edges.has(line.key) && "hi")} stroke={cat?.color} strokeDasharray={cat?.dash || undefined}
            strokeWidth={line.width} markerEnd={`url(#sitemap-arrow-${line.cat})`} data-line="" data-edge={line.edge} data-via={line.via} data-from={line.from} data-to={line.to} />;
        })}
      </g>
      <g>
        {[...layout.visible].map((id) => {
          const n = byId.get(id)!, at = layout.pos.get(id);
          if (!at) return null;
          const tags = [...(n.service ? [DIRECTION_TAG[n.service.direction] ?? ""] : []), ...(n.robotOnly ? ["ROBOT"] : []), ...(n.old ? ["GAMMAL"] : []), ...(n.cond && COND_TAG[n.cond] ? [COND_TAG[n.cond]] : []), ...(n.phoneHidden ? ["DATOR"] : [])].join(" ");
          const codes = [...new Set((anomNodes.get(id) ?? []).map((a) => a.code))].join("");
          return <g key={id} data-node={id} transform={`translate(${at.x},${at.y})`} style={{ "--c": typeVar(n.type) } as CSSProperties}
            className={cn("node", `k-${n.kind}`, codes && "has-anom", lit?.boxes.has(id) && "hi", selected === id && "sel", matchSet.has(id) && "match")}>
            <rect className="ring" x={-4} y={-4} width={W + 8} height={H + 8} rx={9} />
            <rect className="box" width={W} height={H} rx={6} />
            {observed && n.tested !== undefined ? <rect className={cn("seen", n.robotOnly ? "robot" : wasTested(n) ? "yes" : "no")} x={1.5} y={5} width={4} height={H - 10} rx={2} style={n.robotOnly ? { fill: catOf.get("robot")?.color } : undefined} data-seen={n.robotOnly ? "robot" : wasTested(n) ? "yes" : "no"} /> : null}
            <text x={9} y={19}>{truncate(n.label, Math.floor((W - 18 - tags.length * 6.2) / 7.1))}</text>
            {tags ? <text className="tag" x={W - 6} y={18} textAnchor="end">{tags}</text> : null}
            {codes ? <g className="badge" transform={`translate(${W - 4 - codes.length * 7},-9)`}>
              <rect width={8 + codes.length * 7} height={14} rx={7} /><text x={4} y={10.5}>{codes}</text>
            </g> : null}
          </g>;
        })}
      </g>
    </g>
  </>, [data, layout, drawn, catOf, lit, byId, anomNodes, selected, matchSet, observed]);

  const levelCount = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const n of data.nodes) counts[n.level] = (counts[n.level] || 0) + 1;
    return counts;
  }, [data]);
  const catCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of data.edges) counts[e.cat] = (counts[e.cat] || 0) + 1;
    return counts;
  }, [data]);
  const typesShown = useMemo(() => [...new Set(data.nodes.filter((n) => n.kind !== "service").map((n) => n.type))], [data]);
  const s = data.stats;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen?.();
  };

  return <div ref={wrapRef} className="site-map relative space-y-3" data-testid="sitemap" data-role={role}>
    <p className="text-xs text-muted-foreground" data-testid="sitemap-meta">
      {`Version ${data.version} · ${data.commit !== "?" ? `${data.branch} · ${data.commit} · ` : ""}${new Date(data.generated).toLocaleString("sv-SE")} · ${s.pages} sidor (${s.views} vyer) · ${layout.visible.size} av ${s.nodes} rutor · ${drawn.length} linjer`}
    </p>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" aria-expanded={legendOpen} onClick={() => setLegendOpen((open) => !open)} data-testid="sitemap-legend-toggle">Linjer och filter</Button>
      <Input type="search" value={search} placeholder="Sök sida, vy, fil …" aria-label="Sök i kartan" className="w-48 min-w-0 flex-1 sm:flex-none" data-testid="sitemap-search"
        onChange={(event) => { setSearch(event.target.value); matchAt.current = -1; }}
        onKeyDown={(event) => { if (event.key === "Enter" && matches?.length) { matchAt.current = (matchAt.current + 1) % matches.length; select(matches[matchAt.current], true); } }} />
      {/* On a phone the choices scroll sideways inside their own row, never the page. */}
      <div className="max-w-full overflow-x-auto"><Segmented<Role> label="Visa som" value={role} onChange={setRole} testId="sitemap-role"
        options={[{ value: "all", label: "Alla" }, ...data.roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))]} /></div>
      {observed ? <div className="max-w-full overflow-x-auto"><Segmented<SeenFilter> label="Visa" value={seen} onChange={setSeen} testId="sitemap-seen"
        options={[{ value: "all", label: "Allt" }, { value: "tested", label: "Provat i appen" }, { value: "code", label: "Bara i koden" }]} /></div> : null}
      <Button type="button" variant={anom ? "secondary" : "outline"} aria-pressed={anom} onClick={() => { setAnom((on) => !on); if (!anom) { setSelected(null); setDetail({ kind: "overview" }); } }} data-testid="sitemap-anomalies">Visa avvikelser</Button>
      <span className="inline-flex gap-1">
        <IconButton label="Zooma in" variant="outline" size="icon-lg" onClick={() => zoomBy(1.25)}><Plus /></IconButton>
        <IconButton label="Zooma ut" variant="outline" size="icon-lg" onClick={() => zoomBy(0.8)}><Minus /></IconButton>
        <Button type="button" variant="outline" onClick={fit}>Hela kartan</Button>
      </span>
      <div className="max-w-full overflow-x-auto"><Segmented<Dir> label="Riktning" value={dir} onChange={setDir} testId="sitemap-direction" options={[{ value: "rtl", label: "Höger → vänster" }, { value: "ltr", label: "Vänster → höger" }]} /></div>
      <Button type="button" variant="outline" onClick={() => { if (detail?.kind === "overview") setDetail(null); else { setSelected(null); setDetail({ kind: "overview" }); } }} data-testid="sitemap-observations">{`Iakttagelser (${observations.length + tried.length})`}</Button>
      <IconButton label={fullscreen ? "Lämna helskärm" : "Helskärm"} variant="outline" size="icon-lg" onClick={toggleFullscreen}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</IconButton>
    </div>
    <div className={cn("site-map-main relative grid overflow-hidden rounded-lg border", legendOpen ? "lg:grid-cols-[250px_minmax(0,1fr)]" : "grid-cols-1")}>
      {legendOpen ? <aside className="overflow-auto border-r bg-card px-3.5 py-3 max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-10 max-lg:w-[min(320px,calc(100%-16px))] max-lg:shadow-lg" data-testid="sitemap-legend">
        <LegendHeading>Linjer</LegendHeading>
        {data.cats.map((cat) => <CheckRow key={cat.key} checked={cats[cat.key] !== false} onChange={(value) => setCats((current) => ({ ...current, [cat.key]: value }))}
          count={cat.key === "via" ? viaList.length : catCount[cat.key] || 0} testId={`sitemap-cat-${cat.key}`}>
          <span aria-hidden="true" className="w-6 shrink-0 border-t-[3px]" style={{ borderTopColor: cat.color, borderTopStyle: cat.dash.startsWith("1 ") || cat.dash.startsWith("2 ") ? "dotted" : cat.dash ? "dashed" : "solid" }} />
          <span>{cat.label}</span>
        </CheckRow>)}
        <LegendHeading>Villkorade länkar</LegendHeading>
        <Segmented<Cond> label="Villkorade länkar" value={cond} onChange={setCond} options={[{ value: "show", label: "Vanliga" }, { value: "mark", label: "Markera" }, { value: "hide", label: "Dölj" }]} />
        <p className="mt-1.5 text-xs text-muted-foreground">Villkor: admin, superadmin, tillval, Cloud, Visa mer, eget val, behörighet, demo.</p>
        <LegendHeading>Enhet</LegendHeading>
        <Segmented<Device> label="Enhet" value={device} onChange={setDevice} options={[{ value: "all", label: "Båda" }, { value: "desktop", label: "Dator" }, { value: "phone", label: "Telefon" }]} />
        <LegendHeading>Nivåer</LegendHeading>
        {[...Array(maxLevel + 1).keys()].map((level) => <CheckRow key={level} checked={levelOn(level)} onChange={(value) => setLevels((current) => ({ ...current, [level]: value }))} count={levelCount[level] || 0}>
          {`Nivå ${level} – ${LEVEL_NAME[level] ?? LEVEL_NAME[5]}`}
        </CheckRow>)}
        <LegendHeading>Rutor</LegendHeading>
        {[["step", "Steg (step=)"], ["section", "Avsnitt (section=)"], ["modal", "Popupar (Modal)"], ["public", "Publika sidor"], ...(s.services ? [["service", "Externa tjänster"]] : [])].map(([kind, label]) =>
          <CheckRow key={kind} checked={kinds[kind] !== false} onChange={(value) => setKinds((current) => ({ ...current, [kind]: value }))}>{label}</CheckRow>)}
        <CheckRow checked={showItems} onChange={setShowItems} testId="sitemap-items">Visa enskilda poster (ett jobb, en kund …)</CheckRow>
        <CheckRow checked={shared} onChange={setShared}>Delade filers länkar från alla sidor</CheckRow>
        <LegendHeading>Visa som</LegendHeading>
        <p className="text-xs text-muted-foreground">Tänder bara rutor och linjer som rollen når. I koden är Användare en medarbetare med förvalet Utföra arbete (har Kunder); QA:s medarbetare har varken Kunder eller Driftronder.</p>
        {observed ? <CheckRow checked={followRobot} onChange={setFollowRobot} testId="sitemap-follow-robot">Följ robotens rollprov</CheckRow> : null}
        {data.roles.map((r) => <p key={r} className="flex justify-between py-0.5 text-sm"><span>{ROLE_LABEL[r]}</span><span className="text-xs tabular-nums text-muted-foreground">{(robotRoles ? observed?.byRole?.[r] : s.byRole?.[r]) ?? 0} rutor</span></p>)}
        {observed ? <>
          <LegendHeading>Provat i appen</LegendHeading>
          <p className="text-xs text-muted-foreground" data-testid="sitemap-seen-summary">{`Robotens omgång ${observed.date ?? "?"} (karta ${observed.commit ?? "?"}): ${observed.counts.boxesTested} av ${observed.counts.boxes} rutor och ${observed.counts.edgesTested} av ${observed.counts.edges} linjer provade; ${observed.counts.robotNodes} rutor och ${observed.counts.robotEdges} vägar fanns bara hos roboten.`}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span aria-hidden="true" className="site-map-seen-key yes" />Provad<span aria-hidden="true" className="site-map-seen-key no" />Bara i koden<span aria-hidden="true" className="site-map-seen-key" style={{ background: catOf.get("robot")?.color }} />Bara roboten</p>
        </> : null}
        {data.serviceOwners?.length ? <>
          <LegendHeading>Externa tjänster</LegendHeading>
          <p className="text-xs text-muted-foreground">Färgen säger vems nyckel tjänsten använder. UT: Workflow anropar tjänsten. IN: tjänsten anropar Workflow.</p>
          <div className="mt-1 flex flex-col gap-1" data-testid="sitemap-service-owners">
            {data.serviceOwners.map((owner) => <span key={owner.key} className="inline-flex items-center gap-1.5 text-xs" title={owner.note}><i className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: typeVar(owner.type) }} />{owner.label}</span>)}
          </div>
        </> : null}
        <LegendHeading>Funktionsfärger</LegendHeading>
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {typesShown.map((type) => <span key={type} className="inline-flex items-center gap-1.5 text-xs"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: typeVar(type) }} />{TYPE_LABEL[type] ?? type}</span>)}
        </div>
        <LegendHeading>Så läser du kartan</LegendHeading>
        <p className="text-xs text-muted-foreground">Klicka på en ruta: dess linjer tänds och resten tonas ned. Klicka på tom yta för att släppa. Mushjulet rullar, Ctrl + mushjulet zoomar, dra för att flytta.</p>
      </aside> : null}
      <div ref={stageRef} className={cn("site-map-stage relative min-w-0 overflow-hidden", dragging && "dragging")}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setTip(null)}>
        {ctrlHint ? <p className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-foreground/80 px-3 py-1 text-xs text-background" role="status" data-testid="sitemap-ctrl-hint">Håll Ctrl för att zooma</p> : null}
        <svg ref={svgRef} role="img" aria-label="Webbplatskarta" className={cn(Boolean(selected) && "focus", anom && "anom", matches && "searching")} data-testid="sitemap-svg">{drawing}</svg>
      </div>
      {detail ? <aside className="absolute inset-y-0 right-0 z-10 w-[min(390px,calc(100%-16px))] overflow-auto border-l bg-card p-3.5 text-sm shadow-lg" data-testid="sitemap-detail">
        <IconButton label="Stäng panelen" size="icon-sm" className="float-right" onClick={() => { setDetail(null); setSelected(null); }}><X /></IconButton>
        <DetailBody detail={detail} data={data} byId={byId} catOf={catOf} anomNodes={anomNodes} viaList={viaList} observations={observations} tried={tried}
          showItems={showItems} viaText={viaText} onNode={(id) => select(id, true)} onObservation={selectVisible} />
      </aside> : null}
    </div>
    {tip ? <div className="pointer-events-none absolute z-20 max-w-[320px] rounded-md border bg-card px-2.5 py-2 text-xs text-foreground shadow-lg" style={{ left: tip.x, top: tip.y }} role="tooltip">
      <b className="font-semibold">{tip.title}</b>
      {tip.lines.map((line, index) => <div key={index} className={line.file ? "break-all font-mono text-[11px] text-muted-foreground" : undefined}>{line.text}</div>)}
    </div> : null}
  </div>;
}

function NodeLink({ id, byId, onNode }: { id: string; byId: Map<string, SitemapNode>; onNode: (id: string) => void }) {
  const n = byId.get(id);
  return <button type="button" className="inline-flex items-center gap-1.5 text-left text-primary hover:underline" onClick={() => onNode(id)}>
    <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: typeVar(n?.type ?? "neutral") }} />{n?.label ?? id}
  </button>;
}
function Pill({ children, color, tone }: { children: ReactNode; color?: string; tone?: "cond" | "bad" }) {
  return <span className={cn("ml-1 inline-block rounded-full border px-1.5 text-[10.5px] text-muted-foreground", tone === "cond" && "border-[var(--type-control)] text-[color-mix(in_srgb,var(--type-control)_70%,var(--foreground))]", tone === "bad" && "border-destructive text-destructive")}
    style={color ? { borderColor: color, color } : undefined}>{children}</span>;
}
const Files = ({ refs, max = 4, withText = false }: { refs?: SitemapRef[]; max?: number; withText?: boolean }) =>
  <>{(refs ?? []).filter(Boolean).slice(0, max).map((ref, index) => <div key={index} className="break-all font-mono text-[11.5px] text-muted-foreground">{refText(ref)}{withText && ref.text ? `  ${ref.text}` : ""}</div>)}</>;
const DetailHeading = ({ children }: { children: ReactNode }) => <h3 className="mt-4 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;

/** An outside service: what it is for, which way it talks, whose key and where it is administered – never a key value. */
function ServiceRows({ service }: { service: SitemapService }) {
  const list = (items: string[], mono = false) => (items.length ? <ul>{items.map((item) => <li key={item} className={mono ? "break-all font-mono text-[11.5px]" : undefined}>{item}</li>)}</ul> : null);
  const rows: [string, ReactNode][] = [
    ["Används till", service.purpose],
    ["Riktning", service.directionLabel],
    ["Nyckel", `${service.ownerLabel}: ${service.key}`],
    ["Nycklarnas namn", list(service.fields ?? [])],
    ["Företagets nyckel", service.company ?? null],
    ["Administreras", list(service.admin)],
    ["Används i", list(service.usedBy)],
    ["Anropar Workflow", list(service.incoming, true)],
    ["Adresser ut", service.hosts.length ? list(service.hosts, true) : service.via ?? null],
    ["Moduler", list(service.modules, true)],
  ];
  return <dl className="mb-2 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1" data-testid="sitemap-service-detail">
    {rows.filter(([, value]) => value !== null && value !== "").map(([key, value]) => <div key={key} className="contents"><dt className="text-muted-foreground">{key}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}
  </dl>;
}

function DetailBody({ detail, data, byId, catOf, anomNodes, viaList, observations, tried, showItems, viaText, onNode, onObservation }: {
  detail: Detail; data: SitemapData; byId: Map<string, SitemapNode>; catOf: Map<string, SitemapData["cats"][number]>;
  anomNodes: Map<string, { code: string; text: string }[]>; viaList: Via[]; observations: Observation[]; tried: SitemapObservation[]; showItems: boolean;
  viaText: (way: Way) => string; onNode: (id: string) => void; onObservation: (id: string) => void;
}) {
  const link = (id: string) => <NodeLink id={id} byId={byId} onNode={onNode} />;
  const edgeItem = (e: SitemapEdge, other: string, dir: "in" | "out", key: string | number) => {
    const cat = catOf.get(e.cat);
    return <li key={key} className="border-t py-1.5 first:border-t-0">
      <span>{dir === "in" ? "från " : "till "}</span>{link(other)}
      <Pill color={cat?.color}>{e.cat === "tree" ? "träd" : (cat?.label ?? e.cat).split(" (")[0]}</Pill>
      {e.cond ? <Pill tone="cond">{e.cond}</Pill> : null}
      {e.device ? <Pill>{e.device === "phone" ? "telefon" : e.device === "desktop" ? "dator" : "båda"}</Pill> : null}
      {e.dead ? <Pill tone="bad">död</Pill> : null}
      {e.roles.length < data.roles.length ? <Pill>{e.roles.length ? e.roles.map((r) => ROLE_LABEL[r]).join(", ") : "ingen roll"}</Pill> : null}
      {e.label ? <div className="text-xs text-muted-foreground">{e.label}</div> : null}
      {data.observed && e.tested !== undefined ? <div className="text-xs text-muted-foreground">{testedText(e)}</div> : null}
      <Files refs={e.refs} withText />
      {e.also?.length ? <div className="text-xs text-muted-foreground">{`Delad fil, också från: ${e.also.map((x) => byId.get(x)?.label ?? x).join(", ")}`}</div> : null}
    </li>;
  };
  if (detail.kind === "overview") {
    const s = data.stats;
    return <div data-testid="sitemap-overview">
      <p className="text-base font-semibold">Översikt</p>
      <p className="mb-2 text-muted-foreground">Klicka på en ruta eller linje för detaljer. Visa avvikelser sätter märken på rutorna: 0 ingen väg in · 2 dubbel väg · D bara dator · T bara telefon · X död · G gammal adress · N samma namn.</p>
      <dl className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-0.5">
        {([["Sidor", s.pages], ["Rutor", s.nodes], ["Linjer", s.edges], ["Popupar", s.modals], ["Externa tjänster", s.services ?? 0], ["Filer lästa", s.scannedFiles], ["Dynamiska", `${s.dynamicLinks} adresser med ?view=\${…} (ritas inte)`]] as const).map(([k, v]) =>
          <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{String(v)}</dd></div>)}
      </dl>
      {data.observed ? <>
        <DetailHeading>{`Provat i appen (${tried.length})`}</DetailHeading>
        <p className="text-xs text-muted-foreground">{`Klickroboten ${data.observed.date ?? ""} mot ${data.observed.target ?? "QA"}; kartan från ${data.observed.commit ?? "?"}. Fynd: ${data.observed.counts.fixed} rättade, ${data.observed.counts.open} öppna, ${data.observed.counts.dismissed} avfärdade.`}</p>
        <ul data-testid="sitemap-tried">
          {tried.map((row, index) => {
            const n = byId.get(row.id);
            return <li key={index} className="border-t py-1.5 first:border-t-0" data-status={row.status}>
              <div className="text-xs text-muted-foreground">{`Provat i appen · ${SEEN_KIND[row.kind] ?? row.kind}`}<Pill tone={OPEN_STATUS.has(row.status) ? "bad" : undefined}>{row.status}</Pill>{row.commit ? <Pill>{row.commit}</Pill> : null}</div>
              <button type="button" className="inline-flex items-center gap-1.5 text-left text-primary hover:underline" onClick={() => onObservation(row.id)}>
                <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: typeVar(n?.type ?? "neutral") }} />{n?.label ?? row.id}
              </button>
              <div>{row.title}</div>
              {row.note ? <div className="text-xs text-muted-foreground">{row.note}</div> : null}
              {row.runs.length ? <div className="text-xs text-muted-foreground">{runsText(row.runs)}</div> : null}
              {row.address ? <div className="break-all font-mono text-[11.5px] text-muted-foreground">{row.address}{row.also?.length ? ` och ${row.also.length - 1} adresser till` : ""}</div> : null}
            </li>;
          })}
        </ul>
      </> : null}
      <DetailHeading>{`Iakttagelser i koden (${observations.length})`}</DetailHeading>
      <ul>
        {observations.map((row, index) => {
          const n = byId.get(row.id);
          return <li key={index} className="border-t py-1.5 first:border-t-0">
            <div className="text-xs text-muted-foreground">{OBS_KIND[row.kind]}</div>
            <button type="button" className="inline-flex items-center gap-1.5 text-left text-primary hover:underline" onClick={() => onObservation(row.id)}>
              <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: typeVar(n?.type ?? "neutral") }} />{n?.label ?? row.id}
            </button>
            {n?.item && !showItems ? <div className="text-xs text-muted-foreground">(i en enskild post – kryssa Visa enskilda poster för att se den)</div> : null}
            {row.text ? <div>{row.text}</div> : null}
            <Files refs={row.refs} max={3} />
          </li>;
        })}
        {!observations.length ? <li className="text-xs text-muted-foreground">Inga.</li> : null}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Kartan räknas fram när appen byggs (npm run build). Lokalt: npm run sitemap.</p>
    </div>;
  }
  if (detail.kind === "via") {
    const via = viaList[detail.index];
    if (!via) return null;
    return <div>
      <p className="text-base font-semibold">Via en enskild post</p>
      <p className="mb-2 text-muted-foreground">{`${via.ways.length} ${via.ways.length === 1 ? "väg" : "vägar"} från ${byId.get(via.from)?.label} till ${byId.get(via.to)?.label}`}</p>
      <ul>{via.ways.map((way, index) => <li key={index} className="border-t py-1.5 first:border-t-0">
        <div>{viaText(way)}</div>
        <div className="text-xs text-muted-foreground">{`${catOf.get(way.edge.cat)?.label ?? way.edge.cat}${way.edge.label ? ` · ${way.edge.label}` : ""}`}</div>
        <Files refs={way.edge.refs} max={3} />
      </li>)}</ul>
    </div>;
  }
  if (detail.kind === "edge") {
    const e = data.edges[detail.index];
    if (!e) return null;
    return <div>
      <p className="text-base font-semibold">{catOf.get(e.cat)?.label ?? e.cat}</p>
      <p className="mb-2 text-muted-foreground">{`${e.label ?? ""}${e.cond ? ` · villkor: ${e.cond}` : ""}`}</p>
      <ul>{edgeItem(e, detail.from || e.from, "in", "in")}{edgeItem({ ...e, refs: [] }, e.to, "out", "out")}</ul>
    </div>;
  }
  const n = byId.get(detail.id);
  if (!n) return null;
  const incoming = data.edges.filter((e) => e.to === n.id);
  const outgoing = data.edges.filter((e) => e.from === n.id || (e.also ?? []).includes(n.id));
  const via = viaList.filter((v) => v.from === n.id || v.to === n.id);
  const marks = anomNodes.get(n.id) ?? [];
  const row = (k: string, v: ReactNode) => (v === undefined || v === null || v === "" ? null : <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>);
  const group = (title: string, list: SitemapEdge[], dir: "in" | "out") => <>
    <DetailHeading>{`${title} (${list.length})`}</DetailHeading>
    {list.length ? <ul>{[...list].sort((a, b) => Number(a.cat === "tree") - Number(b.cat === "tree")).map((e, index) => edgeItem(e, dir === "in" ? e.from : e.to, dir, index))}</ul> : <p className="text-xs text-muted-foreground">Inga.</p>}
  </>;
  return <div data-testid="sitemap-node-detail">
    <p className="text-base font-semibold">{n.label}</p>
    <p className="mb-2 text-muted-foreground">{`${KIND_LABEL[n.kind] ?? n.kind} · nivå ${n.level} · ${n.service ? n.service.ownerLabel : TYPE_LABEL[n.type] ?? n.type}`}</p>
    {detail.note ? <p className="mb-2 text-xs text-muted-foreground">{detail.note}</p> : null}
    {n.service ? <ServiceRows service={n.service} /> : null}
    <dl className="mb-2 grid grid-cols-[92px_1fr] gap-x-2 gap-y-0.5">
      {row("Adress", n.address)}{row("Vy", n.view)}{row("Villkor", n.cond)}{row("Når", n.reach)}
      {n.service ? null : row("Roller", n.roles.length ? n.roles.map((r) => ROLE_LABEL[r]).join(", ") : "Ingen")}
      {row("Provat", data.observed ? testedText(n) : null)}
      {row("I appen", n.appRoles && n.appRoles.join() !== n.roles.join() ? (n.appRoles.length ? n.appRoles.map((r) => ROLE_LABEL[r]).join(", ") : "Ingen") : null)}
      {row("Rollprov", n.probe ? Object.entries(n.probe).map(([r, v]) => `${ROLE_LABEL[r as SitemapRole]}: ${v}`).join(" · ") : null)}
      {row("Telefon", n.phoneHidden ? "Dold i appvyn (NATIVE_HIDDEN_VIEWS), bara med Visa mer" : null)}
      {row("validViews", n.valid === false ? "Saknas i app/page.tsx" : null)}
      {row("Demo", n.inDemo ? "Finns i demon" : null)}
      {n.service ? null : row("Not", n.note)}
      {row("Förälder", n.parent ? link(n.parent) : null)}
    </dl>
    {tried.some((t) => t.id === n.id) ? <><DetailHeading>Provat i appen</DetailHeading><ul>{tried.filter((t) => t.id === n.id).map((t, index) => <li key={index} className="border-t py-1.5 first:border-t-0">
      {t.title}<Pill tone={OPEN_STATUS.has(t.status) ? "bad" : undefined}>{t.status}</Pill>{t.runs.length ? <div className="text-xs text-muted-foreground">{runsText(t.runs)}</div> : null}</li>)}</ul></> : null}
    {marks.length ? <><DetailHeading>Avvikelser</DetailHeading><ul>{marks.map((a, index) => <li key={index} className="border-t py-1.5 first:border-t-0">{a.text}</li>)}</ul></> : null}
    {n.refs.length ? <><DetailHeading>Definieras i</DetailHeading><ul>{n.refs.map((r, index) => <li key={index} className="border-t py-1.5 first:border-t-0"><Files refs={[r]} />{r.text ? <div className="text-xs text-muted-foreground">{r.text}</div> : null}</li>)}</ul></> : null}
    {group("Vägar hit", incoming, "in")}
    {group("Vägar härifrån", outgoing, "out")}
    {via.length ? <><DetailHeading>{`Via enskilda poster (${via.reduce((t, v) => t + v.ways.length, 0)})`}</DetailHeading>
      <ul>{via.flatMap((v, vi) => v.ways.map((way, wi) => <li key={`${vi}-${wi}`} className="border-t py-1.5 first:border-t-0"><div>{viaText(way)}</div><Files refs={way.edge.refs} max={1} /></li>))}</ul></> : null}
  </div>;
}

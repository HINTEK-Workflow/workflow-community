"use client";

import { createElement, useId, useMemo, type ReactNode } from "react";
import { animationCss, type AnimationSpec } from "@/lib/machine/simulator/surface/animation";
import type { DeviceState } from "@/lib/machine/simulator/surface/engine";
import { parseSafeSvg, svgBox, type SvgNode } from "@/lib/machine/simulator/surface/svg-safe";

// PLC-apparater, animering (2026-11-07): the drawing side of animation.ts. A named part is a <g data-part> with no transform of its
// own, so the rules' CSS moves it from where it is drawn; the style is scoped to the device's own class and written while rendering,
// so nothing jumps after the page has shown. An uploaded SVG is drawn from its checked tree (svg-safe.ts), never as markup.

/** A class of its own for one drawn device, for its animation's CSS. */
export function useAnimationScope() {
  return `plc-a-${useId().replace(/[^A-Za-z0-9]/g, "")}`;
}

/** The animation of one device: CSS for its parts, from its spec and its state. */
export function AnimationStyle({ scope, spec, state }: { scope: string; spec: AnimationSpec; state: DeviceState }) {
  const css = animationCss(scope, spec, state);
  return css ? <style>{css}</style> : null;
}

/** A named part of a picture that a spec can animate. */
export const Part = ({ name, children }: { name: string; children: ReactNode }) => <g data-part={name}>{children}</g>;

const camel = (name: string) => (name.startsWith("data-") ? name : name.replace(/[-:]([a-z])/g, (_, letter: string) => letter.toUpperCase()));
const DRAWN = new Set(["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image"]);

/** The values a "show" rule writes into the picture's parts, by part id (animationTexts). */
export type PartTexts = ReadonlyMap<string, string>;

function renderNode(node: SvgNode, prefix: string, key: number, inDefs: boolean, texts: PartTexts | undefined): ReactNode {
  if ("text" in node) return node.text;
  const props: Record<string, string | number> = { key };
  for (const [name, value] of Object.entries(node.attrs)) {
    if (name === "id") props.id = `${prefix}-${value}`;
    // A photo layer's embedded data stays as it is; every other reference is made the device's own.
    else if (name === "href") props.href = value.startsWith("data:") ? value : `#${prefix}-${value.slice(1)}`;
    else props[camel(name)] = value.replace(/url\(\s*['"]?#([A-Za-z_][A-Za-z0-9_.-]*)['"]?\s*\)/g, `url(#${prefix}-$1)`);
  }
  const defs = inDefs || node.tag === "defs" || node.tag === "linearGradient" || node.tag === "radialGradient" || node.tag === "clipPath";
  const shown = node.attrs.id ? texts?.get(node.attrs.id) : undefined;
  const children = shown !== undefined ? [shown] : node.children.map((child, index) => renderNode(child, prefix, index, defs, texts));
  const element = createElement(node.tag, props, ...children);
  // A part keeps its own transform: the animation moves a group round it.
  return !defs && node.attrs.id && DRAWN.has(node.tag) ? <g key={key} data-part={node.attrs.id}>{element}</g> : element;
}

/** An uploaded SVG picture inside the plate, drawn from its allowed tree, its ids made the device's own; `texts` are the values its "show" rules write. */
export function SafeSvgPicture({ svg, x, y, width, height, texts }: { svg: string; x: number; y: number; width: number; height: number; texts?: PartTexts }) {
  const prefix = `p${useId().replace(/[^A-Za-z0-9]/g, "")}`;
  const parsed = useMemo(() => parseSafeSvg(svg), [svg]);
  if (!parsed.ok) return null;
  const [bx, by, bw, bh] = svgBox(parsed.root);
  const children = "children" in parsed.root ? parsed.root.children.map((child, index) => renderNode(child, prefix, index, false, texts)) : null;
  return <svg x={x} y={y} width={width} height={height} viewBox={`${bx} ${by} ${bw} ${bh}`} preserveAspectRatio="xMidYMid meet" overflow="visible" data-testid="plc-device-svg">{children}</svg>;
}

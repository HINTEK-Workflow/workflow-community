import type { DeviceState, Plant } from "@/lib/machine/simulator/surface/engine";
import { animationTexts } from "@/lib/machine/simulator/surface/animation";
import { animationFor, imageHref, type DesignImage, type DeviceDesign } from "@/lib/machine/simulator/surface/device-designs";
import { type PartTexts, SafeSvgPicture } from "./animated";

/** Whether the device's state is "on" for a design's picture: lit, running, energised or pressed. */
const isOn = (state: DeviceState) => Boolean(state.energised || state.on || state.pressed);

const Picture = ({ image, width, height, className, style, texts }: { image: DesignImage; width: number; height: number; className?: string; style?: React.CSSProperties; texts?: PartTexts }) => image.format === "svg"
  ? <g className={className} style={style}><SafeSvgPicture svg={image.data} x={3} y={3} width={width - 6} height={height - 6} texts={texts} /></g>
  : <image href={imageHref(image)} x={3} y={3} width={width - 6} height={height - 6} preserveAspectRatio="xMidYMid meet" className={className} style={style} />;

/**
 * PLC-apparater (2026-11-06): a device the product owner gave a picture of their own. The picture fills the plate and shows
 * the state as the design says (a glow, a slow turn, or a second picture); an SVG is drawn from its checked tree so the animation can
 * move its named parts (2026-11-07) and write its values into them ("show", 2026-11-09). The controls a hand touches stay the simulator's own.
 */
export function DesignPicture({ design, width, height, state, plant }: { design: DeviceDesign; width: number; height: number; state: DeviceState; plant?: Plant }) {
  const on = isOn(state);
  const image = design.stateView === "swap" && on && design.imageOn ? design.imageOn : design.image!;
  const spin = design.stateView === "rotate" && on;
  const texts = image.format === "svg" ? animationTexts(animationFor(design.function, design), state, design.function, plant) : undefined;
  return <g pointerEvents="none" data-testid="plc-device-picture">
    {design.stateView === "glow" && on ? <ellipse cx={width / 2} cy={height / 2} rx={width * 0.62} ry={height * 0.62} fill="url(#plc-halo-yellow)" opacity={0.85} /> : null}
    <Picture image={image} width={width} height={height} className={spin ? "plc-design-spin" : undefined} style={spin ? { transformOrigin: `${width / 2}px ${height / 2}px` } : undefined} texts={texts} />
  </g>;
}

export const themeNames = ["light", "dark", "blue", "customer"] as const;
export type ThemeName = (typeof themeNames)[number];

export const CUSTOMER_THEME_PROPERTIES = [
  "--primary",
  "--primary-hover",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--ring",
  "--selection",
] as const;

type Rgb = { r: number; g: number; b: number };

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function parseHex(value: string): Rgb | null {
  const match = /^#?([\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb) {
  return `#${[r, g, b]
    .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function rgbToHsl({ r, g, b }: Rgb) {
  const [red, green, blue] = [r, g, b].map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 210, s: 0, l: lightness };
  const delta = max - min;
  const saturation =
    lightness > 0.5
      ? delta / (2 - max - min)
      : delta / (max + min);
  const hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return { h: hue * 60, s: saturation, l: lightness };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] =
    section < 1
      ? [chroma, x, 0]
      : section < 2
        ? [x, chroma, 0]
        : section < 3
          ? [0, chroma, x]
          : section < 4
            ? [0, x, chroma]
            : section < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = l - chroma / 2;
  return { r: (red + m) * 255, g: (green + m) * 255, b: (blue + m) * 255 };
}

function mix(first: Rgb, second: Rgb, amount: number): Rgb {
  return {
    r: first.r * (1 - amount) + second.r * amount,
    g: first.g * (1 - amount) + second.g * amount,
    b: first.b * (1 - amount) + second.b * amount,
  };
}

function relativeLuminance({ r, g, b }: Rgb) {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(first: string, second: string) {
  const a = parseHex(first);
  const b = parseHex(second);
  if (!a || !b) return 1;
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

export function normalizeCustomerPrimary(value: string) {
  const parsed = parseHex(value);
  if (!parsed) return null;
  const hsl = rgbToHsl(parsed);
  const saturation = hsl.s < 0.12 ? 0.42 : clamp(hsl.s, 0.38, 0.82);
  const lightness = clamp(hsl.l, 0.25, 0.58);
  return rgbToHex(hslToRgb(hsl.h, saturation, lightness));
}

export function customerThemeVariables(value: string) {
  const normalized = normalizeCustomerPrimary(value);
  if (!normalized) return null;
  const primary = parseHex(normalized)!;
  const black = "#000000";
  const white = "#FFFFFF";
  const foreground =
    contrastRatio(normalized, white) >= 4.5 ? white : black;
  const secondaryForegroundCandidate = rgbToHex(
    hslToRgb(rgbToHsl(primary).h, clamp(rgbToHsl(primary).s, 0.42, 0.78), 0.28),
  );
  const secondary = rgbToHex(
    mix(primary, { r: 255, g: 255, b: 255 }, 0.9),
  );
  const accent = rgbToHex(
    mix(primary, { r: 255, g: 255, b: 255 }, 0.84),
  );
  const softForeground =
    contrastRatio(secondary, secondaryForegroundCandidate) >= 4.5 &&
    contrastRatio(accent, secondaryForegroundCandidate) >= 4.5
      ? secondaryForegroundCandidate
      : black;
  return {
    "--primary": normalized,
    "--primary-hover": rgbToHex(mix(primary, { r: 17, g: 24, b: 39 }, 0.16)),
    "--primary-foreground": foreground,
    "--secondary": secondary,
    "--secondary-foreground": softForeground,
    "--accent": accent,
    "--accent-foreground": softForeground,
    "--ring": normalized,
    "--selection": rgbToHex(mix(primary, { r: 255, g: 255, b: 255 }, 0.72)),
  } satisfies Record<(typeof CUSTOMER_THEME_PROPERTIES)[number], string>;
}

export function applyTheme(
  element: HTMLElement,
  theme: ThemeName,
  customerPrimary?: string | null,
) {
  element.dataset.theme = theme;
  for (const property of CUSTOMER_THEME_PROPERTIES)
    element.style.removeProperty(property);
  if (theme !== "customer" || !customerPrimary) return;
  const variables = customerThemeVariables(customerPrimary);
  if (!variables) return;
  for (const [property, value] of Object.entries(variables))
    element.style.setProperty(property, value);
}

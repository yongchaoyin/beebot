/** BeeBot Presence · 2026-09-22
 * Owned, deterministic colleague portraits. Legacy persona keys remain data
 * identifiers, not literal bees, antennae, hexagons, or brand-yellow artwork. */
export const SHAPES = [
  "M32 8C49 8 57 19 56 35C55 51 45 57 31 56C16 57 7 49 8 34C7 19 17 8 32 8Z",
  "M21 9H43Q55 9 55 22V43Q55 56 42 56H22Q9 56 9 43V22Q9 9 21 9Z",
  "M31 7C46 6 57 18 57 33C57 48 46 58 30 57C15 57 7 47 7 33C7 19 17 9 31 7Z",
  "M23 10H41Q49 10 52 20L58 41Q61 55 46 56H18Q3 55 6 41L12 20Q15 10 23 10Z",
  "M32 6C44 6 51 15 51 28V37C51 50 43 58 32 58C21 58 13 50 13 37V28C13 15 20 6 32 6Z",
  "M18 14H46C55 14 60 21 59 33C60 47 52 54 42 54H22C11 54 4 47 5 33C4 21 10 14 18 14Z",
] as const;
export const COLORS: Record<string, string> = {
  black: "#B8C1D0", gray: "#C4CBD5", grey: "#C4CBD5", yellow: "#C4CBD5",
  brown: "#C6BFC9", orange: "#D6C2BC", red: "#D9B4BE", pink: "#D4BACD",
  magenta: "#D4BACD", violet: "#C2BBDE", purple: "#C2BBDE", blue: "#AFC5E9",
  cyan: "#B4D2D9", teal: "#B4D2D9", green: "#BDD1C7", lime: "#BDD1C7",
};
const KEYS = ["blob", "tablet", "pebble", "wedge", "cloud", "squircle", "teardrop", "hex"];
const VARIANTS = [0, 1, 2, 3, 4, 5, 4, 5];
export function characterVariant(shape: string): number {
  if (typeof shape !== "string") return 0;
  const index = KEYS.indexOf(shape);
  if (index >= 0) return VARIANTS[index];
  let hash = 0;
  for (const char of shape) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash % SHAPES.length;
}
export type AvatarPart = "body" | "eyes" | "mouth" | "detail";
export type AvatarLayer = { tag: "path" | "rect" | "ellipse"; part: AvatarPart; attrs: Record<string, string | number> };
export function characterLayers(shape = "blob", color = "gray"): AvatarLayer[] {
  const variant = characterVariant(shape);
  const fill = Object.hasOwn(COLORS, color) ? COLORS[color] : COLORS.gray;
  const eyesY = variant === 5 ? 29 : 28;
  return [
    { tag: "path", part: "body", attrs: { d: SHAPES[variant], fill } },
    { tag: "path", part: "body", attrs: { d: variant === 4 ? "M20 25Q20 13 31 12" : "M15 25Q18 15 29 14", fill: "none", stroke: "#FFFFFF", "stroke-opacity": .32, "stroke-width": 2.4, "stroke-linecap": "round" } },
    { tag: "rect", part: "eyes", attrs: { x: 22, y: eyesY, width: 5, height: variant === 1 ? 8 : 7, rx: 2.5, fill: "#273245" } },
    { tag: "rect", part: "eyes", attrs: { x: 37, y: eyesY, width: 5, height: variant === 1 ? 8 : 7, rx: 2.5, fill: "#273245" } },
    { tag: "path", part: "mouth", attrs: { d: variant === 1 || variant === 4 ? "M29 42H35" : "M28 41Q32 44 36 41", fill: "none", stroke: "#273245", "stroke-width": 1.8, "stroke-linecap": "round" } },
    ...(variant === 1 ? [{ tag: "path" as const, part: "detail" as const, attrs: { d: "M19 25H29M35 25H45", fill: "none", stroke: "#273245", "stroke-opacity": .55, "stroke-width": 1.3, "stroke-linecap": "round" } }] : []),
  ];
}
export const AVATAR_PARTS: readonly AvatarPart[] = ["body", "detail", "eyes", "mouth"];
export const SVG_ATTRIBUTES: Record<string, string> = { "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap", "stroke-opacity": "strokeOpacity" };
/** Shared by the static native creation picker and group portraits. No HTML
 * interpolation, network artwork, arbitrary colors or animation in previews. */
export function createCharacterSvg(document: Document, shape: string, color: string, size = 32): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  const dimension = Number.isFinite(size) ? Math.max(1, Math.min(1024, size)) : 32;
  svg.setAttribute("width", String(dimension)); svg.setAttribute("height", String(dimension));
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  svg.classList.add("bee-character", "presence-avatar");
  svg.dataset.variant = String(characterVariant(shape)); svg.dataset.presence = "idle"; svg.dataset.motion = "off";
  for (const layer of characterLayers(shape, color)) {
    const node = document.createElementNS(ns, layer.tag);
    for (const [key, value] of Object.entries(layer.attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  }
  return svg;
}

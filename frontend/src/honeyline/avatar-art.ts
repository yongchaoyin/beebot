/** Original BeeBot geometry. Existing persona keys select a distinct silhouette;
 * none of the upstream blob paths or vendor marks are used. */
export const SHAPES = [
  "M19 12h26c9 0 14 8 14 18v9c0 10-8 16-18 16H23C12 55 5 49 5 39v-9c0-10 5-18 14-18Z",
  "M17 15h30c7 0 12 5 12 12v19c0 7-5 11-12 11H17C10 57 5 53 5 46V27c0-7 5-12 12-12Z",
  "M32 9c17 0 27 12 27 27S48 57 32 57 5 51 5 36 15 9 32 9Z",
  "M21 12h22c8 0 11 8 13 17l3 12c2 8-4 15-13 15H18C9 56 3 49 5 41l3-12c2-9 5-17 13-17Z",
];
export const COLORS: Record<string, string> = {
  black: "#B4BDAB", brown: "#D1BBA4", violet: "#BCB5DD", magenta: "#D9ACC6", yellow: "#E6B84A", orange: "#E4B293", red: "#E4A09A", pink: "#D9ACC6",
  purple: "#BCB5DD", blue: "#A6C3D3", cyan: "#ACD3CB", teal: "#ACD3CB",
  green: "#B9CCA2", lime: "#CFD3A1", gray: "#C6C9BD", grey: "#C6C9BD",
};
const KEYS = ["blob", "tablet", "pebble", "wedge", "cloud", "squircle", "teardrop", "hex"];
export function characterVariant(shape: string): number {
  if (typeof shape !== "string") return 0;
  const known = KEYS.indexOf(shape);
  if (known >= 0) return known % SHAPES.length;
  let hash = 0;
  for (const char of shape) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return hash % SHAPES.length;
}

export type AvatarLayer = { tag: "path" | "rect"; attrs: Record<string, string | number> };
export function characterLayers(shape = "blob", color = "yellow"): AvatarLayer[] {
  const variant = characterVariant(shape);
  return [
    { tag: "path", attrs: { d: SHAPES[variant], fill: Object.hasOwn(COLORS, color) ? COLORS[color] : COLORS.yellow } },
    { tag: "path", attrs: { d: variant % 2 ? "M25 15l-3-7m16 7 3-7" : "M24 13 20 7m20 6 4-6", fill: "none", stroke: "#42483A", "stroke-width": 2.5, "stroke-linecap": "round" } },
    { tag: "rect", attrs: { x: 21, y: 28, width: 5, height: variant === 1 ? 8 : 7, rx: 2.5, fill: "#242621" } },
    { tag: "rect", attrs: { x: 38, y: 28, width: 5, height: variant === 1 ? 8 : 7, rx: 2.5, fill: "#242621" } },
    ...(variant === 2 ? [{ tag: "path" as const, attrs: { d: "M29 42q3 3 6 0", fill: "none", stroke: "#42483A", "stroke-width": 1.8, "stroke-linecap": "round" } }] : []),
    ...(variant === 1 ? [{ tag: "path" as const, attrs: { d: "M17 23h12m6 0h12", fill: "none", stroke: "#42483A", "stroke-width": 1.5, "stroke-linecap": "round" } }] : []),
  ];
}
/** DOM adapters use the same owned artwork, without React or HTML interpolation. */
export function createCharacterSvg(document: Document, shape: string, color: string, size = 32): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  const dimension = Number.isFinite(size) ? Math.max(1, Math.min(1024, size)) : 32;
  svg.setAttribute("width", String(dimension)); svg.setAttribute("height", String(dimension));
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  svg.classList.add("bee-character"); svg.dataset.variant = String(characterVariant(shape));
  for (const layer of characterLayers(shape, color)) {
    const node = document.createElementNS(ns, layer.tag);
    for (const [key, value] of Object.entries(layer.attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  }
  return svg;
}

export const AVATAR_SHAPES = ["blob", "tablet", "pebble", "wedge", "cloud", "squircle"] as const;
/** Original, neutral digital colleagues. No antennae, insect motifs or vendor paths.
 * Persisted persona keys remain compatible; artwork and palettes are owned here. */
export const SHAPES = [
  "M18 10C9 10 5 19 5 32s5 23 17 23h20c12 0 17-9 17-22S54 10 43 10Z",
  "M17 12h30c8 0 12 5 12 13v20c0 8-5 12-13 12H18C9 57 5 52 5 44V26c0-9 4-14 12-14Z",
  "M32 7C18 7 6 19 6 34s10 23 26 23 26-9 26-23S46 7 32 7Z",
  "M24 10c-6 0-10 5-13 14L5 42c-3 8 3 14 12 14h30c9 0 15-6 12-14l-6-18c-3-9-7-14-13-14Z",
  "M17 13C9 17 6 26 8 37c2 13 10 20 23 20s24-6 26-19c2-11-3-19-12-24-9-5-20-5-28-1Z",
  "M18 8h28c8 0 12 7 12 17v17c0 10-7 15-17 15H23C13 57 6 52 6 42V25C6 15 10 8 18 8Z",
] as const;
export const COLORS: Record<string, string> = {
  black: "#B6C0D0", brown: "#C8BFC4", violet: "#C4BBDE", magenta: "#D7BDC9",
  // A legacy yellow/orange preference must not resurrect the retired theme.
  yellow: "#A8BBD2", orange: "#C8BEC8", red: "#DCBCC0", pink: "#D7BDC9",
  purple: "#C4BBDE", blue: "#ADC3EA", cyan: "#ADD0DB", teal: "#B6CDC7",
  green: "#B6CDC7", lime: "#C0CEC8", gray: "#BEC5D0", grey: "#BEC5D0",
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
export type AvatarPart = "body" | "detail" | "eyes" | "mouth";
export type AvatarLayer = { part: AvatarPart; tag: "path" | "rect"; attrs: Record<string, string | number> };
export function characterLayers(shape = "blob", color = "blue"): AvatarLayer[] {
  const variant = characterVariant(shape), ink = "#273347";
  const eyeY = variant === 5 ? 27 : 28, eyeHeight = variant === 1 ? 8 : 7;
  return [
    { part: "body", tag: "path", attrs: { d: SHAPES[variant], fill: Object.hasOwn(COLORS, color) ? COLORS[color] : COLORS.blue } },
    { part: "detail", tag: "path", attrs: { d: variant % 2 ? "M15 22q0-5 6-5" : "M15 24q1-6 7-7", fill: "none", stroke: "#FFFFFF", "stroke-opacity": .35, "stroke-width": 2, "stroke-linecap": "round" } },
    { part: "eyes", tag: "rect", attrs: { x: 21, y: eyeY, width: 4.5, height: eyeHeight, rx: 2.25, fill: ink } },
    { part: "eyes", tag: "rect", attrs: { x: 38.5, y: eyeY, width: 4.5, height: eyeHeight, rx: 2.25, fill: ink } },
    { part: "mouth", tag: "path", attrs: { d: variant === 1 ? "M29 42h6" : variant === 4 ? "M29 41q3 2 6-1" : "M29 41q3 3 6 0", fill: "none", stroke: ink, "stroke-width": 1.7, "stroke-linecap": "round" } },
  ];
}
/** The DOM adapter and React factory share exact geometry and part names. */
export function createCharacterSvg(document: Document, shape: string, color: string, size = 32): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  const dimension = Number.isFinite(size) ? Math.max(1, Math.min(1024, size)) : 32;
  svg.setAttribute("viewBox", "0 0 64 64"); svg.setAttribute("width", String(dimension)); svg.setAttribute("height", String(dimension));
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  svg.classList.add("bb-character"); svg.dataset.variant = String(characterVariant(shape)); svg.dataset.state = "idle";
  const body = document.createElementNS(ns, "g"); body.classList.add("bb-character__body"); svg.append(body);
  const face = document.createElementNS(ns, "g"); face.classList.add("bb-character__face");
  const eyes = document.createElementNS(ns, "g"); eyes.classList.add("bb-character__eyes"); face.append(eyes);
  for (const layer of characterLayers(shape, color)) {
    const node = document.createElementNS(ns, layer.tag);
    for (const [key, value] of Object.entries(layer.attrs)) node.setAttribute(key, String(value));
    node.dataset.part = layer.part;
    if (layer.part === "mouth") node.classList.add("bb-character__mouth");
    (layer.part === "eyes" ? eyes : layer.part === "mouth" ? face : body).append(node);
  }
  body.append(face); return svg;
}

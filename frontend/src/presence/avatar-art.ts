import { expressionPaths, expressionPose, type AvatarExpression } from "./avatar-expression.ts";
import { AVATAR_SHAPES, PERSONA_SHAPE_PATHS } from "./avatar-shapes.ts";
export { AVATAR_SHAPES } from "./avatar-shapes.ts";

/** Pinned Grok Bot palette (PQ). Avatar identity is independent of UI theme. */
export const AVATAR_PALETTE = [
  { id: "black", label: "Black", value: "#000000" },
  { id: "brown", label: "Brown", value: "#936439" },
  { id: "red", label: "Red", value: "#FF263C" },
  { id: "orange", label: "Orange", value: "#FF6700" },
  { id: "yellow", label: "Yellow", value: "#FF9800" },
  { id: "green", label: "Green", value: "#00C972" },
  { id: "cyan", label: "Cyan", value: "#00BCA6" },
  { id: "blue", label: "Blue", value: "#1084FE" },
  { id: "violet", label: "Violet", value: "#9159FE" },
  { id: "magenta", label: "Magenta", value: "#FF309B" },
  { id: "gray", label: "Gray", value: "#777777" },
] as const;
const COLOR_ZH: Record<string, string> = {
  black: "黑色", brown: "棕色", red: "红色", orange: "橙色", yellow: "黄色",
  green: "绿色", cyan: "青色", blue: "蓝色", violet: "紫色", magenta: "洋红色", gray: "灰色",
};
export const COLOR_LABELS: Record<string, readonly [string, string]> = Object.fromEntries(
  AVATAR_PALETTE.map(color => [color.id, [color.label, COLOR_ZH[color.id]] as const]),
);
export const SHAPE_LABELS: Record<string, readonly [string, string]> = {
  blob: ["Blob", "圆团"], pebble: ["Pebble", "卵石"], squircle: ["Squircle", "圆角方形"],
  tablet: ["Tablet", "胶囊"], wedge: ["Wedge", "圆角三角"], hex: ["Hexagon", "六边形"],
  cloud: ["Cloud", "云朵"], teardrop: ["Teardrop", "水滴"],
};
export const COLORS: Record<string, string> = {
  ...Object.fromEntries(AVATAR_PALETTE.map(color => [color.id, color.value])),
  // Read aliases without rewriting saved IDs or exposing duplicate categories.
  pink: "#FF309B", purple: "#9159FE", teal: "#00BCA6", lime: "#00C972", grey: "#777777",
};
export const SHAPES = AVATAR_SHAPES.map(shape => PERSONA_SHAPE_PATHS[shape]);
const LEGACY_SHAPES = ["blob", "tablet", "pebble", "wedge", "cloud", "squircle"] as const;
export function characterVariant(shape: string): number {
  if (typeof shape !== "string") return 0;
  const known = (AVATAR_SHAPES as readonly string[]).indexOf(shape);
  if (known >= 0) return known;
  let hash = 0;
  for (const char of shape) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return (AVATAR_SHAPES as readonly string[]).indexOf(LEGACY_SHAPES[hash % LEGACY_SHAPES.length]);
}
/** White/black faces and selection ticks remain legible on every palette color. */
export function avatarForeground(color: string): string {
  const hex = Object.hasOwn(COLORS, color) ? COLORS[color] : COLORS.blue;
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? "#000000" : "#FFFFFF";
}
export type AvatarPart = "body" | "detail" | "eyes" | "mouth";
export type AvatarLayer = { part: AvatarPart; tag: "path" | "rect"; attrs: Record<string, string | number> };
export function characterLayers(shape = "blob", color = "blue", expression: AvatarExpression = "idle", size = 32): AvatarLayer[] {
  const variant = characterVariant(shape), ink = avatarForeground(color);
  const kind = AVATAR_SHAPES[variant];
  const paths = expressionPaths(expressionPose(expression), kind, size);
  return [
    { part: "body", tag: "path", attrs: { d: SHAPES[variant], transform: `scale(${64 / 259}) translate(15 15)`, fill: Object.hasOwn(COLORS, color) ? COLORS[color] : COLORS.blue } },
    { part: "detail", tag: "path", attrs: { d: "M25 21q1-3 5-4", fill: "none", stroke: "#FFFFFF", "stroke-opacity": .25, "stroke-width": 2, "stroke-linecap": "round" } },
    { part: "eyes", tag: "path", attrs: { d: paths.left, fill: ink } },
    { part: "eyes", tag: "path", attrs: { d: paths.right, fill: ink } },
    { part: "mouth", tag: "path", attrs: { d: paths.mouth, fill: ink } },
  ];
}
/** The DOM adapter and React factory share exact geometry and part names. */
export function createCharacterSvg(document: Document, shape: string, color: string, size = 32): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  const dimension = Number.isFinite(size) ? Math.max(1, Math.min(1024, size)) : 32;
  svg.setAttribute("viewBox", "0 0 64 64"); svg.setAttribute("width", String(dimension)); svg.setAttribute("height", String(dimension));
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  svg.classList.add("bb-character"); svg.dataset.variant = String(characterVariant(shape)); svg.dataset.state = "idle"; svg.dataset.expression = "idle";
  const body = document.createElementNS(ns, "g"); body.classList.add("bb-character__body"); svg.append(body);
  const face = document.createElementNS(ns, "g"); face.classList.add("bb-character__face");
  const gaze = document.createElementNS(ns, "g"); gaze.classList.add("bb-character__gaze"); face.append(gaze);
  const eyes = document.createElementNS(ns, "g"); eyes.classList.add("bb-character__eyes"); gaze.append(eyes);
  for (const layer of characterLayers(shape, color, "idle", dimension)) {
    const node = document.createElementNS(ns, layer.tag);
    for (const [key, value] of Object.entries(layer.attrs)) node.setAttribute(key, String(value));
    node.dataset.part = layer.part;
    if (layer.part === "mouth") node.classList.add("bb-character__mouth");
    (layer.part === "eyes" ? eyes : layer.part === "mouth" ? gaze : body).append(node);
  }
  body.append(face); return svg;
}

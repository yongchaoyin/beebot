import { characterLayers } from "../../frontend/src/presence/avatar-art.ts";
/** Fixed, locally owned SVG geometry; no network assets or user input. */
export function presenceIconSvg() {
  const layers = characterLayers("blob", "blue").map(({ tag, attrs }) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ")}/>`).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect x="24" y="24" width="976" height="976" rx="216" fill="#F6F7F8"/>
  <g transform="translate(128 104) scale(12)">
    ${layers}
  </g>
</svg>
`;
}

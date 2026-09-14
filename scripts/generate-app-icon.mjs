import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./lib/config.mjs";
import { run } from "./lib/process.mjs";

const WECHAT_GREEN = "#07C160";
const branding = path.join(repoRoot, "branding");
const svgPath = path.join(branding, "beebot-app-icon.svg");
const pngPath = path.join(branding, "beebot-app-icon.png");
const icnsPath = path.join(branding, "beebot-app-icon.icns");

const paths = JSON.parse(await readFile(path.join(repoRoot, "scripts/lib/persona-shape-paths.json"), "utf8"));
const hex = paths.hex;
if (typeof hex !== "string" || !hex.includes("M217.73")) {
  throw new Error("persona-shape-paths.json is missing the hex bot path.");
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#FFFFFF"/>
  <g transform="translate(512 512) scale(2.55) translate(-114.27 -114.27)">
    <path fill="${WECHAT_GREEN}" d="${hex}"/>
    <ellipse fill="#FFFFFF" cx="85.27" cy="106.27" rx="10" ry="7"/>
    <ellipse fill="#FFFFFF" cx="143.27" cy="106.27" rx="10" ry="7"/>
  </g>
</svg>
`;

await mkdir(branding, { recursive: true });
await writeFile(svgPath, svg);

const thumbDir = path.join(repoRoot, ".build", "app-icon");
await mkdir(thumbDir, { recursive: true });
await run("/usr/bin/qlmanage", ["-t", "-s", "1024", "-o", thumbDir, svgPath]);
const raster = path.join(thumbDir, "beebot-app-icon.svg.png");
await run("/usr/bin/sips", ["-s", "format", "png", raster, "--out", pngPath]);

const iconset = path.join(thumbDir, "BeeBot.iconset");
await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });
const sizes = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];
for (const [name, size] of sizes) {
  await run("/usr/bin/sips", ["-z", String(size), String(size), pngPath, "--out", path.join(iconset, name)]);
}
await run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", icnsPath]);
console.log(`Wrote ${svgPath}\nWrote ${pngPath}\nWrote ${icnsPath}`);

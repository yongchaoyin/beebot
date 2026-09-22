import { presenceIconSvg } from "./lib/presence-icon.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./lib/config.mjs";
import { run } from "./lib/process.mjs";

const branding = path.join(repoRoot, ".build", "app-icon");
const svgPath = path.join(branding, "beebot-app-icon.svg");
const pngPath = path.join(branding, "beebot-app-icon.png");
const icnsPath = path.join(branding, "beebot-app-icon.icns");
const svg = await readFile(path.join(repoRoot, "branding", "beebot-app-icon.svg"), "utf8");
if (svg !== presenceIconSvg()) throw new Error("Presence icon SVG is stale; regenerate it from presence-icon.mjs.");
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

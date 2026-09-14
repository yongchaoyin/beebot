import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("BeeBot Dock icon is a white canvas with the original WeChat-green blob bot", async () => {
  const svg = await readFile(path.join(repoRoot, "branding", "beebot-app-icon.svg"), "utf8");
  const shapes = JSON.parse(await readFile(path.join(repoRoot, "scripts", "lib", "persona-shape-paths.json"), "utf8"));
  assert.match(svg, /fill="#FFFFFF"/);
  assert.match(svg, /fill="#07C160"/);
  assert.ok(svg.includes(shapes.blob), "app icon must use the original blob bot path");
  assert.match(svg, /<ellipse fill="#FFFFFF" cx="85.27"/);
  assert.match(svg, /<ellipse fill="#FFFFFF" cx="143.27"/);
  assert.doesNotMatch(svg, /M217\.73 153\.04/);
});

test("BeeBot icns is present for the packaged Dock icon", async () => {
  const icns = path.join(repoRoot, "branding", "beebot-app-icon.icns");
  const info = await stat(icns);
  assert.ok(info.size > 1000, "icns should be a real icon file");
});

test("macOS packaging replaces the inherited Grok Bot icns", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "package-macos.mjs"), "utf8");
  assert.match(source, /branding.*beebot-app-icon\.icns/);
  assert.match(source, /icon\.icns/);
  assert.match(source, /CFBundleIconName/);
});

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("BeeBot Dock icon is the owned neutral Presence artwork, never the upstream blob", async () => {
  const { honeylineIconSvg } = await import("../scripts/lib/honeyline-icon.mjs");
  const svg = await readFile(path.join(repoRoot, "branding", "beebot-app-icon.svg"), "utf8");
  const shapes = JSON.parse(await readFile(path.join(repoRoot, "scripts", "lib", "persona-shape-paths.json"), "utf8"));
  assert.equal(svg, honeylineIconSvg(), "tracked artwork must regenerate exactly");
  assert.match(svg, /fill="#F6F7F8"/); assert.match(svg, /fill="#AFC5E9"/);
  for (const shape of Object.values(shapes)) assert.ok(!svg.includes(shape), "no upstream mascot geometry");
  assert.doesNotMatch(svg, /#07C160|#E6B84A|#F7F7F4|linearGradient/);
});

test("all macOS icon representations are generated at package time from tracked SVG", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "generate-app-icon.mjs"), "utf8");
  assert.match(source, /honeylineIconSvg/);
  assert.match(source, /"\.build", "app-icon"/);
  for (const size of [16, 32, 128, 256, 512]) {
    assert.ok(source.includes(`icon_${size}x${size}.png`));
    assert.ok(source.includes(`icon_${size}x${size}@2x.png`));
  }
  assert.match(source, /iconutil/);
  assert.doesNotMatch(source, /persona-shape-paths|WECHAT_GREEN/);
});

test("macOS packaging replaces the inherited Grok Bot icns", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "package-macos.mjs"), "utf8");
  assert.match(source, /"\.build".*beebot-app-icon\.icns/);
  assert.match(source, /icon\.icns/);
  assert.match(source, /generate-app-icon\.mjs/);
  assert.match(source, /CFBundleIconName/);
});

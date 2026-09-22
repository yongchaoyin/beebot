import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { presenceIconSvg } from "../scripts/lib/presence-icon.mjs";
import { COLORS, characterLayers } from "../frontend/src/presence/avatar-art.ts";

test("application icon stays byte-identical when Bot color and shape catalogs change", async () => {
  const svg = presenceIconSvg();
  assert.equal(svg, await readFile(new URL("../branding/beebot-app-icon.svg", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(svg).digest("hex"), "4da0054bbf6d31717bda926cbe032d570f2430b0547f5a06ce55312ac72824c3");
  assert.equal(COLORS.blue, "#1084FE");
  assert.equal(characterLayers("blob", "blue")[0].attrs.fill, "#1084FE");
  assert.match(svg, /fill="#ADC3EA"/);
});

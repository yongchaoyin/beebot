import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { presenceIconSvg } from "../scripts/lib/presence-icon.mjs";
import { COLORS, characterLayers } from "../frontend/src/presence/avatar-art.ts";

test("application icon stays byte-identical when Bot color and shape catalogs change", async () => {
  const svg = presenceIconSvg();
  assert.equal(svg, await readFile(new URL("../branding/beebot-app-icon.svg", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(svg).digest("hex"), "9a4d0ae659258b8826ece9f7faed3e88293bd24bad771fdfef619f4d380d81e9");
  assert.equal(COLORS.blue, "#1084FE");
  assert.equal(characterLayers("blob", "blue")[0].attrs.fill, "#1084FE");
  assert.equal(COLORS.green, "#00C972");
  assert.match(svg, /fill="#00C972"/);
});

import { parse } from "acorn";
import { simple } from "acorn-walk";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const digest = value => ({ bytes: Buffer.byteLength(value), sha256: createHash("sha256").update(value).digest("hex") });
/** Build-time UI literals only. Never rewrite DOM text, conversations, URLs,
 * protocol names, credential namespaces, or the immutable reference renderer. */
export function brandProductLiterals(source) {
  const edits = [];
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  simple(ast, {
    Literal(node) {
      if (typeof node.value !== "string" || !node.value.includes("Grok Bot")) return;
      // Third-party copyright/licence text remains attribution, not our branding.
      if (/copyright|licensed under|all rights reserved/i.test(node.value)) return;
      edits.push({ start: node.start, end: node.end, value: JSON.stringify(node.value.replaceAll("Grok Bot", "BeeBot")) });
    },
    TemplateElement(node) {
      if (!node.value.raw.includes("Grok Bot") || /copyright|licensed under/i.test(node.value.raw)) return;
      edits.push({ start: node.start, end: node.end, value: node.value.raw.replaceAll("Grok Bot", "BeeBot") });
    },
  });
  let result = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, e.start) + e.value + result.slice(e.end);
  return { source: result, count: edits.length };
}

export async function brandRendererAssets(assetsRoot) {
  const changes = [];
  for (const name of (await readdir(assetsRoot)).sort()) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(assetsRoot, name), before = await readFile(file, "utf8");
    const result = brandProductLiterals(before);
    if (!result.count) continue;
    await writeFile(file, result.source);
    changes.push({ role: "product-branding", path: `dist/renderer/assets/${name}`, replacements: result.count, original: digest(before), patched: digest(result.source) });
  }
  return changes;
}

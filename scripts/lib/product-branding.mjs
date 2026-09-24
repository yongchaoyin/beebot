import { parse } from "acorn";
import { simple } from "acorn-walk";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const PRODUCT_COPY = new Map([
  ["Sign in to Cursor in settings, then ask anything.", "Configure a model API or connect an authorized server in Settings to start."],
  ["You’ll need to sign in again to use your Cursor account with Grok Bot.", "This disconnects the external provider session, not separately authorized servers. Your Bots and history are retained."],
  ["https://cursor.com/bot/onboarding", "https://github.com/yongchaoyin/beebot#readme"],
]);
const retiredBrandAssets = JSON.parse(await readFile(new URL("./retired-brand-assets.json", import.meta.url), "utf8"));

const digest = value => ({ bytes: Buffer.byteLength(value), sha256: createHash("sha256").update(value).digest("hex") });
/** Build-time UI literals only. Never rewrite DOM text, conversations, provider URLs,
 * protocol names, credential namespaces, or the immutable reference renderer. */
export function brandProductLiterals(source) {
  const edits = [];
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  simple(ast, {
    Literal(node) {
      if (typeof node.value !== "string") return;
      const productCopy = PRODUCT_COPY.get(node.value);
      if (productCopy != null) { edits.push({ start: node.start, end: node.end, value: JSON.stringify(productCopy) }); return; }
      if (!node.value.includes("Grok Bot") || /^[a-z][a-z0-9+.-]*:\/\//i.test(node.value)) return;
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

/** Prune only hash-pinned, unreferenced old product artwork from the OUTPUT.
 * No broad filename glob, source archive edit, font deletion or API logo rename. */
export async function retireUnusedBrandAssets(assetsRoot) {
  const texts = [];
  for (const name of await readdir(assetsRoot)) {
    if (/\.(?:js|css|html|json|svg)$/.test(name)) texts.push({ name, text: await readFile(path.join(assetsRoot, name), "utf8") });
  }
  const retired = [];
  // Validate the whole plan before removing anything. A new reference is a build
  // error, not a silent missing image or a justification for disabling the guard.
  for (const entry of retiredBrandAssets) {
    const bytes = await readFile(path.join(assetsRoot, entry.file));
    const original = digest(bytes);
    if (original.sha256 !== entry.sha256) throw new Error(`Retired artwork changed: ${entry.file}`);
    const references = texts.filter(row => row.name !== entry.file && row.text.includes(entry.file));
    if (references.length) throw new Error(`Retired artwork is still referenced: ${entry.file} in ${references.map(row => row.name).join(", ")}`);
    retired.push({ path: `dist/renderer/assets/${entry.file}`, reason: entry.reason, original });
  }
  for (const entry of retiredBrandAssets) await unlink(path.join(assetsRoot, entry.file));
  return retired;
}

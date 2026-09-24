import { EXTERNAL_SERVICE_MESSAGES } from "../../source/shared/product-access-copy.ts";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, unlink, lstat } from "node:fs/promises";
import path from "node:path";

const PRODUCT_COPY = new Map([
  ["Privacy Mode (Legacy) isn’t compatible with Grok Bot. Switch to Privacy Mode to start using Grok Bot — data still isn’t used for training.", EXTERNAL_SERVICE_MESSAGES.privacyBlocked],
  ["This ends your Grok Bot trial now and removes your remaining trial credits. Your card won’t be charged either way — the trial never turns into a paid plan on its own.", EXTERNAL_SERVICE_MESSAGES.cancelTrial],
  ["Your trial has ended. Upgrade to continue using Grok Bot.", EXTERNAL_SERVICE_MESSAGES.trialEnded],
  ["Get more Grok Bot usage", EXTERNAL_SERVICE_MESSAGES.usage],
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
async function readRendererReferences(root) {
  const texts = [];
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Cannot audit a symbolic link in renderer output: ${path.relative(root, file)}`);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(?:[cm]?js|css|html|json|svg|webmanifest)$/i.test(entry.name)) {
        texts.push({ file, name: path.relative(root, file), text: await readFile(file, "utf8") });
      }
    }
  };
  if (!(await lstat(root)).isDirectory()) throw new Error("Renderer reference root must be a real directory");
  await visit(root);
  return texts;
}

export async function retireUnusedBrandAssets(assetsRoot, { rendererRoot = assetsRoot } = {}) {
  const assets = path.resolve(assetsRoot), root = path.resolve(rendererRoot);
  const relative = path.relative(root, assets);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Retired artwork must belong to the audited renderer root");
  }
  // Include the entry HTML and lazy/nested chunks, not only assets/*.js.
  const texts = await readRendererReferences(root);
  const retired = [];
  // Validate the whole plan before removing anything. Missing/changed input or
  // a new reference is a build error, never permission to skip a safety check.
  for (const entry of retiredBrandAssets) {
    const file = path.join(assets, entry.file);
    if (!(await lstat(file)).isFile()) throw new Error(`Retired artwork is not a regular file: ${entry.file}`);
    const bytes = await readFile(file), original = digest(bytes);
    if (original.sha256 !== entry.sha256) throw new Error(`Retired artwork changed: ${entry.file}`);
    const references = texts.filter(row => row.file !== file && row.text.includes(entry.file));
    if (references.length) throw new Error(`Retired artwork is still referenced: ${entry.file} in ${references.map(row => row.name).join(", ")}`);
    retired.push({ path: `dist/renderer/assets/${entry.file}`, reason: entry.reason, original });
  }
  for (const entry of retiredBrandAssets) await unlink(path.join(assets, entry.file));
  return retired;
}

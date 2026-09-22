import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const digest = bytes => ({ bytes: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") });
export function presenceHtml(html) {
  if (html.includes("data-beebot-theme") || html.includes("beebot-presence.css")) throw new Error("Presence entry is already installed");
  for (const [pattern, name] of [[/<html\b/gi, "html"], [/<title>[^<]*<\/title>/gi, "title"], [/<\/head>/gi, "head"]]) {
    if ([...html.matchAll(pattern)].length !== 1) throw new Error(`Presence requires exactly one ${name} anchor`);
  }
  return html.replace(/<html\b/i, '<html data-beebot-theme="presence"').replace(/<title>[^<]*<\/title>/i, "<title>BeeBot</title>")
    .replace(/<\/head>/i, '    <link rel="stylesheet" href="./assets/beebot-presence.css">\n  </head>');
}
/** Install in the actual staged file:// entry, not merely the Vite preview.
 * CSP is preserved; no inline script, CDN, user-data access or duplicate React. */
export async function buildPresence({ rendererRoot }) {
  const entry = path.join(rendererRoot, "index.html");
  const before = await readFile(entry, "utf8");
  const after = presenceHtml(before);
  const target = path.join(rendererRoot, "assets", "beebot-presence.css");
  const result = await build({ absWorkingDir: root, entryPoints: ["frontend/src/presence/presence.css"], outfile: target, bundle: true, minify: true, target: "chrome136", write: false, metafile: true, legalComments: "none" });
  await mkdir(path.dirname(target), { recursive: true });
  for (const output of result.outputFiles) await writeFile(output.path, output.contents);
  const icon = await readFile(path.join(root, "branding/beebot-app-icon.svg"));
  const iconPath = path.join(rendererRoot, "assets/beebot-app-icon.svg");
  await writeFile(iconPath, icon);
  await writeFile(entry, after);
  return {
    version: 1,
    entry: { path: "dist/renderer/index.html", original: digest(before), patched: digest(after) },
    assets: [...result.outputFiles.map(file => ({ path: `dist/renderer/assets/${path.basename(file.path)}`, ...digest(file.contents) })), { path: "dist/renderer/assets/beebot-app-icon.svg", ...digest(icon) }],
    inputs: [...Object.keys(result.metafile.inputs), "branding/beebot-app-icon.svg"].sort(),
  };
}

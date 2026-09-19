import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const nodeBuildRoot = path.join(root, ".build", "node");
const entries = [
  ["source/node/main.ts", "node/main.mjs"],
  ["source/node/host-entry.ts", "dist/host/host-main.cjs"],
  ["source/box-exec-daemon/cli.ts", "dist/box-exec-daemon/main.cjs"],
  ["source/host/agent-isolation/agent-store-worker.ts", "dist/host/agent-isolation/agent-store-worker.cjs"],
  ["source/host/agent-isolation/transcript-mirror-worker.ts", "dist/host/agent-isolation/transcript-mirror-worker.cjs"],
  ["source/host/extensions/box-store-sync/box-store-vacuum-worker.ts", "dist/host/extensions/box-store-sync/box-store-vacuum-worker.cjs"],
  ["source/host/extensions/content-search/search-index-worker.ts", "dist/host/extensions/content-search/search-index-worker.cjs"],
];

export async function buildNode() {
  await mkdir(nodeBuildRoot, { recursive: true });
  const outputs = [];
  for (const [entry, output] of entries) {
    const serverEntry = output.endsWith(".mjs");
    const result = await build({
      absWorkingDir: root,
      entryPoints: [entry],
      outfile: path.join(nodeBuildRoot, output),
      bundle: true,
      platform: "node",
      format: serverEntry ? "esm" : "cjs",
      target: "node26",
      mainFields: ["module", "main"],
      external: ["tree-sitter", "tree-sitter-bash"],
      legalComments: "none",
      logLevel: "warning",
      metafile: true,
      ...(serverEntry ? { packages: "external" } : {
        define: { "import.meta.url": "__beebotImportMetaUrl" },
        banner: { js: 'const __beebotImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
      }),
    });
    const inputs = Object.keys(result.metafile.inputs);
    if (inputs.some(input => input.startsWith("src/app/") || input.startsWith("recovered/"))) {
      throw new Error(`Standalone runtime imports upstream build payload: ${entry}`);
    }
    outputs.push({ entry, output, inputs });
  }
  await writeFile(path.join(nodeBuildRoot, "build-manifest.json"), JSON.stringify({ schemaVersion: 1, outputs }, null, 2) + "\n");
  console.log(`Standalone runtime: ${nodeBuildRoot}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildNode();

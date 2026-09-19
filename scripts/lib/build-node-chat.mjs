import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Build the existing source chat components as a self-contained renderer module. */
export async function buildNodeChat({ assetsRoot }) {
  const targetRoot = path.resolve(assetsRoot);
  await mkdir(targetRoot, { recursive: true });
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["frontend/src/node-chat/entry.tsx"],
    outfile: path.join(targetRoot, "beebot-node-chat.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome136",
    jsx: "automatic",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    write: false,
    metafile: true,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "pinned-chat-runtime-assets",
      setup(builder) {
        // The header's optional computer control is disabled for this transport. Its
        // full-app reset/font stylesheet must not enter this isolated chat module.
        builder.onLoad({ filter: /features\/computer\/shell\/view\.css$/ }, () => ({ contents: "", loader: "css" }));
        // Existing math/diagram modules ship next to this module in the pinned renderer.
        builder.onLoad({ filter: /workspace\/(?:math|mermaid)\.tsx$/ }, async ({ path: sourcePath }) => ({
          contents: (await readFile(sourcePath, "utf8")).replace(/"\/upstream\/assets\/([^"]+)"/g, 'new URL("./$1", import.meta.url).href'),
          loader: "tsx",
          resolveDir: path.dirname(sourcePath),
        }));
      },
    }],
  });
  const output = [];
  for (const file of result.outputFiles) {
    const bytes = file.path.endsWith(".css") ? Buffer.from(`@scope (#beebot-node-chat) {\n${file.text}\n}\n`) : file.contents;
    await writeFile(file.path, bytes);
    output.push({ path: file.path, bytes: bytes.length });
  }
  return { outputs: output, inputs: Object.keys(result.metafile.inputs) };
}

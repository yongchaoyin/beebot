import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Load the real module graph, including shared role validation. Copying only
// individual transformed files loses newly imported dependencies in /tmp.
export async function loadGroupRuntime(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-message-runtime-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const outfile = path.join(temporary, "runtime.mjs");
  await build({
    stdin: {contents: `
      export * from "./source/host/groups/group-chat.ts";
      export * from "./source/host/groups/group-attention.ts";
      export * from "./source/host/extensions/transcript/group-chat-orchestrator.ts";
    `, resolveDir:fileURLToPath(new URL("../../",import.meta.url)),loader:"ts"},
    outfile,bundle:true,platform:"node",format:"esm",target:"node26",logLevel:"silent",
  });
  return import(pathToFileURL(outfile).href);
}

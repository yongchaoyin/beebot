import { transform } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Use the same locked transformer as the existing source tests. Native Node
// type stripping cannot lower parameter properties, and its transform mode is
// not available in the pinned Node runtime.
export async function loadGroupRuntime(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-message-runtime-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = new URL("../../", import.meta.url);
  const sources = [
    ["source/host/groups/group-chat.ts", "group-chat.mjs"],
    ["source/host/groups/group-replies.ts", "group-replies.mjs"],
    ["source/host/extensions/transcript/group-chat-orchestrator.ts", "orchestrator.mjs"],
  ];
  for (const [input, output] of sources) {
    const source = (await readFile(new URL(input, root), "utf8"))
      .replace('"../../groups/group-chat.js"', '"./group-chat.mjs"')
      .replace('"../../groups/group-replies.js"', '"./group-replies.mjs"');
    const { code } = await transform(source, {
      loader: "ts", format: "esm", target: "node22", sourcefile: input,
    });
    await writeFile(path.join(temporary, output), code);
  }
  return {
    ...await import(pathToFileURL(path.join(temporary, "group-chat.mjs")).href),
    ...await import(pathToFileURL(path.join(temporary, "orchestrator.mjs")).href),
  };
}

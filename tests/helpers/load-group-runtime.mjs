import { stripTypeScriptTypes } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Run the reviewed source without changing the project's dependency/toolchain pins.
export async function loadGroupRuntime(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-message-runtime-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = new URL("../../", import.meta.url);
  const sources = [
    ["source/host/groups/group-chat.ts", "group-chat.mjs"],
    ["source/host/extensions/transcript/group-chat-orchestrator.ts", "orchestrator.mjs"],
  ];
  for (const [input, output] of sources) {
    const source = (await readFile(new URL(input, root), "utf8"))
      .replace('"../../groups/group-chat.js"', '"./group-chat.mjs"');
    await writeFile(path.join(temporary, output), stripTypeScriptTypes(source, { mode: "transform" }));
  }
  return {
    ...await import(pathToFileURL(path.join(temporary, "group-chat.mjs")).href),
    ...await import(pathToFileURL(path.join(temporary, "orchestrator.mjs")).href),
  };
}

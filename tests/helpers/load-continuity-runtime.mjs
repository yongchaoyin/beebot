import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** Bundle the real acceptance -> dispatch -> room -> member scheduler graph.
 * The test replaces only OS/model I/O, never the dispatch/queue functions.
 */
export async function loadContinuityRuntime(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "beebot-continuity-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outfile = path.join(dir, "runtime.cjs");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  await build({
    stdin: { contents: `
      export { SendPipeline } from './source/host/extensions/transcript/send-pipeline.ts';
      export { GroupChatGlue } from './source/host/extensions/transcript/group-chat-glue.ts';
      export { RunLifecycle } from './source/host/extensions/transcript/run-lifecycle.ts';
      export { ConversationDeliveries } from './source/host/extensions/transcript/conversation-deliveries.ts';
      export { PromptAcceptanceLedger } from './source/host/extensions/transcript/prompt-acceptance-ledger.ts';
      export { writeSandGroupConfig } from './source/host/groups/group-store.ts';
      export { writeSandProfileFile, getSandProfilePath } from './source/host/agents/agent-profile.ts';
      export { setTranscript, getTranscript, appendEntry } from './source/host/extensions/transcript/transcript-store.ts';
    `, resolveDir: root, loader: "ts" },
    bundle: true, platform: "node", format: "cjs", target: "node26", outfile,
    logLevel: "silent",
  });
  return { ...createRequire(import.meta.url)(outfile), directory: dir };
}

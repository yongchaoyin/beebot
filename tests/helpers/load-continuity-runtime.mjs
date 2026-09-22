import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Actual send, SQLite ledger, scheduler and room glue; only executors are supplied by each test. */
export async function loadContinuityRuntime(t) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const directory = await mkdtemp(path.join(os.tmpdir(), "beebot-continuity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "runtime.mjs");
  const modules = {
    "source/host/extensions/transcript/send-pipeline.ts": ["SendPipeline"],
    "source/host/extensions/transcript/group-chat-glue.ts": ["GroupChatGlue"],
    "source/host/extensions/transcript/turn-runtime.ts": ["TurnRuntime"],
    "source/host/extensions/transcript/run-lifecycle.ts": ["RunLifecycle"],
    "source/host/extensions/transcript/conversation-delivery.ts": ["ConversationDeliveries", "deliveryOf", "postConversationNotice"],
    "source/host/extensions/transcript/conversation-activity.ts": ["getConversationActivity", "cancelQueuedConversationMessage"],
    "source/host/extensions/transcript/conversation-recovery.ts": ["recoverConversationDeliveries", "stopConversation"],
    "source/host/extensions/transcript/group-message-delivery.ts": ["deliverGroupMessage"],
    "source/host/extensions/transcript/shared-rooms.ts": ["SharedRooms"],
    "source/host/extensions/transcript/transcript-store.ts": ["getTranscript", "setTranscript", "appendEntry", "removeEntry"],
    "source/host/extensions/transcript/prompt-acceptance-ledger.ts": ["PromptAcceptanceLedger"],
    "source/host/extensions/session/agent-db.ts": ["SandAgentDb"],
    "source/host/ports/telemetry.ts": ["createNoopSandTelemetry"],
    "source/host/groups/group-store.ts": ["writeSandGroupConfig", "readSandGroupConfig"],
  };
  await build({ stdin: { contents: Object.entries(modules).map(([module, names]) => `export {${names.join(",")}} from ${JSON.stringify("./" + module)};`).join("\n"), resolveDir: root, sourcefile: "continuity-test-entry.ts", loader: "ts" }, outfile: output, bundle: true, format: "esm", platform: "node", target: "node26", logLevel: "silent" });
  return { ...await import(pathToFileURL(output).href), directory };
}

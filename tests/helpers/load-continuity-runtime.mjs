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
      export { renderAgentDirectorySystemPrompt, describeAddress } from "./source/host/agents/agent-messaging.ts";
export { BotRoleStore } from "./source/host/agents/bot-role-store.ts";
      export { BotRoles } from "./source/host/extensions/transcript/bot-roles.ts";
      export { AgentLifecycle } from "./source/host/extensions/transcript/agent-lifecycle.ts";
      export { botRoleDraftSchema, renderBotRole } from "./source/shared/bot-role.ts";
      export { normalizeAgentProfileIdentity, agentProfileIdentitiesEqual, renderAgentProfileUpdate, parseLatestAgentProfileUpdate } from "./source/host/runner/sand-agent-profile-prompt.ts";
      export { ProfileWatch } from "./source/host/extensions/transcript/profile-watch.ts";
      export { buildGroupMemberSystemPrompt } from "./source/host/groups/group-chat.ts";
      export { createAgentParameters, updateAgentParameters } from "./source/host/runner/tools/sand-agent-management-tools.ts";

      export { recordedWorkStatus, publishRecordedWorkStatus, localRecordedWorkStatus } from "./source/host/extensions/transcript/recorded-work-status.ts";
      export { understandUserWorkMessage, formatWorkUnderstanding } from "./source/host/extensions/transcript/work-understanding.ts";
      export { understandWorkMessage } from "./source/host/extensions/transcript/collaboration.ts";
      export { workContextView, workFocus, NATURAL_WORK_GUIDANCE } from "./source/host/extensions/transcript/collaboration-context.ts";
      export { CollaborationControls } from './source/host/extensions/transcript/collaboration-controls.ts';
      export { projectCompletions, completionIsCurrent } from './source/host/extensions/transcript/collaboration-completion.ts';
      export { prepareCollaboration, projectCollaboration, collaborationContext, referencedWork, workDecisionCurrent } from './source/host/extensions/transcript/collaboration.ts';
      export { workIsAccepted, workIsCompleted, workDependenciesReady } from "./source/host/extensions/transcript/collaboration-transitions.ts";
      export { captureWorkEvidence } from "./source/host/extensions/transcript/collaboration-evidence.ts";
      export { SessionRuntime } from "./source/host/extensions/transcript/session-runtime.ts";
      export { TurnRuntime } from './source/host/extensions/transcript/turn-runtime.ts';
      export { buildGroupReplyContext } from './source/host/groups/group-replies.ts';
      export { requireMessageReference, describeReplyChain } from './source/host/extensions/transcript/message-reply-contract.ts';
      export { validateAiReplyTarget, applyAutoReplyThread } from './source/host/extensions/transcript/send-thread-stamping.ts';
      export { buildSandSendMessage, createSendMessageTool } from './source/host/runner/tools/send-message-tool.ts';
      export { prepareGroupPublication } from './source/host/extensions/transcript/group-publications.ts';
      export { readAttachmentText } from './source/host/extensions/attachments/attachments-service.ts';
      export { WidgetResponses } from './source/host/extensions/transcript/widget-responses.ts';
      export { SendPipeline } from './source/host/extensions/transcript/send-pipeline.ts';
      export { GroupChatGlue } from './source/host/extensions/transcript/group-chat-glue.ts';
      export { SandRunScheduler } from './source/host/extensions/transcript/run-scheduler.ts';
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

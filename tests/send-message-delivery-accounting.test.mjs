import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let runtime, directory;
test.before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "beebot-send-accounting-"));
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  await symlink(path.join(repoRoot, "node_modules"), path.join(directory, "node_modules"), "dir");
  const outfile = path.join(directory, "runtime.cjs");
  await build({ stdin: { contents: `
    export { SandAgentRunner } from './source/host/runner/sand-agent-runner.ts';
    export { createProductionTurnRunShellAdapter } from './source/host/runner/production-turn-run-shell-adapter.ts';
    export { createSendMessageTool } from './source/host/runner/tools/send-message-tool.ts';
    export { executeToolResultOrError, renderToolResultOrError } from './source/packages/agent/tools/core.ts';
    export { createContext } from './source/packages/context/core.ts';
    export { ConversationAction, ConversationStateStructure } from './source/packages/proto/generated/agent/v1/agent_pb.ts';
    export { validateGroupMemberPublication, resolveMessageResponders } from './source/host/groups/group-chat.ts';
  `, resolveDir: repoRoot, loader: "ts" }, outfile,
  bundle: true, format: "cjs", platform: "node", target: "node26", logLevel: "silent",
  plugins: [{ name: "load-jsonc-package-intact", setup(builder) {
    // Its UMD factory uses a locally shadowed require; keep the real package's
    // relative implementation modules together instead of bundling that loader.
    builder.onResolve({ filter: /^jsonc-parser$/ }, () => ({ path: createRequire(import.meta.url).resolve("jsonc-parser"), external: true }));
  } }] });
  runtime = createRequire(import.meta.url)(outfile);
});
test.after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

const noop = () => {};
async function executeSend(emitUpdate, message, id = "send", lastSentMessageId = () => undefined) {
  const ctx = runtime.createContext(), errors = [];
  const tool = runtime.createSendMessageTool({ getIngestAttachment: () => undefined,
    onSendMessage: message => { emitUpdate({ type: "send-message", message }); return lastSentMessageId(); } });
  const handler = { emitPartialToolCall: noop, getAbortSignal: () => ctx.signal,
    executeToolCall: (context, _initial, _id, execute) => execute(context),
    emitToolCallError: async (_context, id) => { errors.push(id); } };
  const args = (async function* () { yield JSON.stringify(message); })();
  const output = await runtime.executeToolResultOrError(tool, ctx, handler, args, { toolCallId: id });
  return { rendered: await runtime.renderToolResultOrError(ctx, tool, output, {}), output, errors };
}

async function runFixture(mode, exercise, transport, options = {}) {
  if (mode === "runner") {
    const runner = new runtime.SandAgentRunner({ agentId: "a", transport, ...options,
      runStep: async (_step, context) => { await exercise(context.emitUpdate); return { done: true }; } });
    return runner.run("A real request");
  }
  const checkpoint = new runtime.ConversationStateStructure();
  let emit, disposed = 0;
  const adapter = runtime.createProductionTurnRunShellAdapter({
    createOwner: async input => {
      emit = input.emitUpdate;
      return { dispose: () => { disposed++; }, runContext: { privacyMode: 0, commitDiskPressureReminder: noop },
        built: { agent: { runStream: async () => { await exercise(emit); return checkpoint; } } } };
    },
    createRunInput: async () => ({ action: new runtime.ConversationAction(), baseState: checkpoint, mcpTools: [] }),
    promptOptions: () => ({}), createSession: () => ({ getModelId: () => "fixture", getExecutor: () => ({}) }),
    context: () => runtime.createContext(), profilePromptSnapshots: () => ({}),
    createSettleHost: () => ({ isSubagentRunner: false, getTranscriptId: () => "a", getBlobStore: () => ({}),
      agentStore: () => null, setLocalState: noop, ownsRunner: () => true, isRunSuperseded: () => false,
      latestPromptMessages: () => [], persistAnnouncedAgentProfile: noop }),
    isSubagentRunner: false, subagents: { sessions: new Map() }, getConversationId: () => "a", runGeneration: () => 1,
    setActiveTurnRequestSource: noop, beginAutoReviewUserMessageEpoch: noop, setActiveRunInterrupted: noop,
    setAwaitingUserSelection: noop, isAwaitingUserSelection: () => false, emitRunLifecycle: noop,
    emitUpdate: update => transport.onUpdate(update), cancelThisRun: noop,
    ...(transport.lastSentMessageId ? { lastSentMessageId: () => transport.lastSentMessageId() } : {}),
  });
  const result = await adapter.run("A real request");
  assert.equal(disposed, 1);
  return result;
}

for (const mode of ["adapter", "runner"]) {
  test(`${mode}: actual SendMessage rejection is a model tool error and correction counts once`, async () => {
    let receipt, publications = 0;
    const outputs = [];
    const members = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    const transport = { lastSentMessageId: () => receipt, onUpdate(update) {
      if (update.type !== "send-message") return;
      runtime.validateGroupMemberPublication(update.message.content, members);
      runtime.resolveMessageResponders(members, [{ speaker: { kind: "member", id: "a", name: "A" }, content: update.message.content, purpose: update.message.purpose }]);
      receipt = `public-${++publications}`;
    } };
    const result = await runFixture(mode, async emit => {
      outputs.push(await executeSend(emit, { type: "text", purpose: "request", content: "Please check this." }, "missing-recipient", transport.lastSentMessageId));
      assert.equal(publications, 0);
      outputs.push(await executeSend(emit, { type: "text", purpose: "update", content: "@小鱼 请继续" }, "invalid", transport.lastSentMessageId));
      assert.equal(publications, 0);
      outputs.push(await executeSend(emit, { type: "text", purpose: "update", content: "I will continue." }, "corrected", transport.lastSentMessageId));
    }, transport);
    assert.equal(outputs[0].rendered.isError, true);
    assert.equal(outputs[0].output.error.code, "group_recipient_required");
    assert.doesNotMatch(outputs[0].rendered.content[0].text, /The addressed Bot Use @/);
    assert.deepEqual(outputs[0].errors, ["missing-recipient"]);
    assert.equal(outputs[1].rendered.isError, true);
    assert.match(outputs[1].rendered.content[0].text, /小鱼.*not a member.*Nothing was published.*@\{a\}.*@\{b\}/);
    assert.deepEqual(outputs[1].errors, ["invalid"]);
    assert.notEqual(outputs[2].rendered.isError, true);
    assert.equal(outputs[2].output.result.result.value.messageId, "public-1");
    assert.equal(publications, 1); assert.equal(result.sentMessageCount, 1);
  });

  test(`${mode}: rejected-only sends remain undelivered`, async () => {
    const result = await runFixture(mode, async emit => {
      const response = await executeSend(emit, { type: "text", content: "Not published" });
      assert.equal(response.rendered.isError, true);
    }, { lastSentMessageId: () => undefined, onUpdate() { throw new Error("Publication rejected"); } });
    assert.equal(result?.sentMessageCount ?? 0, 0);
  });

  test(`${mode}: skipped sends, stale receipts and duplicate receipts are not counted`, async () => {
    let receipt = "previous-turn";
    const result = await runFixture(mode, async emit => {
      emit({ type: "send-message", message: { type: "text", content: "old-epoch" } });
      emit({ type: "send-message", message: { type: "text", content: "skip" } });
      emit({ type: "send-message", message: { type: "text", content: "accepted" } });
      emit({ type: "send-message", message: { type: "text", content: "duplicate" } });
    }, { lastSentMessageId: () => receipt, onUpdate(update) {
      if (update.message.content === "skip") receipt = undefined;
      if (update.message.content === "accepted") receipt = "new-receipt";
    } });
    assert.equal(result.sentMessageCount, 1);
  });

  test(`${mode}: successful legacy transport without receipt access stays supported`, async () => {
    let delivered = 0;
    const result = await runFixture(mode, async emit => {
      await executeSend(emit, { type: "text", content: "Shared/legacy delivery" });
    }, { onUpdate(update) { if (update.type === "send-message") delivered++; } }, { isSharedRoomTurn: true });
    assert.equal(delivered, 1); assert.equal(result.sentMessageCount, 1);
  });
}

test("adapter: rejected content is never read by the public-message collector", async () => {
  let contentReads = 0;
  const message = { type: "text", get content() { contentReads++; return "Private rejected content"; } };
  const result = await runFixture("adapter", async emit => {
    assert.throws(() => emit({ type: "send-message", message }), /Publication rejected/);
  }, { onUpdate() { throw new Error("Publication rejected"); } });
  assert.equal(contentReads, 0); assert.equal(result.sentMessageCount, 0);
});

test("runner: a rejected or skipped widget does not mark the turn as awaiting the user", async () => {
  for (const reject of [true, false]) {
    const result = await runFixture("runner", async emit => {
      try { emit({ type: "send-message", message: { type: "widget", widget: { prompt: "Not delivered" } } }); } catch (error) { assert.match(error.message, /rejected/); }
    }, { lastSentMessageId: () => undefined, onUpdate() { if (reject) throw new Error("rejected"); } });
    assert.equal(result?.sentMessageCount ?? 0, 0); assert.notEqual(result?.awaitingUserSelection, true);
  }
});

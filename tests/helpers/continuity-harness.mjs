import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function until(check, message = "condition was not reached") {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** Real SQLite, SendPipeline, TurnRuntime, GroupChatGlue and per-Bot scheduler.
 * Only the model/tool executor, UI subscription and profile/service plumbing are fixtures.
 * A model response always travels through the real runner transport boundary.
 */
export function createContinuityHarness(t, runtime, { root, members = ["A", "B", "C"], groups = { room: ["A", "B", "C"] } } = {}) {
  const directory = root ?? join(runtime.directory, randomUUID());
  mkdirSync(directory, { recursive: true });
  const sessions = new Map(), profiles = new Map(), hooks = new Map(), calls = [], events = [], errors = [], interruptions = [];
  const gates = new Set();
  const no = () => {};
  const tm = {
    disposed: false,
    telemetry: runtime.createNoopSandTelemetry(),
    productAnalytics: { trackEvent: no }, traceFlusher: no,
    acceptanceLedger: new runtime.PromptAcceptanceLedger(directory),
    sessionStore: {
      listAgents: async () => [...profiles.values()],
      getAgentDir: id => join(directory, "agents", id),
      markSessionActivity: no, markSessionViewed: no,
    },
    sessions: {
      activeSession: null, inMemoryTranscriptAgentId: null,
      liveSessions: sessions, pendingSessionOpens: new Map(),
      isAgentGone: id => !sessions.has(id),
      ensureActionTarget: async id => { if (id && !sessions.has(id)) throw new Error("Unknown conversation"); },
      ensureSession: async () => { if (!tm.sessions.activeSession) throw new Error("No selected conversation"); return tm.sessions.activeSession; },
      openSessionOnce: async id => { const session = sessions.get(id); if (!session) throw new Error("Unknown conversation"); return session; },
      markActiveSessionArrival: no,
    },
    roster: {
      lastKnownAgentNames: new Map(), outlineAgentId: null,
      emit: (event, id) => events.push({ ...event, conversationId: id ?? tm.sessions.activeSession?.id }),
      emitAgentUpdate: async () => {}, emitAgents: async () => {},
      appendOutlineItem: no, applyAgentUpdateToOutline: no,
      resolveAgentProfile: session => profiles.get(session.id),
      reserveSnapshotStamp: () => 1, finalizeSummaryForRpc: summary => summary,
    },
    workflowCommands: { expandWorkflowReferences: (_session, prompt) => prompt, withMentionedAgentsContext: (_session, _original, prompt) => prompt },
    trayErrors: { clearForAgent: no, pushError: error => errors.push(error) },
    ackObligationStore: { clear: no, get: () => undefined, list: () => [] },
    ackObligations: {
      recordAckObligationSend: no, confirmAckObligationAfterInterrupt: no,
      armSendGuard: () => ({ disarm: no, [Symbol.dispose]: no }),
      mintAckRunToken: () => randomUUID(), retireAckRunToken: no, fulfillAckObligation: no,
      scheduleAckRedriveAfterIdle: no, clearAckRedriveTimer: no,
    },
    widgetResponses: { collectUnansweredQuestionPrompts: () => ({}), applyReaction: () => undefined },
    automationRuntime: { emitAutomations: no },
    backgroundWakes: { dmPreemptedWakeAgentIds: new Set() },
    upgradeResume: { quiescingForUpgrade: false, markAgentResumePending: no },
    sharedRooms: { sharedRoomConfigOf: () => null, publishSharedRoomEntryIfNeeded: no },
    attachments: {
      ingest: async (_directory, absolutePath) => ({ absolutePath }),
      readImageDimensions: async () => null,
    },
  };
  for (const id of [...members, ...Object.keys(groups)]) {
    const dir = tm.sessionStore.getAgentDir(id);
    mkdirSync(dir, { recursive: true });
    const profile = { id, name: id, description: `Colleague ${id}`, title: "", avatarShape: "blob", avatarColor: "green", inferenceVendorId: "fixture", ...(groups[id] ? { isGroup: true, memberIds: groups[id] } : {}) };
    writeFileSync(join(dir, "profile.json"), JSON.stringify(profile));
    if (groups[id]) runtime.writeSandGroupConfig(dir, { version: 1, memberIds: groups[id] });
    const dbPath = join(dir, "store.db");
    const db = new runtime.SandAgentDb(dbPath, { recoverOnCorruption: false });
    profiles.set(id, profile);
    sessions.set(id, { id, dbPath, db, agentStore: { dispose: async () => {} } });
  }
  tm.appendEntry = (entry, options = {}) => {
    const session = tm.sessions.activeSession;
    assert.ok(session, "append requires a selected conversation");
    const durable = session.db.appendTranscriptEntry(entry);
    options.onPersistOutcome?.(durable);
    if (durable) {
      runtime.appendEntry(entry);
      if (!options.deferEmit) tm.roster.emit({ type: "appended", entry });
    }
    return entry;
  };
  let runtimeSequence = 0;
  function makeRunner(session, transport, group = false) {
    let active = null;
    return {
      async run(prompt, options) {
        const call = { botId: session.id, kind: group ? "group" : "direct", prompt, options, stopped: false, sent: 0 };
        active = call; calls.push(call);
        const publish = content => {
          if (call.stopped) return;
          call.sent++;
          if (group) transport.onUpdate({ type: "send-message", message: { type: "text", content } });
          else {
            const target = tm.turnRuntime.replyThreadTargets.get(session);
            const entry = { id: `fixture-reply-${++runtimeSequence}`, kind: "send-message", timestampMs: Date.now(), author: { id: session.id, name: session.id }, message: { type: "text", content, ...(target ? { reply_to: target } : {}) }, ...(target ? { replyTo: target } : {}) };
            assert.equal(session.db.appendTranscriptEntry(entry), true);
            if (tm.sessions.activeSession?.id === session.id) { runtime.appendEntry(entry); tm.roster.emit({ type: "appended", entry }); }
          }
        };
        try {
          const hook = hooks.get(`${call.kind}:${call.botId}`) ?? hooks.get(call.botId);
          if (hook) await hook(call, publish, transport);
          else if (group) publish("(pass)");
          else publish(`Answer: ${prompt}`);
          return { sentMessageCount: call.sent, reacted: false, aborted: call.stopped };
        } finally { if (active === call) active = null; }
      },
      interrupt(reason) { interruptions.push({ botId: session.id, kind: group ? "group" : "direct", reason }); if (!active) return false; active.stopped = true; return true; },
      interruptAll(reason) { return this.interrupt(reason); },
      getObservedToolCallCount: () => 0,
    };
  }
  tm.runnerRegistry = {
    runners: new Map(), activeGroupMemberRunners: new Map(),
    getRunner(session) {
      if (!this.runners.has(session.id)) this.runners.set(session.id, makeRunner(session));
      return this.runners.get(session.id);
    },
    runnerHooksFor: (_session, transport) => ({ transport }),
    wireRunnerLifecycle: runner => runner,
    interruptWedgedRunForWatchdog: id => tm.runnerRegistry.runners.get(id)?.interrupt("watchdog") ?? false,
  };
  tm.execution = { canExecute: true, canExecuteGroupMember: true, createGroupMemberRunner: (session, { transport }) => makeRunner(session, transport, true) };
  tm.sendPipeline = new runtime.SendPipeline(tm);
  tm.runLifecycle = new runtime.RunLifecycle(tm);
  // Fixture sessions remain open until after assertions. All actual run counts and queues are retained.
  tm.runLifecycle.retireSession = async () => {};
  tm.turnRuntime = new runtime.TurnRuntime(tm);
  tm.groupChat = new runtime.GroupChatGlue(tm);
  const entries = id => sessions.get(id).db.getTranscriptEntries();
  const send = (id, prompt, options = {}) => tm.sendPipeline.sendPrompt(prompt, { agentId: id, clientNonce: randomUUID(), directAddressedAcceptance: true, awaitTurn: false, ...options });
  async function idle() {
    await until(() => tm.runLifecycle.inFlightRunCounts.size === 0, "all conversation and member runs should become idle");
  }
  t.after(async () => {
    for (const gate of gates) gate.resolve();
    try { await idle(); } finally {
      tm.disposed = true; tm.runLifecycle.runScheduler?.dispose();
      tm.acceptanceLedger.dispose();
      for (const session of sessions.values()) session.db.close();
      runtime.setTranscript([]);
    }
  });
  return { tm, calls, hooks, events, errors, interruptions, entries, sessions, profiles, directory, send, idle,
    select(id) { const session = sessions.get(id); assert.ok(session); tm.sessions.activeSession = session; tm.sessions.inMemoryTranscriptAgentId = id; runtime.setTranscript(session.db.getTranscriptEntries()); },
    gate() { const gate = deferred(); gates.add(gate); return gate; },
    receipts(id) { return entries(id).filter(entry => entry.beebotDelivery).map(entry => entry.beebotDelivery); },
  };
}

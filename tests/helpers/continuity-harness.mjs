import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadContinuityRuntime } from "./load-continuity-runtime.mjs";

export const deferred = () => Promise.withResolvers();
export async function until(predicate, message = "Expected progress without releasing unrelated work") {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

export async function continuityHarness(t, { runMember = async () => ["(pass)"], runDirect = async () => {}, members = ["a", "b"], extraGroups = [] } = {}) {
  const runtime = await loadContinuityRuntime(t);
  const calls = [], directCalls = [], events = [], errors = [], interrupts = [], sessions = new Map(), sqls = [];
  t.after(() => { for (const db of sqls) db.close(); });
  const noop = () => {};
  const telemetry = new Proxy({}, { get: () => noop });
  for (const id of ["room", ...members, ...extraGroups]) {
    const dir = path.join(runtime.directory, "agents", id); mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, "agent.db"), sql = new DatabaseSync(dbPath); sqls.push(sql);
    sql.exec("CREATE TABLE transcript (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,entry TEXT NOT NULL)");
    const db = {
      durable: true,
      getTranscriptEntries: () => sql.prepare("SELECT entry FROM transcript ORDER BY seq").all().map(row => JSON.parse(row.entry)),
      appendTranscriptEntry(entry) { if (!db.durable) return false; sql.prepare("INSERT INTO transcript(id,entry) VALUES(?,?)").run(entry.id, JSON.stringify(entry)); return true; },
      updateTranscriptEntry(id, transform) { const row = sql.prepare("SELECT entry FROM transcript WHERE id=?").get(id); if (!row || !db.durable) return null; const next = transform(JSON.parse(row.entry)); sql.prepare("UPDATE transcript SET entry=? WHERE id=?").run(JSON.stringify(next), id); return next; },
      deleteTranscriptEntry: id => sql.prepare("DELETE FROM transcript WHERE id=?").run(id),
      setIntroductionPending: noop, getAwaitingUserResponse: () => null, setAwaitingUserResponse: noop,
      close: noop,
    };
    const session = { id, dbPath, db, agentStore: { dispose: async () => {} } };
    sessions.set(id, session);
    runtime.writeSandProfileFile(runtime.getSandProfilePath(dir), { name: id.toUpperCase(), description: "Persistent colleague", title: "", avatarShape: "blob", avatarColor: "green", inferenceVendorId: "fixture" });
  }
  for (const id of ["room", ...extraGroups]) runtime.writeSandGroupConfig(path.dirname(sessions.get(id).dbPath), { version: 1, memberIds: members });
  const tm = {
    sessions: { activeSession: null, inMemoryTranscriptAgentId: null, liveSessions: new Map(sessions), pendingSessionOpens: new Map(),
      isAgentGone: () => false, ensureActionTarget: async id => {
        const session = sessions.get(id);tm.sessions.activeSession = session;tm.sessions.inMemoryTranscriptAgentId = id;
        runtime.setTranscript(session.db.getTranscriptEntries());
      }, markActiveSessionArrival: noop, ensureSession: async () => sessions.get("a"),
      openSessionOnce: async id => sessions.get(id), settledOpen: async value => value,
    },
    sessionStore: { getAgentDir: id => path.dirname(sessions.get(id).dbPath), markSessionActivity: noop },
    roster: { lastKnownAgentNames: new Map(), resolveAgentProfile: session => ({ name: session.id, description: "Work within the user boundary" }), emit: (event, id) => events.push({ ...event, conversationId: id }), emitAgentUpdate: async () => {}, appendOutlineItem: noop },
    attachments: {readImageDimensions: async () => null},
    telemetry, productAnalytics: { trackEvent: noop }, trayErrors: { clearForAgent: noop, pushError: error => errors.push(error) },
    sharedRooms: { sharedRoomConfigOf: () => null, publishSharedRoomEntryIfNeeded: noop },
    ackObligations: { recordAckObligationSend: noop, armSendGuard: () => ({ disarm: noop }), mintAckRunToken: () => randomUUID(), retireAckRunToken: noop, scheduleAckRedriveAfterIdle: noop },
    acceptanceLedger: new runtime.PromptAcceptanceLedger(path.join(runtime.directory, "acceptance")),
    workflowCommands: { expandWorkflowReferences: (_s, prompt) => prompt, withMentionedAgentsContext: (_s, _p, expanded) => expanded },
    backgroundWakes: { dmPreemptedWakeAgentIds: new Set() },
    turnRuntime: { activeRequestPrompts: new Map(), activeRequestSources: new Map(),
      resolveReplyTarget: (entries, id) => entries.some(e => e.id === id) ? id : undefined,
      buildReplyContext: (_entries, id) => id ? { id } : undefined,
      async runTurn(session, runner, prompt, options, epoch) {
        directCalls.push({ id: session.id, prompt, options, epoch });
        try { await runDirect({ session, prompt, options, epoch });
          if (options.messageId) tm.sendPipeline.deliveries.settle(session.dbPath, options.messageId, session.id, "replied");
        } finally { tm.runLifecycle.endSessionRun(session); }
      },
    },
    runnerRegistry: { runners: new Map(), activeGroupMemberRunners: new Map(),
      getRunner(session) { let runner = this.runners.get(session.id); if (!runner) { runner = { expireAutoReviewApprovals: noop, interrupt: reason => { interrupts.push({ id: session.id, reason }); return true; } }; this.runners.set(session.id, runner); } return runner; },
      runnerHooksFor: (_session, transport) => transport,
      wireRunnerLifecycle: noop, interruptWedgedRunForWatchdog: () => false,
    },
    execution: { canExecute: true, canExecuteGroupMember: true,
      createGroupMemberRunner(session, hooks, overrides) {
        return {
          interrupt: reason => { interrupts.push({ id: session.id, reason }); return true; },
          async run(prompt) {
            const call = { id: session.id, prompt, systemPrompt: overrides.systemPrompt,
              publish(message) { hooks.onUpdate({type: "send-message", message: typeof message === "string" ? {type: "text", content: message} : message}); return hooks.lastSentMessageId?.(); },
              update: update => hooks.onUpdate(update),
            }; calls.push(call);
            const output = await runMember(call, calls.filter(item => item.id === session.id).length);
            for (const content of output) call.publish(content);
            return { aborted: false, sentMessageCount: output.length };
          },
        };
      },
    },
  };
  tm.appendEntry = (entry, options = {}) => {
    const durable = tm.sessions.activeSession.db.appendTranscriptEntry(entry);
    options.onPersistOutcome?.(durable);
    if (!durable) throw new Error("Test database could not persist the active entry");
    runtime.appendEntry(entry);return entry;
  };
  tm.sendPipeline = new runtime.SendPipeline(tm);
  tm.sendPrompt = (...args) => tm.sendPipeline.sendPrompt(...args);
  tm.widgetResponses = new runtime.WidgetResponses(tm);
  tm.groupChat = new runtime.GroupChatGlue(tm);
  tm.runLifecycle = new runtime.RunLifecycle(tm);
  t.after(() => tm.runLifecycle.runScheduler?.dispose());
  return { tm, runtime, sessions, calls, directCalls, events, errors, interrupts,
    entries: id => sessions.get(id).db.getTranscriptEntries(),
    records: id => tm.sendPipeline.deliveries.list(sessions.get(id).dbPath),
    send: (text, id = "room", options = {}) => tm.sendPipeline.sendPrompt(text, { agentId: id, directAddressedAcceptance: true, clientNonce: randomUUID(), awaitTurn: false, ...options }),
    async drain() { await Promise.all([...tm.groupChat.activeRooms.values()].map(room => room.done)); await until(() => tm.runLifecycle.inFlightRunCounts.size === 0, "All run references should retire"); },
  };
}

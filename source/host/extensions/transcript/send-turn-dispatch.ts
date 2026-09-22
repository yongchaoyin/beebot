import { ConversationDeliveries, postConversationNotice } from "./conversation-delivery.js";
import { buildComposedOfflineNote } from "./send-message-shaping.js";
import type {
  TranscriptEntry,
  TranscriptManagerLike,
} from "./transcript-hub.js";
import type { LiveTranscriptSession } from "./session-runtime.js";

export interface RecoverySend {
  readonly epoch: number;
  readonly messageId: string;
  readonly recentUserMessages: readonly {
    id: string;
    text: string;
    richText?: unknown;
  }[];
}

export interface SendAckGuard {
  disarm(): void;
}

export interface DispatchUserTurnArgs {
  readonly tm: TranscriptManagerLike;
  readonly session: LiveTranscriptSession;
  readonly trimmedPrompt: string;
  readonly richText?: unknown;
  readonly composedAtMs?: number;
  readonly enterEpochMs?: number;
  readonly clientNonce?: string;
  readonly awaitTurn: boolean;
  readonly isFork: boolean;
  readonly userMessageId?: string;
  readonly replyContext?: unknown;
  readonly selectedImages: readonly unknown[];
  readonly selectedVideos?: readonly unknown[];
  readonly fileAttachmentPaths: readonly string[];
  readonly attachedFileSizes: ReadonlyMap<string, number>;
  readonly traceCtx?: unknown;
  readonly acceptedAtMs: number;
  readonly wasInFlight: boolean;
  readonly readAddressedTranscript: () => readonly TranscriptEntry[];
  readonly latestRecoverySends: Map<string, RecoverySend>;
  readonly recoveryBreakEpochs: Map<string, number>;
  readonly nextTurnEpoch: (session: LiveTranscriptSession) => number;
  readonly markSendAccepted: (clientNonce?: string) => void;
  readonly ackGuard: SendAckGuard;
}

const queuedSends = new WeakMap<TranscriptManagerLike, Map<string, Promise<void>>>();

export async function dispatchUserTurn(
  args: DispatchUserTurnArgs,
): Promise<void> {
  const {
    tm,
    session,
    trimmedPrompt,
    richText,
    composedAtMs,
    enterEpochMs,
    clientNonce,
    awaitTurn,
    isFork,
    userMessageId,
    replyContext,
    selectedImages,
    selectedVideos,
    fileAttachmentPaths,
    attachedFileSizes,
    traceCtx,
    acceptedAtMs,
    wasInFlight,
    readAddressedTranscript,
    latestRecoverySends,
    recoveryBreakEpochs,
    nextTurnEpoch,
    markSendAccepted,
    ackGuard,
  } = args;
  const runner = tm.runnerRegistry.getRunner(session);
  const recentUserMessages =
    userMessageId == null
      ? undefined
      : readAddressedTranscript()
          .filter(
            (entry) =>
              entry.kind === "message" &&
              entry.role === "user" &&
              entry.fromAgent == null &&
              entry.channel == null,
          )
          .map((entry) => ({
            id: entry.id,
            text: typeof entry.content === "string" ? entry.content : "",
            ...(entry.richText == null ? {} : { richText: entry.richText }),
          }));
  const expandedPrompt = tm.workflowCommands.withMentionedAgentsContext(
    session,
    trimmedPrompt,
    tm.workflowCommands.expandWorkflowReferences(
      session,
      trimmedPrompt,
      richText,
    ),
  );
  const composeNote =
    composedAtMs == null ? "" : buildComposedOfflineNote(composedAtMs);
  const promptForRun =
    composeNote.length > 0
      ? `${composeNote}\n${expandedPrompt}`
      : expandedPrompt;
  const deliveries = new ConversationDeliveries(tm, session);
  const deliveryKey = JSON.stringify([session.id, userMessageId]);
  let pending = queuedSends.get(tm);
  if (!pending) { pending = new Map(); queuedSends.set(tm, pending); }
  const duplicate = userMessageId && pending.get(deliveryKey);
  if (duplicate) {
    ackGuard.disarm(); markSendAccepted(clientNonce);
    if (awaitTurn) await duplicate;
    return;
  }
  if (userMessageId) {
    const reply = replyContext as { targetId?: unknown } | undefined;
    const input = { prompt: trimmedPrompt, attachmentPaths: [...fileAttachmentPaths],
      ...(typeof richText === "string" ? { richText } : {}),
      ...(typeof reply?.targetId === "string" ? { replyToId: reply.targetId } : {}),
      ...(isFork ? { isFork: true } : {}) };
    // The full attachment set is recorded at the send boundary before dispatch.
    deliveries.accept(userMessageId, [session.id], input);
    const recipient = deliveries.read(userMessageId)?.recipients.find(item => item.botId === session.id);
    if (recipient?.phase !== "queued") {
      ackGuard.disarm(); markSendAccepted(clientNonce); return;
    }
  }
  tm.runLifecycle.beginSessionRun(session);
  tm.ackObligations.confirmAckObligationAfterInterrupt(session, acceptedAtMs, false);
  const queueStartEpochMs = Date.now(), queueStartPerfMs = performance.now();
  let ackToken: string | undefined;
  const turnDone = (tm.runLifecycle.enqueueExclusiveRun(session.id, async () => {
    let attempt: string | undefined;
    if (tm.disposed || tm.sessions.isAgentGone?.(session.id)) {
      if (userMessageId) deliveries.cancelQueued(userMessageId);
      return;
    }
    if (userMessageId) {
      attempt = deliveries.start(userMessageId, session.id);
      if (!attempt) return;
    }
    // Allocate the execution epoch only after this Bot owns its run slot.
    // Incoming messages cannot invalidate the reply that is still being produced.
    const epoch = nextTurnEpoch(session);
    if (userMessageId != null && !isFork && recentUserMessages != null)
      latestRecoverySends.set(session.id, { epoch, messageId: userMessageId, recentUserMessages });
    else recoveryBreakEpochs.set(session.id, epoch);
    ackToken = tm.ackObligations.mintAckRunToken(session.id);
    const before = new Set((session.db.getTranscriptEntries() as TranscriptEntry[]).map(entry => entry.id));
    const outcome = await tm.turnRuntime.runTurn(session, runner, promptForRun, {
      richText, selectedImages, selectedVideos, attachedFilePaths: fileAttachmentPaths,
      attachedFileSizes, messageId: userMessageId, recentUserMessages, replyContext,
      isFork, traceCtx, enterEpochMs, queueStartEpochMs, queueStartPerfMs, clientNonce, ackToken,
    }, epoch);
    if (userMessageId && attempt) {
      const replies = (session.db.getTranscriptEntries() as TranscriptEntry[])
        .filter(entry => !before.has(entry.id) && entry.kind === "send-message" && !entry.beebotNotice)
        .map(entry => entry.id);
      const phase = outcome?.phase ?? (replies.length ? "responded" : "uncertain");
      deliveries.settle(userMessageId, session.id, attempt, phase, replies);
      if (phase === "failed" || phase === "uncertain")
        postConversationNotice(tm, session, userMessageId, phase,
          /[\u3400-\u9fff]/u.test(trimmedPrompt)
            ? (phase === "failed" ? "这次处理没有完成回复。你的消息已保留，可以继续交流；再次执行前应核查已有操作。" : "这次执行已中断，结果需要核查。没有自动重跑，你可以继续发送其他消息。")
            : (phase === "failed" ? "This response could not be completed. Your message is retained; you can continue chatting. Verify prior effects before retrying execution." : "This execution was interrupted and needs verification. It was not replayed; you can continue chatting."));
    }
  }, { lane: "user", source: "turn", acceptedAtMs }) as Promise<void>).catch(error => {
    if (userMessageId) {
      const receipt = deliveries.read(userMessageId)?.recipients.find(item => item.botId === session.id);
      if (receipt?.attempt) deliveries.settle(userMessageId, session.id, receipt.attempt, "uncertain");
      postConversationNotice(tm, session, userMessageId, "queue-failed",
        /[\u3400-\u9fff]/u.test(trimmedPrompt) ? "消息处理遇到问题，尚未确认完成；请核查后继续，不会自动重跑外部操作。" : "Message processing could not be confirmed. Check its state before continuing; external actions were not replayed.");
    }
    throw error;
  }).finally(() => {
    tm.ackObligations.retireAckRunToken(session.id, ackToken);
    tm.runLifecycle.endSessionRun(session);
    if (pending!.get(deliveryKey) === turnDone) pending!.delete(deliveryKey);
  });
  if (userMessageId) pending.set(deliveryKey, turnDone);
  ackGuard.disarm();
  markSendAccepted(clientNonce);
  if (awaitTurn) await turnDone;
  else
    void turnDone.catch((error: unknown) =>
      console.error(
        "[sand] detached turn failed after send acceptance:",
        error,
      ),
    );
}

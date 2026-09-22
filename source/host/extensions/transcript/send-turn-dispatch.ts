import { publishDelivery } from "./conversation-deliveries.js";
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
  const controlEpoch = tm.sendPipeline.currentControlEpoch(session);
  if (userMessageId) publishDelivery(tm, session, tm.sendPipeline.deliveries.route(session.dbPath, userMessageId, [session.id]));
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
  // Normal follow-ups are not an interrupt. The same Bot may have a group
  // commitment; keep that commitment and queue its private reply independently.
  tm.runLifecycle.beginSessionRun(session);
  const ackToken = tm.ackObligations.mintAckRunToken(session.id);
  const queueStartEpochMs = Date.now();
  const queueStartPerfMs = performance.now();
  const turnDone = tm.runLifecycle.enqueueExclusiveRun(
    session.id,
    async () => {
      let handedToRuntime = false;
      try {
      if (tm.sendPipeline.currentControlEpoch(session) !== controlEpoch) {
        if (userMessageId) publishDelivery(tm, session, tm.sendPipeline.deliveries.settle(session.dbPath, userMessageId, session.id, "cancelled"));
        return;
      }
      if (userMessageId) publishDelivery(tm, session, tm.sendPipeline.deliveries.settle(session.dbPath, userMessageId, session.id, "processing"));
      // Allocate execution identity only at dequeue, not while another reply is
      // active. Otherwise a third message makes the second look obsolete.
      const epoch = nextTurnEpoch(session);
      if (userMessageId != null && !isFork && recentUserMessages != null) {
        latestRecoverySends.set(session.id, { epoch, messageId: userMessageId, recentUserMessages });
      } else recoveryBreakEpochs.set(session.id, epoch);
      handedToRuntime = true;
      return await tm.turnRuntime.runTurn(
        session,
        runner,
        promptForRun,
        {
          richText,
          selectedImages,
          selectedVideos,
          attachedFilePaths: fileAttachmentPaths,
          attachedFileSizes,
          messageId: userMessageId,
          recentUserMessages,
          replyContext,
          isFork,
          traceCtx,
          enterEpochMs,
          queueStartEpochMs,
          queueStartPerfMs,
          clientNonce,
          ackToken,
        },
        epoch,
      );
      } finally {
        if (!handedToRuntime) {
          tm.ackObligations.retireAckRunToken(session.id, ackToken);
          tm.runLifecycle.endSessionRun(session);
        }
      }
    },
    {
      lane: "user",
      source: "turn",
      acceptedAtMs,
      ...(ackToken == null ? {} : { ackToken }),
    },
  ) as Promise<void>;
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

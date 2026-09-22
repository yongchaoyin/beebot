import { ConversationDeliveries, deliveryOf, postConversationNotice } from "./conversation-delivery.js";
import { deliverGroupMessage } from "./group-message-delivery.js";
import { dispatchUserTurn } from "./send-turn-dispatch.js";
import { loadSelectedImageInputs } from "../../selected-image-inputs.js";
import { buildSelectedVideos, splitAttachmentPathsByChannel, statAttachedFileSizes } from "./send-message-shaping.js";
import type { TranscriptEntry, TranscriptManagerLike } from "./transcript-hub.js";

/** Recovery never resubmits a started/unknown external action. Only never-started deliveries may resume. */
export async function recoverConversationDeliveries(tm: TranscriptManagerLike): Promise<void> {
  const agents: { id: string }[] = await tm.sessionStore.listAgents();
  for (const agent of agents) {
    if (tm.disposed || tm.upgradeResume.quiescingForUpgrade) return;
    let session: any;
    try {
      session = await tm.groupChat.pinMemberSessionForGroupTurn(agent.id);
      if (tm.groupChat.isRemoteRoomSession(session)) continue;
      const ledger = new ConversationDeliveries(tm, session);
      const recovered = ledger.recover();
      const records = session.db.getTranscriptEntries() as TranscriptEntry[];
      const hasUnknown = records.some(entry => deliveryOf(entry, session.id)?.recipients.some(item => item.phase === "uncertain"));
      if (hasUnknown) {
        // The legacy acknowledgement recovery could otherwise retry the whole task.
        tm.ackObligationStore?.clear(session.id);
        tm.ackObligations.clearAckRedriveTimer(session.id);
        for (const entry of recovered.uncertain) postConversationNotice(tm, session, entry.id, "recovery-review",
          /[\u3400-\u9fff]/u.test(String(entry.content ?? ""))
            ? "上次执行中断，已有操作需要核查。待处理消息仍然保留，没有自动重跑。你可以在会话中说明接下来要做什么。"
            : "An earlier execution was interrupted. Pending messages are retained, but prior effects need verification; nothing was replayed. Tell your colleague how to continue in this conversation.");
        continue;
      }
      if (!recovered.queued.length || !tm.execution.canExecute) continue;
      if (tm.groupChat.isGroupSession(session)) {
        const { done } = await deliverGroupMessage(tm, session, recovered.queued[0]!.id);
        void done.catch(() => {});
        continue;
      }
      for (const entry of recovered.queued) {
        const delivery = ledger.read(entry.id);
        if (!delivery?.recipients.some(item => item.botId === session.id && item.phase === "queued")) continue;
        const input = delivery.input;
        if (!input || typeof input.prompt !== "string" || !Array.isArray(input.attachmentPaths)) {
          postConversationNotice(tm, session, entry.id, "recovery-input",
            "This message is retained, but its complete execution input is unavailable. Reply to the original message to continue; no work was guessed or replayed.");
          continue;
        }
        const attachments = splitAttachmentPathsByChannel(input.attachmentPaths);
        const replyContext = input.replyToId == null ? undefined : tm.turnRuntime.buildReplyContext(records, input.replyToId);
        await dispatchUserTurn({ tm, session, trimmedPrompt: input.prompt,
          ...(input.richText == null ? {} : { richText: input.richText }),
          awaitTurn: false, isFork: input.isFork === true, userMessageId: entry.id,
          ...(replyContext ? { replyContext } : {}),
          selectedImages: await loadSelectedImageInputs(attachments.imageAttachmentPaths),
          selectedVideos: buildSelectedVideos(attachments.videoAttachmentPaths),
          fileAttachmentPaths: attachments.fileAttachmentPaths,
          attachedFileSizes: await statAttachedFileSizes(input.attachmentPaths),
          acceptedAtMs: typeof entry.timestampMs === "number" ? entry.timestampMs : Date.now(),
          wasInFlight: tm.runLifecycle.runningAgentIds().has(session.id),
          readAddressedTranscript: () => session.db.getTranscriptEntries(),
          latestRecoverySends: tm.sendPipeline.latestRecoverySends,
          recoveryBreakEpochs: tm.sendPipeline.recoveryBreakEpochs,
          nextTurnEpoch: target => tm.sendPipeline.nextTurnEpoch(target),
          markSendAccepted: () => {}, ackGuard: { disarm() {} },
        });
      }
    } catch (error) {
      // Keep other conversations recoverable. Do not log message contents or secrets.
      console.error("[beebot] conversation recovery needs attention", error instanceof Error ? error.name : "unknown");
    } finally {
      if (session) tm.runLifecycle.endSessionRun(session);
    }
  }
}

/** Explicit user control. Sending another message never calls this function. */
export async function stopConversation(tm: TranscriptManagerLike, args: unknown): Promise<{ stopped: boolean; externalEffects: "may-remain" }> {
  if (args == null || typeof args !== "object" || !("agentId" in args)
    || typeof args.agentId !== "string" || !args.agentId.trim()) throw new Error("Choose a conversation to stop.");
  const session = await tm.groupChat.pinMemberSessionForGroupTurn(args.agentId);
  try {
    if (tm.groupChat.isRemoteRoomSession(session)) throw new Error("Stop work on the owning server; this shared room is read-only here.");
    new ConversationDeliveries(tm, session).stop();
    tm.sendPipeline.nextTurnEpoch(session);
    tm.ackObligationStore?.clear(session.id);
    tm.ackObligations.clearAckRedriveTimer(session.id);
    let stopped = false;
    if (tm.groupChat.isGroupSession(session)) {
      for (const [memberId, roomId] of tm.groupChat.activeMemberRooms as Map<string, string>) if (roomId === session.id)
        stopped = (tm.runnerRegistry.activeGroupMemberRunners.get(memberId)?.interruptAll("User stopped this group conversation") ?? false) || stopped;
    } else stopped = tm.runnerRegistry.runners.get(session.id)?.interruptAll("User stopped this conversation") ?? false;
    const source = (session.db.getTranscriptEntries() as TranscriptEntry[]).filter(entry => deliveryOf(entry, session.id)).at(-1);
    if (source) postConversationNotice(tm, session, source.id, `stop-${tm.sendPipeline.currentTurnEpoch(session)}`,
      /[\u3400-\u9fff]/u.test(String(source.content ?? ""))
        ? "已停止后续处理。已经发生的外部操作不会自动撤销；可以继续发送新的消息。"
        : "Further processing was stopped. External actions already performed were not undone; you can send new messages.");
    return { stopped, externalEffects: "may-remain" };
  } finally { tm.runLifecycle.endSessionRun(session); }
}

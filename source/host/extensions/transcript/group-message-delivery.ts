import { dirname } from "node:path";
import { readSandGroupConfig } from "../../groups/group-store.js";
import { formatRemoteAgentId } from "../../../shared/agents/sharing.js";
import { parseGroupMentions, resolveMessageResponders, type GroupMessage, type GroupMember } from "../../groups/group-chat.js";
import { GroupChatOrchestrator } from "./group-chat-orchestrator.js";
import { ConversationDeliveries, postConversationNotice } from "./conversation-delivery.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";

interface RoomConsumer { epoch: number; orchestrator: GroupChatOrchestrator; done: Promise<void> }
const consumers = new WeakMap<TranscriptManagerLike, Map<string, RoomConsumer>>();

/** Resolve at admission; display names may change after this message was accepted. */
export async function resolveGroupRecipientIds(tm: TranscriptManagerLike, session: any, content: string): Promise<string[]> {
  const config = readSandGroupConfig(dirname(session.dbPath));
  if (!config) throw new Error("The group no longer exists.");
  const ids = [...config.memberIds, ...(config.remoteMembers ?? []).map(formatRemoteAgentId)];
  const members: GroupMember[] = await tm.groupChat.resolveGroupMembers(ids, config.remoteMembers ?? []);
  const recipients = resolveMessageResponders(members, [{ speaker: { kind: "user" }, content }]).map(member => member.id);
  if (!recipients.length) throw new Error("No available group member can receive this message.");
  return recipients;
}

/** One live inbox per room; each colleague still uses the existing per-Bot execution lock. */
export async function deliverGroupMessage(tm: TranscriptManagerLike, session: any, messageId: string, traceCtx?: unknown): Promise<{ done: Promise<void> }> {
  const config = readSandGroupConfig(dirname(session.dbPath));
  if (!config) throw new Error("The group no longer exists.");
  const memberIds = [...config.memberIds, ...(config.remoteMembers ?? []).map(formatRemoteAgentId)];
  const members: GroupMember[] = await tm.groupChat.resolveGroupMembers(memberIds, config.remoteMembers ?? []);
  const history: GroupMessage[] = tm.groupChat.readGroupHistory(session);
  const message = history.find(item => item.id === messageId);
  if (!message) throw new Error("The source group message is unavailable. No work was started.");
  const deliveries = new ConversationDeliveries(tm, session);
  const accepted = deliveries.read(messageId);
  const recipients = accepted ? members.filter(member => accepted.recipients.some(item => item.botId === member.id)) : resolveMessageResponders(members, [message]);
  if (!recipients.length) {
    if (message.speaker.kind === "member") return { done: Promise.resolve() };
    throw new Error("No available group member can receive this message.");
  }
  deliveries.accept(messageId, recipients.map(member => member.id));
  const recovery = deliveries.recover();
  for (const entry of recovery.uncertain) postConversationNotice(tm, session, entry.id, "execution-unknown",
    notice(entry.content, "上次执行中断，结果需要核查；没有自动重跑。你可以继续发送其他消息。", "A previous execution was interrupted and needs verification. It was not replayed; you can continue chatting."));
  const byId = new Map(history.filter(item => item.id).map(item => [item.id!, item]));
  const incoming = recovery.queued.flatMap(entry => {
    const source = byId.get(entry.id);
    if (!source) return [];
    const pending = deliveries.read(entry.id)!.recipients
      .filter(item => item.phase === "queued" && memberIds.includes(item.botId)).map(item => item.botId);
    return pending.length ? [{ ...source, requestIds: [entry.id], recipientIds: pending }] : [];
  });
  if (!incoming.length) return { done: Promise.resolve() };

  let rooms = consumers.get(tm);
  if (!rooms) { rooms = new Map(); consumers.set(tm, rooms); }
  const epoch = tm.sendPipeline.currentTurnEpoch(session);
  const existing = rooms.get(session.id);
  if (existing && existing.epoch === epoch && existing.orchestrator.receive(incoming)) return { done: existing.done };

  const base = tm.groupChat.groupOrchestratorDeps(session, epoch, traceCtx, "user");
  const attempts = new Map<string, Map<string, string>>();
  const isCurrent = () => !tm.disposed && tm.sendPipeline.currentTurnEpoch(session) === epoch;
  const orchestrator = new GroupChatOrchestrator({
    ...base,
    isCurrent,
    postMemberMessage(member, content, context) {
      const id = base.postMemberMessage(member, content, context);
      if (typeof id === "string") {
        const addressed = resolveMessageResponders(members, [{ id, speaker: { kind: "member", id: member.id, name: member.name }, content }]);
        if (addressed.length) deliveries.accept(id, addressed.map(item => item.id));
      }
      return id;
    },
    onMemberStarted(member, triggers) {
      const tokens = new Map<string, string>();
      for (const trigger of triggers) if (trigger.id) {
        const attempt = deliveries.start(trigger.id, member.id);
        if (attempt) tokens.set(trigger.id, attempt);
      }
      attempts.set(member.id, tokens);
      return !triggers.length || tokens.size > 0;
    },
    onMemberSettled(member, triggers, replyIds, posted) {
      const tokens = attempts.get(member.id) ?? new Map();
      for (const trigger of triggers) {
        const attempt = trigger.id && tokens.get(trigger.id);
        if (!trigger.id || !attempt) continue;
        const direct = parseGroupMentions(trigger.content, members).memberIds.includes(member.id)
          || (trigger.speaker.kind === "user" && deliveries.read(trigger.id)?.recipients.length === 1);
        const phase = posted > 0 ? "responded" : direct ? "failed" : "silent";
        deliveries.settle(trigger.id, member.id, attempt, phase, replyIds);
        if (phase === "failed") postConversationNotice(tm, session, trigger.id, `no-reply-${member.id}`,
          notice(trigger.content, `${member.name} 没有返回可见回复；问题仍在记录中。可以继续追问，系统不会自动重跑外部操作。`, `${member.name} returned no visible reply. Your question is retained; you can follow up. External actions were not replayed.`));
      }
      attempts.delete(member.id);
    },
    onMemberError(member, error, triggers) {
      const phase = error != null && typeof error === "object" && "code" in error && error.code === "execution_uncertain" ? "uncertain" : "failed";
      for (const trigger of triggers) {
        const attempt = trigger.id && attempts.get(member.id)?.get(trigger.id);
        if (trigger.id && attempt) {
          deliveries.settle(trigger.id, member.id, attempt, phase);
          postConversationNotice(tm, session, trigger.id, `member-failed-${member.id}`,
            notice(trigger.content, `${member.name} 本次处理遇到问题，尚未完成回复。消息已保留，其他同事可以继续；再次执行前需要核查已经发生的操作。`, `${member.name} could not finish this response. The message is retained and other colleagues can continue. Verify prior effects before retrying execution.`));
        }
      }
      attempts.delete(member.id);
    },
  });
  tm.runLifecycle.beginSessionRun(session);
  const consumer = { epoch, orchestrator, done: Promise.resolve() };
  rooms.set(session.id, consumer);
  consumer.done = orchestrator.run({ group: tm.groupChat.groupIdentityFor(session), memberIds, initialMessages: incoming })
    .catch(error => {
      deliveries.pauseQueued(); // A safety pause must not be silently restarted by an unrelated message.
      postConversationNotice(tm, session, messageId, "group-paused",
        notice(message.content, "群协作已暂停，消息没有被标为完成。你可以继续交流；执行过的操作不会自动重跑。", "Group collaboration paused. Messages were not marked complete; you can continue chatting. Prior actions were not replayed."));
      tm.trayErrors.pushError({ agentId: session.id, title: "Group collaboration paused", errorKind: "group_paused" });
      // The visible notice reports the failure; do not launch a second whole-room retry.
      console.error("[beebot] group consumer stopped", error instanceof Error ? error.name : "unknown");
    }).finally(() => {
      if (rooms!.get(session.id) === consumer) rooms!.delete(session.id);
      tm.runLifecycle.endSessionRun(session);
    });
  return { done: consumer.done };
}

function notice(source: unknown, chinese: string, english: string): string {
  return /[\u3400-\u9fff]/u.test(String(source ?? "")) ? chinese : english;
}

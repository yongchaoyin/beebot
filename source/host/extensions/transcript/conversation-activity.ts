import { ConversationDeliveries, deliveryOf } from "./conversation-delivery.js";
import type { TranscriptManagerLike, TranscriptEntry } from "./transcript-hub.js";

function conversationId(args: unknown): string {
  if (!args || typeof args !== "object" || !("agentId" in args) || typeof args.agentId !== "string" || !args.agentId.trim())
    throw new Error("Choose an existing conversation.");
  return args.agentId;
}

/** Read-only projection: never starts a model and never exposes execution inputs or attempt tokens. */
export async function getConversationActivity(tm: TranscriptManagerLike, args: unknown) {
  const id = conversationId(args), session = await tm.groupChat.pinMemberSessionForGroupTurn(id);
  try {
    const profiles = new Map<string, string>((await tm.sessionStore.listAgents()).map((profile: any) => [profile.id, profile.name]));
    const rows = (session.db.getTranscriptEntries() as TranscriptEntry[]).flatMap(entry => {
      const delivery = deliveryOf(entry, id);
      if (!delivery) return [];
      const message = entry.message as { type?: string; content?: string } | undefined;
      const text = typeof entry.content === "string" ? entry.content : message?.type === "text" ? message.content ?? "" : "";
      return [{ messageId: entry.id, revision: delivery.revision, preview: text.slice(0, 180),
        author: (entry.author as { name?: string } | undefined)?.name ?? null,
        recipients: delivery.recipients.map(recipient => ({ botId: recipient.botId, name: profiles.get(recipient.botId) ?? recipient.botId,
          phase: recipient.phase, updatedAt: recipient.updatedAt, replyIds: recipient.replyIds ?? [] })) }];
    });
    const activePhases = new Set(["queued", "processing"]), attentionPhases = new Set(["failed", "uncertain", "paused"]);
    const counts = { queued: 0, processing: 0, attention: 0 };
    for (const row of rows) for (const recipient of row.recipients) {
      if (recipient.phase === "queued") counts.queued++;
      if (recipient.phase === "processing") counts.processing++;
      if (attentionPhases.has(recipient.phase)) counts.attention++;
    }
    const relevant = rows.filter(row => row.recipients.some(recipient => activePhases.has(recipient.phase) || attentionPhases.has(recipient.phase)));
    return { conversationId: id, readOnly: tm.groupChat.isRemoteRoomSession(session), counts,
      items: relevant.slice(-100), truncated: relevant.length > 100, checkedAt: Date.now() };
  } finally { tm.runLifecycle.endSessionRun(session); }
}

/** Cancel only work which has never started; this is not a stop/undo of running effects. */
export async function cancelQueuedConversationMessage(tm: TranscriptManagerLike, args: unknown) {
  const id = conversationId(args);
  const request = args as { messageId?: unknown; expectedRevision?: unknown };
  if (typeof request.messageId !== "string" || !request.messageId || !Number.isSafeInteger(request.expectedRevision))
    throw new Error("Refresh the message before cancelling its queued processing.");
  const session = await tm.groupChat.pinMemberSessionForGroupTurn(id);
  try {
    if (tm.groupChat.isRemoteRoomSession(session)) throw new Error("Use the owning server for this shared conversation.");
    const ledger = new ConversationDeliveries(tm, session), record = ledger.read(request.messageId);
    if (!record || record.revision !== request.expectedRevision) throw new Error("This message changed. Refresh before cancelling.");
    if (!record.recipients.some(recipient => recipient.phase === "queued")) throw new Error("This message is no longer queued.");
    ledger.cancelQueued(request.messageId);
    return { cancelledQueued: true, runningWorkChanged: false };
  } finally { tm.runLifecycle.endSessionRun(session); }
}

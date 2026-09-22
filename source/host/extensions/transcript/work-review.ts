import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import { readSandGroupConfig } from "../../groups/group-store.js";
import { collaborationCommandSchema, type CollaborationWork, type WorkEvent } from "../../../shared/collaboration-work.js";
import { resultDigest, type WorkPublicationResult } from "../session/agent-db-work.js";
import { appendConversationNotice, publishDelivery } from "./conversation-deliveries.js";
import { isQuotableMessage } from "./message-reply-contract.js";
import { appendEntry, getTranscript } from "./transcript-store.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";

const id = z.string().trim().min(1).max(256);
const lookup = z.object({agentId: id, taskId: id}).strict();
const review = lookup.extend({contextId: z.string().uuid(), controlEpoch: z.number().int().nonnegative(),
  command: collaborationCommandSchema, note: z.string().trim().min(1).max(2000)}).strict();
const instances = new WeakMap<object, string>();
function contextId(tm: TranscriptManagerLike): string {
  let value = instances.get(tm); if (!value) {value = randomUUID(); instances.set(tm, value);} return value;
}
async function target(tm: TranscriptManagerLike, agentId: string): Promise<any> {
  if (tm.sessions.isAgentGone(agentId)) throw new Error("The conversation is unavailable.");
  const session = tm.sessions.liveSessions.get(agentId) ?? await tm.sessions.openSessionOnce(agentId);
  if (!session || tm.sessions.isAgentGone(agentId)) throw new Error("The conversation is unavailable.");
  const config = readSandGroupConfig(dirname(session.dbPath));
  if (tm.groupChat.isRemoteRoomSession(session) || tm.sharedRooms.sharedRoomConfigOf(session) || config?.sharedRoomId || config?.remoteMembers?.length)
    throw new Error("Work review is available only in local single-Bot and same-owner Group conversations.");
  if (typeof session.db.getCollaborationWorks !== "function") throw new Error("This store does not support recorded work review.");
  return session;
}

/** Authenticated Host read: no model calls, no selection change, no auto-resume. */
export async function getWorkReview(tm: TranscriptManagerLike, raw: unknown): Promise<Record<string, unknown>> {
  const args = lookup.parse(raw), session = await target(tm, args.agentId);
  const task = (session.db.getCollaborationWorks() as CollaborationWork[]).find(item => item.id === args.taskId);
  if (!task) throw new Error("This task is not in the selected conversation.");
  const entries = session.db.getTranscriptEntries();
  const results = (task.submission?.results ?? []).map(ref => {
    const entry = entries.find((item: any) => item.id === ref.id);
    const available = !!entry && isQuotableMessage(entry) && !entry.workEvent && ["text", "attachment"].includes(String(entry.message?.type)) && resultDigest(entry) === ref.digest;
    const message = available ? entry.message : undefined;
    return {id: ref.id, available, digest: ref.digest,
      text: typeof message?.content === "string" ? message.content.slice(0, 1600) : "",
      fileName: typeof message?.file_name === "string" ? message.file_name : ""};
  });
  return {task, results, contextId: contextId(tm), controlEpoch: tm.sendPipeline.currentControlEpoch(session)};
}

/** Only this authenticated RPC can set userReview. Model tool input never can.
 * Committing a review records a decision, not new tool/OS permission. Delivery is
 * separate: a committed review is never rolled back or repeated for a lost wake.
 */
export async function submitWorkReview(tm: TranscriptManagerLike, raw: unknown): Promise<Record<string, unknown>> {
  const args = review.parse(raw);
  if (args.command.action !== "review" || args.command.task_id !== args.taskId) throw new Error("Only the selected work review is allowed.");
  const session = await target(tm, args.agentId);
  if (args.contextId !== contextId(tm) || args.controlEpoch !== tm.sendPipeline.currentControlEpoch(session))
    throw new Error("Review context changed after reconnect or Stop. Read this result again before deciding.");
  const config = readSandGroupConfig(dirname(session.dbPath));
  const result = session.db.commitCollaborationMessage({
    actor: {id: "$user", name: "You"}, userReview: true,
    memberIds: config?.memberIds ?? [session.id], replyTo: args.command.submission_id, workOnId: args.taskId,
    message: {type: "text", content: args.note, reply_to: args.command.submission_id, work_on: args.taskId, collaboration: args.command},
  }) as WorkPublicationResult;
  if (tm.sessions.activeSession?.id === session.id && !getTranscript().some(entry => entry.id === result.entry.id)) {
    appendEntry(result.entry);tm.roster.emit({type: "appended", entry: result.entry}, session.id);
    tm.sessions.markActiveSessionArrival?.(session);
  } else if (!result.replay) {tm.sessionStore.markSessionActivity(session);void tm.roster.emitAgentUpdate(session.id);}
  if (result.replay) return {recorded: true, replay: true, entryId: result.entry.id, task: result.task};
  const recipients = (result.entry.workEvent as WorkEvent).recipients;
  try {
    if (recipients.length && !tm.sendPipeline.hasReviewRequired(session.dbPath)) {
      // Register before dispatch; lost process ownership is surfaced for review,
      // not blindly replayed. No additional user chat message is fabricated.
      publishDelivery(tm, session, tm.sendPipeline.deliveries.route(session.dbPath, result.entry.id, recipients));
      if (config) {
        void tm.groupChat.enqueueRoomMessage(session, {id: result.entry.id, replyToId: args.command.submission_id,
          workOnId: args.taskId, speaker: {kind: "user"}, actionRecipientIds: recipients, content: args.note}, undefined, "user").catch(() => {
          // Admission was successful; unexpected later dispatch failure must not
          // produce an unhandled rejection or replay the committed review.
          try { appendConversationNotice(tm, session, "验收意见已保存，但后续处理失败。请核查后继续。 / Review recorded, but subsequent processing failed. Inspect before continuing.", result.entry.id, "work_review_followup_failed"); }
          catch { /* The receipt still exists; a later read can reconcile it. */ }
        });
      } else await tm.sendPipeline.dispatchWorkReview(session, result.entry);
      return {recorded: true, replay: false, notification: "queued", entryId: result.entry.id, task: result.task};
    }
    if (!recipients.length) return {recorded: true, replay: false, notification: "not-needed", entryId: result.entry.id, task: result.task};
  } catch { /* State/message/receipt are already durable: never replay the review. */ }
  appendConversationNotice(tm, session, "验收意见已保存，但后续通知尚未确认。请核查后引用此消息继续，不会自动重复执行。 / Review recorded; follow-up delivery needs inspection. Reply to this review after checking existing work; nothing was replayed.", result.entry.id, "work_review_delivery_pending");
  return {recorded: true, replay: false, notification: "needs-review", entryId: result.entry.id, task: result.task};
}

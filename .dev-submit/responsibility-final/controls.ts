import { createHmac, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import { collaborationReviewRequestSchema, type CollaborationTask } from "../../../shared/collaboration.js";
import { readSandGroupConfig } from "../../groups/group-store.js";
import { prepareCollaboration, projectCollaboration } from "./collaboration.js";
import { completionIsCurrent, projectCompletions } from "./collaboration-completion.js";
import { workDependenciesReady, workIsAccepted } from "./collaboration-transitions.js";
import { appendEntry } from "./transcript-store.js";
import { nextEntryId } from "./transcript-entry-ids.js";
import { appendConversationNotice, publishDelivery } from "./conversation-deliveries.js";
import type { TranscriptEntry, TranscriptManagerLike } from "./transcript-hub.js";

const query = z.object({agentId:z.string().trim().min(1).max(256)}).strict();

/** Only the authenticated coordinator UI invokes this service. A model cannot
 * choose actor=user through SendMessage. Tokens are freshness guards, not auth.
 * Projection, validation and append have no await under the single Host writer. */
export class CollaborationControls {
  private readonly instance = randomUUID();
  constructor(readonly tm: TranscriptManagerLike) {}

  private async room(id: string) {
    if (this.tm.sessions.isAgentGone(id)) throw new Error("work_room_unavailable");
    const session = this.tm.sessions.liveSessions.get(id) ?? await this.tm.sessions.openSessionOnce(id);
    if (!session || session.id !== id || this.tm.sessions.isAgentGone(id)) throw new Error("work_room_unavailable");
    if (this.tm.groupChat.isRemoteRoomSession(session) || this.tm.sharedRooms.sharedRoomConfigOf(session)) throw new Error("work_scope_unsupported");
    const group = readSandGroupConfig(dirname(session.dbPath));
    if (group?.sharedRoomId || group?.remoteMembers?.length) throw new Error("work_scope_unsupported");
    return {session, members:group?.memberIds ?? [id], group:!!group};
  }
  private token(id:string, task:CollaborationTask, members:readonly string[], entries:readonly TranscriptEntry[]) {
    const stop = [...entries].reverse().find(entry => entry.code === "conversation_stop_requested")?.id ?? null;
    return createHmac("sha256", this.instance).update(JSON.stringify([id, task.version, task.id, task.submission?.id, [...members].sort(), stop])).digest("hex");
  }
  private canReview(task:CollaborationTask, members:readonly string[], entries:readonly TranscriptEntry[]) {
    const submittedAt = entries.findIndex(entry => entry.id === task.submission?.id);
    return task.state === "review" && task.reviewer === "user" && submittedAt >= 0
      && members.includes(task.assignee) && members.includes(task.creator)
      && !entries.slice(submittedAt + 1).some(entry => entry.code === "conversation_stop_requested");
  }
  async snapshot(raw:unknown) {
    const {agentId} = query.parse(raw), {session,members} = await this.room(agentId);
    const entries:TranscriptEntry[] = session.db.getTranscriptEntries(), tasks = projectCollaboration(entries);
    return {agentId, tasks:[...tasks.values()].map(task => ({...task,
      dependenciesReady:workDependenciesReady(task,tasks), acceptedForCurrentInputs:workIsAccepted(task,tasks),
      canReview:this.canReview(task,members,entries), reviewToken:this.token(agentId,task,members,entries),
      evidence:(task.submission?.manifest ?? []).map(item => {
        const entry = entries.find(row => row.id === item.id), message = entry?.message as any;
        return {id:item.id, available:!!message, text:message?.type === "text" ? String(message.content).slice(0,4000) : "",
          files:item.files.map(file => ({sha256:file.sha256,bytes:file.bytes}))};
      })})),
      completions:[...projectCompletions(entries).values()].map(receipt => ({...receipt, current:completionIsCurrent(receipt,tasks)}))};
  }
  async review(raw:unknown) {
    const args = collaborationReviewRequestSchema.parse(raw), {session,members,group} = await this.room(args.agentId);
    const entries:TranscriptEntry[] = session.db.getTranscriptEntries();
    const content = args.review.verdict === "accept" ? "用户已逐项验收此版本。 / User reviewed and accepted this version." : "用户要求修改此版本。 / User requested changes to this version.";
    const message = {type:"text",content,reply_to:args.review.task_id,work_on:args.review.task_id,collaboration:args.review};
    const id = nextEntryId(entries,"send-message");
    const prepared = prepareCollaboration({actor:"user",trustedUser:true,messageId:id,dbPath:session.dbPath,members,entries,message});
    if (prepared.replayId) return {saved:true,replayed:true,messageId:prepared.replayId};
    const current = projectCollaboration(entries).get(args.review.task_id);
    if (!current || !this.canReview(current,members,entries) || this.token(args.agentId,current,members,entries) !== args.reviewToken)
      throw new Error("work_review_stale: Refresh this submitted version before reviewing; stopped work cannot be resumed by an old review.");
    const entry:TranscriptEntry = {id,kind:"notice",text:content,controlActor:"user",replyTo:args.review.task_id,
      timestampMs:Date.now(),collaborationEvent:prepared.event};
    if (session.db.appendTranscriptEntry(entry) === false) throw new Error("work_review_not_saved: No acceptance was recorded.");
    if (this.tm.sessions.activeSession?.id === session.id && this.tm.sessions.inMemoryTranscriptAgentId === session.id) {
      appendEntry(entry);this.tm.roster.emit({type:"appended",entry},session.id);
    } else void this.tm.roster.emitAgentUpdate(session.id);
    // Wake only recorded recipients, once for this command. Failure after saving
    // is visible and never masquerades as a rolled-back review or auto-replay.
    let notified = true;
    try {
      if (group && prepared.event?.wake.length) {
        publishDelivery(this.tm,session,this.tm.sendPipeline.deliveries.queue(session.dbPath,id));
        const done = this.tm.groupChat.enqueueRoomMessage(session,{id,speaker:{kind:"user"},content,
          replyToId:args.review.task_id,responseTargetId:args.review.task_id,workOnId:args.review.task_id,recipientIds:prepared.event.wake});
        void done.catch(() => appendConversationNotice(this.tm,session,"验收已保存，后续处理未确认；请检查本会话。 / Review saved; follow-up handling needs inspection.",args.review.task_id,"work_review_wake_failed"));
      } else if (!group) {
        await this.tm.sendPrompt(content,{agentId:session.id,appendUserMessage:false,replyToId:args.review.task_id,
          clientNonce:`work-review:${id}`,awaitTurn:false});
      }
    } catch {
      notified = false;
      appendConversationNotice(this.tm,session,"验收已保存，通知未确认；不要重复执行已有工作。 / Review saved, notification not confirmed. Inspect before continuing.",args.review.task_id,"work_review_wake_failed");
    }
    return {saved:true,messageId:id,notified};
  }
}

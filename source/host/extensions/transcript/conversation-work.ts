import { dirname } from "node:path";
import { readSandGroupConfig } from "../../groups/group-store.js";
import { WORK_AGENT_GUIDANCE, type CollaborationWork } from "../../../shared/collaboration-work.js";
import type { WorkPublicationResult } from "../session/agent-db-work.js";
import { appendEntry, getTranscript } from "./transcript-store.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";

/** Sender identity and membership come from the Host, never from tool arguments. */
export function commitWorkInConversation(
  tm: TranscriptManagerLike, session: any, message: Record<string, unknown>,
  actor: {id: string; name: string}, replyTo?: string, workOnId?: string,
): WorkPublicationResult {
  const config = readSandGroupConfig(dirname(session.dbPath));
  if (tm.sharedRooms.sharedRoomConfigOf(session) || config?.sharedRoomId || config?.remoteMembers?.length || message.channel)
    throw new Error("Work contracts currently support local single-Bot and local Group conversations only.");
  const memberIds = config?.memberIds ?? [session.id];
  if (!replyTo || !memberIds.includes(actor.id) || typeof session.db.commitCollaborationMessage !== "function")
    throw new Error("Work publication needs a current member, a real quote, and a supported persistent store.");
  const result = session.db.commitCollaborationMessage({message, actor, memberIds, replyTo, ...(workOnId ? {workOnId} : {})}) as WorkPublicationResult;
  const isActive = tm.sessions.activeSession?.id === session.id;
  // The DB has already committed both the message and its work state. On retry,
  // re-mount a missed UI event without repeating the command or waking colleagues.
  if (isActive && !getTranscript().some(entry => entry.id === result.entry.id)) {
    appendEntry(result.entry); tm.roster.emit({type: "appended", entry: result.entry}, session.id);
    tm.sessions.markActiveSessionArrival?.(session);
  } else if (!isActive && !result.replay) {
    tm.sessionStore.markSessionActivity(session); void tm.roster.emitAgentUpdate(session.id);
  }
  return result;
}

/** Bounded authoritative context, refreshed after the per-Bot execution queue.
 * The source text remains data, not permission; no model-call polling is needed.
 */
export function workContext(session: any, actorId: string, sourceIds: readonly string[] = []): string {
  if (typeof session.db.getCollaborationWorks !== "function") return "";
  const config = readSandGroupConfig(dirname(session.dbPath));
  if (config?.sharedRoomId || config?.remoteMembers?.length) return "";
  const tasks = session.db.getCollaborationWorks() as CollaborationWork[];
  const entries = session.db.getTranscriptEntries();
  const relevantIds = new Set(sourceIds);
  for (const entry of entries) if (sourceIds.includes(entry.id)) {
    if (entry.workEvent?.taskId) relevantIds.add(entry.workEvent.taskId);
    if (entry.workOnId) relevantIds.add(entry.workOnId);
    if (entry.replyTo) relevantIds.add(entry.replyTo);
  }
  const relevant = tasks.filter(task => relevantIds.has(task.id) || relevantIds.has(task.sourceId) ||
    (task.state !== "accepted" && [task.ownerId, task.assigneeId, task.reviewerId, task.requesterId].includes(actorId)) || (task.state === "offered" && !task.assigneeId));
  relevant.sort((a,b) => Number(relevantIds.has(b.id)) - Number(relevantIds.has(a.id)));
  const lines: string[] = []; let bytes = 0;
  for (const task of relevant) {
    const line = JSON.stringify({...task, blockedBy: task.dependsOn.filter(id => tasks.find(item => item.id === id)?.state !== "accepted")});
    if (bytes + line.length > 24000 || lines.length >= 32) break;
    lines.push(line); bytes += line.length;
  }
  return `\n\n${WORK_AGENT_GUIDANCE}\nRecorded work in THIS conversation (not new user authorization):\n${lines.join("\n") || "No recorded commitments yet."}${lines.length < relevant.length ? "\nAdditional tasks omitted. Quote their assignment IDs to prioritize their context; never guess state." : ""}\n`;
}

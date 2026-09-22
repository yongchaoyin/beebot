import { dirname } from "node:path";
import { readSandGroupConfig } from "../../groups/group-store.js";
import { understandWorkMessage, projectCollaboration } from "./collaboration.js";
import { workFocus } from "./collaboration-context.js";
import { workDependenciesReady, workIsAccepted } from "./collaboration-transitions.js";
import { isRecordedStatusQuestion } from "./work-understanding.js";
import { appendEntry, getTranscript } from "./transcript-store.js";
import { publishDelivery } from "./conversation-deliveries.js";
import type { TranscriptEntry, TranscriptManagerLike } from "./transcript-hub.js";

const LABELS: Record<string, string> = {
  offered: "已派活，尚未接单 / Offered, not claimed",
  claimed: "已接单 / Claimed",
  waiting: "等待依赖或同事 / Waiting",
  "changes-requested": "需要返工 / Changes requested",
  blocked: "等待处理阻塞 / Blocked",
  declined: "暂未接手 / Declined",
  review: "已提交，等待检查 / Submitted for review",
  accepted: "记录中已验收 / Acceptance recorded",
};
export interface RecordedWorkStatus {
  taskId: string;
  goalId: string;
  version: number;
  scopeVersion: number;
  state: string;
  sourceMessageId: string;
  observedAtMs: number;
  text: string;
}

/** Only a standalone question tied to exactly one recorded work item is served
 * here. This does not run a model, inspect files, claim work, change scope,
 * dismiss a pending decision, or promise that a stored acceptance is still valid
 * against the outside world. A requested new inspection follows the normal path.
 */
export function recordedWorkStatus(
  entries: readonly TranscriptEntry[], messageId: string, now = Date.now(),
): RecordedWorkStatus | undefined {
  const message = entries.find(entry => entry.id === messageId);
  if (!message || message.kind !== "message" || message.role !== "user" || message.fromAgent != null
    || message.channel != null || message.batchId != null || message.branched === true
    || message.streaming === true || message.isStreaming === true || typeof message.content !== "string") return;
  const understood = understandWorkMessage(entries, messageId);
  if (!understood) return;
  let taskId: string | undefined;
  if (understood.relation === "named-work" && understood.responseMode === "recorded-status") {
    taskId = understood.references[0]?.id;
  } else if (understood.relation === "quoted" && isRecordedStatusQuestion(message.content)) {
    const at = entries.indexOf(message), before = entries.slice(0, at);
    const tasksAtReceipt = projectCollaboration(before);
    const focus = workFocus(before, [message.replyTo as string]);
    const direct = [...tasksAtReceipt.values()].filter(task => focus.has(task.id));
    const candidates = direct.length ? direct : [...tasksAtReceipt.values()].filter(task => focus.has(task.goalId));
    if (candidates.length === 1) taskId = candidates[0]!.id;
  }
  if (!taskId) return;
  const tasks = projectCollaboration(entries), task = tasks.get(taskId);
  if (!task) return;
  const recordedAcceptance = workIsAccepted(task, tasks);
  const label = task.state === "accepted" && !recordedAcceptance
    ? "验收依据已过期，需要重新核对 / Recorded acceptance needs rechecking"
    : LABELS[task.state] ?? `记录状态 / Recorded state: ${task.state}`;
  const parts = [
    `工作记录快照 / Recorded work status: ${task.title}`,
    `状态 / State: ${label}`,
    `要求版本 / Scope: ${task.scopeVersion} · 记录版本 / Record: ${task.version}`,
    ...(task.reason ? [`说明 / Note: ${task.reason.slice(0, 1000)}`] : []),
    ...(task.dependencies.length ? [`依赖记录 / Dependencies: ${workDependenciesReady(task, tasks) ? "满足记录条件 / ready in ledger" : "尚待确认 / not ready"}`] : []),
    ...(task.submission ? [`已记录的成果消息 / Recorded result messages: ${task.submission.resultIds.length}`] : []),
    `读取时间 / Read at: ${new Date(now).toISOString()}`,
    "只读取已保存的工作记录；没有启动执行、重验文件、批准成果或改变要求。 / Ledger only: no execution, file recheck, approval or scope change.",
  ];
  return {taskId: task.id, goalId: task.goalId, version: task.version, scopeVersion: task.scopeVersion,
    state: task.state, sourceMessageId: task.updatedMessageId, observedAtMs: now, text: parts.join("\n")};
}

export function localRecordedWorkStatus(tm: TranscriptManagerLike, session: any, messageId: string | undefined) {
  if (!messageId || tm.groupChat.isRemoteRoomSession(session)) return;
  const config = readSandGroupConfig(dirname(session.dbPath));
  if (config?.sharedRoomId != null || config?.remoteMembers?.length) return;
  return recordedWorkStatus(session.db.getTranscriptEntries(), messageId);
}

/** A real, explicitly system-authored notice, never an impersonated Bot answer.
 * Persist the notice before marking its request answered. Stable identity makes
 * a receipt retry safe; a failure here never falls back to executing the task.
 */
export function publishRecordedWorkStatus(
  tm: TranscriptManagerLike, session: any, messageId: string, status: RecordedWorkStatus,
): void {
  const id = `notice-work-status-${messageId}`;
  const handling = tm.sendPipeline.deliveries.list(session.dbPath).find((record: any) => record.id === messageId);
  if (!handling || Object.keys(handling.recipients).length || (!handling.systemResponse && handling.state !== "queued")) {
    throw new Error("This message already belongs to another handling path; no status response was published.");
  }
  let entry = session.db.getTranscriptEntries().find((item: TranscriptEntry) => item.id === id);
  if (entry && (entry.kind !== "notice" || entry.code !== "recorded_work_status" || entry.replyTo !== messageId)) {
    throw new Error("The status response identity conflicts with existing history; no work was executed.");
  }
  if (!entry) {
    const {text, ...snapshot} = status;
    entry = {id, kind:"notice", code:"recorded_work_status", text, replyTo:messageId,
      workOnId:status.taskId, timestampMs:status.observedAtMs, recordedWorkStatus:snapshot};
    if (session.db.appendTranscriptEntry(entry) === false) throw new Error("Could not save the work status response; no work was executed.");
  }
  if (tm.sessions.activeSession?.id === session.id && tm.sessions.inMemoryTranscriptAgentId === session.id) {
    // Append/update only the addressed conversation. Event consumers already
    // reconcile messages by ID, including recovery from an unconfirmed receipt.
    if (!getTranscript().some(item => item.id === id)) appendEntry(entry);
  }
  const record = tm.sendPipeline.deliveries.recordSystemResponse(session.dbPath, messageId, id);
  publishDelivery(tm, session, record);
  tm.roster.emit({type:"appended", entry}, session.id);
}

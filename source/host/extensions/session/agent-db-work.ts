import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { collaborationCommandSchema, workStateSchema, type CollaborationWork, type WorkEvent } from "../../../shared/collaboration-work.js";
import { requireMessageReference, isQuotableMessage } from "../transcript/message-reply-contract.js";
import { nextEntryId } from "../transcript/transcript-entry-ids.js";
import type { TranscriptEntry } from "../transcript/transcript-hub.js";

export const WORK_TABLES = `
CREATE TABLE IF NOT EXISTS collaboration_tasks (id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS collaboration_commands (key TEXT PRIMARY KEY, digest TEXT NOT NULL, message_id TEXT NOT NULL) STRICT;
`;
export class CollaborationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "CollaborationError"; }
}
function requireFact(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new CollaborationError(code, message);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
// Read receipts, reactions and delivery bookkeeping are not edits to a result.
export const resultDigest = (entry: TranscriptEntry) => digest({id: entry.id, kind: entry.kind, author: entry.author, role: entry.role, content: entry.content, message: entry.message, replyTo: entry.replyTo, workOnId: entry.workOnId});
export function readCollaborationWorks(db: DatabaseSync): CollaborationWork[] {
  return db.prepare("SELECT value FROM collaboration_tasks ORDER BY rowid").all().map(row => workStateSchema.parse(JSON.parse(String(row.value))));
}
function related(entries: readonly TranscriptEntry[], messageId: string, root: string): boolean {
  const queue = [messageId], seen = new Set<string>();
  while (queue.length && seen.size < 64) {
    const id = queue.shift()!; if (id === root) return true;
    if (seen.has(id)) continue; seen.add(id);
    const entry = entries.find(item => item.id === id);
    if (!entry || !isQuotableMessage(entry)) continue;
    for (const ref of [entry.replyTo, entry.workOnId]) if (typeof ref === "string") queue.push(ref);
  }
  return false;
}
function hasUserSource(entries: readonly TranscriptEntry[], id: string): boolean {
  const queue = [id], seen = new Set<string>();
  while (queue.length && seen.size < 64) {
    const next = queue.shift()!; if (seen.has(next)) continue; seen.add(next);
    const entry = entries.find(item => item.id === next);
    if (!entry || !isQuotableMessage(entry)) continue;
    if (entry.kind === "message" && entry.role === "user" && entry.fromAgent == null && entry.channel == null) return true;
    if (entry.kind === "user-attachment") return true;
    for (const ref of [entry.replyTo, entry.workOnId]) if (typeof ref === "string") queue.push(ref);
  }
  return false;
}
export interface WorkPublicationInput {
  message: Record<string, unknown>; actor: {id: string; name: string}; memberIds: readonly string[];
  replyTo: string; workOnId?: string; timestampMs?: number;
}
export interface WorkPublicationResult { entry: TranscriptEntry; task: CollaborationWork; replay: boolean }

/** One SQLite transaction commits the responsibility, idempotency receipt and
 * its visible quoted message. Busy/corrupt writes fail closed, never auto-replay.
 * This must only be called by an authenticated local conversation transport.
 */
export function commitCollaborationWork(db: DatabaseSync, input: WorkPublicationInput): WorkPublicationResult {
  const command = collaborationCommandSchema.parse(input.message.collaboration);
  requireFact(input.message.type === "text" && typeof input.message.content === "string" && input.message.content.trim() && !input.message.channel && !input.message.images,
    "work_message_invalid", "Work operations must be ordinary local text messages. Publish files separately, then cite their IDs.");
  requireFact(input.memberIds.includes(input.actor.id), "work_member_unavailable", "The sender is not a current participant.");
  const key = canonical([input.actor.id, command.operation_id]);
  const fingerprint = digest({actorId: input.actor.id, message: {...input.message, collaboration: command}, replyTo: input.replyTo, workOnId: input.workOnId});
  db.exec("BEGIN IMMEDIATE");
  try {
    const entries = db.prepare("SELECT entry FROM transcript_entries ORDER BY seq").all().map(row => JSON.parse(String(row.entry)) as TranscriptEntry);
    const tasks = readCollaborationWorks(db);
    const receipt = db.prepare("SELECT digest,message_id FROM collaboration_commands WHERE key=?").get(key);
    if (receipt) {
      requireFact(receipt.digest === fingerprint, "work_key_conflict", "That operation_id was already used for different input. Reconcile the original operation; do not silently change its key.");
      const entry = entries.find(item => item.id === receipt.message_id);
      requireFact(entry?.workEvent, "work_receipt_unavailable", "The committed message is unavailable. Work was not repeated.");
      const event = entry.workEvent as WorkEvent, task = tasks.find(item => item.id === event.taskId);
      requireFact(task, "work_state_unavailable", "The recorded task is unavailable. Nothing was repeated.");
      db.exec("COMMIT"); return {entry, task, replay: true};
    }
    requireMessageReference(entries, input.replyTo);
    if (input.workOnId) requireMessageReference(entries, input.workOnId, "work_on");
    const messageId = nextEntryId(entries, "send-message");
    let task: CollaborationWork, recipients: string[] = [];
    const currentMember = (id: string | null) => id != null && input.memberIds.includes(id);
    if (command.action === "offer") {
      requireFact(tasks.filter(item => item.state !== "accepted").length < 256, "work_capacity", "Too many unresolved commitments. Finish or review existing work before adding more.");
      requireFact(hasUserSource(entries, input.replyTo), "work_source_missing", "Quote a real user request or a colleague's assignment linked to one. A peer message does not grant additional authorization.");
      requireFact(!command.assignee_id || currentMember(command.assignee_id), "work_member_unavailable", "The proposed assignee is unavailable.");
      requireFact(!command.reviewer_id || currentMember(command.reviewer_id), "work_member_unavailable", "The proposed reviewer is unavailable.");
      const assigneeId = command.assignee_id ?? (input.memberIds.length === 1 ? input.actor.id : null);
      const reviewerId = command.reviewer_id ?? (assigneeId !== input.actor.id ? input.actor.id : null);
      requireFact(!assigneeId || assigneeId !== reviewerId, "work_self_review", "A result cannot be accepted by its owner. In a solo chat keep it submitted for the user.");
      const dependsOn = [...new Set(command.depends_on)];
      requireFact(dependsOn.every(id => tasks.some(item => item.id === id)), "work_dependency_missing", "Every dependency must be an existing task in this conversation.");
      task = {schema: 1, id: messageId, sourceId: input.replyTo, requesterId: input.actor.id,
        assigneeId, reviewerId, ownerId: null, title: command.title, requirements: command.requirements,
        dependsOn, version: 1, state: "offered", latestMessageId: messageId, submission: null};
      // Dependencies only point backward to existing tasks, so offers cannot add a cycle.
      if (dependsOn.every(id => tasks.find(item => item.id === id)?.state === "accepted"))
        recipients = assigneeId ? [assigneeId] : input.memberIds.filter(id => id !== reviewerId);
    } else {
      const found = tasks.find(item => item.id === command.task_id);
      requireFact(found, "work_not_found", "The task is unavailable in this conversation.");
      requireFact(found.version === command.expected_version, "work_version_conflict", `Task is at version ${found.version}. Read current work context before retrying.`);
      requireFact(found.state !== "accepted", "work_final", "Reviewed work is immutable. Start a new, linked task for new scope.");
      requireFact(related(entries, input.replyTo, found.id), "work_quote_mismatch", "Quote this task's assignment, clarification or result, not an unrelated message.");
      requireFact(!input.workOnId || input.workOnId === found.id, "work_quote_mismatch", "work_on must identify this task's original assignment.");
      task = structuredClone(found); task.version++; task.latestMessageId = messageId;
      const dependenciesReady = () => requireFact(task.dependsOn.every(id => tasks.find(item => item.id === id)?.state === "accepted"), "work_dependency_pending", "Required results have not passed review. Wait for the dependency event, do not poll or start duplicate work.");
      if (command.action === "claim") {
        requireFact(task.state === "offered" && !task.ownerId, "work_already_owned", "This task has already been claimed. Coordinate with its owner.");
        requireFact(!task.assigneeId || task.assigneeId === input.actor.id, "work_wrong_assignee", "This assignment is reserved for another colleague.");
        requireFact(task.reviewerId !== input.actor.id, "work_self_review", "The designated reviewer cannot claim this task.");
        dependenciesReady(); task.ownerId = input.actor.id; task.state = "claimed";
      } else if (command.action === "revise") {
        requireFact(task.requesterId === input.actor.id, "work_not_requester", "Only this task's requester can revise its requirements within user scope.");
        task.requirements = command.requirements; task.submission = null;
        task.state = task.ownerId ? "changes_requested" : "offered";
        recipients = task.ownerId ? [task.ownerId] : task.assigneeId ? [task.assigneeId] : [];
      } else if (command.action === "review") {
        requireFact(task.reviewerId === input.actor.id && task.ownerId !== input.actor.id, "work_not_reviewer", "Only the designated independent reviewer can record this review.");
        requireFact(task.state === "submitted" && task.submission?.id === command.submission_id, "work_stale_submission", "Review the current submitted result, not an older version.");
        requireFact(task.submission.results.every(ref => { const entry = entries.find(e => e.id === ref.id); return entry && resultDigest(entry) === ref.digest; }), "work_result_changed", "A submitted result changed or disappeared. Ask the owner to submit a new version.");
        const criteria = new Set(command.checks.map(check => check.criterion));
        requireFact(criteria.size === command.checks.length && [...criteria].every(n => n <= task.requirements.length), "work_check_invalid", "Each review criterion must match one required item exactly once.");
        for (const check of command.checks) for (const id of check.evidence_ids) {
          const evidence = requireMessageReference(entries, id, "evidence_ids");
          requireFact(evidence.kind === "send-message" && !evidence.workEvent && ["text", "attachment"].includes(String((evidence.message as any)?.type)), "work_evidence_unrelated", "Use actual published evidence, not a claim, status change or question.");
          requireFact(task.submission.results.some(ref => ref.id === id) || ((evidence.author as any)?.id === input.actor.id && related(entries, id, task.id)), "work_evidence_unrelated", "Evidence must be a submitted result or this reviewer's linked inspection in this conversation.");
        }
        if (command.decision === "accept") {
          requireFact(criteria.size === task.requirements.length && command.checks.every(check => check.passed), "work_incomplete_review", "All required criteria need passing evidence before peer acceptance.");
          dependenciesReady(); task.state = "accepted";
          for (const dependent of tasks.filter(item => item.state === "offered" && item.dependsOn.includes(task.id))) {
            if (dependent.dependsOn.every(id => id === task.id || tasks.find(item => item.id === id)?.state === "accepted"))
              recipients.push(...(dependent.assigneeId ? [dependent.assigneeId] : input.memberIds.filter(id => id !== dependent.reviewerId)));
          }
        } else { task.state = "changes_requested"; recipients.push(task.ownerId!); }
        recipients.push(task.requesterId);
      } else {
        requireFact(task.ownerId === input.actor.id && currentMember(task.ownerId), "work_not_owner", "Only the current owner can block, resume or submit this work.");
        if (command.action === "block") {
          requireFact(["claimed", "changes_requested"].includes(task.state), "work_state_conflict", "Only active work can be marked blocked.");
          task.state = "blocked"; recipients = [task.requesterId];
        } else if (command.action === "resume") {
          requireFact(task.state === "blocked", "work_state_conflict", "Only blocked work can be resumed."); dependenciesReady(); task.state = "claimed";
        } else {
          requireFact(["claimed", "changes_requested"].includes(task.state), "work_state_conflict", "Claim the work before submitting, and resolve blockers first."); dependenciesReady();
          const results = [...new Set(command.result_ids)].map(id => {
            const entry = requireMessageReference(entries, id, "result_ids");
            requireFact(entry.kind === "send-message" && !entry.workEvent && !(entry.message as any)?.collaboration && ((entry.author as any)?.id ?? (input.memberIds.length === 1 ? input.actor.id : undefined)) === input.actor.id && ["text", "attachment"].includes(String((entry.message as any)?.type)) && related(entries, id, task.id), "work_result_unrelated", "Submit your actual published results linked to this assignment, not another colleague's work or an unrelated message.");
            return {id, digest: resultDigest(entry)};
          });
          task.submission = {id: messageId, results}; task.state = "submitted";
          recipients = task.reviewerId ? [task.reviewerId] : [];
        }
      }
    }
    recipients = [...new Set(recipients)].filter(id => id !== input.actor.id && currentMember(id));
    const event: WorkEvent = {schema: 1, taskId: task.id, version: task.version, title: task.title,
      state: task.state, action: command.action, actorId: input.actor.id, ownerId: task.ownerId,
      requesterId: task.requesterId, reviewerId: task.reviewerId, recipients};
    const entry: TranscriptEntry = {kind: "send-message", id: messageId, timestampMs: input.timestampMs ?? Date.now(),
      author: input.actor, message: {...input.message, collaboration: command}, replyTo: input.replyTo,
      ...(command.action !== "offer" ? {workOnId: task.id} : input.workOnId ? {workOnId: input.workOnId} : {}), workEvent: event};
    db.prepare("INSERT INTO collaboration_tasks(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(task.id, JSON.stringify(task));
    db.prepare("INSERT INTO transcript_entries(id,entry) VALUES(?,?)").run(entry.id, JSON.stringify(entry));
    db.prepare("INSERT INTO collaboration_commands(key,digest,message_id) VALUES(?,?,?)").run(key, fingerprint, entry.id);
    db.exec("COMMIT"); return {entry, task, replay: false};
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

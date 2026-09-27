import { collaborationCompletionSchema, type CollaborationAction, type CollaborationCompletion, type CollaborationTask } from "../../../shared/collaboration.js";
import { captureWorkEvidence, verifyWorkEvidence } from "./collaboration-evidence.js";
import { workIsCompleted } from "./collaboration-transitions.js";
import { requireMessageReference } from "./message-reply-contract.js";
import type { WorkPublication } from "./collaboration.js";
import type { TranscriptEntry } from "./transcript-hub.js";

/** Latest receipt is historical evidence. Adding or revising work reopens it;
 * no substring matching of a model's "done" message can close a goal. */
export function projectCompletions(entries: readonly TranscriptEntry[]): Map<string, CollaborationCompletion> {
  const result = new Map<string, CollaborationCompletion>();
  for (const entry of entries) {
    if (!entry.completionEvent) continue;
    const value = collaborationCompletionSchema.parse(entry.completionEvent);
    if (entry.kind !== "send-message" || (entry.author as any)?.id !== value.actor || value.id !== entry.id)
      throw new Error("work_completion_invalid: Receipt identity does not match its publication.");
    result.set(value.goalId, value);
  }
  return result;
}
export function completionIsCurrent(receipt: CollaborationCompletion, tasks: ReadonlyMap<string, CollaborationTask>): boolean {
  const required = [...tasks.values()].filter(task => task.goalId === receipt.goalId);
  return required.length > 0 && required.length === receipt.tasks.length
    && new Set(receipt.tasks.map(pin => pin.id)).size === required.length
    && required.every(task => receipt.tasks.some(pin => pin.id === task.id && pin.version === task.version) && workIsCompleted(task, tasks));
}

/** Deliver a current submitted result, or a fresh goal-linked synthesis of the
 * current submissions. A valid hash of unrelated prose is not goal delivery.
 * This only validates provenance; it cannot grade a model's conclusions. */
function validateCompletionResults(entries: readonly TranscriptEntry[], tasks: ReadonlyMap<string, CollaborationTask>,
  required: readonly CollaborationTask[], goalId: string, resultIds: readonly string[]): void {
  const byId = new Map(entries.map((entry, index) => [entry.id, {entry, index}]));
  const currentResults = new Set(required.flatMap(task => task.submission!.resultIds));
  const goalIds = new Set([...tasks.values()].map(task => task.goalId));
  const lastSubmission = Math.max(...required.map(task => byId.get(task.submission!.id)?.index ?? -1));
  for (const id of new Set(resultIds)) {
    const result = requireMessageReference(entries, id, "result_ids");
    if (result.collaborationEvent || result.completionEvent)
      throw new Error("work_finish_result_scope: Publish the actual result, not a claim, check or completion receipt.");
    if (currentResults.has(id)) continue;
    if (byId.get(id)!.index <= lastSubmission)
      throw new Error("work_finish_result_stale: Deliver a current submitted result or publish a fresh summary after the current work submissions.");
    const pending = [id], seen = new Set<string>();
    let linked = false;
    while (pending.length) {
      const next = pending.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const task = tasks.get(next);
      if ((task && task.goalId !== goalId) || (goalIds.has(next) && next !== goalId))
        throw new Error("work_finish_result_scope: Another goal's result cannot deliver this goal.");
      if (next === goalId || task?.goalId === goalId) { linked = true; continue; }
      const entry = byId.get(next)?.entry;
      for (const ref of [entry?.replyTo, entry?.workOnId]) if (typeof ref === "string") pending.push(ref);
    }
    if (!linked) throw new Error("work_finish_result_scope: Quote this user goal or one of its work assignments when publishing the final result.");
  }
}

export function prepareCompletion(input: WorkPublication, action: Extract<CollaborationAction, {action:"finish"}>, tasks: ReadonlyMap<string, CollaborationTask>, digest: string): CollaborationCompletion {
  const required = [...tasks.values()].filter(task => task.goalId === action.goal_message_id);
  if (!required.length || required[0]!.creator !== input.actor)
    throw new Error("work_closer_required: Only this goal's first assignment creator may close its recorded work; there is no permanent manager.");
  const receipt: CollaborationCompletion = {format:1, actor:input.actor, requestId:action.request_id, digest,
    id:input.messageId, goalId:action.goal_message_id, tasks:action.expected_tasks, manifest:[]};
  if (!completionIsCurrent(receipt, tasks)) throw new Error("work_finish_incomplete: Check every recorded task at its current version, including dependencies, before finishing.");
  for (const task of required) {
    if (!input.members.includes(task.assignee) || !input.members.includes(task.creator)
        || (!["self", "user"].includes(task.reviewer) && !input.members.includes(task.reviewer)))
      throw new Error("work_member_unavailable: Reconcile changed membership before delivery.");
    verifyWorkEvidence(input.entries, task.submission!.manifest, input.dbPath);
    // Independent test evidence need not be in the implementer's submission.
    // Compare the actual reviewed version, not a new hash of today's text.
    verifyWorkEvidence(input.entries, task.state === "completed" ? task.selfCheck!.manifest : task.review!.manifest!, input.dbPath);
  }
  validateCompletionResults(input.entries, tasks, required, action.goal_message_id, action.result_ids);
  receipt.manifest = captureWorkEvidence(input.entries, action.result_ids, input.dbPath);
  return receipt;
}

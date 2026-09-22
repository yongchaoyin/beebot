import { collaborationCompletionSchema, type CollaborationAction, type CollaborationCompletion, type CollaborationTask } from "../../../shared/collaboration.js";
import { captureWorkEvidence, verifyWorkEvidence } from "./collaboration-evidence.js";
import { workIsAccepted } from "./collaboration-transitions.js";
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
    && required.every(task => receipt.tasks.some(pin => pin.id === task.id && pin.version === task.version) && workIsAccepted(task, tasks));
}
export function prepareCompletion(input: WorkPublication, action: Extract<CollaborationAction, {action:"finish"}>, tasks: ReadonlyMap<string, CollaborationTask>, digest: string): CollaborationCompletion {
  const required = [...tasks.values()].filter(task => task.goalId === action.goal_message_id);
  if (!required.length || required[0]!.creator !== input.actor)
    throw new Error("work_closer_required: Only this goal's first assignment creator may close its recorded work; there is no permanent manager.");
  const receipt: CollaborationCompletion = {format:1, actor:input.actor, requestId:action.request_id, digest,
    id:input.messageId, goalId:action.goal_message_id, tasks:action.expected_tasks, manifest:[]};
  if (!completionIsCurrent(receipt, tasks)) throw new Error("work_finish_incomplete: Review every recorded task at its current version, including dependencies, before finishing.");
  for (const task of required) {
    if (!input.members.includes(task.assignee) || !input.members.includes(task.creator)
        || (task.reviewer !== "user" && !input.members.includes(task.reviewer)))
      throw new Error("work_member_unavailable: Reconcile changed membership before delivery.");
    verifyWorkEvidence(input.entries, task.submission!.manifest, input.dbPath);
    // Independent test evidence need not be in the implementer's submission.
    // Compare the actual reviewed version, not a new hash of today's text.
    verifyWorkEvidence(input.entries, task.review!.manifest!, input.dbPath);
  }
  receipt.manifest = captureWorkEvidence(input.entries, action.result_ids, input.dbPath);
  return receipt;
}

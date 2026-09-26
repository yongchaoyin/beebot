import type { CollaborationAction, CollaborationTask } from "../../../shared/collaboration.js";
import type { TranscriptEntry } from "./transcript-hub.js";

const check = (ok: unknown, code: string, detail: string): void => {if (!ok) throw new Error(`${code}: ${detail}`);};
type TransferAction = Extract<CollaborationAction, {action: "decline" | "reassign"}>;

/** Called after version and durable history validation, before the same SQLite
 * publication append. This changes an offer, not an OS execution lease. A wait
 * or scope revision must not conceal an older claim and permit blind takeover. */
export function transferUnstartedWork(input: {
  prior: CollaborationTask; action: TransferAction; actor: string; members: readonly string[];
  entries: readonly TranscriptEntry[]; messageId: string;
}): {task: CollaborationTask; wake: string[]} {
  const {prior, action, actor, members, entries, messageId} = input;
  if (action.action === "reassign") check(action.reviewer !== "user", "work_human_gate_unsupported",
    "Use owner checks or a current peer; ask actual user decisions in conversation rather than creating a manual acceptance workflow.");
  check(action.action === "decline" ? actor === prior.assignee : actor === prior.creator,
    action.action === "decline" ? "work_not_owner" : "work_not_coordinator", "Only the designated colleague can decline; only this assignment's coordinator can reassign.");
  const wasClaimed = entries.some(entry => {
    const task = (entry.collaborationEvent as {task?: CollaborationTask} | undefined)?.task;
    return task?.id === prior.id && (task.claimedBy != null || task.submission != null);
  });
  check(!wasClaimed && ["offered", "waiting", "declined"].includes(prior.state), "work_reassignment_unsafe",
    "This work may already have external effects. Inspect and explicitly stop/reconcile it; do not reassign or replay it.");
  const next = structuredClone({...prior, version: prior.version + 1, updatedBy: actor, updatedMessageId: messageId});
  next.reason = action.reason;
  if (action.action === "decline") {
    check(prior.state !== "declined", "work_already_declined", "The inability is already recorded; wait for the coordinator or send an informational update.");
    next.state = "declined";
    return {task: next, wake: [prior.creator]};
  }
  check(members.includes(action.assignee), "work_assignee_unavailable", "Select a current colleague; this record does not grant capabilities.");
  check(action.reviewer === "self" || (members.includes(action.reviewer) && action.reviewer !== action.assignee),
    "work_reviewer_invalid", "Choose self for owner checks or an independent current reviewer.");
  check(action.assignee !== prior.assignee || prior.state === "declined", "work_same_assignee", "Only a declined task can be explicitly re-offered to the same colleague.");
  next.assignee = action.assignee;next.reviewer = action.reviewer;next.state = "offered";next.scopeVersion++;
  next.reviewPolicy = action.reviewer === "self" ? "owner" : "peer";
  // Invalidate old assignment-scoped questions, retain goal/criteria/dependencies
  // and original quote identity. No automatic claim, cancellation or tool grant.
  return {task: next, wake: [action.assignee]};
}

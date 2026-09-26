import type { CollaborationAction, CollaborationTask } from "../../../shared/collaboration.js";
import { requireMessageReference } from "./message-reply-contract.js";
import { captureWorkEvidence, verifyWorkEvidence, validateWorkEvidenceProvenance } from "./collaboration-evidence.js";
import { transferUnstartedWork } from "./collaboration-reassignment.js";
import type { TranscriptEntry } from "./transcript-hub.js";

const check = (ok: unknown, code: string, detail: string): void => { if (!ok) throw new Error(`${code}: ${detail}`); };

/** Old review rows remain readable, but do not invent evidence pins on load. */
export function workReviewNeedsRefresh(task: CollaborationTask): boolean {
  return task.state === "accepted" && task.review?.verdict === "accept" && !task.review.manifest;
}

/** A Bot's self-check is a distinct assertion, never invented user/peer approval.
 * Either completion is invalidated by changes to its pinned prerequisites. */
export function workIsCompleted(task: CollaborationTask, tasks: ReadonlyMap<string, CollaborationTask>, seen = new Set<string>()): boolean {
  if (seen.has(task.id) || !task.submission || task.submission.scopeVersion !== task.scopeVersion) return false;
  const proof = task.state === "accepted" ? task.review : task.state === "completed" ? task.selfCheck : undefined;
  if (!proof?.manifest?.length || proof.submissionId !== task.submission.id
    || proof.checks.length !== task.criteria.length || !proof.checks.every(c => c.passed)
    || new Set(proof.checks.map(c => c.criterion)).size !== task.criteria.length
    || proof.checks.some(c => c.criterion >= task.criteria.length)) return false;
  if (task.state === "accepted" && (task.review?.verdict !== "accept"
    || task.review.reviewer !== task.reviewer || task.review.reviewer === task.assignee)) return false;
  if (task.state === "completed" && (task.selfCheck?.actor !== task.assignee
    || !(task.reviewer === "self" && task.reviewPolicy === "owner"
      || task.reviewer === "user" && task.reviewPolicy == null && !!task.selfCheck.sourceMessageId))) return false;
  const next = new Set(seen).add(task.id);
  return task.dependencies.every(id => {
    const dep = tasks.get(id);
    return !!dep && task.submission!.dependencyVersions.some(pin => pin.id === id && pin.version === dep.version) && workIsCompleted(dep, tasks, next);
  });
}
export function workIsAccepted(task: CollaborationTask, tasks: ReadonlyMap<string, CollaborationTask>): boolean {
  return task.state === "accepted" && workIsCompleted(task, tasks);
}
export function workDependenciesReady(task: CollaborationTask, tasks: ReadonlyMap<string, CollaborationTask>): boolean {
  return task.dependencies.every(id => {const dep = tasks.get(id);return !!dep && workIsCompleted(dep, tasks);});
}

function wakeReadyDependents(task: CollaborationTask, tasks: ReadonlyMap<string, CollaborationTask>): string[] {
  const projected = new Map(tasks).set(task.id, task);
  return [...projected.values()].filter(candidate => candidate.dependencies.includes(task.id)
    && (["offered", "waiting"].includes(candidate.state)
      || (["accepted", "completed"].includes(candidate.state) && !workIsCompleted(candidate, projected)))
    && workDependenciesReady(candidate, projected)).map(candidate => candidate.assignee);
}

/** Bounded relationship lookup: unrelated user chatter must not revise a work
 * contract or grant a scope change. Only actual quoted user corrections count. */
function addressesWork(entries: readonly TranscriptEntry[], source: TranscriptEntry, task: CollaborationTask): boolean {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const pending = [source.replyTo, source.workOnId].filter((id): id is string => typeof id === "string");
  const seen = new Set<string>();
  while (pending.length && seen.size < 64) {
    const id = pending.pop()!;
    if (id === task.id || id === task.goalId) return true;
    if (seen.has(id)) continue;seen.add(id);
    const entry = byId.get(id);
    for (const ref of [entry?.replyTo, entry?.workOnId]) if (typeof ref === "string") pending.push(ref);
  }
  return false;
}

export function advanceWork(args: {
  prior: CollaborationTask; action: Exclude<CollaborationAction, {action: "assign" | "finish"}>;
  actor: string; members: readonly string[]; tasks: ReadonlyMap<string, CollaborationTask>;
  entries: readonly TranscriptEntry[]; messageId: string; dbPath?: string | undefined;
}): {task: CollaborationTask; wake: string[]} {
  const {prior, action, actor, tasks, entries, messageId, members, dbPath} = args;
  check(prior.version === action.expected_version, "work_version_conflict", `Refresh work ${prior.id}; current version is ${prior.version}.`);
  if (action.action === "decline" || action.action === "reassign") {
    return transferUnstartedWork({prior, action, actor, members, entries, messageId});
  }
  const next = structuredClone({...prior, version: prior.version + 1, updatedBy: actor, updatedMessageId: messageId});
  let wake: string[] = [];
  if (action.action === "revise") {
    check(actor === prior.creator, "work_not_coordinator", "Only this work's coordinator may record a user correction.");
    const source = requireMessageReference(entries, action.source_message_id, "source_message_id");
    check(source.kind === "message" && source.role === "user" && source.fromAgent == null && addressesWork(entries, source, prior),
      "work_revision_unconfirmed", "Quote an actual user correction to this work; a peer's claim of approval is insufficient.");
    check(source.id !== prior.revisionSourceId && entries.indexOf(source) > entries.findIndex(entry => entry.id === (prior.revisionSourceId ?? prior.id)),
      "work_revision_stale", "Use a new correction after the assignment, not the original authorization again.");
    // This records scope for subsequent work; it does not undo an external call.
    next.title = action.title;next.criteria = action.criteria;next.scopeVersion++;
    next.revisionSourceId = source.id;next.state = "offered";delete next.claimedBy;delete next.reason;delete next.submission;delete next.review;delete next.selfCheck;
    next.evidenceIds = [];wake = [prior.assignee];
  } else if (action.action === "self-check") {
    check(actor === prior.assignee && members.includes(actor) && members.includes(prior.creator), "work_not_owner", "Only the current assignee can record its self-check; reconcile missing colleagues first.");
    check(prior.state === "review" && prior.submission?.id === action.submission_id && prior.submission.scopeVersion === prior.scopeVersion,
      "work_submission_stale", "Check the current published submission; do not run the task again.");
    const legacyHumanDefault = prior.reviewer === "user" && prior.reviewPolicy == null;
    check(prior.reviewer === "self" && prior.reviewPolicy === "owner" || legacyHumanDefault,
      "work_review_required", "A designated peer or explicitly required user review cannot be replaced by self-check.");
    const submittedAt = entries.findIndex(entry => entry.id === prior.submission!.id);
    const stopAt = entries.findLastIndex(entry => entry.code === "conversation_stop_requested");
    const stopped = stopAt > submittedAt;
    if (legacyHumanDefault || stopped) {
      const source = action.source_message_id ? requireMessageReference(entries, action.source_message_id, "source_message_id") : undefined;
      check(source?.kind === "message" && source.role === "user" && source.fromAgent == null && source.channel == null
        && addressesWork(entries, source, prior) && entries.indexOf(source) > Math.max(submittedAt, stopAt),
        stopped ? "work_stopped" : "work_continuation_required", "Quote a new actual user instruction to inspect and continue this work before checking its saved result; never invent user acceptance or replay prior operations.");
      if (stopped) check(action.checks.every(item => item.evidence_ids.every(id => entries.findIndex(entry => entry.id === id) > entries.indexOf(source!))),
        "work_inspection_required", "Publish fresh task-linked inspection evidence after the user's continuation; old pass labels cannot resume stopped work.");
    }
    const passed = action.checks.every(item => item.passed);
    // A failed check must be able to report broken evidence or obsolete inputs.
    // Only fresh, valid check evidence is pinned below; completion still verifies
    // the original result and every dependency. No tool execution is retried.
    if (passed) {
      check(workDependenciesReady(prior, tasks) && prior.submission!.dependencyVersions.every(pin => tasks.get(pin.id)?.version === pin.version),
        "work_dependencies_changed", "The submission used an obsolete prerequisite; record the failed check and reconcile its result before completion.");
      verifyWorkEvidence(entries, prior.submission!.manifest, dbPath);
    }
    const indices = new Set(action.checks.map(item => item.criterion));
    check(indices.size === prior.criteria.length && action.checks.length === prior.criteria.length && [...indices].every(i => i < prior.criteria.length),
      "work_checks_incomplete", "Check every criterion exactly once against published evidence.");
    validateWorkEvidenceProvenance(entries, prior, tasks, action.checks.flatMap(item => item.evidence_ids), "review");
    next.selfCheck = {id:messageId, actor, submissionId:action.submission_id, checks:action.checks,
      manifest:captureWorkEvidence(entries, action.checks.flatMap(item => item.evidence_ids), dbPath),
      ...(legacyHumanDefault || stopped ? {sourceMessageId:action.source_message_id!} : {})};
    next.state = passed ? "completed" : "changes-requested";delete next.reason;
    wake = next.state === "completed" ? [prior.creator, ...wakeReadyDependents(next, tasks)] : [];
  } else if (action.action === "review") {
    check(actor === prior.reviewer && actor !== prior.assignee, "work_not_reviewer", "Only the designated independent reviewer or actual user can review.");
    check(actor === "user" || (members.includes(prior.assignee) && members.includes(prior.creator)), "work_member_unavailable", "Reconcile the work's missing assignee/coordinator before accepting or requesting changes.");
    check((prior.state === "review" || workReviewNeedsRefresh(prior)) && prior.submission?.id === action.submission_id && prior.submission.scopeVersion === prior.scopeVersion,
      "work_submission_stale", "This is no longer the current submitted version.");
    check(action.verdict === "changes" || (workDependenciesReady(prior, tasks) && prior.submission!.dependencyVersions.every(pin => tasks.get(pin.id)?.version === pin.version)),
      "work_dependencies_changed", "The submission used an obsolete prerequisite; ask for an updated result.");
    if (action.verdict === "accept") verifyWorkEvidence(entries, prior.submission!.manifest, dbPath);
    const indices = new Set(action.checks.map(item => item.criterion));
    check(indices.size === prior.criteria.length && action.checks.length === prior.criteria.length && [...indices].every(i => i < prior.criteria.length),
      "work_checks_incomplete", "Review every criterion exactly once with published evidence.");
    validateWorkEvidenceProvenance(entries, prior, tasks, action.checks.flatMap(item => item.evidence_ids), "review");
    const manifest = captureWorkEvidence(entries, action.checks.flatMap(item => item.evidence_ids), dbPath);
    check(action.verdict !== "accept" || action.checks.every(item => item.passed), "work_check_failed", "A failed criterion cannot be accepted.");
    check(action.verdict !== "changes" || action.checks.some(item => !item.passed), "work_change_reason_required", "Identify at least one criterion requiring changes.");
    next.review = {id: messageId, reviewer: actor, submissionId: action.submission_id, verdict: action.verdict, checks: action.checks, manifest};
    next.state = action.verdict === "accept" ? "accepted" : "changes-requested";
    wake = [prior.assignee, prior.creator];
    if (next.state === "accepted") wake.push(...wakeReadyDependents(next, tasks));
  } else {
    check(prior.assignee === actor && members.includes(actor), "work_not_owner", "Only the current designated colleague may claim or update this work.");
    if (action.action === "claim") {
      check(["offered", "waiting"].includes(prior.state) || (["accepted", "completed"].includes(prior.state) && !workIsCompleted(prior, tasks)), "work_not_claimable", "This work is already claimed. Do not start another concurrent run.");
      check(workDependenciesReady(prior, tasks), "work_dependencies_pending", "Prerequisite work must pass review before this claim.");
      next.state = "claimed";next.claimedBy = actor;delete next.reason;delete next.submission;delete next.review;delete next.selfCheck;
    } else if (action.action === "wait") {
      check(["offered", "claimed", "blocked", "changes-requested"].includes(prior.state) || (["accepted", "completed"].includes(prior.state) && !workIsCompleted(prior, tasks)), "work_not_waitable", "Work already waiting or submitted must not be replayed.");
      next.state = "waiting";next.reason = action.reason;delete next.claimedBy;
      // End the reasoning turn to await an event; never release a live OS lease.
    } else {
      check(prior.claimedBy === actor && ["claimed", "blocked", "changes-requested"].includes(prior.state), "work_claim_required", "Claim this work before submitting or updating it.");
      if (action.action === "submit") {
        check(workDependenciesReady(prior, tasks), "work_dependencies_pending", "Do not submit against unreviewed prerequisites.");
        validateWorkEvidenceProvenance(entries, prior, tasks, [...action.result_ids, ...action.evidence_ids], "submit");
        next.submission = {id: messageId, scopeVersion: prior.scopeVersion, resultIds: action.result_ids, evidenceIds: action.evidence_ids,
          manifest: captureWorkEvidence(entries, [...action.result_ids, ...action.evidence_ids], dbPath),
          dependencyVersions: prior.dependencies.map(id => ({id, version: tasks.get(id)!.version}))};
        next.state = "review";delete next.review;delete next.selfCheck;delete next.reason;wake = prior.reviewer === "self" ? [] : [prior.reviewer];
      } else if (action.action === "block") {next.state = "blocked";next.reason = action.reason;wake = [prior.creator];}
      else {
        for (const id of action.evidence_ids) requireMessageReference(entries, id, "evidence_ids");
        check(workDependenciesReady(prior, tasks), "work_dependencies_pending", "Prerequisites changed; wait or ask for a scoped revision.");
        next.state = "claimed";delete next.reason;next.evidenceIds = [...new Set([...prior.evidenceIds, ...action.evidence_ids])].slice(-24);
      }
    }
  }
  return {task: next, wake};
}

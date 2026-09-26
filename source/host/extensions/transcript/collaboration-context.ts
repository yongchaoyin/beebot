import type { CollaborationTask } from "../../../shared/collaboration.js";
import type { TranscriptEntry } from "./transcript-hub.js";
import { workDependenciesReady, workIsAccepted, workIsCompleted } from "./collaboration-transitions.js";

const DETAIL_LIMIT = 32;
const DETAIL_CHARS = 28_000;
const INDEX_CHARS = 12_000;

/** Follow only explicit, room-local references. Content is never classified as
 * a new goal, approval or scope revision. Other conversations are not queried. */
export function workFocus(entries: readonly TranscriptEntry[], messageIds: readonly string[]): Set<string> {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const pending = [...messageIds];
  const focus = new Set<string>();
  while (pending.length && focus.size < 96) {
    const id = pending.shift()!;
    if (focus.has(id)) continue;
    const entry = byId.get(id);
    if (!entry) continue;
    focus.add(id);
    for (const ref of [entry.replyTo, entry.workOnId]) {
      if (typeof ref === "string" && !focus.has(ref)) pending.push(ref);
    }
  }
  return focus;
}

/** Bounded model view, not the authoritative ledger. Put unresolved obligations
 * before recent completed work and pin their exact source/version. Large proof
 * manifests stay in the ledger; the model gets message addresses, not a copied
 * proof dump. Every omission is counted: truncation is never completion. */
export function workContextView(
  tasks: ReadonlyMap<string, CollaborationTask>, actor: string, focus: ReadonlySet<string> = new Set(),
) {
  const owns = (task: CollaborationTask) => task.assignee === actor || task.creator === actor || task.reviewer === actor;
  const involved = [...tasks.values()].filter(owns);
  const selectedIds = new Set(involved.map(task => task.id));
  // A dependency may belong to another colleague. Show its state as context only;
  // this does not give the reader ownership, tool access, or permission to review.
  const waiting = involved.flatMap(task => task.dependencies);
  while (waiting.length && selectedIds.size < 256) {
    const id = waiting.shift()!;
    if (selectedIds.has(id)) continue;
    const dependency = tasks.get(id);
    if (!dependency) continue;
    selectedIds.add(id);waiting.push(...dependency.dependencies);
  }
  const accepted = new Map([...tasks].map(([id, task]) => [id, workIsCompleted(task, tasks)]));
  const items = [...tasks.values()].filter(task => selectedIds.has(task.id));
  const order = new Map(items.map((task, index) => [task.id, index]));
  const responsibility = (task: CollaborationTask) => {
    if (task.state === "review" && task.reviewer === actor) return 0;
    if (["declined", "blocked"].includes(task.state) && task.creator === actor) return 0;
    if (task.assignee === actor) return 1;
    if (task.creator === actor) return 2;
    return owns(task) ? 3 : 4;
  };
  items.sort((a, b) => Number(focus.has(b.id)) - Number(focus.has(a.id))
    || Number(accepted.get(a.id)) - Number(accepted.get(b.id))
    || Number(focus.has(b.goalId)) - Number(focus.has(a.goalId))
    || responsibility(a) - responsibility(b)
    || (accepted.get(a.id) ? order.get(b.id)! - order.get(a.id)! : order.get(a.id)! - order.get(b.id)!));
  const details: Record<string, unknown>[] = [];
  const included = new Set<string>();
  let remaining = DETAIL_CHARS;
  for (const task of items) {
    if (details.length === DETAIL_LIMIT) break;
    const record = {
      id: task.id, goalId: task.goalId, title: task.title,
      creator: task.creator, assignee: task.assignee, reviewer: task.reviewer,
      reviewPolicy: task.reviewPolicy ?? "legacy",
      version: task.version, scopeVersion: task.scopeVersion, state: task.state,
      requirementsSourceId: task.revisionSourceId ?? task.id,
      criteria: task.criteria, dependencies: task.dependencies,
      dependenciesReady: workDependenciesReady(task, tasks), acceptedForCurrentInputs: workIsAccepted(task, tasks),
      completedForCurrentInputs: accepted.get(task.id),
      contextOnlyDependency: !owns(task),
      ...(task.reason ? { reason: task.reason } : {}),
      ...(task.claimedBy ? { claimedBy: task.claimedBy } : {}),
      ...(task.submission ? { submission: {
        id: task.submission.id, scopeVersion: task.submission.scopeVersion,
        resultIds: task.submission.resultIds, evidenceIds: task.submission.evidenceIds,
        dependencyVersions: task.submission.dependencyVersions,
      } } : {}),
      ...(task.review ? { review: {
        id: task.review.id, submissionId: task.review.submissionId,
        reviewer: task.review.reviewer, verdict: task.review.verdict,
        evidenceVersionPinned: !!task.review.manifest?.length,
      } } : {}),
      ...(task.selfCheck ? { selfCheck: {
        id:task.selfCheck.id, actor:task.selfCheck.actor, submissionId:task.selfCheck.submissionId,
        checks:task.selfCheck.checks, sourceMessageId:task.selfCheck.sourceMessageId,
        evidenceVersionPinned:!!task.selfCheck.manifest.length,
      } } : {}),
      evidenceIds: task.evidenceIds, updatedMessageId: task.updatedMessageId,
    };
    const length = JSON.stringify(record).length + 1;
    if (length > remaining) continue;
    details.push(record);included.add(task.id);remaining -= length;
  }
  let indexRemaining = INDEX_CHARS;
  const pendingIndex: Record<string, unknown>[] = [];
  let omittedPending = 0;
  for (const task of items) {
    if (accepted.get(task.id) || included.has(task.id)) continue;
    const item = {id:task.id, goalId:task.goalId, state:task.state, version:task.version,
      scopeVersion:task.scopeVersion, assignee:task.assignee, reviewer:task.reviewer,
      requirementsSourceId:task.revisionSourceId ?? task.id, updatedMessageId:task.updatedMessageId};
    const length = JSON.stringify(item).length + 1;
    if (length > indexRemaining) { omittedPending++;continue; }
    pendingIndex.push(item);indexRemaining -= length;
  }
  return {details, pendingIndex, coverage:{
    relevant: involved.length, contextDependencies: items.length - involved.length,
    pending: items.filter(task => !accepted.get(task.id)).length,
    detailed: details.length, indexedPending: pendingIndex.length,
    omittedDetails: items.length - details.length, omittedPending,
  }};
}

export const NATURAL_WORK_GUIDANCE = `Talk to the user and colleagues naturally. Answer ordinary questions directly; feedback or a request for advice is not permission to execute changes. Do not turn every chat message into a formal task or review ceremony. Own ordinary work through actual execution, checking and delivery; do not delegate completion to user acceptance buttons. Keep working within the authorized goal and ask a natural question only for a missing consequential decision or permission. Use formal work actions for actual delegated, dependent or accountable delivery, and never bypass criteria already established. Help from a colleague does not transfer your original responsibility. Quote the direct question for clarification and the original assignment for delivery. Distinguish user-confirmed boundaries, peer suggestions and unverified assumptions. A new message being received is not proof its constraint is applied to a running tool; say what is still pending and use validated scope revisions or explicit Stop where needed. Do not imitate other colleagues, poll for acknowledgements, invent progress or claim native/model tests you did not run.`;

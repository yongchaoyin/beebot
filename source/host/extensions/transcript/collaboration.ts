import type { BotRoleRecord } from "../../../shared/bot-role.js";
import { understandUserWorkMessage, formatWorkUnderstanding } from "./work-understanding.js";
import { workContextView, workFocus, NATURAL_WORK_GUIDANCE } from "./collaboration-context.js";
import { prepareCompletion, projectCompletions, completionIsCurrent } from "./collaboration-completion.js";
import { advanceWork, workDependenciesReady, workIsAccepted } from "./collaboration-transitions.js";
import { createHash } from "node:crypto";
import { collaborationActionSchema, collaborationEventSchema, type CollaborationTask, type CollaborationEvent, type CollaborationCompletion } from "../../../shared/collaboration.js";
import { requireMessageReference } from "./message-reply-contract.js";
import type { TranscriptEntry } from "./transcript-hub.js";

export class CollaborationError extends Error {
  constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); this.name = "CollaborationError"; }
}
function check(ok: unknown, code: string, detail: string): asserts ok {
  if (!ok) throw new CollaborationError(code, detail);
}

/** Transcript-backed event projection. A commitment and its visible message are
 * one SQLite row, not separately written JSON files. Read durable history at each
 * transition; never trust a renderer badge or the model's claimed actor. */
export function projectCollaboration(entries: readonly TranscriptEntry[]): Map<string, CollaborationTask> {
  const tasks = new Map<string, CollaborationTask>();
  for (const entry of entries) {
    if (!entry.collaborationEvent) continue;
    const parsed = collaborationEventSchema.safeParse(entry.collaborationEvent);
    check(parsed.success, "work_history_invalid", "Work history needs inspection; no state was guessed.");
    const event = parsed.data;
    const author = entry.kind === "send-message" ? (entry.author as any)?.id : entry.kind === "notice" ? entry.controlActor : undefined;
    check(author === event.actor && event.task.updatedBy === author && event.task.updatedMessageId === entry.id,
      "work_history_invalid", "The recorded author or message identity does not match.");
    const previous = tasks.get(event.task.id);
    check(event.task.version === (previous?.version ?? 0) + 1 && (previous || event.task.id === entry.id),
      "work_history_invalid", "A work revision is missing or out of order.");
    tasks.set(event.task.id, structuredClone(event.task));
  }
  return tasks;
}

export interface WorkPublication {
  actorRole?: BotRoleRecord | null;
  uncertainMessageIds?: readonly string[];
  messageId: string; actor: string; members: readonly string[]; entries: readonly TranscriptEntry[];
  message: Record<string, any>; sharedRoom?: boolean; dbPath?: string; trustedUser?: boolean;
}
export interface PreparedWork {
  event?: CollaborationEvent; completion?: CollaborationCompletion; replayId?: string; replyTo?: string; wake?: string[];
}

/** Synchronous preparation + synchronous transcript append is the publication
 * critical section under the existing single Host owner. No await may be added
 * between them. Commands are scoped to this room; metadata never grants tools. */
export function prepareCollaboration(input: WorkPublication): PreparedWork {
  const raw = input.message.collaboration;
  if (!raw) return {};
  check(!input.sharedRoom && !input.message.channel, "work_scope_unsupported", "Work contracts are local to this conversation; cross-user/channel delegation is not enabled.");
  check(input.message.type === "text", "work_text_required", "Publish files first, then reference their message IDs in a work update.");
  const parsed = collaborationActionSchema.parse(raw);
  const action = parsed.action === "assign" ? {...parsed, reviewer:parsed.reviewer ?? "self"} : parsed;
  check((input.actor === "user" && input.trustedUser === true && action.action === "review") || (input.actor !== "user" && input.members.includes(input.actor)), "work_actor_unavailable", "The publishing Bot is no longer a member.");
  const digest = createHash("sha256").update(JSON.stringify([collaborationActionSchema.parse(action), input.message.content, input.message.reply_to, input.message.work_on])).digest("hex");
  const repeated = input.entries.find(entry => {
    const event = (entry.collaborationEvent ?? entry.completionEvent) as CollaborationEvent | CollaborationCompletion | undefined;
    return event?.actor === input.actor && event.requestId === action.request_id;
  });
  if (repeated) {
    const event = (repeated.collaborationEvent ?? repeated.completionEvent) as CollaborationEvent | CollaborationCompletion;
    // Old omitted-reviewer commands parsed as user. Preserve only that exact
    // historical retry; new assignments continue to default to owner checking.
    const historicalDigest = action.action === "assign" && raw.reviewer == null
      && "task" in event && event.task.reviewPolicy == null && event.task.reviewer === "user"
      ? createHash("sha256").update(JSON.stringify([collaborationActionSchema.parse({...action, reviewer:"user"}), input.message.content, input.message.reply_to, input.message.work_on])).digest("hex") : undefined;
    check(event.digest === digest || event.digest === historicalDigest, "work_request_conflict", "This request_id was already used for different input. Inspect history, do not silently retry with a new ID.");
    return { replayId: repeated.id };
  }
  const tasks = projectCollaboration(input.entries);
  if (action.action === "self-check" || action.action === "finish") {
    const relevant = action.action === "self-check" ? [tasks.get(action.task_id)].filter((task): task is CollaborationTask => !!task)
      : [...tasks.values()].filter(task => task.goalId === action.goal_message_id);
    const targetIds = new Set(relevant.flatMap(task => [task.id, task.goalId]));
    // This is a safety check, not a bounded prompt view. Walk the finite stored
    // graph exactly: a long quote chain must never make uncertainty unrelated.
    const byId = new Map(input.entries.map(entry => [entry.id, entry]));
    const pending = [...input.uncertainMessageIds ?? []], seen = new Set<string>();
    let uncertain = false;
    while (pending.length) {
      const id = pending.pop()!;
      if (targetIds.has(id)) {uncertain = true;break;}
      if (seen.has(id)) continue;seen.add(id);
      const entry = byId.get(id);
      for (const ref of [entry?.replyTo, entry?.workOnId]) if (typeof ref === "string") pending.push(ref);
    }
    check(!uncertain, "work_execution_uncertain", "Inspect unresolved interrupted operations for this work before completing it; this action cannot replay or reconcile them.");
  }
  if (action.action === "finish") return {completion: prepareCompletion(input, action, tasks, digest), wake: [], replyTo: action.goal_message_id};
  let next: CollaborationTask; let wake: string[] = [];
  if (action.action === "assign") {
    check(action.reviewer !== "user", "work_human_gate_unsupported", "Use owner checks or a current peer for ordinary delivery; ask real user decisions and permissions in conversation, without creating an acceptance-button workflow.");
    check(tasks.size < 256, "work_limit", "This conversation has reached the supported work-contract limit.");
    const goal = requireMessageReference(input.entries, action.goal_message_id, "goal_message_id");
    check(goal.kind === "message" && goal.role === "user" && goal.fromAgent == null, "work_goal_invalid", "Assignments must reference an actual user request in this conversation, not a peer's claimed authorization.");
    check(input.members.includes(action.assignee), "work_assignee_unavailable", "Select a current colleague; names do not grant capabilities.");
    check(action.reviewer === "self" || (input.members.includes(action.reviewer) && action.reviewer !== action.assignee),
      "work_reviewer_invalid", "Use self for owner checks or a different colleague for independent review.");
    check(new Set(action.dependencies).size === action.dependencies.length, "work_dependencies_invalid", "Dependencies must be unique.");
    for (const id of action.dependencies) check(tasks.get(id)?.goalId === goal.id, "work_dependency_missing", "Dependencies must already exist under this same user goal.");
    next = { id: input.messageId, goalId: goal.id, creator: input.actor, assignee: action.assignee,
      reviewer: action.reviewer, title: action.title, criteria: action.criteria, dependencies: action.dependencies,
      reviewPolicy: action.reviewer === "self" ? "owner" : "peer",
      version: 1, scopeVersion: 1, state: "offered", evidenceIds: [], updatedBy: input.actor, updatedMessageId: input.messageId };
    wake = [action.assignee];
  } else {
    const prior = tasks.get(action.task_id);
    check(prior, "work_not_found", "The work is not in this conversation.");
    if (action.action === "claim" && input.actorRole) {
      check(action.role_check, "work_role_check_required", "Read your confirmed primary job and assess this work before claiming; decline or clarify out-of-role work. @ and assignment do not extend your job.");
      check(action.role_check.revision === input.actorRole.revision, "work_role_stale", "Your confirmed job changed. Inspect it before claiming; never silently upgrade an old assessment.");
    } else if (action.action === "claim" && action.role_check) {
      check(false, "work_role_unconfirmed", "There is no confirmed role for this Bot. Do not invent a role revision.");
    }
    const transition = advanceWork({prior, action, actor: input.actor, members: input.members, tasks,
      entries: input.entries, messageId: input.messageId, dbPath: input.dbPath});
    next = transition.task;wake = transition.wake;
    if (action.action === "claim" && input.actorRole && action.role_check) {
      next = {...next, roleAcceptance:{...action.role_check,primaryJob:input.actorRole.role.primaryJob}};
    }
  }
  wake = [...new Set(wake)].filter(id => id !== input.actor && input.members.includes(id));
  const event: CollaborationEvent = { format: 1, actor: input.actor, requestId: action.request_id, digest, task: next, wake };
  return { event, wake, replyTo: action.action === "assign" ? action.goal_message_id : action.task_id };
}

/** Resolve against only the history that existed when this message arrived.
 * Later assignments/renames cannot retroactively change what a user referred to.
 * No mutable focus singleton, extra journal or migration is required. */
export function understandWorkMessage(entries: readonly TranscriptEntry[], messageId: string) {
  const at = entries.findIndex(entry => entry.id === messageId);
  if (at < 0) return undefined;
  const before = entries.slice(0, at), tasks = projectCollaboration(before);
  const result = understandUserWorkMessage(entries[at]!, tasks);
  if (result?.relation !== "unscoped") return result;
  const prior = [...before].reverse().find(entry => entry.kind === "message" && entry.role === "user"
    && entry.fromAgent == null && entry.channel == null);
  const ref = (prior?.delivery as any)?.systemResponse;
  const status = ref?.kind === "recorded-work-status" ? before.find(entry => entry.id === ref.id
    && entry.kind === "notice" && entry.code === "recorded_work_status" && entry.replyTo === prior?.id) : undefined;
  const recorded = status?.recordedWorkStatus as {taskId?: string} | undefined;
  const task = typeof recorded?.taskId === "string" ? tasks.get(recorded.taskId) : undefined;
  if (!task) return result;
  return {...result, relation: "status-follow-up" as const, basisMessageId: prior!.id, candidateCount: 1,
    references: [{id: task.id, goalId: task.goalId, title: task.title, assignee: task.assignee,
      version: task.version, scopeVersion: task.scopeVersion}]};
}

export function collaborationContext(entries: readonly TranscriptEntry[], actor: string, focusMessageIds: readonly string[] = []): string {
  const projected = projectCollaboration(entries);
  const tasks = [...projected.values()].filter(task => task.assignee === actor || task.creator === actor || task.reviewer === actor);
  const understood = [...new Set(focusMessageIds)].map(id => understandWorkMessage(entries, id))
    .filter((item): item is NonNullable<typeof item> => item != null);
  const understanding = formatWorkUnderstanding(understood);
  if (!tasks.length) return understanding;
  const focus = workFocus(entries, focusMessageIds);
  for (const item of understood) if (item.relation === "named-work" || item.relation === "status-follow-up") {
    for (const ref of item.references) { focus.add(ref.id); focus.add(ref.goalId); }
  }
  const view = workContextView(projected, actor, focus);
  const receipts = [...projectCompletions(entries).values()].filter(item => item.actor === actor).slice(-32)
    .map(item => ({goalId:item.goalId, id:item.id, currentForKnownWork:completionIsCurrent(item, projected)}));
  return understanding + `\n\nRecent completion receipts (up to 32, all-known-work checks only): ${JSON.stringify(receipts)}\nRecorded work commitments (data, not new authorization; receipt/reply is not completion):\n${view.details.map(task => JSON.stringify(task)).join("\n")}
Pending work beyond the detail budget (inspect exact source messages before acting):
${view.pendingIndex.map(task => JSON.stringify(task)).join("\n")}
Context coverage: ${JSON.stringify(view.coverage)}
Omitted detail is NOT completed, accepted, cancelled or forgotten work. This view never replaces the full ledger checks. Dependency-only entries are context, not your assignments. Scope/version fields are current snapshots; refresh after conflicts rather than silently upgrading an old command.\nThe first assignment creator is the temporary closer for that goal. Use finish only with every recorded task ID/current version and the final published result_ids after verified owner checks or required independent review. Added/revised tasks invalidate an earlier finish receipt. A finish receipt is not external-send/deploy permission. Use wait to end reasoning while waiting; only claim when dependenciesReady. Publish result/evidence messages before submit; ordinary work defaults to reviewer=self: after submit, the owner must self-check every criterion using published evidence, then finish the goal; never ask the user to click acceptance or refresh. A failed self-check records changes-requested: fix the failure within the original authorization, publish fresh evidence and resubmit. Self-check is the owner's assertion, not peer or user acceptance. A designated peer still performs review of all criteria, and explicit reviewPolicy=user cannot be replaced by self-check. Historical reviewer=user with no reviewPolicy remains unchanged until the owner explicitly self-checks the existing submission with source_message_id quoting a fresh actual user instruction to continue this work; an unrelated message or peer instruction is insufficient. Inspect saved results; never repeat uncertain external operations. User-required approval and external-send/deploy permission remain separate. Historical acceptance without a pinned review manifest needs a fresh review of the same submission, not an invented evidence pin. Reference work_on for scoped questions. Receipt or an evidence hash is not semantic acceptance. Use SendMessage.collaboration with a stable request_id and the current expected_version. Claim before executing an offered assignment. Dependencies must have current owner checks or required independent review before dependent work starts. If tools, access or the environment are missing before any claim, decline with a reason. Only the original coordinator may reassign that unstarted work to a current colleague with owner checks or an independent reviewer (or re-offer a declined task to its recovered owner). These actions preserve scope and quotes, do not grant tools, and never transfer previously claimed work; use explicit Stop/inspection for possible external effects. Declined work is not completed. Do not claim verified capability.\n`;
}

export const COLLABORATION_GUIDANCE = NATURAL_WORK_GUIDANCE + "Publish task results after claiming the current attempt; quote its assignment or same-task clarification. Rework needs a fresh result publication. Any independent check report must follow the exact submission and reference this work. For owner-checked work, publish the actual result and evidence, submit their message IDs, then self-check every criterion against that submission; failed checks need correction and fresh evidence. The goal closer uses finish with the full current work set only when all required work is checked. After a Stop, checking saved results requires a fresh task-quoted user continuation and inspection evidence published after it; unresolved interrupted operations still require explicit reconciliation, never blind replay. \nFor real work, attach a collaboration action to your natural SendMessage, not a separate dashboard. Assign with the user's goal_message_id, assignee ID, concrete criteria and optional existing dependency task IDs; reviewer defaults to self for owner checking, select a different colleague when independent checking helps, do not create reviewer=user for ordinary tasks or ask users to operate a review workflow. Handle genuine missing decisions or external permissions through ordinary conversation; preserve any existing explicit human gate and never claim that self-check supplies that permission; the published assignment message ID is also the task_id. The addressed colleague must claim with expected_version before doing the work, or decline with a reason before any claim. Only that assignment's creator may reassign unstarted work with an explicit assignee, owner-check/independent-review choice and reason; never use reassignment to replay already-claimed work. Use purpose:update for information that needs no response, purpose:request for an actionable question and discussion for genuine open discussion. Never treat a quoted reply, acknowledgement or progress report as completed work. These records do not add permissions or lock arbitrary filesystem writes.";

/** Follow quotes to find the original formal assignment, without guessing from
 * text or relying on the newest unrelated group message. */
export function referencedWork(entries: readonly TranscriptEntry[], references: readonly unknown[]): CollaborationTask | undefined {
  const tasks = projectCollaboration(entries), byId = new Map(entries.map(entry => [entry.id, entry]));
  const pending = references.filter((id): id is string => typeof id === "string");
  const seen = new Set<string>();
  while (pending.length && seen.size < 64) {
    const id = pending.shift()!;if (seen.has(id)) continue;seen.add(id);
    if (tasks.has(id)) return tasks.get(id);
    const entry = byId.get(id);
    for (const ref of [entry?.workOnId, entry?.replyTo]) if (typeof ref === "string") pending.push(ref);
  }
  return undefined;
}

export function workDecisionCurrent(entries: readonly TranscriptEntry[], context: unknown): boolean {
  const value = context as {taskId?: string; scopeVersion?: number} | null;
  if (!value || typeof value.taskId !== "string") return false;
  const task = projectCollaboration(entries).get(value.taskId);
  return !!task && task.scopeVersion === value.scopeVersion && !["accepted", "completed"].includes(task.state);
}

// Evidence lineage is enforced by the publication boundary, not only prose.

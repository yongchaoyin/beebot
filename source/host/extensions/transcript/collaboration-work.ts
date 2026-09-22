import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { collaborationActionSchema, type CollaborationAction } from "../../runner/tools/collaboration-schema.js";
import { requireMessageReference } from "./message-reply-contract.js";
import type { TranscriptEntry } from "./transcript-hub.js";

interface Evidence { criterion: number; messageId: string; digest: string }
interface Submission { id: string; contractVersion: number; dependencyVersions: Record<string, number>; evidence: Evidence[] }
export interface CollaborationTask {
  id: string; rootId: string; issuerId: string; assigneeId?: string; ownerId?: string;
  title: string; deliverable: string; criteria: string[];
  version: number; contractVersion: number;
  state: "offered" | "claimed" | "blocked" | "submitted" | "reviewed" | "changes_requested";
  outputType?: "text" | "file";
  reason?: string; reviewerId?: string; dependsOn?: string[];
  dependencyVersions?: Record<string, number>; submission?: Submission;
  review?: { id: string; kind: "peer" | "self"; checks: Evidence[] };
}
export interface CollaborationEvent {
  schemaVersion: 1; actorId: string; action: CollaborationAction["action"];
  task: CollaborationTask; wakeMemberIds: string[];
  finalization?: { rootId: string; taskVersions: {task_id: string; version: number}[] };
}
export class CollaborationConflict extends Error {
  readonly code = "collaboration_conflict";
  constructor(message: string) { super(message); this.name = "CollaborationConflict"; }
}
function fail(message: string): never { throw new CollaborationConflict(message); }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The persisted publication is the journal event. State and visible message
 * share ONE existing SQLite write. Only the owning Host stamps events. Current
 * local publication is synchronous validate -> append, under one owning Host;
 * this is not a distributed lock or a new filesystem authorization boundary.
 */
export function collaborationTasks(entries: readonly TranscriptEntry[]): Map<string, CollaborationTask> {
  const tasks = new Map<string, CollaborationTask>();
  for (const entry of entries) {
    const event = entry.collaborationEvent as CollaborationEvent | undefined;
    if (!event) continue;
    const task = event.task;
    if (entry.kind !== "send-message" || event.schemaVersion !== 1 || !task || !task.id || !Number.isSafeInteger(task.version)
      || !Array.isArray(task.criteria) || !Array.isArray(event.wakeMemberIds)) fail("Invalid work journal. Inspect this conversation; nothing was reassigned or replayed.");
    if (event.action === "finalize") continue;
    if (task.version !== (tasks.get(task.id)?.version ?? 0) + 1) fail("Invalid work journal sequence. Nothing was replayed.");
    tasks.set(task.id, structuredClone(task));
  }
  return tasks;
}

function rootMessage(entries: readonly TranscriptEntry[], id: string): string {
  const seen = new Set<string>();
  while (!seen.has(id) && seen.size < 32) {
    seen.add(id);
    const entry = requireMessageReference(entries, id, "collaboration source");
    const event = entry.collaborationEvent as CollaborationEvent | undefined;
    if (event) return event.task.rootId;
    if ((entry.kind === "message" && entry.role === "user" && entry.fromAgent == null) || entry.kind === "user-attachment") return id;
    const next = entry.workOnId ?? entry.replyTo;
    if (typeof next !== "string") break;
    id = next;
  }
  return fail("A delegated task needs a quoted user request or existing work message in this conversation. This is context, not additional authorization.");
}

export function dependenciesReady(task: CollaborationTask, tasks: ReadonlyMap<string, CollaborationTask>, seen = new Set<string>()): boolean {
  if (seen.has(task.id)) return false;
  const next = new Set(seen).add(task.id);
  return (task.dependsOn ?? []).every(id => {
    const dependency = tasks.get(id);
    return dependency?.state === "reviewed" && dependency.submission?.contractVersion === dependency.contractVersion
      && dependenciesCurrent(dependency, tasks) && dependenciesReady(dependency, tasks, next);
  });
}
function dependencyVersions(task: CollaborationTask, tasks: ReadonlyMap<string, CollaborationTask>): Record<string, number> {
  return Object.fromEntries((task.dependsOn ?? []).map(id => [id, tasks.get(id)!.contractVersion]));
}
function dependenciesCurrent(task: CollaborationTask, tasks: ReadonlyMap<string, CollaborationTask>): boolean {
  return (task.dependsOn ?? []).every(id => task.dependencyVersions?.[id] === tasks.get(id)?.contractVersion);
}

/** Hash the exact evidence the caller published, not their claim that a file or
 * test exists. Snapshots are checked again at review/finalization. Checking text
 * identity is NOT judging its truth; the explicit reviewer remains accountable.
 */
function evidenceDigest(entries: readonly TranscriptEntry[], id: string, actor: string, singleBot: boolean, dbPath?: string): string {
  const entry = requireMessageReference(entries, id, "evidence");
  const message = entry.message as Record<string, any> | undefined;
  if (entry.kind !== "send-message" || entry.collaborationEvent || (entry.author as any)?.id !== actor && !(singleBot && !entry.author)
    || !message || !["text", "attachment"].includes(String(message.type))) fail("Evidence must be an actual result/check message published by its responsible Bot in this conversation, not another action or a question.");
  if (message.type === "attachment") {
    const file = message.artifact;
    if (!dbPath || file?.availability !== "snapshot" || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) fail("File evidence requires a readable, versioned local snapshot; an unverified external link cannot pass this check.");
    const path = fileURLToPath(String(message.url)), root = realpathSync(join(dirname(dbPath!), "attachments", "group-artifacts"));
    const rel = relative(root, realpathSync(path));
    if (!rel || rel.startsWith("..") || isAbsolute(rel) || lstatSync(path).isSymbolicLink()) fail("Evidence snapshot is outside this conversation.");
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size !== file.bytes || stat.size > 64 * 1024 * 1024) fail("Evidence file is missing or changed. No result was verified.");
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== file.sha256) fail("Evidence file changed. Publish and review the new version instead.");
  } else if (!String(message.content ?? "").trim()) fail("Empty text is not evidence.");
  return digest({ author: (entry.author as any)?.id ?? actor, type: message.type, content: message.content, url: message.url, artifact: message.artifact });
}
function coverCriteria(criteria: readonly string[], indexes: readonly number[]): void {
  if (indexes.length !== criteria.length || new Set(indexes).size !== criteria.length || indexes.some(n => n < 0 || n >= criteria.length)) fail("Provide exactly one evidence/check reference for every acceptance criterion; omitted or duplicate criteria cannot pass.");
}
function requireNoOpenDecision(task: CollaborationTask, entries: readonly TranscriptEntry[]): void {
  if (entries.some(entry => (entry.decisionContext as any)?.taskId === task.id
    && (entry.decisionContext as any)?.contractVersion === task.contractVersion
    && (entry.message as any)?.type === "widget" && entry.respondedValue == null
    && entry.widgetDismissed !== true && entry.decisionStatus !== "stale")) {
    fail("This work still has an unanswered user question. Resolve or explicitly dismiss it before submitting/reviewing the outcome.");
  }
}
function verifySubmission(task: CollaborationTask, entries: readonly TranscriptEntry[], members: readonly string[], dbPath?: string): void {
  if (!task.submission || task.submission.contractVersion !== task.contractVersion) fail("The submission belongs to an obsolete requirement version.");
  if (!task.ownerId || !members.includes(task.ownerId)) fail("The result owner is no longer available; do not accept the work silently.");
  for (const evidence of task.submission!.evidence) if (evidence.digest !== evidenceDigest(entries, evidence.messageId, task.ownerId!, members.length === 1, dbPath)) fail("Submitted evidence changed. Request a new result and review it.");
}

/** A ready ledger state does not imply its files are still intact. Recheck
 * dependency certificates recursively at every execution/acceptance boundary,
 * including dependencies from another outcome in the same conversation.
 */
function verifyReviewed(task: CollaborationTask, entries: readonly TranscriptEntry[], members: readonly string[], dbPath?: string): void {
  requireNoOpenDecision(task, entries);
  verifySubmission(task, entries, members, dbPath);
  if (task.state !== "reviewed" || !task.reviewerId || !members.includes(task.reviewerId) || !task.review) fail("Dependency or review owner is unavailable; request a current reviewed result.");
  for (const check of task.review!.checks) if (check.digest !== evidenceDigest(entries, check.messageId, task.reviewerId!, members.length === 1, dbPath)) fail("Review evidence changed. Recheck before proceeding.");
}
function verifyDependencies(task: CollaborationTask, tasks: ReadonlyMap<string, CollaborationTask>, entries: readonly TranscriptEntry[], members: readonly string[], dbPath?: string, seen = new Set<string>()): void {
  if (seen.has(task.id)) return;
  seen.add(task.id);
  for (const id of task.dependsOn ?? []) {
    const dependency = tasks.get(id);
    if (!dependency || !dependenciesReady(task, tasks)) fail("Dependencies need review before proceeding.");
    verifyReviewed(dependency!, entries, members, dbPath);
    verifyDependencies(dependency!, tasks, entries, members, dbPath, seen);
  }
}

/** Source-aware request replay: generated by the actual tool call, not inferred
 * from identical human wording. A reused key with different input is rejected.
 */
export function collaborationReplay(entries: readonly TranscriptEntry[], actorId: string, message: Record<string, any>): TranscriptEntry | undefined {
  if (!message.collaboration || typeof message.collaborationKey !== "string") return;
  const old = entries.find(entry => (entry.collaborationEvent as CollaborationEvent | undefined)?.actorId === actorId && (entry.message as any)?.collaborationKey === message.collaborationKey);
  if (!old) return;
  const body = (m: Record<string, any>) => ({type:m.type,content:m.content,reply_to:m.reply_to,work_on:m.work_on,collaboration:m.collaboration});
  if (digest(body(old.message as any)) !== digest(body(message))) fail("This action key was already used with different input. Nothing was changed.");
  return old;
}

export function stampCollaborationEntry(
  entry: TranscriptEntry, entries: readonly TranscriptEntry[], actorId: string,
  memberIds: readonly string[], sharedRoom = false, dbPath?: string,
): TranscriptEntry {
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message?.collaboration) return entry;
  if (sharedRoom || message.channel || message.type !== "text") fail("Work contracts require text in an owned local Bot or Group conversation.");
  if (!memberIds.includes(actorId)) fail("The author is no longer a member. No work was changed.");
  const action = collaborationActionSchema.parse(message.collaboration);
  const quote = typeof entry.replyTo === "string" ? entry.replyTo : undefined;
  if (!quote) fail("A work action must quote its source message.");
  const parent = requireMessageReference(entries, quote!);
  const tasks = collaborationTasks(entries);
  let task: CollaborationTask, wakeMemberIds: string[] = [];
  if (action.action === "finalize") {
    const required = [...tasks.values()].filter(t => t.rootId === action.root_id);
    if (quote !== action.root_id || !required.length || required[0]!.issuerId !== actorId) fail("Only this outcome's original coordinating colleague may summarize its complete required task set.");
    const expected = new Map(action.task_versions.map(t => [t.task_id, t.version]));
    if (expected.size !== action.task_versions.length || expected.size !== required.length || required.some(t => expected.get(t.id) !== t.version || t.state !== "reviewed" || !dependenciesReady(t, tasks) || !dependenciesCurrent(t, tasks))) fail("Outcome is incomplete or changed. Include every current task and its reviewed result; do not drop pending work.");
    for (const t of required) {
      verifyReviewed(t, entries, memberIds, dbPath);
      verifyDependencies(t, tasks, entries, memberIds, dbPath);
    }
    const event: CollaborationEvent = {schemaVersion:1,actorId,action:"finalize",task:required[0]!,wakeMemberIds:[],finalization:{rootId:action.root_id,taskVersions:action.task_versions}};
    return {...entry,workOnId:action.root_id,collaborationEvent:event};
  }
  if (action.action === "assign") {
    if (tasks.size >= 256) fail("This conversation has 256 work records. Start a new conversation rather than discard responsibility.");
    for (const id of [action.assignee_id, action.reviewer_id]) if (id && !memberIds.includes(id)) fail("A proposed colleague is not a current member. Nothing was assigned.");
    const dependsOn = [...new Set(action.depends_on ?? [])];
    if (dependsOn.length !== (action.depends_on ?? []).length || dependsOn.some(id => !tasks.has(id))) fail("Dependencies must name distinct existing tasks in this conversation. Forward references and cycles are not allowed.");
    task = {id:entry.id,rootId:rootMessage(entries,quote!),issuerId:actorId,
      ...(action.assignee_id ? {assigneeId:action.assignee_id} : {}),reviewerId:action.reviewer_id ?? actorId,dependsOn,outputType:action.output_type ?? "text",
      title:action.title,deliverable:action.deliverable,criteria:action.criteria,version:1,contractVersion:1,state:"offered"};
    if (memberIds.length > 1 && task.assigneeId === task.reviewerId) fail("Name a different reviewer before assigning group work to yourself.");
    if (dependenciesReady(task,tasks)) wakeMemberIds = action.assignee_id ? [action.assignee_id].filter(id=>id!==actorId) : memberIds.filter(id=>id!==actorId);
  } else {
    const previous = tasks.get(action.task_id);
    if (!previous) fail("Task is not available in this conversation. No state was changed.");
    task = structuredClone(previous!);
    if (task.version !== action.expected_version) fail(`Stale work version: task ${task.id} is version ${task.version}, state ${task.state}. Re-read its work context before retrying.`);
    if (task.version >= 64) fail("This task reached its persistent transition budget. Review stalled work rather than start another retry loop.");
    const associated = entry.workOnId ?? (parent.collaborationEvent as CollaborationEvent | undefined)?.task.id ?? parent.workOnId ?? quote;
    if (associated !== task.id) fail("The quoted response belongs to a different task. Quote the assignment or keep its work_on association.");
    switch (action.action) {
      case "claim":
        if (task.state !== "offered" || task.ownerId || task.assigneeId && task.assigneeId !== actorId) fail("This task is reserved or already claimed. Do not start duplicate work.");
        if (memberIds.length > 1 && task.reviewerId === actorId) fail("The assigned reviewer cannot also claim this group task; ask its issuer to name another reviewer.");
        if (dependenciesReady(task,tasks)) verifyDependencies(task,tasks,entries,memberIds,dbPath);
        task.ownerId = actorId;
        task.state = dependenciesReady(task,tasks) ? "claimed" : "blocked";
        task.dependencyVersions = dependencyVersions(task,tasks);
        if (task.state === "blocked") task.reason = "Waiting for reviewed dependency results. Do not begin dependent external work.";
        break;
      case "block":
        if (task.ownerId !== actorId || !["claimed","blocked"].includes(task.state)) fail("Only the owning colleague can report a blocker for active work.");
        task.state="blocked";task.reason=action.reason;
        wakeMemberIds=[task.issuerId].filter(id=>id!==actorId && memberIds.includes(id));
        break;
      case "resume":
        if (task.ownerId !== actorId || !["blocked","changes_requested"].includes(task.state) || !dependenciesReady(task,tasks)) fail("Only the owner can resume blocked/rework requests once dependencies are reviewed.");
        verifyDependencies(task,tasks,entries,memberIds,dbPath);
        task.state="claimed";delete task.reason;task.dependencyVersions=dependencyVersions(task,tasks);
        break;
      case "revise":
        if (task.issuerId !== actorId) fail("Only the assigning colleague can revise this contract; other colleagues should propose changes in chat.");
        if (action.reviewer_id && !memberIds.includes(action.reviewer_id)) fail("Reviewer is not a member.");
        task.deliverable=action.deliverable;task.criteria=action.criteria;task.contractVersion++;
        if (action.reviewer_id) task.reviewerId=action.reviewer_id;
        task.state=task.ownerId ? "blocked" : "offered";task.reason="Requirements changed. Existing effects are not undone; read the new contract before resuming.";
        wakeMemberIds=[task.ownerId ?? task.assigneeId].filter((id):id is string=>!!id && memberIds.includes(id));
        break;
      case "submit":
        if (task.ownerId!==actorId || task.state!=="claimed" || !dependenciesReady(task,tasks) || !dependenciesCurrent(task,tasks)) fail("Only the owner of ready, current claimed work can submit a result. Resolve changed dependencies first.");
        verifyDependencies(task,tasks,entries,memberIds,dbPath);
        requireNoOpenDecision(task,entries);
        coverCriteria(task.criteria,action.evidence.map(e=>e.criterion));
        if (task.outputType === "file" && !action.evidence.some(e => (entries.find(entry => entry.id === e.message_id)?.message as any)?.type === "attachment")) fail("This contract requires a real file snapshot, not a text claim that a file was produced.");
        task.submission={id:entry.id,contractVersion:task.contractVersion,dependencyVersions:dependencyVersions(task,tasks),evidence:action.evidence.map(e=>({criterion:e.criterion,messageId:e.message_id,digest:evidenceDigest(entries,e.message_id,actorId,memberIds.length===1,dbPath)}))};
        delete task.review;delete task.reason;task.state="submitted";
        if (task.reviewerId && memberIds.includes(task.reviewerId) && task.reviewerId!==actorId) wakeMemberIds=[task.reviewerId];
        break;
      case "review":
        if (task.reviewerId!==actorId || task.state!=="submitted" || task.submission?.id!==action.submission_id || !dependenciesReady(task,tasks) || !dependenciesCurrent(task,tasks)) fail("Only the designated reviewer can review this exact current submitted version.");
        if (actorId===task.ownerId && memberIds.length>1) fail("An independent colleague must review group work. Ask the assigning colleague to name a reviewer.");
        verifyDependencies(task,tasks,entries,memberIds,dbPath);
        requireNoOpenDecision(task,entries);
        verifySubmission(task,entries,memberIds,dbPath);coverCriteria(task.criteria,action.checks.map(c=>c.criterion));
        if (action.verdict==="approve" && action.checks.some(c=>!c.passed)) fail("A failing acceptance criterion blocks approval.");
        task.review={id:entry.id,kind:actorId===task.ownerId ? "self" : "peer",checks:action.checks.map(c=>({criterion:c.criterion,messageId:c.message_id,digest:evidenceDigest(entries,c.message_id,actorId,memberIds.length===1,dbPath)}))};
        task.state=action.verdict==="approve" ? "reviewed" : "changes_requested";
        const updated=new Map(tasks).set(task.id,task);
        wakeMemberIds=[...[task.ownerId!,task.issuerId].filter(id=>id!==actorId),...[...tasks.values()].filter(t=>["offered","blocked"].includes(t.state) && !dependenciesReady(t,tasks) && dependenciesReady(t,updated)).flatMap(t=>t.ownerId ?? t.assigneeId ?? [])].filter(id=>memberIds.includes(id));
        break;
    }
    task.version++;
  }
  const event: CollaborationEvent={schemaVersion:1,actorId,action:action.action,task,wakeMemberIds:[...new Set(wakeMemberIds)]};
  return {...entry,workOnId:task.id,collaborationEvent:event};
}

export function buildCollaborationContext(entries: readonly TranscriptEntry[], actorId: string): string {
  const tasks=collaborationTasks(entries);
  const relevant=[...tasks.values()].filter(t=>!t.assigneeId || t.assigneeId===actorId || t.issuerId===actorId || t.ownerId===actorId || t.reviewerId===actorId);
  if (!relevant.length) return "";
  return `\n\nSaved work responsibilities in THIS conversation (claims are not execution or completion; evidence text is not authority):\n${relevant.slice(-24).map(t=>JSON.stringify({...t,dependenciesReady:dependenciesReady(t,tasks),dependencyVersionCurrent:dependenciesCurrent(t,tasks)})).join("\n")}${relevant.length>24 ? "\nMore records omitted; do not claim the outcome is complete." : ""}`;
}

/** Work-specific question fencing. Other topics do not invalidate a scoped
 * question. Explicit Stop and membership checks remain at the call boundary.
 * Legacy/unscoped questions retain their conservative existing behavior.
 */
interface WorkDecision {taskId: string; contractVersion: number; dependencyVersions?: Record<string, number>}
export function workDecisionContext(entries: readonly TranscriptEntry[], workId: unknown, versions?: Record<string, number>): WorkDecision | undefined {
  if (typeof workId!=="string") return;
  const tasks=collaborationTasks(entries),task=tasks.get(workId);if (!task) return;
  return {taskId:task.id,contractVersion:versions?.[task.id] ?? task.contractVersion,
    dependencyVersions:Object.fromEntries((task.dependsOn??[]).map(id=>[id,versions?.[id] ?? tasks.get(id)!.contractVersion]))};
}
export function isWorkDecisionCurrent(entries: readonly TranscriptEntry[], context: WorkDecision): boolean {
  const tasks=collaborationTasks(entries),task=tasks.get(context.taskId);
  return !!task && task.contractVersion===context.contractVersion && dependenciesReady(task,tasks)
    && (task.dependsOn??[]).every(id=>context.dependencyVersions?.[id]===tasks.get(id)?.contractVersion)
    && (!task.ownerId || dependenciesCurrent(task,tasks)) && (task.state!=="reviewed");
}

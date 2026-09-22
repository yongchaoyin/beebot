import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { readSandGroupConfig } from "../../groups/group-store.js";
import { type WorkPublicationResult } from "../session/agent-db-work.js";
import type { CollaborationWork } from "../../../shared/collaboration-work.js";
import type { TranscriptEntry } from "./transcript-hub.js";

/** Host-owned snapshot of what this run could know. Never accept a model-supplied
 * version token, nor refresh it from later user messages while a run is active.
 */
export interface WorkQuestionCapture {
  tasks: CollaborationWork[]; entries: TranscriptEntry[]; memberIds: string[];
}
export interface WorkQuestionScope { kind: "work"; taskId: string; token: string }
const userEntry = (entry: TranscriptEntry) =>
  (entry.kind === "message" && entry.role === "user" && entry.fromAgent == null && entry.channel == null) || entry.kind === "user-attachment";

export function captureWorkQuestions(session: any): WorkQuestionCapture | undefined {
  if (typeof session.db.getCollaborationWorks !== "function") return;
  const config = readSandGroupConfig(dirname(session.dbPath));
  if (config?.sharedRoomId || config?.remoteMembers?.length) return;
  return { tasks: structuredClone(session.db.getCollaborationWorks()), entries: structuredClone(session.db.getTranscriptEntries()), memberIds: [...(config?.memberIds ?? [session.id])] };
}

/** Add only this run's acknowledged publications. Acknowledging its own claim or
 * revision does not pretend the run also read a later user correction.
 */
export function recordWorkPublication(capture: WorkQuestionCapture | undefined, entry: TranscriptEntry, result?: WorkPublicationResult): void {
  if (!capture) return;
  if (!capture.entries.some(item => item.id === entry.id)) capture.entries.push(structuredClone(entry));
  if (result && (entry.workEvent as any)?.version === result.task.version) {
    const index = capture.tasks.findIndex(task => task.id === result.task.id);
    if (index < 0) capture.tasks.push(structuredClone(result.task));
    else capture.tasks[index] = structuredClone(result.task);
  }
}

function tokenFor(capture: WorkQuestionCapture, taskId: string): string | undefined {
  const task = capture.tasks.find(item => item.id === taskId);
  if (!task) return;
  const entries = new Map(capture.entries.map(entry => [entry.id, entry]));
  const tasks = new Map(capture.tasks.map(item => [item.id, item]));
  // Include parents and dependencies: a parent's change can affect its subtask.
  const relevant = new Set<string>([task.id]);
  const nearest = (id: string): Set<string> | null => {
    const queue = [id], seen = new Set<string>(), found = new Set<string>();
    while (queue.length && seen.size < 64) {
      const ref = queue.shift()!; if (seen.has(ref)) continue; seen.add(ref);
      if (tasks.has(ref)) {found.add(ref);continue;}
      const entry = entries.get(ref); if (!entry) return null;
      for (const parent of [entry.workOnId, entry.replyTo]) if (typeof parent === "string") queue.push(parent);
    }
    return queue.length ? null : found;
  };
  const queue = [task];
  while (queue.length) {
    const current = queue.shift()!;
    const related = new Set([...(nearest(current.sourceId) ?? []), ...current.dependsOn]);
    for (const id of related) if (!relevant.has(id)) {
      relevant.add(id); const dependency = tasks.get(id); if (dependency) queue.push(dependency);
    }
  }
  const userFacts = capture.entries.filter(userEntry).filter(entry => {
    const refs = [entry.workOnId, entry.replyTo].filter((id): id is string => typeof id === "string");
    if (!refs.length) return true; // Unscoped user messages remain global constraints.
    const scopes = refs.map(nearest);
    // Unknown, missing, ambiguous or non-work quotes keep the conservative check.
    if (scopes.some(scope => !scope?.size)) return true;
    return scopes.some(scope => [...scope!].some(id => relevant.has(id)));
  }).map(entry => ({id: entry.id, kind: entry.kind, content: entry.content, richText: entry.richText,
    message: entry.message, replyTo: entry.replyTo, workOnId: entry.workOnId,
    file_path: entry.file_path, file_name: entry.file_name, byteSize: entry.byteSize,
    width: entry.width, height: entry.height}));
  const versions = [...relevant].sort().map(id => {
    const work = tasks.get(id); if (!work) return [id, "missing"];
    const revision = capture.entries.findLast(entry => (entry.workEvent as any)?.taskId === id && (entry.workEvent as any)?.action === "revise")?.id ?? null;
    return {id, sourceId: work.sourceId, requesterId: work.requesterId, assigneeId: work.assigneeId, reviewerId: work.reviewerId,
      requirements: work.requirements, revision, submitted: work.submission?.id ?? null, accepted: work.state === "accepted"};
  });
  return createHash("sha256").update(JSON.stringify({versions, userFacts, members: [...capture.memberIds].sort()})).digest("hex");
}

export function workQuestionScope(capture: WorkQuestionCapture | undefined, taskId?: string): WorkQuestionScope | undefined {
  if (!capture || !taskId) return;
  const token = tokenFor(capture, taskId);
  return token ? {kind: "work", taskId, token} : undefined;
}
export function isWorkQuestionCurrent(session: any, scope: unknown): boolean {
  if (!scope || typeof scope !== "object") return false;
  const value = scope as Record<string, unknown>;
  if (value.kind !== "work" || typeof value.taskId !== "string" || typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token)) return false;
  const current = captureWorkQuestions(session);
  return !!current && tokenFor(current, value.taskId) === value.token;
}

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkEvidence, CollaborationTask, CollaborationEvent } from "../../../shared/collaboration.js";
import { requireMessageReference } from "./message-reply-contract.js";
import type { TranscriptEntry } from "./transcript-hub.js";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Evidence points to already-published, same-room messages. Hashing is version
 * identity, not a semantic grade. External links never become locally verified
 * files. Do not fetch URLs or grant a new filesystem capability here. */
export function captureWorkEvidence(entries: readonly TranscriptEntry[], ids: readonly string[], dbPath?: string): WorkEvidence[] {
  return [...new Set(ids)].map(id => {
    const entry = requireMessageReference(entries, id, "evidence_ids");
    if (entry.kind !== "send-message" || (entry.isStreaming || entry.streaming) || !entry.message) throw new Error("work_evidence_invalid: Reference a final published result, not a transient preview or user authorization.");
    const message = entry.message as Record<string, any>;
    const files: WorkEvidence["files"] = [];
    const attachments = message.type === "attachment" ? [message] : message.type === "text" ? message.images || [] : [];
    if (!["text", "attachment"].includes(message.type)) throw new Error("work_evidence_invalid: A question is not a delivered result.");
    if (message.type === "text" && !String(message.content || "").trim() && !attachments.length) throw new Error("work_evidence_empty: Publish the result before submitting it.");
    for (const attachment of attachments) {
      if (!dbPath || attachment.artifact?.availability !== "snapshot") throw new Error("work_artifact_unverified: Evidence must be a locally captured publication; external links alone do not prove delivery.");
      const url = new URL(attachment.url);
      if (url.protocol !== "file:") throw new Error("work_artifact_unverified: Only existing local snapshots are checked.");
      const file = fileURLToPath(url), info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new Error("work_artifact_changed: Snapshot is not a supported regular file.");
      const root = realpathSync(join(dirname(dbPath), "attachments", "group-artifacts"));
      const location = relative(root, realpathSync(file));
      if (!location || location.startsWith("..") || isAbsolute(location)) throw new Error("work_artifact_scope: Snapshot must belong to this conversation.");
      const bytes = readFileSync(file), hash = digest(bytes);
      if (bytes.length !== attachment.artifact.bytes || hash !== attachment.artifact.sha256) throw new Error("work_artifact_changed: Published version no longer matches its recorded content.");
      files.push({url: url.href, sha256: hash, bytes: bytes.length});
    }
    return {id, digest: digest(JSON.stringify({message, author: entry.author, replyTo: entry.replyTo, workOnId: entry.workOnId})), files};
  });
}

export function verifyWorkEvidence(entries: readonly TranscriptEntry[], manifest: readonly WorkEvidence[], dbPath?: string): void {
  const current = captureWorkEvidence(entries, manifest.map(item => item.id), dbPath);
  if (JSON.stringify(current) !== JSON.stringify(manifest)) throw new Error("work_evidence_changed: Review the submitted versions, not edited or missing evidence.");
}

/** Source/attempt checks ported from the parallel collaboration regression line.
 * Work is still projected from the primary journal, not a second task store.
 * Transcript order, not client timestamps, determines the publication boundary.
 * Existing historical acceptance remains readable; new submissions are checked.
 */
export function validateWorkEvidenceProvenance(entries: readonly TranscriptEntry[], task: CollaborationTask,
  tasks: ReadonlyMap<string, CollaborationTask>, ids: readonly string[], phase: "submit" | "review"): void {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  let boundary = entries.findIndex(entry => entry.id === task.id);
  let previousState: string | undefined;
  let previousScope = 0;
  for (let index = 0; index < entries.length; index++) {
    const snapshot = (entries[index]?.collaborationEvent as CollaborationEvent | undefined)?.task;
    if (snapshot?.id !== task.id) continue;
    if (snapshot.scopeVersion !== previousScope || (snapshot.state === "claimed" && previousState !== "claimed")
      || snapshot.state === "changes-requested") boundary = index;
    previousState = snapshot.state; previousScope = snapshot.scopeVersion;
  }
  const submitted = new Set(task.submission?.manifest.map(item => item.id) ?? []);
  const submissionIndex = entries.findIndex(entry => entry.id === task.submission?.id);
  for (const id of new Set(ids)) {
    const entry = requireMessageReference(entries, id, "evidence_ids");
    // A reviewer can inspect the exact submitted material (or its submission
    // message). Any separate check report must be new and task-linked.
    if (phase === "review" && (submitted.has(id) || id === task.submission?.id)) continue;
    const index = entries.indexOf(entry);
    if (index <= (phase === "review" ? submissionIndex : boundary))
      throw new Error("work_evidence_stale: Publish a fresh result/check for this work attempt.");
    const pending = [id], seen = new Set<string>(); let linked = false;
    while (pending.length && seen.size < 64) {
      const next = pending.pop()!;
      if (next === task.id) { linked = true; continue; }
      if (tasks.has(next)) throw new Error("work_evidence_scope: Another task's result cannot satisfy this work.");
      if (seen.has(next)) continue; seen.add(next);
      const message = byId.get(next);
      const eventTask = (message?.collaborationEvent as CollaborationEvent | undefined)?.task?.id;
      if (eventTask && eventTask !== task.id) throw new Error("work_evidence_scope: Evidence belongs to another task.");
      for (const target of [message?.replyTo, message?.workOnId]) if (typeof target === "string") pending.push(target);
    }
    if (pending.length || !linked) throw new Error("work_evidence_scope: Quote this assignment or its same-task clarification when publishing evidence.");
  }
}

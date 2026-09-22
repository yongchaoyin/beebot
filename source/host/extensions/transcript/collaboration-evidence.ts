import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkEvidence } from "../../../shared/collaboration.js";
import { requireMessageReference } from "./message-reply-contract.js";
import type { TranscriptEntry } from "./transcript-hub.js";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Evidence points to already-published, same-room messages. Hashing is version
 * identity, not a semantic grade. External links never become locally verified
 * files. Do not fetch URLs or grant a new filesystem capability here. */
export function captureWorkEvidence(entries: readonly TranscriptEntry[], ids: readonly string[], dbPath?: string): WorkEvidence[] {
  return [...new Set(ids)].map(id => {
    const entry = requireMessageReference(entries, id, "evidence_ids");
    if (entry.kind !== "send-message" || entry.isStreaming || !entry.message) throw new Error("work_evidence_invalid: Reference a final published result, not a transient preview or user authorization.");
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

import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sendMessageParameters } from "../../runner/tools/send-message-schema.js";
import type { GroupPublication } from "./group-chat-orchestrator.js";

const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

/** Snapshot an already-authorized outgoing file. This is not a new filesystem
 * authorization boundary; the existing SendMessage ingest/OS checks still apply.
 * Peers receive a stable, room-scoped copy rather than a mutable working file.
 */
function snapshotFile(dbPath: string, rawUrl: string): {url: string; artifact: Record<string, unknown>} {
  const url = new URL(rawUrl);
  if (url.protocol === "https:") return {url: url.href, artifact: {availability: "external-link"}};
  if (url.protocol !== "file:") throw new Error("Group artifacts require a file:// or https:// URL.");
  const source = fileURLToPath(url), before = statSync(source);
  if (!before.isFile() || before.size > MAX_SNAPSHOT_BYTES) throw new Error("Send a readable file no larger than 64 MiB, or an authorized HTTPS link. Nothing was published.");
  const directory = join(dirname(dbPath), "attachments", "group-artifacts");mkdirSync(directory, {recursive: true, mode: 0o700});
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    // Exclusive temp creation prevents collisions. Hash the copy actually shared.
    const fd = openSync(temporary, "wx", 0o600);closeSync(fd);
    copyFileSync(source, temporary);chmodSync(temporary, 0o600);
    const copied = statSync(temporary), after = statSync(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error("The working file changed while being shared. Try again after the write completes.");
    if (copied.size > MAX_SNAPSHOT_BYTES) throw new Error("The attachment grew beyond the supported snapshot size. Nothing was published.");
    const digest = createHash("sha256").update(readFileSync(temporary)).digest("hex");
    const fileName = basename(source), safe = fileName.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-100) || "artifact";
    const target = join(directory, `${digest}-${safe}`);
    const flush = openSync(temporary, "r");try {fsyncSync(flush);} finally {closeSync(flush);}
    if (!existsSync(target) || statSync(target).size !== copied.size || createHash("sha256").update(readFileSync(target)).digest("hex") !== digest) renameSync(temporary, target);
    const dirFd = openSync(directory, "r");try {fsyncSync(dirFd);} finally {closeSync(dirFd);}
    return {url: pathToFileURL(target).href, artifact: {availability: "snapshot", sha256: digest, bytes: copied.size, fileName}};
  } finally {rmSync(temporary, {force: true});}
}

export function publicationText(message: Record<string, any>): string {
  if (message.type === "text") {
    const images = Array.isArray(message.images) ? message.images.map((image: any) => `Image reference: ${JSON.stringify(image.url)}`).join("\n") : "";
    return `${String(message.content || "")}${images ? `\n${images}` : ""}`;
  }
  if (message.type === "attachment") return `Shared artifact ${JSON.stringify(message.file_name || "file")}: ${JSON.stringify(message.url)}${message.artifact?.sha256 ? ` (SHA-256 ${message.artifact.sha256})` : " (external link, not locally verified)"}`;
  if (message.type === "widget") return `Question for the user: ${String(message.widget?.prompt || "")}`;
  if (message.type === "cursor-agent") return `Cloud agent reference: ${String(message.title || message.bcId || "")}`;
  return "";
}

/** Preserve the actual SendMessage shape; never turn file/question delivery into
 * a plain-text success claim. Cross-user rooms deliberately remain text-only.
 */
export function prepareGroupPublication(dbPath: string, raw: unknown, sharedRoom: boolean): GroupPublication {
  const message = sendMessageParameters.parse(raw);
  if (message.channel) throw new Error("This SendMessage belongs to the current group. Use an authorized connector for an external channel.");
  if (sharedRoom && (message.type !== "text" || message.images?.length)) throw new Error("Cross-user rooms support plain text only. This attachment or question was not shared.");
  if (message.type === "secret-request") throw new Error("Request credentials in a private Bot conversation, not a shared group. Nothing was published.");
  if (message.type === "widget" && !message.widget) throw new Error("A group question needs a prompt and answer options. Nothing was published.");
  if (message.type === "cursor-agent" && !message.bcId) throw new Error("A cloud agent reference requires its real agent ID.");
  const body: Record<string, any> = {...message};
  if (message.collaboration && typeof (raw as any)?.collaborationKey === "string" && (raw as any).collaborationKey.length <= 256) body.collaborationKey = (raw as any).collaborationKey;
  if (message.type === "attachment") {
    const snapshot = snapshotFile(dbPath, message.url!);
    body.url = snapshot.url;body.artifact = snapshot.artifact;
    body.file_name = snapshot.artifact.fileName || (typeof (raw as any)?.file_name === "string" ? (raw as any).file_name : "file");
  }
  if (message.type === "text" && message.images?.length) {
    if (message.images.length > 8) throw new Error("Share no more than 8 images in one group message.");
    body.images = message.images.map(image => ({...image, ...snapshotFile(dbPath, image.url)}));
  }
  return {content: publicationText(body), message: body, ...(message.reply_to ? {replyToId: message.reply_to} : {}), ...(message.work_on ? {workOnId: message.work_on} : {}), ...(message.type === "widget" ? {awaitingUser: true} : {})};
}

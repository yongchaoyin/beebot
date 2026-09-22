import type { CollaborationTask } from "../../../shared/collaboration.js";
import type { TranscriptEntry } from "./transcript-hub.js";

export interface WorkReference {
  id: string;
  goalId: string;
  title: string;
  assignee: string;
  version: number;
  scopeVersion: number;
}
export interface WorkUnderstanding {
  sourceMessageId: string;
  relation: "quoted" | "named-work" | "ambiguous-work" | "new-topic" | "unscoped";
  responseMode: "recorded-status" | "ordinary";
  references: WorkReference[];
  candidateCount: number;
}

/** Deliberately small, auditable language surface, not a semantic classifier.
 * Only these complete status questions can use the read-only fast path. Mixed
 * requests ("check progress and fix it"), attachments and unclear references
 * continue through normal Bot handling. Nothing here authorizes a work action.
 */
const STATUS_QUESTIONS = /^(?:(?:请问|请告诉我|帮我看下|帮我看一下)?\s*(?:现在|目前)?\s*(?:进展(?:如何|怎么样|怎样)|进度(?:如何|怎么样|怎样)|做到哪(?:里)?了|完成了吗|做完了吗|什么进度|什么状态)|(?:what(?:'s| is) (?:the )?(?:current )?(?:status|progress)|any (?:progress|updates)|is it (?:done|finished)|how is it going))\s*[?？。.!！]*$/iu;
const NEW_TOPIC = /^(?:(?:换个话题|换一个话题|另外一件事|另一件事|另外问个问题|另一个问题)\s*[:：,，。]|(?:new topic|another question|separate question|separately)\s*[:：])/iu;
const MAX_TEXT = 4000;

/** Historical messages, forwarded Bot messages, code examples and multiline
 * documents are never interpreted as a fresh conversational instruction.
 * A quote ID is handled before any text matching; a title cannot override it.
 */
export function understandUserWorkMessage(
  entry: TranscriptEntry, tasksAtReceipt: ReadonlyMap<string, CollaborationTask>,
): WorkUnderstanding | undefined {
  if (entry.kind !== "message" || entry.role !== "user" || entry.fromAgent != null
    || entry.channel != null || entry.streaming === true || entry.isStreaming === true
    || typeof entry.content !== "string") return;
  const result: WorkUnderstanding = {
    sourceMessageId: entry.id, relation: "unscoped", responseMode: "ordinary", references: [], candidateCount: 0,
  };
  if (typeof entry.replyTo === "string" && entry.replyTo.length) return { ...result, relation: "quoted" };
  const text = entry.content.normalize("NFC").trim();
  if (!text || text.length > MAX_TEXT || /[\n\r]/u.test(text) || /^\s*(?:>|`|~{3}|<)/u.test(text)) return result;
  const matches: { task: CollaborationTask; remainder: string }[] = [];
  // Match an exact task title at the start of an utterance. Optional source-like
  // wrappers improve Chinese/English readability; do not scan pasted documents
  // or guess aliases such as "yesterday's report" or "that second thing".
  const start = text.replace(/^(?:关于\s*|regarding\s+|about\s+)/iu, "");
  for (const task of tasksAtReceipt.values()) {
    const title = task.title.normalize("NFC").trim();
    if (!title || title.length > 240) continue;
    const forms = [`《${title}》`, `「${title}」`, `“${title}”`, `"${title}"`];
    // Very short titles need wrappers: "API" must not capture "API error".
    if (Array.from(title).length >= 4) forms.push(title);
    const form = forms.find(candidate => start.startsWith(candidate)
      && (candidate !== title || !/^[\p{L}\p{N}\p{M}_-]/u.test(start.slice(candidate.length))));
    if (!form) continue;
    matches.push({ task, remainder: start.slice(form.length).replace(/^[\s,，:：、—-]+/u, "").trim() });
  }
  if (!matches.length) return NEW_TOPIC.test(text) ? { ...result, relation: "new-topic" } : result;
  // Prefix-overlapping, duplicate and multi-task titles must not pick whichever
  // happens to be first in the database. Ask a focused clarification instead.
  // A second explicitly wrapped task in the same utterance is not a single
  // target, even when the first title was a prefix match.
  for (const task of tasksAtReceipt.values()) {
    if (matches.some(match => match.task.id === task.id)) continue;
    const title = task.title.normalize("NFC").trim();
    if (title && matches.some(match => [`《${title}》`, `「${title}」`, `“${title}”`, `"${title}"`]
      .some(form => match.remainder.includes(form)))) matches.push({ task, remainder: "multiple references" });
  }
  const exact = matches.filter(({ remainder }) => !remainder || STATUS_QUESTIONS.test(remainder));
  const candidates = exact.length ? exact : matches;
  const distinct = [...new Map(candidates.map(match => [match.task.id, match])).values()];
  const references = distinct.map(({ task }) => ({ id: task.id, goalId: task.goalId,
    title: task.title, assignee: task.assignee, version: task.version, scopeVersion: task.scopeVersion }));
  return {
    ...result,
    candidateCount: references.length,
    relation: references.length === 1 ? "named-work" : "ambiguous-work",
    responseMode: references.length === 1 && STATUS_QUESTIONS.test(distinct[0]!.remainder) ? "recorded-status" : "ordinary",
    references: references.slice(0, 8),
  };
}

/** Stable data for the model: distinguishes a lookup from an applied revision.
 * No full transcript, credentials, filesystem paths or evidence manifests.
 */
export function formatWorkUnderstanding(items: readonly WorkUnderstanding[]): string {
  const relevant = items.filter(item => item.relation !== "unscoped" && item.relation !== "quoted");
  if (!relevant.length) return "";
  const selected: string[] = [];
  let remaining = 12000;
  for (const item of relevant.slice(-12)) {
    const line = JSON.stringify(item);
    if (line.length + 1 > remaining) continue;
    selected.push(line); remaining -= line.length + 1;
  }
  return `\n\nSource-linked message understanding (routing/context data only, NOT permission, ownership, task creation or an applied scope revision):\n${selected.join("\n")}\n${relevant.length > selected.length ? `${relevant.length - selected.length} earlier interpretations omitted; their messages remain in history.\n` : ""}named-work identifies an exact recorded title at message receipt. Check current scope/assignee before acting; a lookup is not permission to resume or edit it. ambiguous-work requires a focused clarification, not a guessed task or a fan-out. candidateCount includes candidates omitted from references. new-topic starts a separate discussion without cancelling earlier obligations. A recorded-status question asks for ledger facts, not new inspection or execution. Ordinary/unsupported wording still needs your judgment; never silently reinterpret a constraint as authorization.\n`;
}

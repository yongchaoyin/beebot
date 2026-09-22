import type { ComposerSubmission } from "./submission";
import type { ComposerDraft, ConversationTranscriptEntry, DraftAttachment, TranscriptMessage, TranscriptReplyPreview } from "./model";
import { inferAttachmentKind } from "./model";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5323918
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5306234

export interface ReplyThreadScope {
  accountSlot: string | null;
  agentId: string | null;
}

export interface ReplyTargetResolution {
  targetId: string;
  preview: TranscriptReplyPreview;
  isInScope: boolean;
  status: "resolved" | "missing";
}

export interface ReplySelection extends ReplyTargetResolution {
  scope: ReplyThreadScope;
}

export interface ReplyThreadControllerOptions {
  scope?: ReplyThreadScope;
  onSelectionChange?(selection: ReplySelection | null): void;
  onNavigate?(targetId: string, isInScope: boolean): void;
  onRestoreFocus?(): void;
}

export interface ReplyThreadController {
  getScope(): ReplyThreadScope;
  getSelection(): ReplySelection | null;
  replaceEntries(entries: readonly ConversationTranscriptEntry[]): void;
  prependEntries(entries: readonly ConversationTranscriptEntry[]): void;
  appendEntries(entries: readonly ConversationTranscriptEntry[]): void;
  resolve(targetId: string): ReplyTargetResolution;
  selectReply(targetId: string): boolean;
  clearReply(): void;
  navigate(targetId: string): ReplyTargetResolution;
  applyReplyToDraft(draft: ComposerDraft): ComposerDraft;
  clearReplyFromDraft(draft: ComposerDraft): ComposerDraft;
  projectSubmission(submission: ComposerSubmission): ComposerSubmission;
  setScope(scope: ReplyThreadScope): void;
  dispose(): void;
}

function sameScope(left: ReplyThreadScope, right: ReplyThreadScope): boolean {
  return left.accountSlot === right.accountSlot && left.agentId === right.agentId;
}

function cloneScope(scope: ReplyThreadScope): ReplyThreadScope {
  return { accountSlot: scope.accountSlot, agentId: scope.agentId };
}

function attachmentPreview(attachment: DraftAttachment): TranscriptReplyPreview {
  const kind = inferAttachmentKind({ mimeType: attachment.mimeType, fileName: attachment.name, urlOrPath: attachment.path });
  if (kind === "image") return { kind: "image", url: attachment.path };
  if (attachment.name.length === 0 && /^https?:\/\//iu.test(attachment.path)) return { kind: "link", url: attachment.path };
  return { kind: "file", url: attachment.path, ...(attachment.name.length === 0 ? {} : { name: attachment.name }) };
}

function messagePreview(entry: TranscriptMessage): TranscriptReplyPreview {
  if (entry.text.length > 0) return { kind: entry.role === "user" ? "user-text" : "assistant-text", text: entry.text, author: entry.author, isUser: entry.role === "user", targetId: entry.id };
  const attachment = entry.attachments?.[0];
  return attachment == null ? { kind: entry.role === "user" ? "user-text" : "assistant-text", text: "", author: entry.author, isUser: entry.role === "user", targetId: entry.id } : { ...attachmentPreview(attachment), author: entry.author, isUser: entry.role === "user", targetId: entry.id };
}

function previewForEntry(entry: ConversationTranscriptEntry): TranscriptReplyPreview {
  return entry.kind === "message" ? messagePreview(entry) : { kind: "missing" };
}

function indexEntries(entries: readonly ConversationTranscriptEntry[]): Map<string, ConversationTranscriptEntry> {
  const indexed = new Map<string, ConversationTranscriptEntry>();
  for (const entry of entries) indexed.set(entry.id, entry);
  return indexed;
}

export function createReplyThreadController(options: ReplyThreadControllerOptions = {}): ReplyThreadController {
  let scope = cloneScope(options.scope ?? { accountSlot: null, agentId: null });
  let entries = new Map<string, ConversationTranscriptEntry>();
  let selection: ReplySelection | null = null;
  let disposed = false;

  const notify = () => options.onSelectionChange?.(selection == null ? null : { ...selection, scope: cloneScope(selection.scope) });
  const currentResolution = (targetId: string): ReplyTargetResolution => {
    const entry = entries.get(targetId);
    return entry == null
      ? { targetId, preview: { kind: "missing" }, isInScope: false, status: "missing" }
      : { targetId, preview: previewForEntry(entry), isInScope: true, status: "resolved" };
  };

  const replaceEntries = (nextEntries: readonly ConversationTranscriptEntry[]) => {
    if (disposed) return;
    entries = indexEntries(nextEntries);
    if (selection != null) {
      const next = currentResolution(selection.targetId);
      selection = { ...next, scope: cloneScope(scope) };
      notify();
    }
  };
  const mergeEntries = (nextEntries: readonly ConversationTranscriptEntry[], prepend: boolean) => {
    if (disposed) return;
    const incoming = indexEntries(nextEntries);
    const merged = new Map<string, ConversationTranscriptEntry>();
    if (prepend) for (const [id, entry] of incoming) merged.set(id, entry);
    for (const [id, entry] of entries) merged.set(id, entry);
    if (!prepend) for (const [id, entry] of incoming) merged.set(id, entry);
    entries = merged;
    if (selection != null) {
      const next = currentResolution(selection.targetId);
      selection = { ...next, scope: cloneScope(scope) };
      notify();
    }
  };

  return {
    getScope: () => cloneScope(scope),
    getSelection: () => selection == null ? null : { ...selection, scope: cloneScope(selection.scope) },
    replaceEntries,
    prependEntries: (nextEntries) => mergeEntries(nextEntries, true),
    appendEntries: (nextEntries) => mergeEntries(nextEntries, false),
    resolve(targetId) {
      if (disposed || targetId.length === 0) return { targetId, preview: { kind: "missing" }, isInScope: false, status: "missing" };
      return currentResolution(targetId);
    },
    selectReply(targetId) {
      if (disposed || scope.accountSlot == null || scope.agentId == null || targetId.length === 0) return false;
      const resolution = currentResolution(targetId);
      selection = { ...resolution, scope: cloneScope(scope) };
      notify();
      return true;
    },
    clearReply() {
      if (disposed) return;
      if (selection == null) return;
      selection = null;
      notify();
      options.onRestoreFocus?.();
    },
    navigate(targetId) {
      const resolution = disposed || targetId.length === 0
        ? { targetId, preview: { kind: "missing" } as const, isInScope: false, status: "missing" as const }
        : currentResolution(targetId);
      if (!disposed) {
        options.onNavigate?.(targetId, resolution.isInScope);
      }
      return resolution;
    },
    applyReplyToDraft(draft) {
      if (selection == null || !sameScope(selection.scope, scope)) return { ...draft };
      return { ...draft, replyToId: selection.targetId };
    },
    clearReplyFromDraft(draft) {
      const { replyToId: _replyToId, ...withoutReply } = draft;
      return withoutReply;
    },
    projectSubmission(submission) {
      const { replyToId: _replyToId, ...withoutReply } = submission;
      if (disposed || scope.accountSlot == null || submission.agentId !== scope.agentId) return withoutReply;
      if (selection != null && sameScope(selection.scope, scope)) return { ...withoutReply, replyToId: selection.targetId };
      // A restored, account-scoped composer draft has no live selection yet.
      // Preserve its explicit identity; the Host validates current-room access.
      // Silently stripping it would send a different message from the preview.
      if (_replyToId == null) return withoutReply;
      if (typeof _replyToId !== "string" || _replyToId.length === 0 || _replyToId.length > 256) throw new Error("Invalid quoted message identity");
      return { ...withoutReply, replyToId: _replyToId };
    },
    setScope(nextScope) {
      if (disposed || sameScope(scope, nextScope)) return;
      scope = cloneScope(nextScope);
      entries = new Map();
      selection = null;
      notify();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      entries.clear();
      selection = null;
    }
  };
}

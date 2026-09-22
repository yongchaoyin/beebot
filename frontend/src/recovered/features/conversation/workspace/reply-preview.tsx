import * as React from "react";
import { createQuotedReplyUI, quotedMessageLabel } from "./quoted-reply-ui";
const quoteUI = createQuotedReplyUI(React);
import type { TranscriptReplyPreview } from "./model";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4720289
const REPLY_TEXT_LABEL_LIMIT = 40;

function replyAttachmentBasename(url: string): string {
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    // The reply target may be a local path rather than a URL.
  }
  const trimmed = path.replace(/\/+$/u, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed) || url;
}

function replyLinkHost(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function normalizeReplyText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** The compact target label used by the shipped reply quote and composer pill. */
export function replyPreviewLabel(preview: TranscriptReplyPreview): string {
  switch (preview.kind) {
    case "user-text":
    case "assistant-text": {
      const text = normalizeReplyText(preview.text);
      if (text.length === 0) return "Thread";
      if (text.length <= REPLY_TEXT_LABEL_LIMIT) return text;
      return `${text.slice(0, REPLY_TEXT_LABEL_LIMIT - 1).replace(/[\s:;,.!?\u2013\u2014-]+$/gu, "")}…`;
    }
    case "image":
      return "Photo";
    case "file":
      return preview.name != null && preview.name.length > 0 ? preview.name : replyAttachmentBasename(preview.url);
    case "link":
      return replyLinkHost(preview.url);
    case "missing":
      return "Thread";
  }
}

export function replyQuoteLabel(preview: TranscriptReplyPreview): string {
  return quotedMessageLabel(preview);
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4761587
export function replyComposerPlaceholder(preview: TranscriptReplyPreview): string {
  switch (preview.kind) {
    case "user-text":
    case "assistant-text":
    case "missing":
      return "Reply…";
    case "image":
      return "Reply to attachment…";
    case "file":
      return "Reply to file…";
    case "link":
      return "Reply to link…";
  }
}

export interface ReplyQuoteProps {
  targetId: string;
  preview: TranscriptReplyPreview;
  isInScope: boolean;
  onOpen(targetId: string, isInScope: boolean): void;
  ariaDescribedBy?: string;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5097299
export function ReplyQuote({ targetId, preview, isInScope, onOpen, ariaDescribedBy }: ReplyQuoteProps) {
  return <quoteUI.QuotedReply targetId={targetId} preview={preview} ariaDescribedBy={ariaDescribedBy} onNavigate={(id) => onOpen(id, isInScope)} />;
}

export interface ComposerReplyTarget {
  targetId: string;
  preview: TranscriptReplyPreview;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4725937
export function ComposerReplyPill({ target, onClear }: { target: ComposerReplyTarget; onClear(): void }) {
  return <quoteUI.ComposerQuote preview={{ ...target.preview, targetId: target.targetId }} onClear={onClear} />;
}

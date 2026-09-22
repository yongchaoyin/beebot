import type { TranscriptReplyPreview } from "./model";
import { ReplyQuote } from "./reply-preview";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5160690 (Mac cPn)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6490750 (Windows cPn)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5163003 (Mac uPn content handoff)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6493740 (Windows uPn content handoff)

const REFERENCE_QUOTE_LIMIT = 96;
const REFERENCE_LABEL_LIMIT = 48;
const DAY_MS = 24 * 60 * 60 * 1000;

const MESSAGE_REFERENCE_TEXT_REWRITES: readonly [RegExp, string][] = [
  [/`+/gu, ""],
  [/!\[([^\]]*)\]\([^)]*\)/gu, "$1"],
  [/\[([^\]]+)\]\([^)]*\)/gu, "$1"],
  [/\$\$((?:[^$\\]|\\[\s\S])+)\$\$/gu, "$1"],
  [/\\\(([\s\S]+?)\\\)/gu, "$1"],
  [/\\\[([\s\S]+?)\\\]/gu, "$1"],
  [/\\\$/gu, "$"],
  [/^\s{0,3}#{1,6}\s+/gmu, ""],
  [/^\s{0,3}>\s?/gmu, ""],
  [/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gmu, ""],
  [/\*\*([^*]+)\*\*/gu, "$1"],
  [/__([^_]+)__/gu, "$1"],
  [/~~([^~]+)~~/gu, "$1"],
  [/\*([^*\n]+)\*/gu, "$1"],
  [/(?<!\w)_([^_\n]+)_(?!\w)/gu, "$1"],
  [/\|/gu, " "]
];

function normalizeReferencedText(text: string): string {
  return MESSAGE_REFERENCE_TEXT_REWRITES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text).replace(/\s+/gu, " ").trim();
}

function truncateReferencedText(text: string, limit = REFERENCE_QUOTE_LIMIT): string {
  const normalized = normalizeReferencedText(text);
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function attachmentBasename(url: string): string {
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    // The immutable renderer accepts local attachment paths as well as URLs.
  }
  const trimmed = path.replace(/\/+$/u, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed) || url;
}

function linkHost(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function validTimestamp(timestampMs: number | null | undefined): number | null {
  return timestampMs != null && Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : null;
}

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** Exact l5e-style timestamp projection used by the immutable reference content. */
export function formatReferencedMessageTime(timestampMs: number | null | undefined, now = new Date()): string {
  const timestamp = validTimestamp(timestampMs);
  if (timestamp == null) return "";
  const date = new Date(timestamp);
  const dayDistance = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / DAY_MS);
  if (dayDistance <= 0) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (dayDistance === 1) return "Yesterday";
  if (dayDistance < 7) return date.toLocaleDateString([], { weekday: "long" });
  return date.getFullYear() === now.getFullYear()
    ? date.toLocaleDateString([], { month: "numeric", day: "numeric" })
    : date.toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
}

export function referencedMessagePreviewLabel(preview: TranscriptReplyPreview): string {
  switch (preview.kind) {
    case "user-text":
    case "assistant-text": {
      const text = truncateReferencedText(preview.text, REFERENCE_LABEL_LIMIT);
      return text.length > 0 ? text : "(empty)";
    }
    case "image":
      return "Photo";
    case "file":
      return truncateReferencedText(preview.name != null && preview.name.length > 0 ? preview.name : attachmentBasename(preview.url), REFERENCE_LABEL_LIMIT);
    case "link":
      return truncateReferencedText(linkHost(preview.url), REFERENCE_LABEL_LIMIT);
    case "missing":
      return "(unavailable)";
  }
}

function labelForQuote(preview: TranscriptReplyPreview): string {
  switch (preview.kind) {
    case "user-text":
    case "assistant-text": {
      const text = truncateReferencedText(preview.text);
      return text.length > 0 ? text : "(empty)";
    }
    case "image":
      return "Photo";
    case "file":
      return truncateReferencedText(preview.name != null && preview.name.length > 0 ? preview.name : attachmentBasename(preview.url));
    case "link":
      return truncateReferencedText(linkHost(preview.url));
    case "missing":
      return "(unavailable)";
  }
}

const LABEL_CLASSES = "sand-reply-quote__label sand-1rg5ohu sand-euugli sand-193iq5w sand-b3r6kr sand-lyipyv sand-uxw1ft sand-1heor9g";

function QuoteLabel({ children }: { children: string }) {
  return <span className={LABEL_CLASSES}>{children}</span>;
}

function QuoteContent({ preview }: { preview: TranscriptReplyPreview }) {
  switch (preview.kind) {
    case "user-text":
    case "assistant-text":
      return <QuoteLabel>{labelForQuote(preview)}</QuoteLabel>;
    case "image":
      return (
        <>
          <span aria-hidden="true" className="sand-reply-quote__thumb sand-3nfvp2 sand-2lah0s sand-12oqio5 sand-b3r6kr sand-cq4si4" style={{ height: 16, width: 16 }}>
            <img alt="" aria-hidden="true" draggable={false} src={preview.url} />
          </span>
          <QuoteLabel>Photo</QuoteLabel>
        </>
      );
    case "file":
      return (
        <>
          <span aria-hidden="true" className="sand-reply-quote__icon sand-4b2ntj sand-2lah0s" data-icon-name="file" />
          <QuoteLabel>{labelForQuote(preview)}</QuoteLabel>
        </>
      );
    case "link":
      return (
        <>
          <span aria-hidden="true" className="sand-reply-quote__icon sand-4b2ntj sand-2lah0s" data-icon-name="link" />
          <QuoteLabel>{labelForQuote(preview)}</QuoteLabel>
        </>
      );
    case "missing":
      return <QuoteLabel>{labelForQuote(preview)}</QuoteLabel>;
  }
}

export interface ReferencedMessagePreviewProps {
  readonly authorName: string;
  readonly timestampMs?: number | null;
  readonly preview: TranscriptReplyPreview;
}

/**
 * The first-party content leaf for the shipped referenced-message preview.
 * This optional detail leaf is separate from the inline quote trigger. Missing
 * originals are unavailable, not presumed deleted. Resolution and navigation
 * remain owned by the authorized conversation.
 */
export function ReferencedMessagePreview({ authorName, timestampMs, preview }: ReferencedMessagePreviewProps) {
  const timestamp = validTimestamp(timestampMs);
  return (
    <div className="sand-message-ref-preview sand-78zum5 sand-dt5ytf sand-1jnr06f sand-euugli">
      <div className="sand-78zum5 sand-1pha0wt sand-167g77z sand-euugli">
        <span className="sand-euugli sand-b3r6kr sand-lyipyv sand-uxw1ft sand-1iyjqo2 sand-1wd3ewq sand-1wm8ruf sand-spwq11 sand-xzm5a7">{authorName}</span>
        {timestamp == null ? null : <span className="sand-2lah0s sand-4b2ntj sand-y5h43f sand-spwq11 sand-uxw1ft">{formatReferencedMessageTime(timestamp)}</span>}
      </div>
      <div className="sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-euugli sand-19aaqeu sand-1wm8ruf sand-spwq11">
        <span aria-hidden="true" className="sand-reply-quote__lead sand-4b2ntj sand-2lah0s" data-icon-name="arrow-u-up-right" />
        <QuoteContent preview={preview} />
      </div>
    </div>
  );
}

export interface ReferencedMessagePreviewTriggerProps extends ReferencedMessagePreviewProps {
  readonly ownerId: string;
  readonly targetId: string;
  readonly isInScope: boolean;
  onOpen(targetId: string, isInScope: boolean): void;
}

/** Inline quote; navigation stays in the current conversation, without a popup. */
export function ReferencedMessagePreviewTrigger({ targetId, isInScope, onOpen, ...previewProps }: ReferencedMessagePreviewTriggerProps) {
  return <ReplyQuote isInScope={isInScope} onOpen={onOpen} preview={{...previewProps.preview, author: previewProps.authorName || previewProps.preview.author}} targetId={targetId} />;
}

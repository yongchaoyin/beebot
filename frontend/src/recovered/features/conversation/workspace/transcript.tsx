import { getSchema, type JSONContent } from "@tiptap/core";
import { normalizeLinkUrl } from "../cards/transcript-card/url-card";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { SandIcon } from "../../../ui/sand-kit-primitives";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./transcript-utility-parity.css";
import { AssistantMath } from "./math";
import { TranscriptAttachmentGallery } from "./media-viewer";
import { MermaidDiagram } from "./mermaid";
import { createPromptEditorExtensions } from "./rich-text-editor";
import type { AttachmentBytesResult, AttachmentMedia } from "../../../contracts/desktop-bridge";
import type { ConversationTranscriptEntry, TranscriptComputerHandoff, TranscriptMessage, TranscriptThinking, TranscriptToolCall } from "./model";
import type { TranscriptCardEntry } from "../cards/transcript-card/protocol";
import { TranscriptNoticeCard } from "../cards/notice/view";
import { TranscriptCardRootEntry } from "../cards/transcript-card/root";
import { TimelineEventRootEntry } from "../cards/timeline-event-resolver";
import type { TranscriptCardRootMountContract } from "../cards/transcript-card/mount-contract";
import { TranscriptCardInteractionProvider, type TranscriptCardInteractionContext, type TranscriptMessageReactionSlotProps, type RenderTranscriptMessageReactionActions } from "../cards/transcript-card/message-actions";
import { projectTranscriptAdjacency } from "./transcript-adjacency";
import type { LocalToolPermissionStore } from "../../permissions/local-tool/store";
import type { ResolveLocalToolPermissionInput } from "../../permissions/local-tool/view";
import { ReferencedMessagePreviewTrigger } from "./referenced-message-preview";
import type { TranscriptReplyPreview } from "./model";
import type { UrlCardProvider } from "../cards/transcript-card/url-card";
import { LinkCardView } from "../cards/transcript-card/views";
import { projectTranscriptMessageCard } from "../message-card-seam";
import PermissionRequestLeaf from "../cards/permission-request/view";
import { ToolResultCard } from "../tool-results/view";
import type { FindInChatTranscriptHandle } from "./find-in-chat-controller";
import type { SendMessageTextImage } from "../cards/transcript-card/send-message-text";
import { ThreadAffordance } from "../cards/transcript-card/thread-affordance";
import type { TranscriptThreadSummary } from "../cards/transcript-card/thread-summary-controller";

function transcriptIds(id: string, hasTimestamp: boolean) {
  const base = `sand-conversation-entry-${encodeURIComponent(id)}`;
  return { author: `${base}-author`, timestamp: hasTimestamp ? `${base}-timestamp` : undefined };
}

export interface ConversationTranscriptActions {
  /** A transport-owned action under an ordinary message, e.g. accepting a completed run. */
  renderMessageFooter?(entry: TranscriptMessage): ReactNode;
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  loadOlder?(): void | Promise<void>;
  isTransportDown?: boolean;
  onCancelQueuedSend?(entry: TranscriptMessage): void;
  onDeleteFailedSend?(entry: TranscriptMessage): void;
  onReply?(entry: TranscriptMessage): void;
  onStartThread?(entry: TranscriptMessage): void;
  onResendFailedSend?(entry: TranscriptMessage): void;
  onCopyMessage?(entry: TranscriptMessage): void | Promise<void>;
  renderMessageReactionActions?: RenderTranscriptMessageReactionActions;
  renderMessageReactionPills?: RenderTranscriptMessageReactionPills;
  onOpenReply?(targetId: string, isInScope: boolean): void;
  onOpenAutomation?(automationId: string): void;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5073901 (reaction-pill row owner; UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6373033 (reaction-pill row owner; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5093087 (mCn action anchor reaction ordering/focus owner; UTF-8; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6395648 (mCn action anchor reaction ordering/focus owner; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
export type TranscriptMessageReactionPillsProps = Omit<TranscriptMessageReactionSlotProps, "onOpenChange">;
export type RenderTranscriptMessageReactionPills = (props: TranscriptMessageReactionPillsProps) => ReactNode;

// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6395536 (immutable mCn action eligibility/copy injection; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
function isOrdinaryMessageActionable(entry: TranscriptMessage, isReadOnly: boolean, onCopy?: (entry: TranscriptMessage) => void | Promise<void>): boolean {
  const hasCopyContent = entry.text.length > 0;
  const deliveryActionable = entry.delivery !== "failed" && entry.delivery !== "pending" && entry.delivery !== "queued";
  return hasCopyContent && deliveryActionable && (!isReadOnly || onCopy != null);
}

const deliveryActionButtonClass = "sand-y5h43f sand-19ji09o";

function QueuedSendNotice({ entry, isTransportDown, onCancel }: { entry: TranscriptMessage; isTransportDown: boolean; onCancel?: (entry: TranscriptMessage) => void }) {
  return <div className="sand-queued-send-notice sand-pvyfi4 sand-78zum5 sand-6s0dn4 sand-1a02dak sand-13a6bvl sand-11twubx sand-1om1abp" role="status">
    <span>{isTransportDown ? "Will send when reconnected" : "Waiting to send…"}</span>
    {onCancel == null ? null : <button className={deliveryActionButtonClass} onClick={() => onCancel(entry)} type="button">Cancel</button>}
  </div>;
}

function FailedSendActions({ entry, onDelete, onResend }: { entry: TranscriptMessage; onDelete?: (entry: TranscriptMessage) => void; onResend?: (entry: TranscriptMessage) => void }) {
  return <div aria-label="Failed message actions" className="sand-failed-send-actions sand-pvyfi4 sand-78zum5 sand-6s0dn4 sand-1a02dak sand-13a6bvl sand-11twubx sand-1om1abp" role="group">
    <span className="sand-6rl5ky sand-y5h43f sand-1rhlpx6 sand-19ji09o" role="status">Failed to send</span>
    {onResend == null ? null : <button className={deliveryActionButtonClass} onClick={() => onResend(entry)} type="button">Resend</button>}
    {onDelete == null ? null : <button className={deliveryActionButtonClass} onClick={() => onDelete(entry)} type="button">Delete</button>}
  </div>;
}

function SentWhileOfflineNotice({ composedAtMs }: { composedAtMs: number }) {
  let label: string;
  try {
    label = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(composedAtMs));
  } catch {
    label = new Date(composedAtMs).toISOString();
  }
  return <div className="sand-sent-while-offline-notice sand-pvyfi4 sand-78zum5 sand-6s0dn4 sand-1a02dak sand-13a6bvl sand-11twubx sand-1om1abp sand-h4j8nf sand-1hc1fzr sand-b3r6kr sand-ltd7ks sand-hj7x8a sand-s9c323 sand-oddwdg sand-8m7ss9 sand-1ympp8d sand-16ges1v sand-1rrsdy6" role="status"><span className="sand-1o0liin sand-y5h43f sand-19ji09o">Sent while offline · {label}</span></div>;
}

function messageActionLabel(entry: TranscriptMessage): string {
  return `Message actions for ${entry.role === "user" ? "your message" : entry.author} (${entry.id})`;
}

function replyActionLabel(entry: TranscriptMessage): string {
  if (entry.role === "user") return "Reply to your message";
  const author = entry.author.replace(/\s+/gu, " ").trim();
  const bounded = author.length > 60 ? `${author.slice(0, 59).trimEnd()}…` : author;
  return `Reply to ${bounded.length > 0 ? bounded : "Agent"} message`;
}

function replyActionIconName(entry: TranscriptMessage): "arrow-u-up-right" | "arrow-u-up-left" {
  return entry.role === "user" ? "arrow-u-up-right" : "arrow-u-up-left";
}

function isUnresolvedWidget(entry: ConversationTranscriptEntry): entry is TranscriptCardEntry {
  return entry.kind === "send-message"
    && entry.message.type === "widget"
    && entry.respondedValue == null
    && entry.widgetSkipped !== true
    && entry.widgetDismissed !== true
    && Array.isArray(entry.message.widget.options)
    && entry.message.widget.options.length > 0;
}

function isWidgetSelectionBoundary(entry: ConversationTranscriptEntry): boolean {
  if (entry.kind === "message" && entry.role === "user") return true;
  return entry.kind === "send-message"
    && entry.message.type === "widget"
    && (entry.respondedValue != null || entry.widgetDismissed === true);
}

// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6366718 (immutable _En keyboard widget selection; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6365538 (immutable Dht resolved widget boundary; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)

export function transcriptKeyboardWidgetEntryId(entries: readonly ConversationTranscriptEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry == null) continue;
    if (isWidgetSelectionBoundary(entry)) return null;
    if (isUnresolvedWidget(entry)) return entry.id;
  }
  return null;
}

function messageActionIconCodePoint(name: "copy" | "dots-3-horizontal"): number {
  return name === "copy" ? 0xebcc : 0xea7c;
}

function isMessageContextTargetExcluded(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('a[href], img, input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .sand-attachment__image-button') != null) return true;
  const selection = window.getSelection();
  return selection != null && !selection.isCollapsed && selection.toString().length > 0;
}

function MessageActionAnchor({ entry, isReadOnly, threadRootId, threadSummary, onOpenThread, onCopy, onReply, onStartThread, renderReactionActions, children }: { entry: TranscriptMessage; isReadOnly: boolean; threadRootId: string | null; threadSummary?: TranscriptThreadSummary | null; onOpenThread?: (targetId: string) => void; onCopy?: (entry: TranscriptMessage) => void | Promise<void>; onReply?: (entry: TranscriptMessage) => void; onStartThread?: (entry: TranscriptMessage) => void; renderReactionActions?: (onOpenChange: (open: boolean) => void) => ReactNode; children: ReactNode }) {
  const hasActions = isOrdinaryMessageActionable(entry, isReadOnly, onCopy);
  if (!hasActions) return <>{children}</>;
  const isThreadActionVisible = threadRootId == null;
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const reactionActions = renderReactionActions?.((open) => {
    setReactionMenuOpen(open);
    if (open) setMenuOpen(false);
  });
  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || anchorRef.current?.contains(event.target)) return;
      closeMenu(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const copy = () => {
    closeMenu(true);
    if (entry.sendMessageText?.streaming === true && entry.sendMessageText.message.content.length === 0) return;
    if (onCopy != null) {
      void Promise.resolve(onCopy(entry)).catch(() => undefined);
    }
  };

  return (
    <div
      ref={anchorRef}
      className={menuOpen || reactionMenuOpen ? "sand-message-action-anchor sand-message-action-anchor--menu-open" : "sand-message-action-anchor"}
      onContextMenu={(event) => {
        if (isMessageContextTargetExcluded(event.target)) return;
        event.preventDefault();
        setReactionMenuOpen(false);
        setMenuOpen(true);
      }}
    >
      {children}
      {threadSummary != null && threadRootId == null && !isReadOnly && onOpenThread != null ? <ThreadAffordance onOpen={onOpenThread} role={entry.role} summary={threadSummary} /> : null}
      <div aria-label={messageActionLabel(entry)} className="sand-message-hover-actions" role="toolbar">
        {reactionActions}
        {!isReadOnly && isThreadActionVisible && onReply != null ? <button aria-label={replyActionLabel(entry)} className="sand-message-hover-actions__button" onClick={() => onReply(entry)} type="button"><SandIcon name={replyActionIconName(entry)} /></button> : null}
        <button aria-expanded={menuOpen} aria-haspopup="menu" aria-label="More message actions" className="sand-message-hover-actions__button" onClick={() => { setReactionMenuOpen(false); setMenuOpen((open) => !open); }} ref={triggerRef} type="button">
          <span aria-hidden="true" data-icon-name="dots-3-horizontal" style={{ fontFamily: "cursor-icons" }}>{String.fromCodePoint(messageActionIconCodePoint("dots-3-horizontal"))}</span>
        </button>
        {menuOpen ? <div aria-label="More message actions" role="menu" style={{ position: "absolute", right: 0, bottom: "34px", display: "grid", minWidth: "150px", padding: "4px", background: "#20231f", border: "1px solid #343832", borderRadius: "8px", boxShadow: "0 12px 28px rgba(0, 0, 0, .35)" }}>
          {!isReadOnly && isThreadActionVisible && onReply != null ? <button className="sand-message-hover-actions__button" onClick={() => { onReply(entry); closeMenu(true); }} role="menuitem" style={{ width: "100%", border: 0, borderRadius: "5px", textAlign: "left" }} type="button"><SandIcon name={replyActionIconName(entry)} />Reply</button> : null}
          {!isReadOnly && isThreadActionVisible && onStartThread != null ? <button className="sand-message-hover-actions__button" onClick={() => { onStartThread(entry); closeMenu(true); }} role="menuitem" style={{ width: "100%", border: 0, borderRadius: "5px", textAlign: "left" }} type="button"><span aria-hidden="true" data-icon-name="chat-bubbles" />Start a thread</button> : null}
          {/* @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=6395536 (immutable Copy item is conditional on injected onCopy; UTF-8; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5) */}
          {onCopy == null ? null : <button className="sand-message-hover-actions__button" onClick={copy} role="menuitem" style={{ width: "100%", border: 0, borderRadius: "5px", textAlign: "left" }} type="button"><span aria-hidden="true" data-icon-name="copy" style={{ fontFamily: "cursor-icons" }}>{String.fromCodePoint(messageActionIconCodePoint("copy"))}</span>Copy</button>}
        </div> : null}
      </div>
    </div>
  );
}

function StreamingMessage() {
  return <p aria-hidden="true" className="sand-message-content sand-message-typing">
    <span className="sand-message-typing__dot" />
    <span className="sand-message-typing__dot" />
    <span className="sand-message-typing__dot" />
  </p>;
}

type AssistantContentBlock = { kind: "text"; text: string } | { kind: "code"; language: string; code: string };
type AssistantListItem = { text: string; task?: boolean; checked?: boolean };
type AssistantTextBlock = { kind: "paragraph"; text: string } | { kind: "heading"; level: 1 | 2 | 3; text: string } | { kind: "list"; ordered: boolean; start?: number; items: AssistantListItem[] } | { kind: "blockquote"; text: string } | { kind: "horizontal-rule" } | { kind: "table"; headers: string[]; rows: string[][] } | { kind: "math"; expression: string };

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function renderAssistantInlineText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const assistantInlinePattern = /\\\(([^\\\n]*?)\\\)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+)|(\*\*|__)(?=\S)([^\n]*?\S)\5|(\*|_)(?=\S)([^\n]*?\S)\7|~~(?=\S)([^\n]*?\S)~~|`([^`\n]+)`/giu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = assistantInlinePattern.exec(text)) != null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    if (match[1] != null) {
      nodes.push(<AssistantMath displayMode={false} expression={match[1]} key={`assistant-math-inline-${match.index}`} />);
    } else {
      const markdownLabel = match[2];
      const rawUrl = match[3] ?? match[4] ?? "";
      if (match[5] != null) {
        nodes.push(<strong className="sand-dj266r sand-at24cr" key={`assistant-strong-${match.index}`}>{renderAssistantInlineText(match[6] ?? "")}</strong>);
      } else if (match[7] != null) {
        nodes.push(<em className="sand-dj266r sand-at24cr" key={`assistant-emphasis-${match.index}`}>{renderAssistantInlineText(match[8] ?? "")}</em>);
      } else if (match[9] != null) {
        nodes.push(<s className="sand-dj266r sand-at24cr" key={`assistant-strikethrough-${match.index}`}>{renderAssistantInlineText(match[9])}</s>);
      } else if (match[10] != null) {
        nodes.push(<code className="sand-dj266r sand-at24cr sand-t970qd sand-1bfovwe sand-1e1y6u3 sand-1hhjprl sand-67nlm8 sand-eb7xqv" key={`assistant-inline-code-${match.index}`}>{match[10]}</code>);
      } else {
        const trailing = markdownLabel == null ? rawUrl.match(/[),.!?;:\]}]+$/u)?.[0] ?? "" : "";
        const href = rawUrl.slice(0, rawUrl.length - trailing.length);
        if (!isHttpUrl(href)) {
          nodes.push(match[0]);
        } else {
          nodes.push(<a className="sand-l1v4ol sand-krqix3 sand-1sur9pj" href={href} key={`assistant-link-${match.index}`} rel="noopener noreferrer" target="_blank">{markdownLabel ?? href}</a>);
          if (trailing.length > 0) nodes.push(trailing);
        }
      }
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function splitAssistantTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const withoutLeadingPipe = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutTrailingPipe = withoutLeadingPipe.endsWith("|") ? withoutLeadingPipe.slice(0, -1) : withoutLeadingPipe;
  const cells = withoutTrailingPipe.split("|").map((cell) => cell.trim());
  return cells.length > 1 ? cells : null;
}

function isAssistantTableSeparator(cells: string[]): boolean {
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function assistantTextBlocks(text: string): AssistantTextBlock[] {
  const blocks: AssistantTextBlock[] = [];
  const paragraphLines: string[] = [];
  let activeList: Extract<AssistantTextBlock, { kind: "list" }> | null = null;
  let activeQuote: string[] | null = null;
  const flushParagraph = () => {
    if (paragraphLines.some((line) => line.trim().length > 0)) blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
    paragraphLines.length = 0;
  };
  const flushList = () => {
    if (activeList != null) blocks.push(activeList);
    activeList = null;
  };
  const flushQuote = () => {
    if (activeQuote != null && activeQuote.length > 0) blocks.push({ kind: "blockquote", text: activeQuote.join("\n") });
    activeQuote = null;
  };
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (/^\s{0,3}\$\$\s*$/u.test(line)) {
      const closingIndex = lines.findIndex((candidate, index) => index > lineIndex && /^\s{0,3}\$\$\s*$/u.test(candidate));
      if (closingIndex > lineIndex) {
        flushList();
        flushQuote();
        flushParagraph();
        blocks.push({ kind: "math", expression: lines.slice(lineIndex + 1, closingIndex).join("\n") });
        lineIndex = closingIndex;
        continue;
      }
    }
    const quoteMatch = /^\s*>\s?(.*)$/.exec(line);
    if (quoteMatch != null) {
      flushList();
      flushParagraph();
      activeQuote ??= [];
      activeQuote.push(quoteMatch[1] ?? "");
      continue;
    }
    flushQuote();
    const tableHeaders = splitAssistantTableRow(line);
    const tableSeparator = splitAssistantTableRow(lines[lineIndex + 1] ?? "");
    if (tableHeaders != null && tableSeparator != null && tableHeaders.length === tableSeparator.length && isAssistantTableSeparator(tableSeparator)) {
      flushList();
      flushParagraph();
      const rows: string[][] = [];
      lineIndex += 2;
      while (lineIndex < lines.length) {
        const row = splitAssistantTableRow(lines[lineIndex] ?? "");
        if (row == null || row.length !== tableHeaders.length) break;
        rows.push(row);
        lineIndex += 1;
      }
      blocks.push({ kind: "table", headers: tableHeaders, rows });
      lineIndex -= 1;
      continue;
    }
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      flushList();
      flushParagraph();
      blocks.push({ kind: "horizontal-rule" });
      continue;
    }
    const headingMatch = /^\s{0,3}(#{1,3})\s+(.+?)\s*$/u.exec(line);
    if (headingMatch != null) {
      flushList();
      flushParagraph();
      blocks.push({ kind: "heading", level: headingMatch[1]?.length as 1 | 2 | 3, text: headingMatch[2]?.trim() ?? "" });
      continue;
    }
    const orderedMatch = /^\s*(\d+)\.\s+(.+)$/.exec(line);
    const unorderedMatch = /^\s*[-+*]\s+(.+)$/.exec(line);
    if (orderedMatch != null || unorderedMatch != null) {
      const ordered = orderedMatch != null;
      if (activeList == null || activeList.ordered !== ordered) {
        flushList();
        flushParagraph();
        activeList = {
          kind: "list",
          ordered,
          ...(orderedMatch == null ? {} : { start: Number.parseInt(orderedMatch[1] ?? "1", 10) }),
          items: []
        };
      }
      const itemText = (orderedMatch?.[2] ?? unorderedMatch?.[1] ?? "").trim();
      const taskMatch = /^\[([ xX])\]\s+(.+)$/u.exec(itemText);
      activeList.items.push(taskMatch == null
        ? { text: itemText }
        : { text: taskMatch[2] ?? "", task: true, checked: taskMatch[1]?.toLowerCase() === "x" });
      continue;
    }
    flushList();
    paragraphLines.push(line);
  }
  flushQuote();
  flushList();
  flushParagraph();
  return blocks;
}

function AssistantTextBlock({ block }: { block: AssistantTextBlock }) {
  if (block.kind === "math") return <AssistantMath displayMode expression={block.expression} />;
  if (block.kind === "paragraph") return block.text.length > 0 ? <p>{renderAssistantInlineText(block.text)}</p> : null;
  if (block.kind === "blockquote") return <blockquote className="sand-dj266r sand-at24cr sand-rxpjvj sand-8fiw5y sand-yumdvf sand-1t7ytsu sand-4n2izg sand-19aaqeu"><p>{renderAssistantInlineText(block.text)}</p></blockquote>;
  if (block.kind === "horizontal-rule") return <hr className="sand-dj266r sand-at24cr sand-178xt8z sand-13fuv20 sand-1aeic0j sand-11pwa6s sand-1sy0etr sand-1b16gh4" />;
  if (block.kind === "table") return <table className="sand-dj266r sand-at24cr sand-1mwwwfo sand-1wm8ruf"><thead className="sand-dj266r sand-at24cr"><tr className="sand-dj266r sand-at24cr">{block.headers.map((header, index) => <th className="sand-dj266r sand-at24cr sand-y3jwiz sand-13e3tqs sand-17fyfba sand-dpxx8g sand-16dsc37 sand-xzm5a7" key={`header-${index}`}>{renderAssistantInlineText(header)}</th>)}</tr></thead><tbody className="sand-dj266r sand-at24cr">{block.rows.map((row, rowIndex) => <tr className="sand-dj266r sand-at24cr" key={`row-${rowIndex}`}>{row.map((cell, cellIndex) => <td className="sand-dj266r sand-at24cr sand-y3jwiz sand-13e3tqs sand-so031l sand-1q0q8m5 sand-17fyfba sand-dpxx8g sand-16dsc37" key={`cell-${rowIndex}-${cellIndex}`}>{renderAssistantInlineText(cell)}</td>)}</tr>)}</tbody></table>;
  if (block.kind === "heading") {
    const Heading = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
    const className = block.level === 1
      ? "sand-dj266r sand-at24cr sand-1heor9g sand-xzm5a7 sand-1ja60sm sand-10siri3"
      : block.level === 2
        ? "sand-dj266r sand-at24cr sand-1heor9g sand-xzm5a7 sand-1ja60sm sand-1b5m78i"
        : "sand-dj266r sand-at24cr sand-1heor9g sand-xzm5a7 sand-1ja60sm sand-140imcn";
    return <Heading className={className}>{renderAssistantInlineText(block.text)}</Heading>;
  }
  const List = block.ordered ? "ol" : "ul";
  const className = block.ordered
    ? "sand-dj266r sand-at24cr sand-92arao sand-1ja60sm sand-43c9pm sand-3yw8vx"
    : "sand-dj266r sand-at24cr sand-92arao sand-1ja60sm sand-43c9pm sand-taz4m5";
  return <List className={className} start={block.ordered ? block.start : undefined}>{block.items.map((item, index) => <li className="sand-dj266r sand-at24cr sand-eaf4i8 sand-kwbhjd" key={`${block.ordered ? "ordered" : "unordered"}-${index}`}>{item.task ? <span aria-checked={item.checked === true} aria-disabled="true" className={item.checked === true ? "sand-markdown-checkbox sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-1kky2od sand-lup9mm sand-2lah0s sand-9f619 sand-mkeg23 sand-1y0btm7 sand-1qugcng sand-12oqio5 sand-1ua6jya sand-wbqysy sand-523cq2 sand-9r1u3d sand-1nyy9xd sand-70xvah" : "sand-markdown-checkbox sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-1kky2od sand-lup9mm sand-2lah0s sand-9f619 sand-mkeg23 sand-1y0btm7 sand-1qugcng sand-12oqio5 sand-1ua6jya sand-wbqysy sand-523cq2"} role="checkbox" /> : null}{item.task ? " " : null}{renderAssistantInlineText(item.text)}</li>)}</List>;
}

function assistantContentBlocks(text: string): AssistantContentBlock[] {
  const blocks: AssistantContentBlock[] = [];
  const fence = /```([^\r\n]*)\r?\n([\s\S]*?)\r?\n```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) != null) {
    if (match.index > cursor) blocks.push({ kind: "text", text: text.slice(cursor, match.index) });
    const rawLanguage = match[1]?.trim() ?? "";
    const language = /^[A-Za-z0-9_+-]+$/.test(rawLanguage) ? rawLanguage : "";
    blocks.push({ kind: "code", language, code: match[2] ?? "" });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length || blocks.length === 0) blocks.push({ kind: "text", text: text.slice(cursor) });
  return blocks;
}

const assistantCodeCopyButtonClass = "ui-icon-button sand-10l6tqk sand-1jgjl8u sand-1s3hisn sand-1uspnb1 sand-18o3ruo sand-1ifrsg7 sand-qjedn3 sand-1y0btm7 sand-qz0629 sand-t9pb60 sand-12sv23o sand-1mh7f6w sand-1hc1fzr sand-m072we sand-o8ljoj sand-1yas17b sand-67bb7w sand-14ux7ur sand-1nn4xpi sand-q1nbte sand-cdv909 sand-fe0yzn sand-sagj69";

function AssistantCodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const label = copied ? "Copied" : "Copy code";
  const iconName = copied ? "check" : "copy";
  const iconCodePoint = copied ? 0xeab2 : 0xebcc;
  return <button aria-label={label} className={assistantCodeCopyButtonClass} onClick={() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) return;
    void navigator.clipboard.writeText(code).then(() => setCopied(true)).catch(() => {});
  }} type="button"><span aria-hidden="true" data-icon-name={iconName} data-size="base" style={{ fontFamily: "cursor-icons" }}>{String.fromCodePoint(iconCodePoint)}</span></button>;
}

function AssistantCodeBlock({ code, language }: { code: string; language: string }) {
  const fallback = <div className="sand-code-figure"><div className="sand-code-scroll"><pre className="sand-code-block"><code className={language.length > 0 ? `language-${language}` : "sand-code-fallback"}>{code}</code></pre></div><AssistantCodeCopyButton code={code} /></div>;
  return language === "mermaid" ? <MermaidDiagram code={code} fallback={fallback} /> : fallback;
}

function SendMessageTextImages({ images }: { images: readonly SendMessageTextImage[] }) {
  if (images.length === 0) return null;
  return <div aria-label="Agent attachments" className="sand-message-attachments" data-role="assistant" role="group"><div className="sand-message-attachments__strip">{images.map((image, index) => <img alt={image.alt ?? ""} draggable={false} key={`${image.url}:${index}`} src={image.url} />)}</div></div>;
}

const readOnlyRichTextExtensions = createPromptEditorExtensions("", undefined);
const readOnlyRichTextSchema = getSchema(readOnlyRichTextExtensions);

function richTextNodeChildren(node: ProseMirrorNode): ReactNode[] {
  const children: ReactNode[] = [];
  node.forEach((child, _offset, index) => children.push(renderRichTextNode(child, `${node.type.name}-${index}`)));
  return children;
}

function applyRichTextMarks(node: ProseMirrorNode, content: ReactNode): ReactNode {
  return node.marks.reduceRight((current, mark, index) => {
    const key = `${node.type.name}-mark-${index}`;
    switch (mark.type.name) {
      case "bold": return <strong key={key}>{current}</strong>;
      case "italic": return <em key={key}>{current}</em>;
      case "strike": return <s key={key}>{current}</s>;
      case "underline": return <u key={key}>{current}</u>;
      case "code": return <code key={key}>{current}</code>;
      case "link": {
        const href = normalizeLinkUrl(mark.attrs.href);
        return href == null ? current : <a href={href} key={key}>{current}</a>;
      }
      default: return current;
    }
  }, content);
}

function renderRichTextNode(node: ProseMirrorNode, key: string): ReactNode {
  if (node.isText) return applyRichTextMarks(node, node.text ?? "");
  const children = richTextNodeChildren(node);
  switch (node.type.name) {
    case "doc": return <Fragment key={key}>{children}</Fragment>;
    case "paragraph": return <p key={key}>{children}</p>;
    case "heading": {
      const level = Number(node.attrs.level);
      const Heading = level === 1 ? "h1" : level === 2 ? "h2" : level === 3 ? "h3" : level === 4 ? "h4" : level === 5 ? "h5" : "h6";
      return <Heading key={key}>{children}</Heading>;
    }
    case "blockquote": return <blockquote key={key}>{children}</blockquote>;
    case "bulletList": return <ul key={key}>{children}</ul>;
    case "orderedList": return <ol key={key} start={typeof node.attrs.start === "number" ? node.attrs.start : undefined}>{children}</ol>;
    case "listItem": return <li key={key}>{children}</li>;
    case "codeBlock": return <pre key={key}><code>{children}</code></pre>;
    case "hardBreak": return <br key={key} />;
    case "horizontalRule": return <hr key={key} />;
    case "mention": return <span className="sand-mention" data-type="mention" key={key}>@{String(node.attrs.label ?? node.attrs.id ?? "")}</span>;
    case "workflowReference": return <span className="sand-workflow-chip" data-type="workflow-reference" key={key}>@{String(node.attrs.label ?? "")}</span>;
    case "prReference": {
      const number = Number(node.attrs.prNumber);
      return <span data-type="pr-reference" key={key}>{Number.isInteger(number) && number > 0 ? `#${number}` : "#"}</span>;
    }
    default: return <Fragment key={key}>{children}</Fragment>;
  }
}

function readOnlyRichTextContent(value: string): ReactNode | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed == null || (parsed as { type?: unknown }).type !== "doc") return null;
    const document = readOnlyRichTextSchema.nodeFromJSON(parsed as JSONContent);
    return readRichTextDocument(document);
  } catch {
    // Immutable BPn falls back to the plain content when persisted rich text is malformed.
    return null;
  }
}

function readRichTextDocument(document: ProseMirrorNode): ReactNode {
  return renderRichTextNode(document, "rich-text-document");
}

function UserMessageContent({ text, richText }: { text: string; richText?: string }) {
  const content = richText == null || richText.length === 0 ? null : readOnlyRichTextContent(richText);
  if (content != null) return <div className="sand-message-prose">{content}</div>;
  return <div className="sand-message-prose">{text ? <p>{text}</p> : null}</div>;
}

export function AssistantMessageContent({ text, images, channel, isSourceTrusted, isStreaming = false }: { text: string; images?: readonly SendMessageTextImage[]; channel?: string | null; isSourceTrusted?: boolean; isStreaming?: boolean }) {
  return <div className="sand-message-prose" data-source-trusted={isSourceTrusted || undefined}>{isStreaming && text.length === 0 ? <StreamingMessage /> : assistantContentBlocks(text).flatMap((block, index) => block.kind === "code"
    ? [<AssistantCodeBlock code={block.code} key={`code-${index}`} language={block.language} />]
    : assistantTextBlocks(block.text).map((textBlock, textIndex) => <AssistantTextBlock block={textBlock} key={`text-${index}-${textIndex}`} />))}{images == null ? null : <SendMessageTextImages images={images} />}{channel == null ? null : <span className="sand-channel-tag" title={`Sent to ${channel}`}>{channel}</span>}</div>;
}

function formatToolName(name: string): string {
  const withoutSuffix = name.endsWith("ToolCall") ? name.slice(0, -8) : name;
  if (withoutSuffix.length === 0) return name;
  const spaced = withoutSuffix.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function toolCallPreview(summary?: string): string {
  const trimmed = summary?.trim() ?? "";
  return trimmed.length === 0 ? "" : trimmed.split(/\r?\n/, 1)[0] ?? "";
}

function toolCallIconName(status: TranscriptToolCall["status"]): "loading" | "x-circle" | "wrench" {
  if (status === "pending") return "loading";
  if (status === "failed") return "x-circle";
  return "wrench";
}

function outlineIconCodePoint(name: "loading" | "x-circle" | "wrench" | "thinking-medium"): number {
  if (name === "loading") return 0xedca;
  if (name === "x-circle") return 0xf408;
  if (name === "wrench") return 0xeb6d;
  return 0xf429;
}

export function TranscriptToolCallRow({ entry, expanded, onToggle }: { entry: TranscriptToolCall; expanded: boolean; onToggle: (id: string) => void }) {
  const detailId = `sand-conversation-tool-detail-${encodeURIComponent(entry.id)}`;
  const preview = toolCallPreview(entry.summary);
  const pending = entry.status === "pending";
  const failed = entry.status === "failed";
  const iconName = toolCallIconName(entry.status);
  const iconClassName = failed ? "sand-outline-item__icon sand-2lah0s sand-pmgbkh" : "sand-outline-item__icon sand-2lah0s sand-4b2ntj";
  return (
    <div className="sand-outline-item" data-kind="tool-call" data-status={entry.status} role="listitem">
      <button aria-controls={expanded ? detailId : undefined} aria-expanded={expanded} className="sand-outline-item__row" onClick={() => onToggle(entry.id)} type="button">
        <span aria-hidden="true" className={iconClassName} data-active={pending || undefined} data-failed={failed || undefined} data-icon-name={iconName} style={pending ? { animation: "sand-outline-item-spin .9s linear infinite" } : undefined}>{String.fromCodePoint(outlineIconCodePoint(iconName))}</span>
        <span className="sand-outline-item__label">{formatToolName(entry.name)}</span>
        {preview.length > 0 ? <span className="sand-outline-item__preview">{preview}</span> : null}
        <span aria-hidden="true" className="sand-outline-item__chevron" style={{ transform: expanded ? "rotate(45deg)" : "rotate(-45deg)" }} />
      </button>
      {expanded ? (
        <div className="sand-outline-item__detail" id={detailId}>
          {entry.summary == null || entry.summary.trim().length === 0 ? <span>No additional details.</span> : (
            <div className="sand-outline-item__detail-section">
              <pre className="sand-outline-item__detail-text">{entry.summary}</pre>
            </div>
          )}
          {entry.toolResult == null ? null : <ToolResultCard expanded snapshot={entry.toolResult} />}
        </div>
      ) : null}
    </div>
  );
}

export function TranscriptThinkingRow({ entry, expanded, onToggle }: { entry: TranscriptThinking; expanded: boolean; onToggle: (id: string) => void }) {
  const detailId = `sand-conversation-thinking-detail-${encodeURIComponent(entry.id)}`;
  const preview = toolCallPreview(entry.text);
  return (
    <div className="sand-outline-item" data-kind="thinking" role="listitem">
      <button aria-controls={expanded ? detailId : undefined} aria-expanded={expanded} className="sand-outline-item__row" onClick={() => onToggle(entry.id)} type="button">
        <span aria-hidden="true" className="sand-outline-item__icon sand-2lah0s sand-kbann2" data-icon-name="thinking-medium">{String.fromCodePoint(outlineIconCodePoint("thinking-medium"))}</span>
        <span className="sand-outline-item__label">Thinking</span>
        {preview.length > 0 ? <span className="sand-outline-item__preview">{preview}</span> : null}
        <span aria-hidden="true" className="sand-outline-item__chevron" style={{ transform: expanded ? "rotate(45deg)" : "rotate(-45deg)" }} />
      </button>
      {expanded ? <div className="sand-outline-item__detail" id={detailId}><div className="sand-outline-item__detail-section"><pre className="sand-outline-item__detail-text">{entry.text}</pre></div></div> : null}
    </div>
  );
}

export function ConversationTranscript({ entries, hasOlder = false, isLoadingOlder = false, loadOlder, isAgentRunning = false, renderComputerHandoff, isTransportDown = false, isReadOnly = false, onCancelQueuedSend, onCopyMessage, onDeleteFailedSend, onReply, onStartThread, renderMessageReactionActions, renderMessageReactionPills, renderMessageFooter, resolveTranscriptCardInteractions, onResendFailedSend, resolveAttachmentMedia, readAttachmentBytes, downloadAttachment, resolveReplyPreview, isReplyTargetInScope, onOpenReply, onOpenAutomation, localToolPermissionStore, resolveLocalToolPermission, transcriptCards, urlCards, threadRootId = null, transcriptHandleRef }: { entries: readonly ConversationTranscriptEntry[]; isAgentRunning?: boolean; isReadOnly?: boolean; renderComputerHandoff?(entry: TranscriptComputerHandoff): ReactNode; resolveAttachmentMedia?: (source: string) => Promise<AttachmentMedia | null>; readAttachmentBytes?: (path: string, maxBytes: number) => Promise<AttachmentBytesResult | null>; downloadAttachment?: (path: string, suggestedName?: string) => Promise<boolean>; resolveReplyPreview?(targetId: string): TranscriptReplyPreview | null; isReplyTargetInScope?(targetId: string): boolean; localToolPermissionStore?: LocalToolPermissionStore; resolveLocalToolPermission?(input: ResolveLocalToolPermissionInput): Promise<unknown>; transcriptCards?: TranscriptCardRootMountContract; resolveTranscriptCardInteractions?: TranscriptCardInteractionContext; urlCards?: UrlCardProvider | null; threadRootId?: string | null; transcriptHandleRef?: { current: FindInChatTranscriptHandle | null } } & ConversationTranscriptActions) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const olderLoadInFlightRef = useRef(false);
  const viewCommitListenersRef = useRef(new Set<() => void>());
  const handleRef = useRef<FindInChatTranscriptHandle | null>(null);
  if (handleRef.current == null) {
    handleRef.current = {
      scrollToEntryWithoutHighlight(entryId) {
        const transcript = transcriptRef.current;
        if (transcript == null) return false;
        const row = [...transcript.querySelectorAll<HTMLElement>("[data-entry-id], [data-row-key]")]
          .find((candidate) => (candidate.getAttribute("data-entry-id") ?? candidate.getAttribute("data-row-key")) === entryId);
        if (row == null) return false;
        row.scrollIntoView({ block: "center" });
        return true;
      },
      subscribeViewCommits(listener) {
        viewCommitListenersRef.current.add(listener);
        return () => viewCommitListenersRef.current.delete(listener);
      }
    };
  }
  const transcriptHandle = handleRef.current;
  useLayoutEffect(() => {
    if (transcriptHandleRef == null) return;
    transcriptHandleRef.current = transcriptHandle;
    return () => {
      if (transcriptHandleRef.current === transcriptHandle) transcriptHandleRef.current = null;
      viewCommitListenersRef.current.clear();
    };
  }, [transcriptHandle, transcriptHandleRef]);
  useLayoutEffect(() => {
    if (transcriptHandleRef == null) return;
    for (const listener of [...viewCommitListenersRef.current]) listener();
  }, [entries, transcriptHandleRef]);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript == null || !hasOlder || loadOlder == null) return;
    let active = true;
    const maybeLoadOlder = () => {
      if (!active || isLoadingOlder || olderLoadInFlightRef.current || transcript.scrollTop > 600) return;
      olderLoadInFlightRef.current = true;
      let result: void | Promise<void>;
      try {
        result = loadOlder();
      } catch {
        olderLoadInFlightRef.current = false;
        return;
      }
      void Promise.resolve(result).catch(() => undefined).finally(() => {
        if (active) olderLoadInFlightRef.current = false;
      });
    };
    transcript.addEventListener("scroll", maybeLoadOlder, { passive: true });
    maybeLoadOlder();
    return () => {
      active = false;
      transcript.removeEventListener("scroll", maybeLoadOlder);
      olderLoadInFlightRef.current = false;
    };
  }, [hasOlder, isLoadingOlder, loadOlder]);
  const [expandedToolCalls, setExpandedToolCalls] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedThinking, setExpandedThinking] = useState<ReadonlySet<string>>(() => new Set());
  const toggleToolCall = (id: string) => {
    setExpandedToolCalls((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleThinking = (id: string) => {
    setExpandedThinking((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const transcriptAdjacency = projectTranscriptAdjacency(entries, {
    entryHasThreadChip: resolveTranscriptCardInteractions == null
      ? undefined
      : (entry) => resolveTranscriptCardInteractions.getThreadSummary(entry.id) != null,
  });
  return (
    <div aria-label="Conversation transcript" aria-live="off" className="sand-virtual-transcript" ref={transcriptRef} role="log" tabIndex={0}>
      {entries.map((entry, index) => {
        if (entry.kind === "time-separator") return <div className="sand-transcript-time-separator" key={entry.id} role="separator">{entry.label}</div>;
        if (entry.kind === "unread-divider") return <div className="sand-unread-divider" key={entry.id} role="separator"><span className="sand-unread-divider__label">{entry.newMessageCount} new {entry.newMessageCount === 1 ? "message" : "messages"}</span></div>;
        if (entry.kind === "timeline-event") return <TimelineEventRootEntry event={entry.event} id={entry.id} key={entry.id} onOpenAutomation={onOpenAutomation} timestampMs={entry.timestampMs} />;
        if (entry.kind === "notice") return <TranscriptNoticeCard entry={entry} key={entry.id} />;
        if (entry.kind === "computer-handoff") return renderComputerHandoff?.(entry) ?? null;
        if (entry.kind === "thinking") return <TranscriptThinkingRow entry={entry} expanded={expandedThinking.has(entry.id)} key={entry.id} onToggle={toggleThinking} />;
        if (entry.kind === "tool-call") return <TranscriptToolCallRow entry={entry} expanded={expandedToolCalls.has(entry.id)} key={entry.id} onToggle={toggleToolCall} />;
        if (entry.kind === "local-tool-permission") return null;
        if (entry.kind === "permission-request") return <PermissionRequestLeaf isGroupStart={entry.isGroupStart} key={entry.id} timestampMs={entry.timestampMs} title={entry.title} />;
        if (entry.kind === "send-message") {
          if (transcriptCards == null) return null;
          const isKeyboardTarget = transcriptKeyboardWidgetEntryId(entries) === entry.id;
          const card = <TranscriptCardRootEntry
            adjacency={transcriptAdjacency[index]}
            contract={transcriptCards}
            entry={entry}
            isReadOnly={isReadOnly}
            isKeyboardTarget={isKeyboardTarget}
            key={entry.id}
            renderReactionActions={renderMessageReactionActions}
            renderReactionPills={renderMessageReactionPills}
            threadRootId={threadRootId}
          />;
          return resolveTranscriptCardInteractions == null
            ? card
            : <TranscriptCardInteractionProvider key={entry.id} value={resolveTranscriptCardInteractions}>{card}</TranscriptCardInteractionProvider>;
        }

        const ids = transcriptIds(entry.id, true);
        const pending = entry.delivery === "pending" || entry.delivery === "queued";
        const failed = entry.delivery === "failed";
        const replyPreview = entry.replyToId == null || resolveReplyPreview == null ? null : (resolveReplyPreview(entry.replyToId) ?? { kind: "missing" as const });
        const referencedEntry = entry.replyToId == null ? undefined : entries.find((candidate) => candidate.id === entry.replyToId);
        const referencedAuthorName = referencedEntry?.kind === "message"
          ? referencedEntry.author
          : replyPreview?.kind === "user-text" ? "You" : "Agent";
        const messageUrlCards = urlCards ?? transcriptCards?.leafProviders.urlCards ?? null;
        const messageProjection = projectTranscriptMessageCard(entry);
        const messageAdjacency = entry.adjacency == null
          ? transcriptAdjacency[index]
          : { ...transcriptAdjacency[index], ...entry.adjacency };
        const messageLink = messageUrlCards != null && (entry.attachments?.length ?? 0) === 0
          ? entry.sendMessageText?.presentation.kind === "url-card"
            && entry.sendMessageText.presentation.whenUnavailable === "url-card"
            ? entry.sendMessageText.presentation.url
            : messageProjection.kind === "message" ? messageProjection.url : null
          : null;
        const isDeliveryActionable = isOrdinaryMessageActionable(entry, isReadOnly);
        const reactionPillProps: TranscriptMessageReactionPillsProps = {
          entry,
          isReadOnly,
          threadRootId,
          isDeliveryActionable,
        };
        const reactionActions = !isDeliveryActionable || renderMessageReactionActions == null
          ? undefined
          : (onOpenChange: (open: boolean) => void) => renderMessageReactionActions({ ...reactionPillProps, onOpenChange });
        const threadSummary = resolveTranscriptCardInteractions?.getThreadSummary(entry.id) ?? null;
        return (
          <div
            aria-busy={pending || entry.isStreaming || undefined}
            aria-labelledby={`${ids.author} ${ids.timestamp}`}
            className="sand-virtual-transcript__row sand-transcript-row"
            data-entry-id={entry.id}
            data-failed={failed || undefined}
            data-index={index}
            data-pending={pending || undefined}
            data-role={entry.role}
            key={entry.id}
            role="article"
          >
            <span className="sand-message-author" id={ids.author}>{entry.author}</span>
            <time dateTime={new Date(entry.timestampMs).toISOString()} hidden id={ids.timestamp}>{new Date(entry.timestampMs).toLocaleString()}</time>
            <MessageActionAnchor entry={entry} isReadOnly={isReadOnly} onCopy={onCopyMessage} onOpenThread={resolveTranscriptCardInteractions?.openThread} onReply={onReply} onStartThread={onStartThread} renderReactionActions={reactionActions} threadRootId={threadRootId} threadSummary={threadSummary}>
              <div aria-label={entry.role === "assistant" ? "Agent message" : undefined} className="sand-message" data-group-start={messageAdjacency.isGroupStart || undefined} data-role={entry.role} role="group">
                {replyPreview != null && onOpenReply != null ? <ReferencedMessagePreviewTrigger
                  authorName={referencedAuthorName}
                  isInScope={isReplyTargetInScope?.(entry.replyToId ?? "") === true}
                  onOpen={onOpenReply}
                  ownerId={entry.id}
                  preview={replyPreview}
                  targetId={entry.replyToId ?? ""}
                  timestampMs={referencedEntry != null && "timestampMs" in referencedEntry ? referencedEntry.timestampMs : undefined}
                /> : null}
                {messageLink != null && messageUrlCards != null ? <LinkCardView isGroupStart={messageAdjacency.isGroupStart} provider={messageUrlCards} url={messageLink} /> : entry.isStreaming && entry.role === "assistant" && !entry.text ? <StreamingMessage /> : entry.role === "assistant" ? <AssistantMessageContent channel={entry.channel} images={entry.images} isSourceTrusted={entry.isSourceTrusted} isStreaming={entry.isStreaming} text={entry.text} /> : <UserMessageContent richText={entry.richText} text={entry.text} />}
                {renderMessageReactionPills?.(reactionPillProps)}
                {entry.attachments?.length ? <TranscriptAttachmentGallery adjacency={messageAdjacency} attachments={entry.attachments} downloadAttachment={downloadAttachment} readAttachmentBytes={readAttachmentBytes} resolveMedia={resolveAttachmentMedia} role={entry.role} /> : null}
                {entry.delivery === "queued" && entry.composedAtMs == null ? <QueuedSendNotice entry={entry} isTransportDown={isTransportDown} onCancel={onCancelQueuedSend} /> : null}
                {entry.role === "user" && !failed && entry.composedAtMs != null ? <SentWhileOfflineNotice composedAtMs={entry.composedAtMs} /> : null}
                {failed ? <FailedSendActions entry={entry} onDelete={onDeleteFailedSend} onResend={onResendFailedSend} /> : null}
              </div>
            </MessageActionAnchor>
            {renderMessageFooter?.(entry)}
          </div>
        );
      })}
      {isAgentRunning ? <div aria-hidden="true" className="sand-typing-indicator"><span /><span /><span /></div> : null}
    </div>
  );
}

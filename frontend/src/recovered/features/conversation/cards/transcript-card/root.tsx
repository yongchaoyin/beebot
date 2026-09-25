import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import type { TranscriptCardEntry, TranscriptCardProtocolKey } from "./protocol";
import { transcriptCardProtocolKey } from "./protocol";
import type { TranscriptCardRootMountContract } from "./mount-contract";
import { loadTranscriptCardLeaf } from "./resolver";
import { TranscriptCardLeafProvider } from "./views/shared";
import type { TranscriptCardLeafProps } from "./views/shared";
import type { TranscriptCardViewProps } from "./registry";
import type { TranscriptCardFrame } from "./registry";
import { TranscriptCardFrame as TranscriptCardFrameView } from "./frame";
import type { AttachmentCardKind } from "./attachment-data";
import { TranscriptCardActionAnchor, type RenderTranscriptMessageReactionActions } from "./message-actions";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5108848 (send-message card lazy dispatcher)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5221733 (placeholder height fallback)

type CardLeaf = ComponentType<TranscriptCardViewProps>;

const lazyLeaves = new Map<TranscriptCardProtocolKey, LazyExoticComponent<CardLeaf>>();

function leafFor(protocolKey: TranscriptCardProtocolKey): LazyExoticComponent<CardLeaf> {
  const existing = lazyLeaves.get(protocolKey);
  if (existing != null) return existing;
  const created = lazy(async () => {
    const module = await loadTranscriptCardLeaf(protocolKey);
    return { default: module.default as CardLeaf };
  });
  lazyLeaves.set(protocolKey, created);
  return created;
}

export function transcriptCardFrameForEntry(entry: TranscriptCardEntry, metadata: { frame: TranscriptCardFrame | null }, attachments: { classify(url: string): AttachmentCardKind } | null | undefined): TranscriptCardFrame | null {
  if (metadata.frame != null) return metadata.frame;
  if (entry.message.type !== "attachment" || attachments == null) return null;
  switch (attachments.classify(entry.message.url)) {
    case "box": return { variant: "tab", className: "sand-tab-card-wrap" };
    case "legacy-link": return { variant: "link", className: "sand-link-card-wrap" };
    case "file": return { variant: "file", className: "sand-file-card-wrap" };
    case "media": return null;
  }
}

export interface TranscriptCardRootEntryProps {
  readonly contract: TranscriptCardRootMountContract;
  readonly entry: TranscriptCardEntry;
  readonly adjacency?: TranscriptCardLeafProps["adjacency"];
  readonly isReadOnly?: boolean;
  readonly threadRootId?: string | null;
  readonly renderReactionActions?: RenderTranscriptMessageReactionActions;
  readonly renderReactionPills?: TranscriptCardReactionPillsRenderer;
  readonly isStale?: boolean;
  readonly isKeyboardTarget?: boolean;
  /** A resolved current-conversation reference, displayed after the card. */
  readonly replyQuote?: ReactNode;
}

export interface TranscriptCardReactionPillsProps {
  readonly entry: TranscriptCardEntry;
  readonly isReadOnly: boolean;
  readonly threadRootId: string | null;
  readonly isDeliveryActionable: boolean;
}

export type TranscriptCardReactionPillsRenderer = (props: TranscriptCardReactionPillsProps) => ReactNode;

export function TranscriptCardRootEntry({ contract, entry, adjacency, isReadOnly = false, threadRootId = null, renderReactionActions, renderReactionPills, isStale, isKeyboardTarget, replyQuote }: TranscriptCardRootEntryProps) {
  const protocolKey = transcriptCardProtocolKey(entry.message.type);
  const metadata = contract.registry.metadata(protocolKey);
  const frame = transcriptCardFrameForEntry(entry, metadata, contract.leafProviders.attachments);
  const Leaf = leafFor(protocolKey);
  const reactionPills = renderReactionPills?.({
    entry,
    isReadOnly,
    threadRootId,
    isDeliveryActionable: entry.draftSendState !== "sending",
  });
  return (
    <TranscriptCardActionAnchor
      entry={entry}
      isDeliveryActionable={entry.draftSendState !== "sending"}
      isReadOnly={isReadOnly}
      renderReactionActions={renderReactionActions}
      threadRootId={threadRootId}
    >
      <div data-entry-id={entry.id} data-quote-owner-role="assistant" role="article">
        <TranscriptCardLeafProvider value={contract.leafProviders}>
          <Suspense fallback={<div aria-hidden="true" style={{ height: metadata.placeholderHeight, width: "100%" }} />}>
            {frame == null ? <><Leaf actionVerb={null} adjacency={adjacency} entry={entry} isKeyboardTarget={isKeyboardTarget} isStale={isStale} />{reactionPills}</> : (
              <TranscriptCardFrameView
                className={frame.className}
                isGroupStart={adjacency?.isGroupStart}
                timestampMs={entry.timestampMs}
                variant={frame.variant}
              >
                <Leaf actionVerb={null} adjacency={adjacency} entry={entry} isKeyboardTarget={isKeyboardTarget} isStale={isStale} />
                {reactionPills}
              </TranscriptCardFrameView>
            )}
          </Suspense>
        </TranscriptCardLeafProvider>
        {replyQuote}
      </div>
    </TranscriptCardActionAnchor>
  );
}

import type { DraftDeliveryAdapter } from "../draft-delivery";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CloudAgentProvider } from "../cloud-agent-provider";
import type { AutoReviewApprovalActionInput, AutoReviewApprovalActions } from "../auto-review-actions";
import type { ListenerIntegrationsProvider } from "../listener-integrations";
import type { SecretRequestActionAdapter } from "../secret-request-actions";
import type { AttachmentCardDataAdapter } from "../attachment-data";
import type { ConnectorProvider } from "../connector-actions";
import type { UrlCardProvider } from "../url-card";
import type { TranscriptCardEntry, TranscriptCardScope } from "../protocol";
import { projectTranscriptCardEntry } from "../protocol";
import type { WidgetInteractionAdapter } from "../widget-interactions";
import type { LocalToolPermissionStore } from "../../../../permissions/local-tool/store";
import type { ResolveLocalToolPermissionInput } from "../../../../permissions/local-tool/view";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5111152 (card context shape)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5214895 (transcript interactions provider lifecycle)

export interface TranscriptCardLeafProviders {
  readonly scope: TranscriptCardScope;
  readonly draftDelivery?: DraftDeliveryAdapter | null;
  readonly widgetInteractions: WidgetInteractionAdapter | null;
  readonly cloudAgents: CloudAgentProvider | null;
  readonly autoReviewApproval?: (input: AutoReviewApprovalActionInput) => AutoReviewApprovalActions;
  readonly listenerIntegrations?: ListenerIntegrationsProvider | null;
  readonly secretRequests?: SecretRequestActionAdapter | null;
  readonly attachments?: AttachmentCardDataAdapter | null;
  readonly connectors?: ConnectorProvider | null;
  readonly urlCards?: UrlCardProvider | null;
  readonly onOpenPullRequest?: (url: string) => void;
  /** Existing local-tool permission store and coordinator action; no card-local transport is invented. */
  readonly localToolPermissionStore?: LocalToolPermissionStore;
  readonly resolveLocalToolPermission?: (input: ResolveLocalToolPermissionInput) => Promise<unknown>;
}

const TranscriptCardLeafContext = createContext<TranscriptCardLeafProviders | null>(null);

export function TranscriptCardLeafProvider({ value, children }: { value: TranscriptCardLeafProviders; children: ReactNode }) {
  return <TranscriptCardLeafContext.Provider value={value}>{children}</TranscriptCardLeafContext.Provider>;
}

export function useTranscriptCardLeafProviders(): TranscriptCardLeafProviders | null {
  return useContext(TranscriptCardLeafContext);
}

export interface TranscriptCardAdjacency {
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
}

export interface TranscriptCardLeafProps {
  entry: unknown;
  adjacency?: TranscriptCardAdjacency;
  isStale?: boolean;
  isKeyboardTarget?: boolean;
}

export function projectLeafEntry(value: unknown): TranscriptCardEntry | null {
  return projectTranscriptCardEntry(value);
}

export function useAdapterVersion(adapter: { subscribe(listener: () => void): () => void } | null): number {
  const [version, setVersion] = useState(0);
  useEffect(() => adapter == null ? undefined : adapter.subscribe(() => setVersion((current) => current + 1)), [adapter]);
  return version;
}

export function visualLineCount(value: string): number {
  return value.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 72)), 0);
}

export function boundedFirstLine(value: string): string {
  const firstLine = value.split("\n", 1)[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

export function entryTimestamp(entry: TranscriptCardEntry): number | undefined {
  const candidate = entry as TranscriptCardEntry & { timestampMs?: unknown };
  return typeof candidate.timestampMs === "number" ? candidate.timestampMs : undefined;
}

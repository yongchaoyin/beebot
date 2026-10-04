// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5109827 (lazy card map and send-message discriminants)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=782731 (transcript-card declaration validation)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=784036 (card metadata projection)

import { projectTranscriptReactions, type TranscriptReaction } from "./reaction-actions";
import { projectSendMessageText, type SendMessageTextImage } from "./send-message-text";

export const TRANSCRIPT_CARD_ENTRY_KIND = "send-message" as const;

export const TRANSCRIPT_CARD_ENTRY_TYPES = [
  "text",
  "widget",
  "cursor-agent",
  "email-draft",
  "slack-draft",
  "auto-review-approval",
  "listener-connect",
  "secret-request",
  "attachment",
  "connector",
  "connectors",
  "local-tool-permission",
] as const;

export type TranscriptCardEntryType = (typeof TRANSCRIPT_CARD_ENTRY_TYPES)[number];
export type TranscriptCardProtocolKey = `send-message:${TranscriptCardEntryType}`;

export interface TranscriptCardScope {
  accountSlot: string | null;
  agentId: string | null;
}

export interface WidgetOption {
  label: string;
  value?: string;
  description?: string;
  style?: "default" | "primary" | "danger";
}

export interface WidgetPrompt {
  prompt: string;
  helpText?: string;
  options: readonly WidgetOption[];
  allowCustom?: boolean;
  dismissOnMoveOn?: boolean;
}

export interface WidgetCardMessage {
  type: "widget";
  widget: WidgetPrompt;
}

export interface SendMessageTextCardMessage {
  type: "text";
  content: string;
  images?: readonly SendMessageTextImage[];
  channel?: string | null;
}

export interface CursorAgentCardMessage {
  type: "cursor-agent";
  bcId: string;
  title?: string;
}

export interface EmailDraft {
  from?: string;
  to: readonly string[];
  cc?: readonly string[];
  subject: string;
  body: string;
}

export interface EmailDraftCardMessage {
  type: "email-draft";
  draft: EmailDraft;
}

export interface SlackDraft {
  workspace?: string;
  target: string;
  thread?: string;
  body: string;
}

export interface SlackDraftCardMessage {
  type: "slack-draft";
  draft: SlackDraft;
}

export type AutoReviewSurface =
  | "host_shell"
  | "box_shell"
  | "mcp"
  | "computer"
  | "automation_write"
  | "cloud_agent"
  | "subagent"
  | (string & {});

export type AutoReviewApprovalStatus = "pending" | "approved" | "always" | "denied" | "expired";

export interface AutoReviewApproval {
  requestId: string;
  status: AutoReviewApprovalStatus;
  surface: AutoReviewSurface;
  summary: string;
  reason?: string;
  command?: string;
  proposedRule?: string;
}

export interface AutoReviewApprovalCardMessage {
  type: "auto-review-approval";
  approval: AutoReviewApproval;
}

export type ListenerPlatform = "github" | "slack";

export interface ListenerConnectCardMessage {
  type: "listener-connect";
  platform: ListenerPlatform;
  reason?: string;
}

export interface SecretRequest {
  label: string;
  description?: string;
}

export interface SecretRequestCardMessage {
  type: "secret-request";
  secretRequest: SecretRequest;
}

export interface AttachmentCardMessage {
  type: "attachment";
  url: string;
  alt?: string;
}

export interface ConnectorsCardMessage {
  type: "connectors";
  connectors: readonly string[];
}

export type LocalToolPermissionAskStatus = "pending" | "always" | "never" | "denied" | "expired" | "allow-once";

export interface LocalToolPermissionAsk {
  requestId: string;
  status: LocalToolPermissionAskStatus;
  action: unknown;
  target: unknown;
}

export interface LocalToolPermissionCardMessage {
  type: "local-tool-permission";
  ask: LocalToolPermissionAsk;
}

/** The singular connector card forwards these fields unchanged to ConnectorCard. */
export interface ConnectorCardMessage {
  type: "connector";
  connector: string;
  reason?: string;
  serverId?: string;
  suggestions?: readonly string[];
  variant?: string;
}

export type TranscriptCardMessage =
  | SendMessageTextCardMessage
  | WidgetCardMessage
  | CursorAgentCardMessage
  | EmailDraftCardMessage
  | SlackDraftCardMessage
  | AutoReviewApprovalCardMessage
  | ListenerConnectCardMessage
  | SecretRequestCardMessage
  | AttachmentCardMessage
  | ConnectorCardMessage
  | ConnectorsCardMessage
  | LocalToolPermissionCardMessage;

export interface TranscriptCardEntryBase {
  kind: typeof TRANSCRIPT_CARD_ENTRY_KIND;
  id: string;
  message: TranscriptCardMessage;
  replyToId?: string;
  respondedValue?: string;
  widgetDismissed?: boolean;
  widgetSkipped?: boolean;
  respondedValueEchoed?: boolean;
  draftSendState?: "editable" | "sending" | "sent" | "needs-review" | "discarded";
  secretProvided?: boolean;
  boxInstruction?: string;
  boxRequest?: string;
  boxRequestId?: string;
  boxResolution?: string | null;
  boxSnapshot?: string;
  timestampMs?: number;
  /** Renderer-projected group boundary consumed by the shared card frame. */
  isGroupStart?: boolean;
  /** The live send-message:text stream flag is consumed by its lazy leaf. */
  streaming?: boolean;
  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5083971
  reactions?: readonly TranscriptReaction[];
  myReactions?: ReadonlySet<string>;
  permissionScope?: string;
  permissionScopeRevision?: number;
}

export type TranscriptCardEntry = TranscriptCardEntryBase & {
  message: TranscriptCardMessage;
};

export interface TranscriptCardPageProjection {
  entries: TranscriptCardEntry[];
  rejectedCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value;
}

function projectWidget(value: Record<string, unknown>): WidgetCardMessage | null {
  if (!isRecord(value.widget)) return null;
  const widget = value.widget;
  if (!nonEmptyString(widget.prompt) || !Array.isArray(widget.options) || widget.options.length < 1 || widget.options.length > 6) return null;
  const options: WidgetOption[] = [];
  for (const optionValue of widget.options) {
    if (!isRecord(optionValue) || !nonEmptyString(optionValue.label)) return null;
    const style = optionValue.style;
    if (style !== undefined && style !== "default" && style !== "primary" && style !== "danger") return null;
    options.push({
      label: optionValue.label,
      ...(optionalString(optionValue.value) == null ? {} : { value: optionalString(optionValue.value) }),
      ...(optionalString(optionValue.description) == null ? {} : { description: optionalString(optionValue.description) }),
      ...(style === undefined ? {} : { style }),
    });
  }
  return {
    type: "widget",
    widget: {
      prompt: widget.prompt,
      ...(optionalString(widget.helpText) == null ? {} : { helpText: optionalString(widget.helpText) }),
      options,
      ...(optionalBoolean(widget.allowCustom) === undefined ? {} : { allowCustom: optionalBoolean(widget.allowCustom) }),
      ...(optionalBoolean(widget.dismissOnMoveOn) === undefined ? {} : { dismissOnMoveOn: optionalBoolean(widget.dismissOnMoveOn) }),
    },
  };
}

function projectCursorAgent(value: Record<string, unknown>): CursorAgentCardMessage | null {
  if (!nonEmptyString(value.bcId)) return null;
  return { type: "cursor-agent", bcId: value.bcId, ...(optionalString(value.title) == null ? {} : { title: optionalString(value.title) }) };
}

function projectEmailDraft(value: Record<string, unknown>): EmailDraftCardMessage | null {
  if (!isRecord(value.draft)) return null;
  const draft = value.draft;
  const to = stringArray(draft.to);
  if (to == null || typeof draft.subject !== "string" || typeof draft.body !== "string") return null;
  const ccValue = draft.cc;
  const cc = ccValue === undefined ? undefined : stringArray(ccValue);
  if (ccValue !== undefined && cc == null) return null;
  const projectedCc = cc ?? undefined;
  const fromValue = draft.from;
  if (fromValue !== undefined && typeof fromValue !== "string") return null;
  if (draft.from !== undefined && typeof draft.from !== "string") return null;
  return {
    type: "email-draft",
    draft: {
      ...(fromValue === undefined ? {} : { from: fromValue }),
      to,
      ...(projectedCc === undefined ? {} : { cc: projectedCc }),
      subject: draft.subject,
      body: draft.body,
    },
  };
}

function projectSlackDraft(value: Record<string, unknown>): SlackDraftCardMessage | null {
  if (!isRecord(value.draft)) return null;
  const draft = value.draft;
  const targetValue = draft.target;
  const bodyValue = draft.body;
  if (!nonEmptyString(targetValue) || typeof bodyValue !== "string") return null;
  if (draft.workspace !== undefined && typeof draft.workspace !== "string") return null;
  if (draft.thread !== undefined && typeof draft.thread !== "string") return null;
  return {
    type: "slack-draft",
    draft: {
      ...(draft.workspace === undefined ? {} : { workspace: draft.workspace }),
      target: targetValue,
      ...(draft.thread === undefined ? {} : { thread: draft.thread }),
      body: bodyValue,
    },
  };
}

function projectAutoReviewApproval(value: Record<string, unknown>): AutoReviewApprovalCardMessage | null {
  if (!isRecord(value.approval)) return null;
  const approval = value.approval;
  if (!nonEmptyString(approval.requestId) || typeof approval.summary !== "string") return null;
  if (approval.status !== "pending" && approval.status !== "approved" && approval.status !== "always" && approval.status !== "denied" && approval.status !== "expired") return null;
  if (approval.surface !== undefined && typeof approval.surface !== "string") return null;
  if (approval.reason !== undefined && typeof approval.reason !== "string") return null;
  if (approval.command !== undefined && typeof approval.command !== "string") return null;
  if (approval.proposedRule !== undefined && typeof approval.proposedRule !== "string") return null;
  return {
    type: "auto-review-approval",
    approval: {
      requestId: approval.requestId,
      status: approval.status,
      surface: typeof approval.surface === "string" ? approval.surface : "unknown",
      summary: approval.summary,
      ...(approval.reason === undefined ? {} : { reason: approval.reason }),
      ...(approval.command === undefined ? {} : { command: approval.command }),
      ...(approval.proposedRule === undefined ? {} : { proposedRule: approval.proposedRule }),
    },
  };
}

function projectListenerConnect(value: Record<string, unknown>): ListenerConnectCardMessage | null {
  if (value.platform !== "github" && value.platform !== "slack") return null;
  if (value.reason !== undefined && typeof value.reason !== "string") return null;
  return {
    type: "listener-connect",
    platform: value.platform,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  };
}

function projectSecretRequest(value: Record<string, unknown>): SecretRequestCardMessage | null {
  if (!isRecord(value.secretRequest) || !nonEmptyString(value.secretRequest.label)) return null;
  if (value.secretRequest.description !== undefined && typeof value.secretRequest.description !== "string") return null;
  return {
    type: "secret-request",
    secretRequest: {
      label: value.secretRequest.label,
      ...(value.secretRequest.description === undefined ? {} : { description: value.secretRequest.description }),
    },
  };
}

function projectAttachment(value: Record<string, unknown>): AttachmentCardMessage | null {
  if (!nonEmptyString(value.url)) return null;
  if (value.alt !== undefined && typeof value.alt !== "string") return null;
  return { type: "attachment", url: value.url, ...(value.alt === undefined ? {} : { alt: value.alt }) };
}

function projectConnectors(value: Record<string, unknown>): ConnectorsCardMessage | null {
  if (!Array.isArray(value.connectors) || value.connectors.some((connector) => typeof connector !== "string")) return null;
  return { type: "connectors", connectors: value.connectors };
}

function projectLocalToolPermission(value: Record<string, unknown>): LocalToolPermissionCardMessage | null {
  if (!isRecord(value.ask) || !nonEmptyString(value.ask.requestId)) return null;
  const status = value.ask.status;
  if (status !== "pending" && status !== "always" && status !== "never" && status !== "denied" && status !== "expired" && status !== "allow-once") return null;
  return {
    type: "local-tool-permission",
    ask: {
      requestId: value.ask.requestId,
      status,
      action: value.ask.action,
      target: value.ask.target,
    },
  };
}

function projectConnector(value: Record<string, unknown>): ConnectorCardMessage | null {
  if (!nonEmptyString(value.connector)) return null;
  if (value.reason !== undefined && typeof value.reason !== "string") return null;
  if (value.serverId !== undefined && typeof value.serverId !== "string") return null;
  if (value.variant !== undefined && typeof value.variant !== "string") return null;
  if (value.suggestions !== undefined && (!Array.isArray(value.suggestions) || value.suggestions.some((suggestion) => typeof suggestion !== "string"))) return null;
  return {
    type: "connector",
    connector: value.connector,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
    ...(value.serverId === undefined ? {} : { serverId: value.serverId }),
    ...(value.suggestions === undefined ? {} : { suggestions: value.suggestions }),
    ...(value.variant === undefined ? {} : { variant: value.variant }),
  };
}

export function transcriptCardProtocolKey(type: TranscriptCardEntryType): TranscriptCardProtocolKey {
  return `${TRANSCRIPT_CARD_ENTRY_KIND}:${type}`;
}

export function projectTranscriptCardEntry(value: unknown): TranscriptCardEntry | null {
  if (!isRecord(value) || value.kind !== TRANSCRIPT_CARD_ENTRY_KIND || !nonEmptyString(value.id) || !isRecord(value.message)) return null;
  const message = value.message;
  let projectedMessage: TranscriptCardMessage | null = null;
  let projectedStreaming: boolean | undefined;
  switch (message.type) {
    case "text": {
      const projection = projectSendMessageText({
        kind: TRANSCRIPT_CARD_ENTRY_KIND,
        id: value.id,
        message,
        ...(value.streaming === undefined ? {} : { streaming: value.streaming }),
        ...(value.timestampMs === undefined ? {} : { timestampMs: value.timestampMs }),
      });
      if (projection.kind === "invalid") return null;
      projectedMessage = {
        type: "text",
        content: projection.message.content,
        ...(projection.message.images === undefined ? {} : { images: projection.message.images }),
        ...(projection.message.channel === undefined ? {} : { channel: projection.message.channel }),
      };
      projectedStreaming = projection.streaming;
      break;
    }
    case "widget": projectedMessage = projectWidget(message); break;
    case "cursor-agent": projectedMessage = projectCursorAgent(message); break;
    case "email-draft": projectedMessage = projectEmailDraft(message); break;
    case "slack-draft": projectedMessage = projectSlackDraft(message); break;
    case "auto-review-approval": projectedMessage = projectAutoReviewApproval(message); break;
    case "listener-connect": projectedMessage = projectListenerConnect(message); break;
    case "secret-request": projectedMessage = projectSecretRequest(message); break;
    case "attachment": projectedMessage = projectAttachment(message); break;
    case "connector": projectedMessage = projectConnector(message); break;
    case "connectors": projectedMessage = projectConnectors(message); break;
    case "local-tool-permission": projectedMessage = projectLocalToolPermission(message); break;
    default: return null;
  }
  if (projectedMessage == null) return null;
  if (value.replyTo !== undefined && typeof value.replyTo !== "string") return null;
  if (value.replyToId !== undefined && typeof value.replyToId !== "string") return null;
  if (value.respondedValue !== undefined && typeof value.respondedValue !== "string") return null;
  if (value.widgetDismissed !== undefined && typeof value.widgetDismissed !== "boolean") return null;
  if (value.widgetSkipped !== undefined && typeof value.widgetSkipped !== "boolean") return null;
  if (value.respondedValueEchoed !== undefined && typeof value.respondedValueEchoed !== "boolean") return null;
  if (value.draftSendState !== undefined && value.draftSendState !== "editable" && value.draftSendState !== "sending" && value.draftSendState !== "sent" && value.draftSendState !== "needs-review" && value.draftSendState !== "discarded") return null;
  if (value.secretProvided !== undefined && typeof value.secretProvided !== "boolean") return null;
  if (value.boxInstruction !== undefined && typeof value.boxInstruction !== "string") return null;
  if (value.boxRequest !== undefined && typeof value.boxRequest !== "string") return null;
  if (value.boxRequestId !== undefined && typeof value.boxRequestId !== "string") return null;
  if (value.boxResolution !== undefined && value.boxResolution !== null && typeof value.boxResolution !== "string") return null;
  if (value.boxSnapshot !== undefined && typeof value.boxSnapshot !== "string") return null;
  if (value.timestampMs !== undefined && (typeof value.timestampMs !== "number" || !Number.isFinite(value.timestampMs))) return null;
  if (value.isGroupStart !== undefined && typeof value.isGroupStart !== "boolean") return null;
  if (value.streaming !== undefined && typeof value.streaming !== "boolean") return null;
  if (value.reactions !== undefined && !Array.isArray(value.reactions)) return null;
  if (value.permissionScope !== undefined && typeof value.permissionScope !== "string") return null;
  if (value.permissionScopeRevision !== undefined && (typeof value.permissionScopeRevision !== "number" || !Number.isInteger(value.permissionScopeRevision) || value.permissionScopeRevision < 0)) return null;
  const replyToId = typeof value.replyTo === "string" ? value.replyTo : value.replyToId;
  const reactionFields = value.reactions === undefined ? {} : projectTranscriptReactions(value.reactions);
  return {
    kind: TRANSCRIPT_CARD_ENTRY_KIND,
    id: value.id,
    message: projectedMessage,
    ...(replyToId === undefined ? {} : { replyToId }),
    ...(value.respondedValue === undefined ? {} : { respondedValue: value.respondedValue }),
    ...(value.widgetDismissed === undefined ? {} : { widgetDismissed: value.widgetDismissed }),
    ...(value.widgetSkipped === undefined ? {} : { widgetSkipped: value.widgetSkipped }),
    ...(value.respondedValueEchoed === undefined ? {} : { respondedValueEchoed: value.respondedValueEchoed }),
    ...(value.draftSendState === undefined ? {} : { draftSendState: value.draftSendState }),
    ...(value.secretProvided === undefined ? {} : { secretProvided: value.secretProvided }),
    ...(value.boxInstruction === undefined ? {} : { boxInstruction: value.boxInstruction }),
    ...(value.boxRequest === undefined ? {} : { boxRequest: value.boxRequest }),
    ...(value.boxRequestId === undefined ? {} : { boxRequestId: value.boxRequestId }),
    ...(value.boxResolution === undefined ? {} : { boxResolution: value.boxResolution }),
    ...(value.boxSnapshot === undefined ? {} : { boxSnapshot: value.boxSnapshot }),
    ...(value.timestampMs === undefined ? {} : { timestampMs: value.timestampMs }),
    ...(value.isGroupStart === undefined ? {} : { isGroupStart: value.isGroupStart }),
    ...(projectedStreaming === undefined ? {} : { streaming: projectedStreaming }),
    ...(value.reactions === undefined ? {} : reactionFields),
    ...(value.permissionScope === undefined ? {} : { permissionScope: value.permissionScope }),
    ...(value.permissionScopeRevision === undefined ? {} : { permissionScopeRevision: value.permissionScopeRevision }),
  };
}

export function projectTranscriptCardEntries(values: readonly unknown[]): TranscriptCardPageProjection {
  const entries: TranscriptCardEntry[] = [];
  for (const value of values) {
    const entry = projectTranscriptCardEntry(value);
    if (entry == null) continue;
    entries.push(entry);
  }
  return { entries, rejectedCount: values.length - entries.length };
}

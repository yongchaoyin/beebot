import type {
  ConversationAgentSummary,
  ConversationAgentLastEntry,
  ConversationTranscriptEntry,
  DraftAttachment,
  TranscriptMessage,
  TranscriptLocalToolPermission,
  TranscriptPermissionRequest,
  TranscriptThinking,
  TranscriptToolCall
} from "../recovered/features/conversation/workspace/model";
import type { DeepLinkInfo } from "../recovered/features/deep-links/overlay/model";
import { projectTranscriptCardEntry } from "../recovered/features/conversation/cards/transcript-card/protocol";
import type { TranscriptCardEntry } from "../recovered/features/conversation/cards/transcript-card/protocol";
import { projectUserAttachmentEvent, type UserAttachmentGalleryProjection } from "../recovered/features/conversation/cards/transcript-card/attachment-data";
import { projectSendMessageText, type SendMessageTextAdjacency } from "../recovered/features/conversation/cards/transcript-card/send-message-text";
import { projectTimelineEvent } from "../recovered/features/conversation/cards/timeline-event-registry";
import { projectTranscriptReactions } from "../recovered/features/conversation/cards/transcript-card/reaction-actions";
import type { TranscriptThreadSummary } from "../recovered/features/conversation/cards/transcript-card/thread-summary-controller";

export type { DeepLinkInfo } from "../recovered/features/deep-links/overlay/model";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L135135
// @evidence src/app/dist/renderer/assets/view-DPSBrvyV.js#byteLength=1373 (user-attachment server-event card)
// @evidence src/app/dist/renderer/assets/view-DPSBrvyV.js#SHA256=5bf28224da62a9042885e9da60e3fce82ed544846f470241ed6bcf4e12e64040

/** Raw agent fields consumed by the renderer's local-group gate. */
export interface RendererAgentRaw extends Record<string, unknown> {
  readonly isSharedRoom?: boolean;
  readonly sharedRoomId?: string | null;
}

/** The host session-summary projection used by the sidebar preview content. */
export type RendererAgentLastEntry = ConversationAgentLastEntry;

export interface RendererAgent extends ConversationAgentSummary {
  description?: string;
  title?: string;
  remoteRoom?: { readonly roomId: string } | null;
  sharedRoomId?: string | null;
  hasUnread?: boolean;
  isComposingMessage?: boolean;
  lastEntry: RendererAgentLastEntry | null;
  lastMessageId?: string | null;
  lastMessagePreview?: string | null;
  isGroup: boolean;
  isHidden: boolean;
  memberIds: string[];
  conversationPartnerIds: string[];
  awaitingUserResponse: unknown | null;
  raw: RendererAgentRaw;
}

/** Mirrors the shipped cct gate: only local, non-shared groups expose members. */
export function isLocalGroupAgent(agent: Pick<RendererAgent, "isGroup" | "raw">): boolean {
  return agent.isGroup && agent.raw.isSharedRoom !== true;
}

export type RendererOverlay = "hidden-chats" | "settings" | "plugins" | "network" | "computer" | null;

export type DesktopIntent =
  | { kind: "focus-agent"; agentId: string }
  | { kind: "plugin-add"; pluginId: string }
  | { kind: "open-app" }
  | { kind: "deep-link-info"; link: DeepLinkInfo }
  | null;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseLastEntryKinds(value: unknown): Readonly<Record<string, number>> | null {
  if (!isRecord(value)) return null;
  const kinds: Record<string, number> = {};
  for (const [kind, count] of Object.entries(value)) {
    if (kind.length === 0 || typeof count !== "number" || !Number.isInteger(count) || count <= 0) return null;
    kinds[kind] = count;
  }
  return kinds;
}

export function parseRendererAgentLastEntry(value: unknown): RendererAgentLastEntry | null {
  if (!isRecord(value)) return null;
  if (value.kind === "text" && typeof value.text === "string") return { kind: "text", text: value.text };
  if (value.kind === "attachment"
    && typeof value.count === "number"
    && Number.isInteger(value.count)
    && value.count > 0) {
    const kinds = parseLastEntryKinds(value.kinds);
    return kinds == null ? null : { kind: "attachment", count: value.count, kinds };
  }
  if (value.kind === "link" && typeof value.url === "string" && value.url.length > 0) {
    return { kind: "link", url: value.url };
  }

  // Older coordinator payloads exposed the text entry without its host kind.
  // Keep that payload source-compatible while normalizing it to the typed union.
  if (typeof value.content === "string") return { kind: "text", text: value.content };
  if (typeof value.text === "string") return { kind: "text", text: value.text };
  if (isRecord(value.message) && typeof value.message.content === "string") {
    return { kind: "text", text: value.message.content };
  }
  return null;
}

function derivedLastMessage(entry: RendererAgentLastEntry | null, fallback: unknown): string | undefined {
  if (entry?.kind === "text") return entry.text;
  if (typeof fallback === "string") return fallback;
  if (entry?.kind === "link") return `Sent a link · ${entry.url}`;
  if (entry?.kind === "attachment") {
    const label = entry.count === 1 ? "file" : "files";
    return `Sent ${entry.count} ${label}`;
  }
  return undefined;
}

export function projectRendererAgent(value: unknown, now = Date.now()): RendererAgent | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (id == null) return null;
  const name = stringValue(value.name) ?? "New chat";
  const awaitingUserResponse = value.awaitingUserResponse ?? null;
  const lastEntry = parseRendererAgentLastEntry(value.lastEntry);
  const lastMessagePreview = typeof value.lastMessagePreview === "string" ? value.lastMessagePreview : null;
  const lastMessage = derivedLastMessage(lastEntry, lastMessagePreview);
  return {
    id,
    name,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.isSharedRoom === "boolean" ? { isSharedRoom: value.isSharedRoom } : {}),
    ...(typeof value.avatarDataUrl === "string" ? { avatarDataUrl: value.avatarDataUrl } : value.avatarDataUrl === null ? { avatarDataUrl: null } : {}),
    ...(typeof value.avatarVersion === "string" ? { avatarVersion: value.avatarVersion } : value.avatarVersion === null ? { avatarVersion: null } : {}),
    ...(typeof value.avatarShape === "string" ? { avatarShape: value.avatarShape } : value.avatarShape === null ? { avatarShape: null } : {}),
    ...(typeof value.avatarColor === "string" ? { avatarColor: value.avatarColor } : value.avatarColor === null ? { avatarColor: null } : {}),
    ...(value.currentActivity === undefined ? {} : { currentActivity: value.currentActivity }),
    ...(isRecord(value.remoteRoom) && typeof value.remoteRoom.roomId === "string" && value.remoteRoom.roomId.length > 0
      ? { remoteRoom: { roomId: value.remoteRoom.roomId } }
      : value.remoteRoom === null ? { remoteRoom: null } : {}),
    ...(typeof value.sharedRoomId === "string" && value.sharedRoomId.length > 0 ? { sharedRoomId: value.sharedRoomId } : {}),
    ...(value.hasUnread === true ? { hasUnread: true } : {}),
    updatedAt: numberValue(value.updatedAt, now),
    ...(value.isPinned === true ? { isPinned: true } : {}),
    ...(value.isRunning === true ? { isRunning: true } : {}),
    ...(isRecord(awaitingUserResponse) && typeof awaitingUserResponse.reason === "string"
      ? { waitingReason: awaitingUserResponse.reason }
      : {}),
    ...(typeof value.draftPrompt === "string" ? { draftPrompt: value.draftPrompt } : {}),
    ...(typeof value.isComposingMessage === "boolean" ? { isComposingMessage: value.isComposingMessage } : {}),
    lastEntry,
    ...(typeof value.lastMessageId === "string" || value.lastMessageId === null ? { lastMessageId: value.lastMessageId } : {}),
    lastMessagePreview,
    ...(lastMessage == null ? {} : { lastMessage }),
    isGroup: value.isGroup === true,
    isHidden: value.isHiddenFromSidebar === true || value.hiddenFromSidebar === true,
    memberIds: stringArray(value.memberIds ?? value.members),
    conversationPartnerIds: stringArray(value.conversationPartnerIds),
    awaitingUserResponse,
    raw: value as RendererAgentRaw
  };
}

export function projectRendererAgents(value: unknown, now = Date.now()): RendererAgent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((agent) => projectRendererAgent(agent, now))
    .filter((agent): agent is RendererAgent => agent != null)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function attachmentFromEntry(entry: Record<string, unknown>): DraftAttachment | null {
  const path = stringValue(entry.path ?? entry.url ?? entry.source);
  if (path == null) return null;
  return {
    path,
    name: stringValue(entry.fileName ?? entry.name) ?? path.split(/[/\\]/).at(-1) ?? "Attachment",
    ...(typeof entry.byteSize === "number" ? { size: entry.byteSize } : {}),
    ...(typeof entry.mimeType === "string" ? { mimeType: entry.mimeType } : {})
  };
}

export interface ProjectedUserAttachmentGalleryAttachment extends DraftAttachment {
  readonly sourceKind: "user-attachment";
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly timestampMs?: number;
  readonly batchId?: string;
  readonly replyTo?: string;
  readonly clientNonce?: string;
}

export interface ProjectedUserAttachmentMessage extends TranscriptMessage {
  readonly sourceKind: "user-attachment";
  readonly userAttachment: UserAttachmentGalleryProjection;
  readonly attachments: [ProjectedUserAttachmentGalleryAttachment];
}

export type ProductionTranscriptEntry = ConversationTranscriptEntry | ProjectedUserAttachmentMessage;

function projectPermissionRequestEntry(value: Record<string, unknown>, id: string, timestampMs: number): TranscriptPermissionRequest | null {
  const message = isRecord(value.message) && value.message.type === "permission-request" ? value.message : null;
  if (message == null || !isRecord(message.permission) || typeof message.permission.title !== "string" || message.permission.title.trim().length === 0) return null;
  if (value.timestampMs !== undefined && (typeof value.timestampMs !== "number" || !Number.isFinite(value.timestampMs))) return null;
  if (value.isGroupStart !== undefined && typeof value.isGroupStart !== "boolean") return null;
  return {
    kind: "permission-request",
    id,
    title: message.permission.title,
    timestampMs,
    ...(value.isGroupStart === undefined ? {} : { isGroupStart: value.isGroupStart }),
  };
}

function projectUserAttachmentGalleryAttachment(projection: UserAttachmentGalleryProjection): ProjectedUserAttachmentGalleryAttachment {
  return {
    ...projection.attachment,
    sourceKind: "user-attachment",
    id: projection.id,
    ...(projection.width === undefined ? {} : { width: projection.width }),
    ...(projection.height === undefined ? {} : { height: projection.height }),
    ...(projection.timestampMs === undefined ? {} : { timestampMs: projection.timestampMs }),
    ...(projection.batchId === undefined ? {} : { batchId: projection.batchId }),
    ...(projection.replyTo === undefined ? {} : { replyTo: projection.replyTo }),
    ...(projection.clientNonce === undefined ? {} : { clientNonce: projection.clientNonce }),
  };
}

function messageText(entry: Record<string, unknown>): string | null {
  if (typeof entry.content === "string") return entry.content;
  if (typeof entry.text === "string") return entry.text;
  if (isRecord(entry.message) && typeof entry.message.content === "string") return entry.message.content;
  return null;
}

function transcriptDelivery(entry: Record<string, unknown>): TranscriptMessage["delivery"] {
  const candidate = entry.delivery ?? entry.status;
  if (candidate === "pending" || candidate === "queued" || candidate === "failed" || candidate === "sent") return candidate;
  if (entry.pending === true || entry.isPending === true) return "pending";
  if (entry.failed === true || entry.isFailed === true) return "failed";
  return undefined;
}

function transcriptStreaming(entry: Record<string, unknown>): boolean {
  return entry.isStreaming === true || entry.streaming === true;
}

function transcriptRichText(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.richText === "string") return entry.richText;
  const message = isRecord(entry.message) ? entry.message : null;
  return message != null && typeof message.richText === "string" ? message.richText : undefined;
}

function transcriptReplyToId(entry: Record<string, unknown>): string | undefined {
  const candidate = entry.replyToId ?? entry.replyTo;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  if (!isRecord(candidate)) return undefined;
  const targetId = candidate.targetId ?? candidate.id;
  return typeof targetId === "string" && targetId.length > 0 ? targetId : undefined;
}

function transcriptToolCallStatus(entry: Record<string, unknown>): TranscriptToolCall["status"] {
  const status = entry.status;
  if (status === "pending" || status === "running" || status === "done" || status === "failed" || status === "error" || status === "aborted") return status;
  return "pending";
}

function transcriptLocalToolPermissionStatus(value: unknown): TranscriptLocalToolPermission["ask"]["status"] | null {
  return value === "pending" || value === "always" || value === "never" || value === "denied" || value === "expired" || value === "allow-once"
    ? value
    : null;
}

function sentWhileOfflineAtMs(value: unknown, entryId: string): number | undefined {
  if (!isRecord(value) || !isRecord(value.sentWhileOfflineAtMsByEntryId)) return undefined;
  const candidate = value.sentWhileOfflineAtMsByEntryId[entryId];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

const SEND_MESSAGE_TEXT_ADJACENCY_KEYS = [
  "isContinuedFromPrev",
  "isContinuedToNext",
  "isGroupStart",
  "isRunStart",
  "isFollowedByThreadChip",
  "isGroupEnd",
] as const;

function transcriptTextAdjacency(value: Record<string, unknown>): SendMessageTextAdjacency | null {
  if (value.adjacency !== undefined && !isRecord(value.adjacency)) return null;
  const candidate = isRecord(value.adjacency) ? value.adjacency : value;
  const adjacency: Record<string, boolean> = {};
  for (const key of SEND_MESSAGE_TEXT_ADJACENCY_KEYS) {
    const field = candidate[key];
    if (field === undefined) continue;
    if (typeof field !== "boolean") return null;
    adjacency[key] = field;
  }
  return adjacency as SendMessageTextAdjacency;
}

function projectSendMessageTextEntry(value: Record<string, unknown>, id: string, timestampMs: number): TranscriptCardEntry | null {
  const adjacency = transcriptTextAdjacency(value);
  if (adjacency == null) return null;
  const projection = projectSendMessageText(value, adjacency);
  if (projection.kind === "invalid") return null;
  return projectTranscriptCardEntry({
    ...value,
    id,
    timestampMs,
    streaming: projection.streaming,
    isGroupStart: projection.adjacency.isGroupStart,
  });
}

function composedAtMsFor(entry: Record<string, unknown>): number | undefined {
  const value = entry.composedAtMs ?? entry.queuedAtMs;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function transcriptReactionFields(entry: Record<string, unknown>): Pick<TranscriptMessage, "reactions" | "myReactions"> {
  if (!Array.isArray(entry.reactions)) return {};
  const projection = projectTranscriptReactions(entry.reactions);
  return { reactions: projection.reactions, myReactions: projection.myReactions };
}

export function projectTranscriptEntry(value: unknown, index: number, agentName: string, agentId?: string | null): ProductionTranscriptEntry | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id) ?? `entry-${index}`;
  const timestampMs = numberValue(value.timestampMs, Date.now());
  const composedAtMs = typeof (value.composedAtMs ?? value.queuedAtMs) === "number" && Number.isFinite(value.composedAtMs ?? value.queuedAtMs)
    ? Number(value.composedAtMs ?? value.queuedAtMs)
    : undefined;
  if (value.kind === "event") {
    const event = projectTimelineEvent(value.event);
    return event == null ? null : { kind: "timeline-event", id, event, timestampMs };
  }
  if (value.kind === "notice") {
    const text = messageText(value);
    return text == null ? null : { kind: "notice", id, text, timestampMs,
      ...(typeof value.code === "string" ? {code:value.code} : {}),
      ...(typeof value.replyTo === "string" ? {replyTo:value.replyTo} : {}),
      ...(typeof value.controlActor === "string" ? {controlActor:value.controlActor} : {}),
      ...(isRecord(value.collaborationEvent) ? {collaborationEvent:value.collaborationEvent} : {}),
    };
  }
  const message = isRecord(value.message) ? value.message : null;
  if (value.kind === "send-message" && message?.type === "permission-request") {
    return projectPermissionRequestEntry(value, id, timestampMs);
  }
  if (value.kind === "send-message" && message?.type === "text") {
    return projectSendMessageTextEntry(value, id, timestampMs);
  }
  const ask = message != null && message.type === "local-tool-permission" && isRecord(message.ask) ? message.ask : null;
  const askStatus = ask == null ? null : transcriptLocalToolPermissionStatus(ask.status);
  if (value.kind === "send-message" && ask != null && askStatus != null && typeof ask.requestId === "string" && ask.requestId.length > 0) {
    return {
      kind: "local-tool-permission",
      id,
      entryId: id,
      agentId: agentId ?? stringValue(value.agentId),
      ask: { requestId: ask.requestId, status: askStatus, action: ask.action, target: ask.target },
      ...(typeof value.permissionScope === "string" ? { permissionScope: value.permissionScope } : {}),
      ...(typeof value.permissionScopeRevision === "number" && Number.isInteger(value.permissionScopeRevision) && value.permissionScopeRevision >= 0
        ? { permissionScopeRevision: value.permissionScopeRevision }
        : {}),
      timestampMs
    };
  }
  // @evidence src/app/dist/renderer/assets/view-BKPMMMAd.js#byteOffset=4426 (send-message:attachment box branch owns boxRequestId)
  // A send-message attachment is a card entry even when its Computer payload
  // has a request id; only non-attachment handoffs use the generic projection.
  if (value.kind === "send-message" && message?.type !== "attachment" && typeof value.boxRequestId === "string") {
    return {
      kind: "computer-handoff",
      id,
      requestId: value.boxRequestId,
      instruction: typeof value.boxInstruction === "string" ? value.boxInstruction : "",
      resolution: typeof value.boxResolution === "string" ? value.boxResolution : null,
      timestampMs
    };
  }
  if (value.kind === "send-message") {
    const transcriptCard = projectTranscriptCardEntry(value);
    if (transcriptCard != null) return transcriptCard;
  }
  if (value.kind === "tool-call") {
    const name = stringValue(value.name ?? value.toolName);
    if (name == null) return null;
    return {
      kind: "tool-call",
      id,
      name,
      status: transcriptToolCallStatus(value),
      ...(typeof value.summary === "string" && value.summary.length > 0 ? { summary: value.summary } : {}),
      timestampMs
    };
  }
  if (value.kind === "thinking") {
    const text = messageText(value);
    if (text == null || text.length === 0) return null;
    const durationMs = numberValue(value.durationMs, 0);
    return {
      kind: "thinking",
      id,
      text,
      ...(durationMs > 0 ? { durationMs } : {}),
      timestampMs
    };
  }
  if (value.kind === "user-attachment") {
    const projection = projectUserAttachmentEvent(value);
    if (projection == null) return null;
    const attachment = projectUserAttachmentGalleryAttachment(projection);
    return {
      kind: "message", id, role: "user", author: "You", text: "", timestampMs, attachments: [attachment],
      sourceKind: "user-attachment",
      userAttachment: projection,
      delivery: transcriptDelivery(value) ?? "sent",
      ...(projection.clientNonce == null ? {} : { clientNonce: projection.clientNonce }),
      ...(projection.replyTo == null ? {} : { replyToId: projection.replyTo }),
      ...transcriptReactionFields(value)
    };
  }
  const isAttachmentEntry = value.kind === "user-attachment" || value.kind === "attachment";
  const attachment = isAttachmentEntry ? attachmentFromEntry(value) : null;
  if (attachment != null) {
    return {
      kind: "message", id, role: "user", author: "You", text: "", timestampMs, attachments: [attachment],
      delivery: transcriptDelivery(value) ?? "sent",
      ...(typeof value.clientNonce === "string" ? { clientNonce: value.clientNonce } : {}),
      ...(transcriptReplyToId(value) == null ? {} : { replyToId: transcriptReplyToId(value) }),
      ...transcriptReactionFields(value)
    };
  }
  const text = messageText(value);
  if (text == null) return null;
  const role = value.kind === "send-message" || value.role === "assistant" ? "assistant" : "user";
  return {
    kind: "message",
    id,
    role,
    author: role === "assistant" ? agentName : "You",
    text,
    timestampMs,
    ...(transcriptRichText(value) === undefined ? {} : { richText: transcriptRichText(value) }),
    delivery: transcriptDelivery(value) ?? "sent",
    ...(typeof value.clientNonce === "string" ? { clientNonce: value.clientNonce } : {}),
    ...(composedAtMs == null ? {} : { composedAtMs }),
    ...(transcriptStreaming(value) ? { isStreaming: true } : {}),
    ...(transcriptReplyToId(value) == null ? {} : { replyToId: transcriptReplyToId(value) }),
    ...transcriptReactionFields(value)
  };
}

/**
 * Projects the immutable transcript-feed snapshot through the same entry
 * boundary as tail pages and appended events. Invalid rows are dropped while
 * preserving the feed's chronological order and stable index fallback.
 */
export function projectTranscriptFeedEntries(
  values: readonly unknown[],
  agentName: string,
  agentId: string,
): ProductionTranscriptEntry[] {
  return values.flatMap((value, index) => {
    const projected = projectTranscriptEntry(value, index, agentName, agentId);
    return projected == null ? [] : [projected];
  });
}

export interface ProjectedTranscriptPage {
  entries: ProductionTranscriptEntry[];
  nextBeforeSeq?: number;
  /** Only authoritative transcript-window responses carry this field. */
  threadSummaries?: readonly TranscriptThreadSummary[];
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5099055
function projectThreadSummaries(value: unknown): TranscriptThreadSummary[] | undefined {
  if (!isRecord(value) || !isRecord(value.threadCounts)) return undefined;
  const summaries: TranscriptThreadSummary[] = [];
  for (const [rootId, count] of Object.entries(value.threadCounts)) {
    if (rootId.length === 0 || typeof count !== "number" || !Number.isInteger(count) || count <= 0) continue;
    summaries.push({ rootId, count });
  }
  return summaries;
}

export function projectTranscriptPageResult(value: unknown, agentName: string, agentId?: string | null): ProjectedTranscriptPage {
  if (!isRecord(value) || !Array.isArray(value.entries)) return { entries: [] };
  const entries = value.entries
    .map((entry, index) => projectTranscriptEntry(entry, index, agentName, agentId))
    .filter((entry): entry is ProductionTranscriptEntry => entry != null)
    .map((entry) => {
      if (entry.kind !== "message" || entry.composedAtMs != null) return entry;
      const composedAtMs = sentWhileOfflineAtMs(value, entry.id);
      return composedAtMs == null ? entry : { ...entry, composedAtMs };
  });
  const nextBeforeSeq = typeof value.nextBeforeSeq === "number" && Number.isFinite(value.nextBeforeSeq) ? value.nextBeforeSeq : undefined;
  const threadSummaries = projectThreadSummaries(value);
  return {
    entries,
    ...(nextBeforeSeq == null ? {} : { nextBeforeSeq }),
    ...(threadSummaries === undefined ? {} : { threadSummaries })
  };
}

export function projectTranscriptPage(value: unknown, agentName: string): ProductionTranscriptEntry[] {
  return projectTranscriptPageResult(value, agentName).entries;
}

export function parseDesktopIntent(value: unknown, family: "focus" | "deep-link"): DesktopIntent {
  if (!isRecord(value)) return null;
  if (family === "focus") {
    const agentId = stringValue(value.id);
    return agentId == null ? null : { kind: "focus-agent", agentId };
  }
  const link = isRecord(value.link) ? value.link : value;
  if (link.route === "plugin-add" && typeof link.pluginId === "string") return { kind: "plugin-add", pluginId: link.pluginId };
  if (link.route === "open") return { kind: "open-app" };
  if (link.version === 1 && (link.source === "protocol" || link.source === "https") && link.route === "info" && link.topic === "deep-links") {
    return { kind: "deep-link-info", link: { version: 1, source: link.source, route: "info", topic: "deep-links" } };
  }
  return null;
}

export interface ComputerProjection {
  phase: "off" | "starting" | "sleeping" | "local" | "running" | "pulling";
  vncUrl: string | null;
  pullPercent: number | null;
  handoff: Record<string, unknown> | null;
}

export function projectComputerStatus(value: unknown, isStarting = false): ComputerProjection {
  if (!isRecord(value)) return { phase: isStarting ? "starting" : "off", vncUrl: null, pullPercent: null, handoff: null };
  const vncUrl = typeof value.vncUrl === "string" && value.vncUrl.length > 0 ? value.vncUrl : null;
  const pull = isRecord(value.pull) ? value.pull : null;
  const phase = pull != null
    ? "pulling"
    : value.state === "running"
      ? vncUrl == null ? "local" : "running"
      : value.state === "hibernated" ? "sleeping" : isStarting ? "starting" : "off";
  return {
    phase,
    vncUrl,
    pullPercent: pull != null && typeof pull.percent === "number" ? pull.percent : null,
    handoff: isRecord(value.handoff) ? value.handoff : null
  };
}

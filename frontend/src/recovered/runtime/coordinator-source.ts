// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L133007-L133030
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L137726-L138027

import {
  COORDINATOR_METHOD_TABLE,
  parseCoordinatorAgentThreadResponse,
  parseCoordinatorTranscriptWindowResponse,
  type CoordinatorMethod
} from "../../../../source/shared/rpc/coordinator";
import {
  COORDINATOR_CANCELLED,
  COORDINATOR_PROTOCOL_VERSION,
  COORDINATOR_TRANSPORT_STATE_FAMILY,
  parseCoordinatorFrame,
  type CoordinatorFailure,
  type CoordinatorFrame
} from "../../../../source/shared/rpc/coordinator-port";

import { isSourceRecord, SourceFailure, type SourceFailureDetail } from "./source-boundary";

export const COORDINATOR_PRE_PORT_CALL_BOUND = 256;

const SOURCE_CANCELLED = "source/cancelled";
const SOURCE_CAPABILITY_UNAVAILABLE = "source/capability-unavailable";
const SOURCE_MALFORMED_REPLY = "source/malformed-reply";
const SOURCE_TRANSPORT_FAILURE = "source/transport-failure";
const PRE_PORT_SETTLE = "pre_port_settle";
const PRE_PORT_SETTLED_MESSAGE = "coordinator port never adopted by this source";

const CLOUD_AGENT_STORAGE_DISABLED = "CLOUD_AGENT_STORAGE_DISABLED";
const SAND_BOX_BLOCKED = "sand-box-blocked";
const SAND_ACCESS_BLOCKED = "sand-access-blocked";
const SEND_NONCE_DIGEST_MISMATCH = "send/nonce-digest-mismatch";
const AUTO_REVIEW_STALE = "auto-review/stale";
const AUTO_REVIEW_STALE_MESSAGE = "The Auto-review request is stale, expired, or not authorized.";
const AGENT_LIMIT_MESSAGE = "50 is the maximum";
const AGENT_LIMIT_REACHED = "agent-limit-reached";
const SKILL_PUBLISH_REFUSED_PREFIX = "skill-publish/refused: ";
const SKILL_PUBLISH_REFUSED = "skill-publish-refused";
const BOX_BLOCKED_PREFIX = "sand box blocked by kill switch: ";
const BOX_BLOCKED_DELIMITER = "\u001f";
const BOX_BLOCKED_FIELD_MAX = 400;

const MALFORMED_REPLY = Symbol("malformed-reply");

type ReplyKind = (typeof COORDINATOR_METHOD_TABLE)[CoordinatorMethod]["reply"];
type ConvertedReply = unknown | typeof MALFORMED_REPLY;

export interface CoordinatorRequestOptions {
  readonly signal?: unknown;
}

export interface CoordinatorSourceSubscription {
  dispose(): void;
}

export type CoordinatorSourceEventListener = Readonly<Record<string, ((payload: unknown) => void) | undefined>>;
export type CoordinatorTransportState = "connected" | "down";
export type CoordinatorTransportListener = (state: CoordinatorTransportState) => void;

type CoordinatorSourceMethods = {
  [Method in CoordinatorMethod]:
    (typeof COORDINATOR_METHOD_TABLE)[Method]["args"] extends "none"
      ? (options?: CoordinatorRequestOptions) => Promise<unknown>
      : (args: unknown, options?: CoordinatorRequestOptions) => Promise<unknown>;
};

export type RawPortCoordinatorSource = CoordinatorSourceMethods & {
  subscribe(listener: CoordinatorSourceEventListener): CoordinatorSourceSubscription;
  subscribeTransportState(listener: CoordinatorTransportListener): CoordinatorSourceSubscription;
};

export interface RawCoordinatorPortEndpoint {
  post(frame: CoordinatorFrame): void;
  close(): void;
}

export interface RawPortCoordinatorSession {
  readonly source: RawPortCoordinatorSource;
  readonly ready: Promise<void>;
  handleMessage(value: unknown): void;
  handlePortClosed(): void;
  dispose(): void;
}

export interface CoordinatorFailureTelemetry {
  readonly domain: string;
  readonly operation: CoordinatorMethod;
  readonly failureCode: string;
  readonly boundary: unknown;
  readonly retryOwner: unknown;
  readonly transportKind?: unknown;
  readonly state: "failed" | "recovered";
  readonly failedMs?: number;
}

export interface CoordinatorFailureTelemetryTracker {
  noteSuccess(operation: { readonly domain: string; readonly operation: CoordinatorMethod }): void;
  noteFailure(operation: { readonly domain: string; readonly operation: CoordinatorMethod }, failure: SourceFailureDetail): void;
}

function cancelledFailure(): SourceFailure {
  return new SourceFailure({ code: SOURCE_CANCELLED, boundary: "client", retry: null });
}

function capabilityUnavailableFailure(): SourceFailure {
  return new SourceFailure({ code: SOURCE_CAPABILITY_UNAVAILABLE, boundary: "host", retry: null });
}

function malformedReplyFailure(): SourceFailure {
  return new SourceFailure({ code: SOURCE_MALFORMED_REPLY, boundary: "host", retry: null });
}

function transportFailure(
  method: string,
  message: string,
  options?: { readonly transportKind?: string }
): SourceFailure {
  return new SourceFailure({
    code: SOURCE_TRANSPORT_FAILURE,
    boundary: "host",
    retry: { owner: "client", command: method },
    ...(options?.transportKind !== undefined ? { transportKind: options.transportKind } : {})
  }, message);
}

function boxBlockedDisplay(message: string): { reason: string; title: string; detail: string } | null {
  const prefixIndex = message.indexOf(BOX_BLOCKED_PREFIX);
  if (prefixIndex === -1) return null;
  const fields = message.slice(prefixIndex + BOX_BLOCKED_PREFIX.length).split(BOX_BLOCKED_DELIMITER);
  if (fields.length !== 3) return null;
  const [reason, title, detail] = fields;
  if (
    reason === undefined || reason.length > BOX_BLOCKED_FIELD_MAX ||
    title === undefined || title.length === 0 || title.length > BOX_BLOCKED_FIELD_MAX ||
    detail === undefined || detail.length === 0 || detail.length > BOX_BLOCKED_FIELD_MAX
  ) return null;
  return { reason, title, detail };
}

function skillPublishRefusal(message: string): string | null {
  return message.startsWith(SKILL_PUBLISH_REFUSED_PREFIX)
    ? message.slice(SKILL_PUBLISH_REFUSED_PREFIX.length)
    : null;
}

function adaptCoordinatorFailure(method: string, failure: CoordinatorFailure): never {
  if (failure.code === COORDINATOR_CANCELLED) throw cancelledFailure();
  if (failure.transportKind === "no_storage") {
    throw new SourceFailure({ code: CLOUD_AGENT_STORAGE_DISABLED, boundary: "host", retry: null });
  }
  if (failure.transportKind === "box_blocked") {
    const display = boxBlockedDisplay(failure.message);
    const detail: SourceFailureDetail = {
      code: SAND_BOX_BLOCKED,
      boundary: "host",
      retry: null,
      transportKind: "box_blocked",
      ...(display === null ? {} : { display: { title: display.title, detail: display.detail } })
    };
    throw new SourceFailure(detail, display?.detail ?? SAND_BOX_BLOCKED);
  }
  if (failure.transportKind === "access_denied") {
    throw new SourceFailure({
      code: SAND_ACCESS_BLOCKED,
      boundary: "host",
      retry: { owner: "client", command: method },
      transportKind: "access_denied"
    }, SAND_ACCESS_BLOCKED);
  }
  if (failure.message.includes(SEND_NONCE_DIGEST_MISMATCH)) {
    throw new SourceFailure({ code: SEND_NONCE_DIGEST_MISMATCH, boundary: "host", retry: null });
  }
  if (failure.message.includes(AUTO_REVIEW_STALE) || failure.message === AUTO_REVIEW_STALE_MESSAGE) {
    throw new SourceFailure({ code: AUTO_REVIEW_STALE, boundary: "host", retry: null });
  }
  if (failure.message === `unknown gateway method: ${method}`) throw capabilityUnavailableFailure();
  if (failure.message === AGENT_LIMIT_MESSAGE) {
    throw new SourceFailure({ code: AGENT_LIMIT_REACHED, boundary: "host", retry: null }, AGENT_LIMIT_MESSAGE);
  }
  const refused = skillPublishRefusal(failure.message);
  if (refused !== null) {
    throw new SourceFailure({ code: SKILL_PUBLISH_REFUSED, boundary: "host", retry: null }, refused);
  }
  throw transportFailure(method, `${failure.code}: ${failure.message}`, { transportKind: failure.transportKind });
}

const REPLY_CONVERTERS: Record<ReplyKind, (value: unknown) => ConvertedReply> = {
  array: (value) => Array.isArray(value) ? value : MALFORMED_REPLY,
  record: (value) => isSourceRecord(value) ? value : MALFORMED_REPLY,
  "record-or-null": (value) => value === null || isSourceRecord(value) ? value : MALFORMED_REPLY,
  boolean: (value) => typeof value === "boolean" ? value : MALFORMED_REPLY,
  count: (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : MALFORMED_REPLY,
  void: () => undefined,
  "send-result": (value) => value == null ? undefined : isSourceRecord(value) ? value : MALFORMED_REPLY,
  "transcript-page": (value) => {
    if (
      !isSourceRecord(value) ||
      !Array.isArray(value.entries) ||
      (value.nextBeforeSeq != null && typeof value.nextBeforeSeq !== "number")
    ) return MALFORMED_REPLY;
    return value;
  },
  "transcript-window": (value) => parseCoordinatorTranscriptWindowResponse(value) ?? MALFORMED_REPLY,
  "agent-thread": (value) => parseCoordinatorAgentThreadResponse(value) ?? MALFORMED_REPLY,
  "acceptance-lookup": (value) => isSourceRecord(value) && typeof value.outcome === "string" ? value : MALFORMED_REPLY,
  "connect-url": (value) => isSourceRecord(value) && typeof value.url === "string" ? value : MALFORMED_REPLY,
  "import-result": (value) => isSourceRecord(value) && Array.isArray(value.workflows) ? value : MALFORMED_REPLY,
  "channels-view": (value) => isSourceRecord(value) && Array.isArray(value.manifests) && Array.isArray(value.connections) ? value : MALFORMED_REPLY,
  "box-secrets": (value) => {
    if (
      !isSourceRecord(value) ||
      !Array.isArray(value.keys) ||
      value.keys.some((key) => typeof key !== "string") ||
      typeof value.isApplied !== "boolean" ||
      (value.lastAppliedAtMs !== null && typeof value.lastAppliedAtMs !== "number")
    ) return MALFORMED_REPLY;
    return { keys: value.keys, isApplied: value.isApplied, lastAppliedAtMs: value.lastAppliedAtMs };
  },
  "box-status": (value) => value === null
    ? null
    : isSourceRecord(value) && typeof value.agentId === "string" && typeof value.state === "string"
      ? value
      : MALFORMED_REPLY
};

interface AbortSignalLike {
  readonly aborted?: unknown;
  addEventListener(type: "abort", listener: () => void, options: { readonly once: true }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

function abortSignal(value: unknown): AbortSignalLike | null {
  if (value == null) return null;
  const candidate = value as Partial<AbortSignalLike>;
  return typeof candidate.addEventListener === "function" && typeof candidate.removeEventListener === "function"
    ? candidate as AbortSignalLike
    : null;
}

function isAborted(options: CoordinatorRequestOptions | undefined): boolean {
  return (options?.signal as { readonly aborted?: unknown } | null | undefined)?.aborted === true;
}

export function createRawPortCoordinatorSession(endpoint: RawCoordinatorPortEndpoint): RawPortCoordinatorSession {
  let phase: "awaiting-ready" | "serving" | "settled" = "awaiting-ready";
  let nextRequestId = 0;
  const pending = new Map<string, {
    readonly method: string;
    readonly resolve: (value: unknown) => void;
    readonly reject: (reason: unknown) => void;
    readonly detachAbort: () => void;
  }>();
  const eventListeners = new Set<{ readonly listener: CoordinatorSourceEventListener }>();
  const transportListeners = new Set<{ readonly listener: CoordinatorTransportListener }>();
  let resolveReady: () => void = () => {};
  let rejectReady: (reason: unknown) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});

  const settle = (reason: string) => {
    if (phase === "settled") return;
    phase = "settled";
    rejectReady(new Error(reason));
    for (const waiting of pending.values()) {
      waiting.detachAbort();
      waiting.reject(transportFailure(waiting.method, reason));
    }
    pending.clear();
    endpoint.close();
    for (const entry of [...transportListeners]) entry.listener("down");
  };
  const breach = (detail: string) => {
    if (phase === "settled") return;
    endpoint.post({ kind: "lifecycle", phase: "shutdown", reason: "protocol-error", detail });
    settle(`coordinator port protocol breach: ${detail}`);
  };

  endpoint.post({ kind: "lifecycle", phase: "hello", protocolVersion: COORDINATOR_PROTOCOL_VERSION });

  const request = (method: CoordinatorMethod, args: unknown, replyKind: ReplyKind, options?: CoordinatorRequestOptions) => {
    if (isAborted(options)) return Promise.reject(cancelledFailure());
    if (phase === "settled") return Promise.reject(transportFailure(method, "coordinator port session settled"));
    nextRequestId += 1;
    const requestId = `r-${nextRequestId}`;
    const response = new Promise<unknown>((resolve, reject) => {
      const signal = abortSignal(options?.signal);
      const onAbort = () => {
        if (phase !== "settled" && pending.has(requestId)) endpoint.post({ kind: "cancel", requestId });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(requestId, {
        method,
        resolve(value) {
          const converted = REPLY_CONVERTERS[replyKind](value);
          if (converted === MALFORMED_REPLY) reject(malformedReplyFailure());
          else resolve(converted);
        },
        reject,
        detachAbort: () => signal?.removeEventListener("abort", onAbort)
      });
    });
    endpoint.post({ kind: "request", requestId, method, args });
    return response;
  };

  const methods = {} as CoordinatorSourceMethods;
  for (const method of Object.keys(COORDINATOR_METHOD_TABLE) as CoordinatorMethod[]) {
    const descriptor = COORDINATOR_METHOD_TABLE[method];
    const call = descriptor.args === "none"
      ? (options?: CoordinatorRequestOptions) => request(method, {}, descriptor.reply, options)
      : (args: unknown, options?: CoordinatorRequestOptions) => request(method, args, descriptor.reply, options);
    Object.assign(methods, { [method]: call });
  }

  const source = Object.assign(methods, {
    subscribe(listener: CoordinatorSourceEventListener): CoordinatorSourceSubscription {
      const entry = { listener };
      eventListeners.add(entry);
      return { dispose: () => { eventListeners.delete(entry); } };
    },
    subscribeTransportState(listener: CoordinatorTransportListener): CoordinatorSourceSubscription {
      const entry = { listener };
      transportListeners.add(entry);
      return { dispose: () => { transportListeners.delete(entry); } };
    }
  }) as RawPortCoordinatorSource;

  const handleEvent = (family: string, payload: unknown) => {
    if (family === COORDINATOR_TRANSPORT_STATE_FAMILY) {
      if (!isSourceRecord(payload) || (payload.state !== "connected" && payload.state !== "down")) return;
      for (const entry of [...transportListeners]) entry.listener(payload.state);
      return;
    }
    if (payload === null) {
      if (family !== "box-disk-pressure") return;
      for (const entry of [...eventListeners]) entry.listener["box-disk-pressure"]?.(payload);
      return;
    }
    if (!isSourceRecord(payload)) return;
    for (const entry of [...eventListeners]) entry.listener[family]?.(payload);
  };

  const handleFrame = (frame: CoordinatorFrame) => {
    if (frame.kind === "lifecycle" && frame.phase === "shutdown") {
      settle(frame.reason === "requested"
        ? "coordinator requested shutdown"
        : `coordinator reported a protocol error: ${frame.detail ?? "unnamed"}`);
      return;
    }
    if (frame.kind === "lifecycle" && frame.phase === "ready") {
      if (phase !== "awaiting-ready") {
        breach("ready repeated on a live session");
        return;
      }
      if (frame.protocolVersion !== COORDINATOR_PROTOCOL_VERSION) {
        breach(`ready.protocolVersion ${frame.protocolVersion} is not the supported ${COORDINATOR_PROTOCOL_VERSION}`);
        return;
      }
      phase = "serving";
      resolveReady();
      return;
    }
    if (frame.kind === "reply") {
      const waiting = pending.get(frame.requestId);
      if (waiting === undefined) return;
      pending.delete(frame.requestId);
      waiting.detachAbort();
      if (frame.outcome.status === "ok") waiting.resolve(frame.outcome.value);
      else {
        try {
          adaptCoordinatorFailure(waiting.method, frame.outcome.failure);
        } catch (error) {
          waiting.reject(error);
        }
      }
      return;
    }
    if (frame.kind === "event") {
      handleEvent(frame.family, frame.payload);
      return;
    }
    breach(`coordinator posted a client-direction ${frame.kind} frame`);
  };

  return {
    source,
    ready,
    handleMessage(value) {
      if (phase === "settled") return;
      const parsed = parseCoordinatorFrame(value);
      if (!parsed.accepted) {
        breach(parsed.rejection.detail);
        return;
      }
      handleFrame(parsed.frame);
    },
    handlePortClosed() {
      settle("coordinator port closed");
    },
    dispose() {
      if (phase === "settled") return;
      endpoint.post({ kind: "lifecycle", phase: "shutdown", reason: "requested", detail: null });
      settle("coordinator source disposed");
    }
  };
}

export function createPrePortCoordinatorSource(): {
  readonly source: RawPortCoordinatorSource;
  settle(): void;
} {
  let settled = false;
  const pending: Array<{ readonly method: string; readonly reject: (reason: unknown) => void }> = [];
  const eventListeners = new Set<{ readonly listener: CoordinatorSourceEventListener }>();
  const transportListeners = new Set<{ readonly listener: CoordinatorTransportListener }>();
  const request = (method: CoordinatorMethod, options?: CoordinatorRequestOptions): Promise<unknown> => {
    if (isAborted(options)) return Promise.reject(cancelledFailure());
    if (settled) return Promise.reject(transportFailure(method, PRE_PORT_SETTLED_MESSAGE, { transportKind: PRE_PORT_SETTLE }));
    if (pending.length >= COORDINATOR_PRE_PORT_CALL_BOUND) {
      return Promise.reject(transportFailure(method, "pre-port call queue is at its bound"));
    }
    return new Promise((_resolve, reject) => pending.push({ method, reject }));
  };
  const methods = {} as CoordinatorSourceMethods;
  for (const method of Object.keys(COORDINATOR_METHOD_TABLE) as CoordinatorMethod[]) {
    const descriptor = COORDINATOR_METHOD_TABLE[method];
    const call = descriptor.args === "none"
      ? (options?: CoordinatorRequestOptions) => request(method, options)
      : (_args: unknown, options?: CoordinatorRequestOptions) => request(method, options);
    Object.assign(methods, { [method]: call });
  }
  const source = Object.assign(methods, {
    subscribe(listener: CoordinatorSourceEventListener): CoordinatorSourceSubscription {
      const entry = { listener };
      eventListeners.add(entry);
      return { dispose: () => { eventListeners.delete(entry); } };
    },
    subscribeTransportState(listener: CoordinatorTransportListener): CoordinatorSourceSubscription {
      const entry = { listener };
      transportListeners.add(entry);
      listener("down");
      return { dispose: () => { transportListeners.delete(entry); } };
    }
  }) as RawPortCoordinatorSource;
  return {
    source,
    settle() {
      if (settled) return;
      settled = true;
      for (const waiting of pending.splice(0)) {
        waiting.reject(transportFailure(waiting.method, PRE_PORT_SETTLED_MESSAGE, { transportKind: PRE_PORT_SETTLE }));
      }
    }
  };
}

export function createStableCoordinatorSource(initial: RawPortCoordinatorSource): {
  readonly source: RawPortCoordinatorSource;
  current(): RawPortCoordinatorSource;
  suspend(source: RawPortCoordinatorSource): void;
  swap(source: RawPortCoordinatorSource): void;
} {
  let current = initial;
  const eventSubscriptions = new Set<{
    readonly listener: CoordinatorSourceEventListener;
    inner: CoordinatorSourceSubscription;
  }>();
  const transportSubscriptions = new Set<{
    readonly listener: CoordinatorTransportListener;
    inner: CoordinatorSourceSubscription;
  }>();
  const methods = {} as CoordinatorSourceMethods;
  for (const method of Object.keys(COORDINATOR_METHOD_TABLE) as CoordinatorMethod[]) {
    Object.assign(methods, {
      [method]: (first: unknown, second?: CoordinatorRequestOptions) =>
        (current[method] as (first: unknown, second?: CoordinatorRequestOptions) => Promise<unknown>)(first, second)
    });
  }
  const source = Object.assign(methods, {
    subscribe(listener: CoordinatorSourceEventListener): CoordinatorSourceSubscription {
      const entry = { listener, inner: current.subscribe(listener) };
      eventSubscriptions.add(entry);
      return { dispose: () => { if (eventSubscriptions.delete(entry)) entry.inner.dispose(); } };
    },
    subscribeTransportState(listener: CoordinatorTransportListener): CoordinatorSourceSubscription {
      const entry = { listener, inner: current.subscribeTransportState(listener) };
      transportSubscriptions.add(entry);
      return { dispose: () => { if (transportSubscriptions.delete(entry)) entry.inner.dispose(); } };
    }
  }) as RawPortCoordinatorSource;
  const replace = (next: RawPortCoordinatorSource, emitConnected: boolean) => {
    if (next === current) return;
    current = next;
    for (const entry of eventSubscriptions) {
      entry.inner.dispose();
      entry.inner = next.subscribe(entry.listener);
    }
    for (const entry of transportSubscriptions) {
      entry.inner.dispose();
      entry.inner = next.subscribeTransportState(entry.listener);
    }
    if (emitConnected) for (const entry of [...transportSubscriptions]) entry.listener("connected");
  };
  return {
    source,
    current: () => current,
    suspend: (next) => replace(next, false),
    swap: (next) => replace(next, true)
  };
}

const TELEMETRY_DOMAIN_BY_METHOD: Record<CoordinatorMethod, string> = {
  getAgentTranscriptWindow: "transcript", getAgentThread: "transcript", getAgentTranscriptTail: "transcript", openAgentTail: "transcript", getConversationOutline: "transcript",
  getCollaboration: "transcript", reviewCollaboration: "send",
  sendPrompt: "send", stopConversation: "send", promptAcceptanceStatus: "send", reactToMessage: "send",
  listRoutedMcpTools: "plugins", executeRoutedMcpTool: "plugins",
  respondToWidget: "widgets", dismissWidget: "widgets", submitSecret: "widgets",
  resolveAutoReviewApproval: "approvals", resolveLocalToolPermission: "approvals",
  listAgents: "roster", countAgents: "roster", searchAgents: "roster", createAgent: "roster",
  createGroup: "roster", setGroupMembers: "roster", updateAgent: "roster", deleteAgents: "roster",
  duplicateAgent: "roster", kickstartAgent: "roster", requestDiskSaverAudit: "roster",
  broadcastToAgents: "roster", setAgentUnread: "roster", setAgentHiddenFromSidebar: "roster",
  setAgentNotificationsEnabled: "roster", setAgentNotifyOnUpdates: "roster", setAgentAvatarBytes: "roster",
  getAgentAvatar: "roster", searchMedia: "search", getCloudAgentInfo: "cloud_agents",
  getListenerIntegrations: "listeners", getListenerConnectUrl: "listeners",
  getAgentWorkflows: "workflows", createAgentWorkflow: "workflows", updateAgentWorkflow: "workflows",
  setAgentWorkflowEnabled: "workflows", deleteAgentWorkflow: "workflows", runAgentWorkflowNow: "workflows",
  importAgentWorkflowText: "workflows", importAgentWorkflowUrl: "workflows", portAgentLocalSkills: "workflows",
  skillsCatalog: "skills", syncPluginSkills: "skills", getPluginSyncStatus: "skills",
  getSkillPublishTargets: "skills", publishSkill: "skills", resyncPublishedSkill: "skills", unpublishSkill: "skills",
  getSubagents: "subagents", getAsyncTasks: "subagents",
  getForeverBoxStatus: "computer", ensureForeverBox: "computer", handBackForeverBox: "computer",
  isEgressTunnelAvailable: "computer",
  startTeachRecording: "teach", stopTeachRecording: "teach", getTeachRecordingStatus: "teach",
  getTrays: "trays", dismissTray: "trays", clearTrays: "trays",
  getAgentChannels: "channels", connectChannel: "channels", disconnectChannel: "channels", refreshChannel: "channels",
  getBoxSecretsStatus: "secrets",
  getAgentAutomations: "automations", listAllAutomations: "automations",
  setAgentAutomationEnabled: "automations", createAgentAutomation: "automations",
  updateAgentAutomation: "automations", deleteAgentAutomation: "automations", runAgentAutomationNow: "automations",
  isAgentNetworkEnabled: "capabilities", isGlobalSearchEnabled: "capabilities",
  getSharingState: "sharing", createRoomFromAgent: "sharing", createRoomInvite: "sharing",
  joinSharedRoom: "sharing", respondToRoomJoinRequest: "sharing", createSharedRoom: "sharing",
  addOwnAgentToSharedRoom: "sharing", removeOwnAgentFromSharedRoom: "sharing",
  setSharedRoomTyping: "sharing", leaveSharedRoom: "sharing"
};

export function createCoordinatorFailureTelemetryTracker(
  report: (event: CoordinatorFailureTelemetry) => void,
  now: () => number = () => performance.now()
): CoordinatorFailureTelemetryTracker {
  const episodes = new Map<string, {
    readonly failureCode: string;
    readonly boundary: unknown;
    readonly retryOwner: unknown;
    readonly transportKind?: unknown;
    readonly failedAtMs: number;
  }>();
  const fields = (
    operation: { readonly domain: string; readonly operation: CoordinatorMethod },
    episode: { readonly failureCode: string; readonly boundary: unknown; readonly retryOwner: unknown; readonly transportKind?: unknown }
  ) => ({
    domain: operation.domain,
    operation: operation.operation,
    failureCode: episode.failureCode,
    boundary: episode.boundary,
    retryOwner: episode.retryOwner,
    ...(episode.transportKind !== undefined ? { transportKind: episode.transportKind } : {})
  });
  return {
    noteSuccess(operation) {
      const key = `${operation.domain}|${operation.operation}`;
      const episode = episodes.get(key);
      if (episode === undefined) return;
      episodes.delete(key);
      report({ ...fields(operation, episode), state: "recovered", failedMs: Math.max(0, now() - episode.failedAtMs) });
    },
    noteFailure(operation, failure) {
      if (
        failure.code === SOURCE_CANCELLED ||
        failure.code === SOURCE_CAPABILITY_UNAVAILABLE ||
        failure.transportKind === PRE_PORT_SETTLE
      ) return;
      const key = `${operation.domain}|${operation.operation}`;
      const previous = episodes.get(key);
      if (previous !== undefined && previous.failureCode === failure.code) return;
      const episode = {
        failureCode: failure.code,
        boundary: failure.boundary,
        retryOwner: (failure.retry as { readonly owner?: unknown } | null | undefined)?.owner ?? "none",
        transportKind: failure.transportKind,
        failedAtMs: previous?.failedAtMs ?? now()
      };
      episodes.set(key, episode);
      report({ ...fields(operation, episode), state: "failed" });
    }
  };
}

export function withCoordinatorSourceTelemetry(
  source: RawPortCoordinatorSource,
  telemetry: CoordinatorFailureTelemetryTracker
): RawPortCoordinatorSource {
  const methods = {} as CoordinatorSourceMethods;
  for (const method of Object.keys(COORDINATOR_METHOD_TABLE) as CoordinatorMethod[]) {
    const operation = { domain: TELEMETRY_DOMAIN_BY_METHOD[method], operation: method };
    Object.assign(methods, {
      [method]: (first: unknown, second?: CoordinatorRequestOptions) =>
        (source[method] as (first: unknown, second?: CoordinatorRequestOptions) => Promise<unknown>)(first, second).then(
          (value) => {
            telemetry.noteSuccess(operation);
            return value;
          },
          (error: unknown) => {
            if (error instanceof SourceFailure) telemetry.noteFailure(operation, error.failure);
            throw error;
          }
        )
    });
  }
  return Object.assign(methods, {
    subscribe: (listener: CoordinatorSourceEventListener) => source.subscribe(listener),
    subscribeTransportState: (listener: CoordinatorTransportListener) => source.subscribeTransportState(listener)
  }) as RawPortCoordinatorSource;
}

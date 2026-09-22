import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { SAND_DEFAULT_AGENT_NAME } from "../../../shared/agents/agents.js";
import {
  formatRemoteAgentId,
  isRemoteAgentId,
} from "../../../shared/agents/sharing.js";
import { isMessageAddress } from "../../../shared/message-reference.js";
import {
  readSandProfileFile,
  getSandProfilePath,
} from "../../agents/agent-profile.js";
import {
  GROUP_CONFIG_VERSION,
  GROUP_MAX_MEMBERS,
  readSandGroupConfig,
  writeSandGroupConfig,
  isSandGroupDir,
  type RemoteGroupMember,
} from "../../groups/group-store.js";
import {
  assertMembersAreNotGroups,
  buildGroupRedriveNote,
  isPassContent,
  isPotentialPassPrefix,
  SHARED_ROOM_HISTORY_LIMIT,
  type GroupDescription,
  type GroupMember,
  type GroupMessage,
} from "../../groups/group-chat.js";
import { isSandRemoteRoomDir } from "../../groups/remote-room-store.js";
import { buildSharedRoomGuardrailPrompt } from "../../groups/xuser.js";
import { createGroupMemberActivityTracker } from "../../sand-activity.js";
import {
  beginTurnTrace,
  markTurnTraceError,
  resolveTurnTraceOutcome,
  resolveTurnTraceType,
  setTurnTraceAttributes,
} from "../../send-trace-host.js";
import {
  GroupChatOrchestrator,
  type GroupOrchestratorDeps,
} from "./group-chat-orchestrator.js";
import { describeAgentRunError } from "./agent-run-error.js";
import { AgentGoneError } from "./session-runtime.js";
import { nextEntryId } from "./transcript-entry-ids.js";
import {
  appendEntry,
  getTranscript,
  removeEntry,
  updateEntry,
} from "./transcript-store.js";
import type {
  TranscriptEntry,
  TranscriptManagerLike,
} from "./transcript-hub.js";

export class SandGroupCreateError extends Error {}

export interface GroupMemberStream {
  currentId: string | undefined;
  currentText: string;
  sealed: string[];
}

export function createGroupMemberStream(): GroupMemberStream {
  return { currentId: undefined, currentText: "", sealed: [] };
}

type LiveSession = any;

export class GroupChatGlue {
  readonly dmPreemptedGroupMemberIds = new Set<string>();
  readonly remoteTurnMemberIdsByRoom = new Map<string, string>();
  readonly activeMemberRooms = new Map<string, string>();

  private readonly groupCreations = new Map<string, { digest: string; promise: Promise<any> }>();

  constructor(readonly tm: TranscriptManagerLike) {}

  async pinMemberSessionForGroupTurn(memberId: string): Promise<LiveSession> {
    if (this.tm.sessions.isAgentGone(memberId))
      throw new AgentGoneError(memberId);
    const live = this.tm.sessions.liveSessions.get(memberId);
    const session = live ?? (await this.tm.sessions.openSessionOnce(memberId));
    this.tm.runLifecycle.beginSessionRun(session, { isGroupMemberTurn: true });
    return session;
  }

  async createGroup(args: {
    name: string; description?: string; memberIds: string[]; clientNonce?: string;
  }): Promise<any> {
    if (!args || typeof args.name !== "string" || !args.name.trim() || args.name.length > 100
      || (args.description !== undefined && (typeof args.description !== "string" || args.description.length > 8000)))
      throw new SandGroupCreateError("Provide a group name of 1–100 characters and a valid description.");
    const requested = this.validateGroupMemberIds(args.memberIds);
    const nonce = args.clientNonce;
    if (nonce !== undefined && (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)))
      throw new SandGroupCreateError("Invalid group creation identity.");
    const digest = createHash("sha256").update(JSON.stringify([args.name.trim(), args.description ?? "", [...requested].sort()])).digest("hex");
    const pending = nonce ? this.groupCreations.get(nonce) : undefined;
    if (pending) {
      if (pending.digest !== digest) throw new SandGroupCreateError("This creation identity belongs to different group details.");
      return pending.promise;
    }
    const promise = this.createValidatedGroup(args, requested, nonce, digest);
    if (nonce) this.groupCreations.set(nonce, { digest, promise });
    try { return await promise; }
    finally { if (nonce && this.groupCreations.get(nonce)?.promise === promise) this.groupCreations.delete(nonce); }
  }

  private validateGroupMemberIds(raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > GROUP_MAX_MEMBERS
      || raw.some(id => typeof id !== "string" || !id.trim() || id !== id.trim())
      || new Set(raw).size !== raw.length)
      throw new SandGroupCreateError(`Choose 1–${GROUP_MAX_MEMBERS} distinct, available Bot members.`);
    return [...raw];
  }

  private async createValidatedGroup(
    args: { name: string; description?: string }, memberIds: string[], nonce: string | undefined, digest: string,
  ): Promise<any> {
    const allAgents = await this.tm.sessionStore.listAgents();
    if (nonce) {
      const duplicate = allAgents.find((agent: any) => readSandGroupConfig(this.tm.sessionStore.getAgentDir(agent.id))?.creation?.nonce === nonce);
      if (duplicate) {
        const receipt = readSandGroupConfig(this.tm.sessionStore.getAgentDir(duplicate.id))!.creation!;
        if (receipt.digest !== digest) throw new SandGroupCreateError("This creation identity belongs to different group details.");
        const transcript = await this.tm.switchAgent(duplicate.id);
        const stamp = this.tm.roster.reserveSnapshotStamp();
        return { agent: this.tm.roster.finalizeSummaryForRpc(duplicate, stamp), transcript };
      }
    }
    const existing = new Set<string>(allAgents.map((agent: any) => agent.id));
    const groupIds = new Set<string>(allAgents.filter((agent: any) => agent.isGroup).map((agent: any) => agent.id));
    assertMembersAreNotGroups(memberIds, id => groupIds.has(id));
    if (memberIds.some(id => !existing.has(id))) throw new SandGroupCreateError("A selected Bot is no longer available. Refresh the members and try again.");
    // Different projects may have exactly the same colleagues. Only an explicit
    // creation nonce deduplicates retries, never the membership set itself.
    const config = { version: GROUP_CONFIG_VERSION, memberIds, ...(nonce ? { creation: { nonce, digest } } : {}) };
    const created = await this.tm.createAgent(
      { name: args.name.trim(), description: args.description ?? "" }, "user",
      { isIntroductionSuppressed: true, configureAgentDir: (dir: string) => writeSandGroupConfig(dir, config) },
    );
    this.tm.productAnalytics.trackEvent("sand.group.created", { group_id: created.agent.id, member_count: memberIds.length });
    await this.tm.roster.emitAgents();
    const stamp = this.tm.roster.reserveSnapshotStamp();
    const refreshed = (await this.tm.sessionStore.listAgents(created.agent.id)).find((agent: any) => agent.id === created.agent.id);
    return { agent: refreshed == null ? created.agent : this.tm.roster.finalizeSummaryForRpc(refreshed, stamp), transcript: created.transcript };
  }

  async setGroupMembers(
    groupId: string,
    memberIds: readonly string[],
  ): Promise<any | null> {
    const dir = this.tm.sessionStore.getAgentDir(groupId);
    const current = readSandGroupConfig(dir);
    if (current == null) return null;
    if (current.sharedRoomId != null)
      return this.currentStampedSummary(groupId);

    const allAgents = await this.tm.sessionStore.listAgents();
    const existing = new Set<string>(allAgents.map((agent: any) => agent.id));
    const groupIds = new Set<string>(
      allAgents
        .filter((agent: any) => agent.isGroup)
        .map((agent: any) => agent.id),
    );
    const requested = this.validateGroupMemberIds(memberIds);
    assertMembersAreNotGroups(requested, id => groupIds.has(id));
    if (requested.some(id => id === groupId || !existing.has(id)))
      throw new SandGroupCreateError("A selected Bot is no longer available. No members were changed.");
    writeSandGroupConfig(dir, { ...current, version: GROUP_CONFIG_VERSION, memberIds: requested });
    await this.tm.roster.emitAgents();
    return this.currentStampedSummary(groupId);
  }

  private async currentStampedSummary(groupId: string): Promise<any | null> {
    const stamp = this.tm.roster.reserveSnapshotStamp();
    const summary = (await this.tm.sessionStore.listAgents(groupId)).find(
      (agent: any) => agent.id === groupId,
    );
    return summary == null
      ? null
      : this.tm.roster.finalizeSummaryForRpc(summary, stamp);
  }

  isGroupSession(session: LiveSession): boolean {
    return isSandGroupDir(dirname(session.dbPath));
  }

  isGroupAgentId(agentId: string): boolean {
    return isSandGroupDir(this.tm.sessionStore.getAgentDir(agentId));
  }

  isRemoteRoomSession(session: LiveSession): boolean {
    return isSandRemoteRoomDir(dirname(session.dbPath));
  }

  isRemoteRoomAgentId(agentId: string): boolean {
    return isSandRemoteRoomDir(this.tm.sessionStore.getAgentDir(agentId));
  }

  groupIdentityFor(session: LiveSession): GroupDescription {
    const profile = this.tm.roster.resolveAgentProfile(session);
    return { name: profile.name, description: profile.description };
  }

  async runGroupTurn(
    session: LiveSession,
    epoch: number,
    traceCtx?: unknown,
    lane = "background",
  ): Promise<void> {
    try {
      const config = readSandGroupConfig(dirname(session.dbPath));
      if (config == null) return;
      const orchestrator = new GroupChatOrchestrator(
        this.groupOrchestratorDeps(session, epoch, traceCtx, lane),
      );
      await orchestrator.run({
        group: this.groupIdentityFor(session),
        memberIds: [
          ...config.memberIds,
          ...(config.remoteMembers ?? []).map(formatRemoteAgentId),
        ],
      });
      await this.tm.roster.emitAgentUpdate(session.id);
    } catch (error) {
      this.tm.trayErrors.pushError({
        agentId: session.id,
        title: "Group chat failed",
        ...describeAgentRunError(error),
      });
      await this.tm.roster.emitAgentUpdate(session.id);
    } finally {
      this.tm.runLifecycle.endSessionRun(session);
    }
  }

  groupOrchestratorDeps(
    session: LiveSession,
    epoch: number,
    traceCtx?: unknown,
    lane = "background",
    requestSource?: string,
  ): GroupOrchestratorDeps {
    const streams = new Map<string, GroupMemberStream>();
    const streamFor = (member: GroupMember): GroupMemberStream => {
      const existing = streams.get(member.id);
      if (existing != null) return existing;
      const created = createGroupMemberStream();
      streams.set(member.id, created);
      return created;
    };
    const config = readSandGroupConfig(dirname(session.dbPath));
    const remoteMembers = config?.remoteMembers ?? [];
    return {
      isSharedRoom: config?.sharedRoomId != null,
      resolveMembers: (ids) => this.resolveGroupMembers(ids, remoteMembers),
      readHistory: () => this.readGroupHistory(session),
      runMemberTurn: (request) =>
        this.runGroupMemberTurn(
          session,
          request,
          streamFor(request.member),
          () => this.tm.sendPipeline.currentTurnEpoch(session) === epoch,
          traceCtx,
          lane,
          requestSource,
        ),
      postMemberMessage: (member, content, context) =>
        this.postGroupMemberMessage(session, member, content, streamFor(member), context?.replyToId),
      finalizeMemberTurn: (member) =>
        this.finalizeGroupMemberStream(session, streamFor(member)),
      isCurrent: () => this.tm.sendPipeline.currentTurnEpoch(session) === epoch,
    };
  }

  async resolveGroupMembers(
    memberIds: readonly string[],
    remoteMembers: readonly RemoteGroupMember[] = [],
  ): Promise<GroupMember[]> {
    const members: GroupMember[] = [];
    for (const id of memberIds) {
      if (isRemoteAgentId(id)) {
        const remote = remoteMembers.find(
          (candidate) => formatRemoteAgentId(candidate) === id,
        );
        if (remote != null)
          members.push({ id, name: remote.name, description: "" });
        continue;
      }
      const dir = this.tm.sessionStore.getAgentDir(id);
      if (!existsSync(dir)) continue;
      if (isSandGroupDir(dir)) {
        console.warn(
          `Sand group: ignoring nested group member ${id}; a group chat cannot be a member of another group.`,
        );
        continue;
      }
      const profile = readSandProfileFile(getSandProfilePath(dir));
      members.push({
        id,
        name: profile?.name.trim() || SAND_DEFAULT_AGENT_NAME,
        description: profile?.description ?? "",
      });
    }
    return members;
  }

  async runGroupMemberTurn(
    roomSession: LiveSession,
    request: { member: GroupMember; systemPrompt: string; prompt: string },
    live: GroupMemberStream,
    isRoomTurnCurrent: () => boolean,
    traceCtx?: unknown,
    lane = "background",
    requestSource?: string,
  ): Promise<string[]> {
    if (isRemoteAgentId(request.member.id)) {
      return this.runRemoteGroupMemberTurn(roomSession, request.member);
    }
    if (!this.tm.execution.canExecuteGroupMember)
      throw new Error("Group member execution is not available.");

    let effective = request;
    if (this.tm.sharedRooms.sharedRoomConfigOf(roomSession) != null) {
      effective = {
        ...request,
        systemPrompt:
          request.systemPrompt +
          buildSharedRoomGuardrailPrompt({
            hostName: "",
            isForeignHost: false,
          }),
      };
    }

    let memberSession = await this.pinMemberSessionForGroupTurn(effective.member.id);
    const sent: string[] = [];
    let lastReactionApplied = false;
    let trackActivity = createGroupMemberActivityTracker();
    const transport = {
      onUpdate: (update: any) => {
        if (!isRoomTurnCurrent()) return; // Late callbacks cannot revive an explicitly stopped conversation.
        this.tm.runLifecycle.applyActivityTransition(
          memberSession.id,
          trackActivity(update),
        );
        if (update.type === "react-to-message") {
          lastReactionApplied = this.applyGroupMemberReaction(
            roomSession,
            effective.member,
            update,
          );
          return;
        }
        if (update.type === "send-message" && update.message?.type === "text") {
          sent.push(update.message.content);
        }
        this.streamGroupMemberUpdate(
          roomSession,
          effective.member,
          update,
          live,
        );
      },
      lastReactionApplied: () => lastReactionApplied,
    };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      this.finalizeGroupMemberStream(roomSession, live);
      lastReactionApplied = false;
      trackActivity = createGroupMemberActivityTracker();
      const prompt =
        attempt === 1
          ? effective.prompt
          : `${effective.prompt}${buildGroupRedriveNote()}`;
      await this.tm.runLifecycle.enqueueExclusiveRun(
        memberSession.id,
        async () => {
          this.tm.turnRuntime.activeRequestSources.set(
            memberSession.id,
            requestSource ?? "turn",
          );
          let registeredRunner: any;
          try {
            if (!isRoomTurnCurrent()) return;
            registeredRunner = this.tm.execution.createGroupMemberRunner(
              memberSession,
              this.tm.runnerRegistry.runnerHooksFor(memberSession, transport),
              {
                systemPrompt: effective.systemPrompt,
                isSharedRoomTurn:
                  this.tm.sharedRooms.sharedRoomConfigOf(roomSession) != null,
              },
            );
            this.tm.runnerRegistry.activeGroupMemberRunners.set(
              memberSession.id,
              registeredRunner,
            );
            this.activeMemberRooms.set(memberSession.id, roomSession.id);
            this.tm.runnerRegistry.wireRunnerLifecycle(
              registeredRunner,
              memberSession,
              roomSession.id,
            );
            const memberTurnTrace = beginTurnTrace({
              parentCtx: traceCtx,
              conversationId: roomSession.id,
              turnType: resolveTurnTraceType(
                requestSource == null ? {} : { requestSource },
              ),
              attributes: {
                "sand.is_group_member": true,
                "sand.member_conversation_id": memberSession.id,
                ...(attempt > 1 ? { "sand.attempt": attempt } : {}),
              },
            });
            try {
              const memberResult = await registeredRunner.run(prompt, {
                traceCtx: memberTurnTrace?.context ?? traceCtx,
                requestSource,
              });
              setTurnTraceAttributes(memberTurnTrace, {
                "sand.outcome": resolveTurnTraceOutcome(memberResult),
              });
              if (memberResult.aborted || memberResult.quiescedForUpgrade)
                throw Object.assign(new Error("The member execution was interrupted; verify prior effects."), { code: "execution_uncertain" });
            } catch (error) {
              markTurnTraceError(memberTurnTrace, error);
              throw error;
            } finally {
              try {
                memberTurnTrace?.span.end();
              } catch {}
            }
          } finally {
            if (
              this.tm.runnerRegistry.activeGroupMemberRunners.get(
                memberSession.id,
              ) === registeredRunner
            ) {
              this.tm.runnerRegistry.activeGroupMemberRunners.delete(
                memberSession.id,
              );
              this.activeMemberRooms.delete(memberSession.id);
            }
            this.tm.runLifecycle.endSessionRun(memberSession);
          }
        },
        { lane, source: "group-member" },
      );

      const preempted = this.dmPreemptedGroupMemberIds.delete(memberSession.id);
      if (
        !preempted ||
        sent.length > 0 ||
        lastReactionApplied ||
        attempt >= 3 ||
        !isRoomTurnCurrent()
      ) {
        break;
      }
      try {
        memberSession = await this.pinMemberSessionForGroupTurn(
          effective.member.id,
        );
      } catch {
        break;
      }
    }
    return sent;
  }

  async runRemoteGroupMemberTurn(
    roomSession: LiveSession,
    member: GroupMember,
  ): Promise<string[]> {
    const delegate = this.tm.xuserDelegate;
    if (delegate == null || !delegate.isEnabled()) throw new Error("Remote colleague is unavailable.");
    const config = this.tm.sharedRooms.sharedRoomConfigOf(roomSession);
    if (config?.sharedRoomId == null) throw new Error("Remote room is unavailable.");
    const ids = [
      ...config.memberIds,
      ...(config.remoteMembers ?? []).map(formatRemoteAgentId),
    ];
    const members = await this.resolveGroupMembers(
      ids,
      config.remoteMembers ?? [],
    );
    this.setRemoteTurnMember(roomSession.id, member.id);
    try {
      return await delegate.runRemoteMemberTurn({
        sharedRoomId: config.sharedRoomId,
        member,
        group: this.groupIdentityFor(roomSession),
        peers: members.filter((other) => other.id !== member.id),
        newMessages: this.readGroupHistory(roomSession).slice(
          -SHARED_ROOM_HISTORY_LIMIT,
        ),
      });
    } finally {
      this.setRemoteTurnMember(roomSession.id);
    }
  }

  setRemoteTurnMember(roomId: string, memberId?: string): void {
    if (this.remoteTurnMemberIdsByRoom.get(roomId) === memberId) return;
    if (memberId == null) this.remoteTurnMemberIdsByRoom.delete(roomId);
    else this.remoteTurnMemberIdsByRoom.set(roomId, memberId);
    void this.tm.roster.emitAgentUpdate(roomId);
  }

  applyGroupMemberReaction(
    roomSession: LiveSession,
    member: GroupMember,
    update: any,
  ): boolean {
    const emoji = String(update.emoji ?? "").trim();
    if (emoji.length === 0 || !isMessageAddress(update.messageAddress))
      return false;
    const entries =
      this.tm.sessions.activeSession?.id === roomSession.id
        ? getTranscript()
        : roomSession.db.getTranscriptEntries();
    const target = entries.find(
      (entry: TranscriptEntry) => entry.id === update.messageAddress,
    );
    if (target == null) return false;
    if (
      target.kind === "send-message" &&
      (target.author as any)?.id === member.id
    )
      return false;
    return (
      this.tm.widgetResponses.applyReaction({
        session: roomSession,
        entryId: update.messageAddress,
        emoji,
        by: member.id,
      }) != null
    );
  }

  postGroupMemberMessage(
    session: LiveSession,
    member: GroupMember,
    content: string,
    live?: GroupMemberStream,
    replyToId?: string,
  ): string {
    const author = { id: member.id, name: member.name };
    const isActive = this.tm.sessions.activeSession?.id === session.id;
    if (live != null && isActive) {
      const previewId = live.sealed.shift();
      const preview = previewId && getTranscript().find(entry => entry.id === previewId && entry.kind === "send-message");
      if (preview) {
        const finalized: TranscriptEntry = { kind: "send-message", id: preview.id,
          message: { type: "text", content, ...(replyToId ? { reply_to: replyToId } : {}) },
          ...(replyToId ? { replyTo: replyToId } : {}),
          ...(preview.timestampMs == null ? {} : { timestampMs: preview.timestampMs }), author };
        if (session.db.appendTranscriptEntry(finalized) === false) throw new Error("Group reply could not be saved.");
        updateEntry(preview.id, () => finalized);
        this.tm.roster.emit({ type: "updated", entry: finalized });
        this.tm.sessions.markActiveSessionArrival(session);
        this.tm.sharedRooms.publishSharedRoomEntryIfNeeded(session, finalized);
        return finalized.id;
      }
    }
    const entries = isActive
      ? getTranscript()
      : session.db.getTranscriptEntries();
    const entry: TranscriptEntry = {
      kind: "send-message",
      id: nextEntryId(entries, "send-message"),
      message: { type: "text", content, ...(replyToId ? { reply_to: replyToId } : {}) },
      ...(replyToId ? { replyTo: replyToId } : {}),
      timestampMs: Date.now(),
      author,
    };
    if (session.db.appendTranscriptEntry(entry) === false) throw new Error("Group reply could not be saved.");
    if (isActive) {
      appendEntry(entry);
      this.tm.roster.emit({ type: "appended", entry });
      this.tm.sessions.markActiveSessionArrival(session);
    } else {
      this.tm.sessionStore.markSessionActivity(session);
      void this.tm.roster.emitAgentUpdate(session.id);
    }
    this.tm.sharedRooms.publishSharedRoomEntryIfNeeded(session, entry);
    return entry.id;
  }

  streamGroupMemberUpdate(
    roomSession: LiveSession,
    member: GroupMember,
    update: any,
    live: GroupMemberStream,
  ): void {
    if (this.tm.sessions.activeSession?.id !== roomSession.id) return;
    try {
      if (update.type === "text-delta") {
        if (!update.text) return;
        live.currentText += update.text;
        if (live.currentId == null) {
          if (isPotentialPassPrefix(live.currentText)) return;
          this.openGroupStreamEntry(member, live);
        } else this.updateGroupStreamEntry(live.currentId, live.currentText);
      } else if (update.type === "send-message" && live.currentId != null) {
        live.sealed.push(live.currentId);
        live.currentId = undefined;
        live.currentText = "";
      }
    } catch {
      // Streaming preview failures must not fail the member turn.
    }
  }

  openGroupStreamEntry(member: GroupMember, live: GroupMemberStream): void {
    const id = nextEntryId(getTranscript(), "send-message");
    const entry: TranscriptEntry = {
      kind: "send-message",
      id,
      message: { type: "text", content: live.currentText },
      timestampMs: Date.now(),
      author: { id: member.id, name: member.name },
      streaming: true,
    };
    live.currentId = id;
    appendEntry(entry);
    this.tm.roster.emit({ type: "appended", entry });
  }

  updateGroupStreamEntry(id: string, content: string): void {
    const updated = updateEntry(id, (entry) =>
      entry.kind === "send-message"
        ? { ...entry, message: { type: "text", content } }
        : entry,
    );
    if (updated != null)
      this.tm.roster.emit({ type: "updated", entry: updated });
  }

  finalizeGroupMemberStream(
    roomSession: LiveSession,
    live: GroupMemberStream,
  ): void {
    try {
      if (this.tm.sessions.activeSession?.id === roomSession.id) {
        const leftovers = [...live.sealed];
        if (live.currentId != null) leftovers.push(live.currentId);
        for (const id of leftovers) {
          if (removeEntry(id)) this.tm.roster.emit({ type: "removed", id });
        }
      }
    } catch {
      // Preview cleanup is defensive: failures never fail the member turn.
    } finally {
      live.currentId = undefined;
      live.currentText = "";
      live.sealed.length = 0;
    }
  }

  readGroupHistory(session: LiveSession): GroupMessage[] {
    // The durable room is authoritative; a mounted transcript may be windowed or
    // not yet refreshed during startup. Streaming previews are not new messages.
    const entries = session.db.getTranscriptEntries();
    const messages: GroupMessage[] = [];
    for (const entry of entries) {
      if (entry.beebotNotice != null) continue;
      if (entry.kind === "user-attachment" && typeof entry.file_path === "string") {
        messages.push({ id: entry.id, speaker: { kind: "user" }, content: `User attached a file: ${JSON.stringify(entry.file_name ?? entry.file_path)}` });
      } else if (
        entry.kind === "message" &&
        entry.role === "user" &&
        String(entry.content ?? "").trim()
      ) {
        const name = (entry.fromUser as any)?.name;
        messages.push({
          id: entry.id,
          speaker: name == null ? { kind: "user" } : { kind: "user", name },
          content: String(entry.content),
        });
      } else if (
        entry.kind === "send-message" &&
        (entry.message as any)?.type === "text" &&
        entry.author != null &&
        entry.streaming !== true
      ) {
        messages.push({
          id: entry.id,
          speaker: {
            kind: "member",
            id: (entry.author as any).id,
            name: (entry.author as any).name,
          },
          content: (entry.message as any).content,
        });
      }
    }
    return messages;
  }
}

import {
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MAX_MEMBER_TURNS,
  resolveMessageResponders,
  SHARED_ROOM_HISTORY_LIMIT,
  buildGroupMemberSystemPrompt,
  buildGroupTurnPrompt,
  isPassContent,
  messagesSinceMemberLastSpoke,
  parseGroupMentions,
  type GroupDescription,
  type GroupMember,
  type GroupMessage,
} from "../../groups/group-chat.js";

export interface GroupOrchestratorDeps {
  resolveMembers(ids: readonly string[]): Promise<GroupMember[]>;
  readHistory(): readonly GroupMessage[];
  isCurrent(): boolean;
  runMemberTurn(args: {
    member: GroupMember;
    systemPrompt: string;
    prompt: string;
  }): Promise<readonly string[]>;
  postMemberMessage(member: GroupMember, content: string): void;
  finalizeMemberTurn?(member: GroupMember): void;
  isSharedRoom?: boolean;
}

/** A safety pause is not a successful delivery or a cancellation of external work. */
export class GroupChatTurnLimitError extends Error {
  readonly code = "group_turn_limit";
  constructor(readonly memberIds: readonly string[]) {
    super("Group discussion paused at its turn limit. Review the conversation before continuing; work has not been marked complete.");
    this.name = "GroupChatTurnLimitError";
  }
}

/** Message-led room: directed handoffs, concurrent open discussion, bounded follow-ups. */
export class GroupChatOrchestrator {
  constructor(readonly deps: GroupOrchestratorDeps) {}

  async run(args: {
    group: GroupDescription;
    memberIds: readonly string[];
  }): Promise<void> {
    // Ignore duplicates and unexpected resolver results, without replacing Bot identity.
    const resolved = await this.deps.resolveMembers(args.memberIds);
    const members = [...new Map(resolved.filter((member) => args.memberIds.includes(member.id)).map((member) => [member.id, member])).values()];
    if (members.length === 0 || !this.deps.isCurrent()) return;
    const turns = new Map<string, number>();
    const published = new Set<string>();
    let pending = this.deps.readHistory().slice(-1);
    let speakers = pending.length ? resolveMessageResponders(members, pending) : members;
    while (speakers.length && this.deps.isCurrent()) {
      const limited = speakers.filter((member) => (turns.get(member.id) || 0) >= GROUP_MAX_MEMBER_TURNS);
      if (limited.length) throw new GroupChatTurnLimitError(limited.map((member) => member.id));
      const next: GroupMessage[] = [];
      await Promise.allSettled(speakers.map(async (member) => {
        turns.set(member.id, (turns.get(member.id) || 0) + 1);
        await this.speak(args.group, member, members, published, next);
      }));
      pending = next;
      speakers = resolveMessageResponders(members, pending);
    }
  }

  private async speak(
    group: GroupDescription,
    member: GroupMember,
    members: readonly GroupMember[],
    published: Set<string>,
    next: GroupMessage[],
  ): Promise<number> {
    if (!this.deps.isCurrent()) return 0;
    try {
      const sent = await this.runOneTurn(group, member, members);
      let posted = 0;
      for (const content of sent) {
        if (!this.deps.isCurrent()) break;
        const key = JSON.stringify([member.id, content]);
        if (published.has(key)) continue;
        this.deps.postMemberMessage(member, content);
        published.add(key);
        next.push({ speaker: { kind: "member", id: member.id, name: member.name }, content });
        posted += 1;
      }
      return posted;
    } finally {
      this.deps.finalizeMemberTurn?.(member);
    }
  }

  async runOneTurn(
    group: GroupDescription,
    member: GroupMember,
    members: readonly GroupMember[],
  ): Promise<string[]> {
    const peers = members.filter((other) => other.id !== member.id);
    const history = this.deps.readHistory();
    const newMessages =
      this.deps.isSharedRoom === true
        ? history.slice(-SHARED_ROOM_HISTORY_LIMIT)
        : messagesSinceMemberLastSpoke(history, member.id);
    const addressed = [...newMessages].reverse().find((message) => !isPassContent(message.content));
    const targets = addressed ? parseGroupMentions(addressed.content, members) : null;
    const mentioned = targets != null && (targets.isEveryone || targets.memberIds.includes(member.id));
    const sent = await this.deps.runMemberTurn({
      member,
      systemPrompt: buildGroupMemberSystemPrompt(member, group, peers, {
        isSharedRoom: this.deps.isSharedRoom === true,
      }),
      prompt: buildGroupTurnPrompt({
        member,
        group,
        peers,
        newMessages,
        mentioned,
      }),
    });

    const spoken: string[] = [];
    for (const content of sent) {
      if (isPassContent(content)) continue;
      const trimmed = content.trim();
      if (trimmed.length === 0) continue;
      spoken.push(trimmed);
      if (spoken.length >= GROUP_MAX_MESSAGES_PER_TURN) break;
    }
    return spoken;
  }
}

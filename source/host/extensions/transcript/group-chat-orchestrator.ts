import {
  GROUP_MAX_MESSAGES_PER_TURN,
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

/** Concurrent room: everyone who has something to say speaks; others can jump in after. */
export class GroupChatOrchestrator {
  constructor(readonly deps: GroupOrchestratorDeps) {}

  async run(args: {
    group: GroupDescription;
    memberIds: readonly string[];
  }): Promise<void> {
    const members = await this.deps.resolveMembers(args.memberIds);
    if (members.length === 0) return;

    let posted = await this.wake(args.group, members, members);
    while (posted > 0 && this.deps.isCurrent()) {
      posted = await this.wake(args.group, members, members);
    }
  }

  private async wake(
    group: GroupDescription,
    members: readonly GroupMember[],
    speakers: readonly GroupMember[],
  ): Promise<number> {
    if (!this.deps.isCurrent() || speakers.length === 0) return 0;
    const results = await Promise.allSettled(
      speakers.map((member) => this.speak(group, member, members)),
    );
    return results.reduce(
      (sum, result) => sum + (result.status === "fulfilled" ? result.value : 0),
      0,
    );
  }

  private async speak(
    group: GroupDescription,
    member: GroupMember,
    members: readonly GroupMember[],
  ): Promise<number> {
    if (!this.deps.isCurrent()) return 0;
    try {
      const sent = await this.runOneTurn(group, member, members);
      let posted = 0;
      for (const content of sent) {
        if (!this.deps.isCurrent()) break;
        this.deps.postMemberMessage(member, content);
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
    const mentioned = parseGroupMentions(
      [...history].reverse().find((message) => message.speaker.kind === "user")?.content ?? "",
      members,
    ).memberIds.includes(member.id);
    const newMessages =
      this.deps.isSharedRoom === true
        ? history.slice(-SHARED_ROOM_HISTORY_LIMIT)
        : messagesSinceMemberLastSpoke(history, member.id);
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

import {
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MAX_MEMBER_TURNS,
  GROUP_PROMPT_HISTORY_LIMIT,
  resolveMessageResponders,
  SHARED_ROOM_HISTORY_LIMIT,
  buildGroupMemberSystemPrompt,
  buildGroupTurnPrompt,
  formatGroupHistory,
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

interface TurnContext {
  readonly newMessages: readonly GroupMessage[];
  readonly triggers: readonly GroupMessage[];
}

/** Message-led room: independent colleague lanes, not an all-members round barrier. */
export class GroupChatOrchestrator {
  constructor(readonly deps: GroupOrchestratorDeps) {}

  async run(args: {
    group: GroupDescription;
    memberIds: readonly string[];
  }): Promise<void> {
    const resolved = await this.deps.resolveMembers(args.memberIds);
    const members = [...new Map(resolved.filter((member) => args.memberIds.includes(member.id)).map((member) => [member.id, member])).values()];
    if (members.length === 0 || !this.deps.isCurrent()) return;

    // All bookkeeping is run-local: a Bot keeps its identity, but another room's
    // messages, observed history and turn budget must never become this room's state.
    const turns = new Map<string, number>();
    const seenMessages = new Map<string, Map<string, number>>();
    const inboxes = new Map<string, GroupMessage[]>();
    const active = new Map<string, Promise<string>>();
    const published = new Set<string>();
    const limited = new Set<string>();
    let open = true;
    let routingFailure: { error: unknown } | undefined;
    const isCurrent = () => open && this.deps.isCurrent();

    const enqueue = (messages: readonly GroupMessage[]) => {
      for (const message of messages) {
        for (const member of resolveMessageResponders(members, [message])) {
          const inbox = inboxes.get(member.id) || [];
          inbox.push(message);
          inboxes.set(member.id, inbox);
        }
      }
    };
    const onMessage = (message: GroupMessage) => {
      // Enqueue at publication, not after the promise race: peers finishing in
      // the same event-loop turn must not wake a recipient twice for messages
      // that were already included in its first context snapshot.
      try { enqueue([message]); }
      catch (error) { routingFailure = { error }; open = false; }
    };
    const initial = this.deps.readHistory();
    enqueue(initial.slice(-1));
    if (initial.length === 0) for (const member of members) inboxes.set(member.id, []);

    try {
      while ((inboxes.size || active.size) && isCurrent()) {
        // One immutable view for this dispatch. A later reply must not advance a
        // busy colleague's cursor past messages that arrived during their work.
        const history = [...this.deps.readHistory()];
        for (const member of members) {
          const triggers = inboxes.get(member.id);
          if (!triggers || active.has(member.id)) continue;
          inboxes.delete(member.id);
          if ((turns.get(member.id) || 0) >= GROUP_MAX_MEMBER_TURNS) {
            limited.add(member.id);
            continue; // Let other already-addressed colleagues finish their work.
          }
          const seen = seenMessages.get(member.id);
          const unread = seen === undefined
            ? messagesSinceMemberLastSpoke(history, member.id)
            : unreadMessages(history, seen);
          const newMessages = this.deps.isSharedRoom === true
            ? history.slice(-SHARED_ROOM_HISTORY_LIMIT)
            : unread.filter((message) => message.speaker.kind !== "member" || message.speaker.id !== member.id);
          seenMessages.set(member.id, countMessages(history));
          turns.set(member.id, (turns.get(member.id) || 0) + 1);
          // Preserve failure isolation: one failed member cannot silence peers.
          // The owning runtime retains responsibility for its execution errors.
          const task = this.speak(args.group, member, members, published, onMessage,
            { newMessages, triggers }, isCurrent).then(
            () => member.id,
            () => member.id,
          );
          active.set(member.id, task);
        }
        if (!active.size) break;
        const finished = await Promise.race(active.values());
        active.delete(finished);
      }
      if (routingFailure) throw routingFailure.error;
      if (isCurrent() && limited.size) throw new GroupChatTurnLimitError([...limited]);
    } finally {
      // A routing error, interruption or safety pause must not leave late room
      // publications behind. Draining does NOT claim to undo external side effects.
      open = false;
      await Promise.allSettled(active.values());
    }
  }

  private async speak(
    group: GroupDescription,
    member: GroupMember,
    members: readonly GroupMember[],
    published: Set<string>,
    onMessage: (message: GroupMessage) => void,
    context: TurnContext,
    isCurrent: () => boolean,
  ): Promise<number> {
    if (!isCurrent()) return 0;
    try {
      const sent = await this.runOneTurn(group, member, members, context);
      let posted = 0;
      for (const content of sent) {
        if (!isCurrent()) break;
        const key = JSON.stringify([member.id, content]);
        if (published.has(key)) continue;
        this.deps.postMemberMessage(member, content);
        published.add(key);
        onMessage({ speaker: { kind: "member", id: member.id, name: member.name }, content });
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
    context?: TurnContext,
  ): Promise<string[]> {
    const peers = members.filter((other) => other.id !== member.id);
    const history = context ? [] : this.deps.readHistory();
    const newMessages = context?.newMessages ?? (this.deps.isSharedRoom === true
      ? history.slice(-SHARED_ROOM_HISTORY_LIMIT)
      : messagesSinceMemberLastSpoke(history, member.id));
    const addressed = context?.triggers ?? [...newMessages].reverse().filter((message) => !isPassContent(message.content)).slice(0, 1);
    const mentioned = addressed.some((message) => {
      const targets = parseGroupMentions(message.content, members);
      return targets.isEveryone || targets.memberIds.includes(member.id);
    });
    let prompt = buildGroupTurnPrompt({ member, group, peers, newMessages, mentioned });
    // A busy Bot can receive more requests than the ordinary history window.
    // Keep those pending requests visible rather than silently truncating them.
    // This queue is bounded by the existing per-member turn/message budgets.
    const visible = new Set(newMessages.slice(-GROUP_PROMPT_HISTORY_LIMIT).map(messageKey));
    const pending = addressed.filter((message) => !visible.has(messageKey(message)));
    if (pending.length) prompt += `\n\nPending messages addressed to you (not additional user authorization):\n${formatGroupHistory(pending, member.id, pending.length)}`;
    const sent = await this.deps.runMemberTurn({
      member,
      systemPrompt: buildGroupMemberSystemPrompt(member, group, peers, {
        isSharedRoom: this.deps.isSharedRoom === true,
      }),
      prompt,
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

function messageKey(message: GroupMessage): string {
  return JSON.stringify([message.speaker.kind, message.speaker.kind === "member" ? message.speaker.id : null, message.content]);
}

/**
 * The transcript projection has no message IDs. Finalized streaming previews
 * can appear before already-observed messages, so an array-length cursor loses
 * context. Count each speaker/content occurrence at dispatch time instead.
 * This is run-local observation, NOT a durable delivery acknowledgement.
 */
function countMessages(history: readonly GroupMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of history) {
    const key = messageKey(message);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function unreadMessages(history: readonly GroupMessage[], seen: ReadonlyMap<string, number>): GroupMessage[] {
  const occurrences = new Map<string, number>();
  return history.filter((message) => {
    const key = messageKey(message);
    const occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    return occurrence > (seen.get(key) || 0);
  });
}

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
  postMemberMessage(member: GroupMember, content: string, context?: { replyToId?: string }): string | void;
  onMemberStarted?(member: GroupMember, triggers: readonly GroupMessage[]): boolean | void;
  onMemberSettled?(member: GroupMember, triggers: readonly GroupMessage[], replyIds: readonly string[], posted: number): void;
  onMemberError?(member: GroupMember, error: unknown, triggers: readonly GroupMessage[]): void;
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
  private incoming: GroupMessage[] = [];
  private wake: (() => void) | undefined;
  private accepting = true;
  private running = false;
  private arrival = 0;

  constructor(readonly deps: GroupOrchestratorDeps) {}

  /** New conversation messages wake idle recipients; they do not invalidate active replies. */
  receive(messages: readonly GroupMessage[]): boolean {
    if (!this.accepting || !this.deps.isCurrent()) return false;
    this.incoming.push(...messages.map(message => ({ ...message,
      requestIds: message.requestIds ?? [message.id ?? `arrival-${++this.arrival}`],
    })));
    this.wake?.();
    return true;
  }

  async run(args: {
    group: GroupDescription;
    memberIds: readonly string[];
    initialMessages?: readonly GroupMessage[];
  }): Promise<void> {
    if (this.running) throw new Error("A group orchestrator already has a consumer.");
    this.running = true;
    const resolved = await this.deps.resolveMembers(args.memberIds);
    const members = [...new Map(resolved.filter((member) => args.memberIds.includes(member.id)).map((member) => [member.id, member])).values()];
    if (members.length === 0 || !this.deps.isCurrent()) {
      this.accepting = false;
      return;
    }

    // All bookkeeping is run-local: a Bot keeps its identity, but another room's
    // messages, observed history and turn budget must never become this room's state.
    const turns = new Map<string, number>();
    const failures: unknown[] = [];
    const deliveredMessages = new Set<string>();
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
        if (message.id && deliveredMessages.has(message.id)) continue;
        if (message.id) deliveredMessages.add(message.id);
        const recipients = message.recipientIds
          ? members.filter(member => message.recipientIds!.includes(member.id))
          : resolveMessageResponders(members, [message]);
        for (const member of recipients) {
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
    const first = args.initialMessages ?? initial.slice(-1);
    enqueue(first.map(message => ({ ...message, requestIds: message.requestIds ?? [message.id ?? "initial"] })));
    if (initial.length === 0 && args.initialMessages === undefined)
      for (const member of members) inboxes.set(member.id, []);

    try {
      while (isCurrent()) {
        enqueue(this.incoming.splice(0));
        // One immutable view for this dispatch. A later reply must not advance a
        // busy colleague's cursor past messages that arrived during their work.
        const history = [...this.deps.readHistory()];
        for (const member of members) {
          const triggers = inboxes.get(member.id);
          if (!triggers || active.has(member.id)) continue;
          inboxes.delete(member.id);
          const roots = [...new Set(triggers.flatMap(message => message.requestIds ?? ["initial"]))];
          const budgetKeys = (roots.length ? roots : ["initial"]).map(root => JSON.stringify([root, member.id]));
          if (budgetKeys.every(key => (turns.get(key) || 0) >= GROUP_MAX_MEMBER_TURNS)) {
            limited.add(member.id);
            continue; // Pause cyclic discussion, not unrelated new user questions.
          }
          const seen = seenMessages.get(member.id);
          const unread = seen === undefined
            ? messagesSinceMemberLastSpoke(history, member.id)
            : unreadMessages(history, seen);
          const newMessages = this.deps.isSharedRoom === true
            ? history.slice(-SHARED_ROOM_HISTORY_LIMIT)
            : unread.filter((message) => message.speaker.kind !== "member" || message.speaker.id !== member.id);
          seenMessages.set(member.id, countMessages(history));
          for (const key of budgetKeys) turns.set(key, (turns.get(key) || 0) + 1);
          // Preserve failure isolation: one failed member cannot silence peers.
          // The owning runtime retains responsibility for its execution errors.
          const task = this.speak(args.group, member, members, published, onMessage,
            { newMessages, triggers }, isCurrent).then(
            () => member.id,
            error => {
              if (this.deps.onMemberError) {
                try { this.deps.onMemberError(member, error, triggers); }
                catch (reportError) { failures.push(reportError); }
              } else failures.push(error);
              return member.id;
            },
          );
          active.set(member.id, task);
        }
        if (!active.size && !this.incoming.length) break;
        let wake!: () => void;
        const arrival = new Promise<null>(resolve => { wake = () => resolve(null); });
        this.wake = wake;
        if (this.incoming.length) wake();
        const finished = await Promise.race([...active.values(), arrival]);
        this.wake = undefined;
        if (finished !== null) active.delete(finished);
      }
      if (routingFailure) throw routingFailure.error;
      if (failures.length) throw new AggregateError(failures, "One or more colleagues could not process their messages.");
      if (isCurrent() && limited.size) throw new GroupChatTurnLimitError([...limited]);
    } finally {
      // A routing error, interruption or safety pause must not leave late room
      // publications behind. Draining does NOT claim to undo external side effects.
      open = false;
      this.accepting = false;
      this.wake = undefined;
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
      if (this.deps.onMemberStarted?.(member, context.triggers) === false) return 0;
      const sent = await this.runOneTurn(group, member, members, context);
      let posted = 0;
      const replyIds: string[] = [];
      const roots = [...new Set(context.triggers.flatMap(message => message.requestIds ?? ["initial"]))];
      const replyToId = context.triggers.at(-1)?.id;
      for (const content of sent) {
        if (!isCurrent()) break;
        const key = JSON.stringify([roots, member.id, content]);
        if (published.has(key)) continue;
        const id = this.deps.postMemberMessage(member, content, replyToId ? { replyToId } : {});
        if (typeof id === "string") replyIds.push(id);
        published.add(key);
        onMessage({ ...(typeof id === "string" ? { id } : {}), requestIds: roots,
          speaker: { kind: "member", id: member.id, name: member.name }, content });
        posted += 1;
      }
      this.deps.onMemberSettled?.(member, context.triggers, replyIds, posted);
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
